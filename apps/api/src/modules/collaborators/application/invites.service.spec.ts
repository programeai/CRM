import { ForbiddenException, GoneException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import * as argon2 from 'argon2';
import { InvitesService, INVITE_TTL_DAYS } from './invites.service';
import type { MailService } from '../../../mail/mail.service';
import type {
  InviteRepository,
  InviteWithUser,
} from '../domain/invite.repository';
import type { AuditService } from '../../audit/audit.service';

const TOKEN = 'token-em-claro';
const hashOf = (raw: string) => createHash('sha256').update(raw).digest('hex');

function invite(overrides: Partial<InviteWithUser> = {}): InviteWithUser {
  return {
    id: 'i1',
    ownerId: 'owner-1',
    userId: 'c1',
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
    user: {
      id: 'c1',
      name: 'Ana',
      email: 'ana@exemplo.com',
      active: true,
      acceptedAt: null,
    },
    owner: { name: 'Edson' },
    ...overrides,
  };
}

describe('InvitesService', () => {
  let repo: jest.Mocked<InviteRepository>;
  let mail: jest.Mocked<Pick<MailService, 'sendCollaboratorInvite'>>;
  let audit: { registrarPeloSistema: jest.Mock };
  let service: InvitesService;

  beforeEach(() => {
    repo = {
      replaceForUser: jest.fn().mockResolvedValue(undefined),
      findByTokenHash: jest.fn().mockResolvedValue(invite()),
      consumeAndActivate: jest.fn().mockResolvedValue(true),
    };
    mail = { sendCollaboratorInvite: jest.fn().mockResolvedValue(undefined) };
    const config = {
      get: jest.fn().mockReturnValue('https://crm.exemplo.com'),
    } as unknown as ConfigService;

    audit = { registrarPeloSistema: jest.fn().mockResolvedValue(undefined) };

    service = new InvitesService(
      repo,
      mail as unknown as MailService,
      config,
      audit as unknown as AuditService,
    );
  });

  describe('issue', () => {
    it('grava só o hash do token e devolve o link com o valor em claro', async () => {
      const url = await service.issue({
        ownerId: 'owner-1',
        ownerName: 'Edson',
        userId: 'c1',
        name: 'Ana',
        email: 'ana@exemplo.com',
        roleName: 'Comercial',
      });

      const rawToken = url.split('/convite/')[1];
      expect(url).toBe(`https://crm.exemplo.com/convite/${rawToken}`);

      const gravado = repo.replaceForUser.mock.calls[0][0];
      expect(gravado.tokenHash).toBe(hashOf(rawToken));
      // O token em claro nunca vai para o banco.
      expect(JSON.stringify(gravado)).not.toContain(rawToken);
      expect(mail.sendCollaboratorInvite).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'ana@exemplo.com', inviteUrl: url }),
      );
    });

    it('define a expiração conforme o TTL do convite', async () => {
      const antes = Date.now();
      await service.issue({
        ownerId: 'owner-1',
        ownerName: 'Edson',
        userId: 'c1',
        name: 'Ana',
        email: 'ana@exemplo.com',
        roleName: 'Comercial',
      });

      const { expiresAt } = repo.replaceForUser.mock.calls[0][0];
      const dias = (expiresAt.getTime() - antes) / (24 * 60 * 60 * 1000);
      expect(dias).toBeCloseTo(INVITE_TTL_DAYS, 1);
    });
  });

  describe('preview', () => {
    it('devolve o convidado e quem convidou', async () => {
      await expect(service.preview(TOKEN)).resolves.toEqual({
        name: 'Ana',
        email: 'ana@exemplo.com',
        ownerName: 'Edson',
      });
      expect(repo.findByTokenHash).toHaveBeenCalledWith(hashOf(TOKEN));
    });

    it('recusa token inexistente', async () => {
      repo.findByTokenHash.mockResolvedValue(null);
      await expect(service.preview(TOKEN)).rejects.toBeInstanceOf(
        GoneException,
      );
    });

    it('recusa token já usado', async () => {
      repo.findByTokenHash.mockResolvedValue(invite({ usedAt: new Date() }));
      await expect(service.preview(TOKEN)).rejects.toBeInstanceOf(
        GoneException,
      );
    });

    it('recusa token expirado', async () => {
      repo.findByTokenHash.mockResolvedValue(
        invite({ expiresAt: new Date(Date.now() - 1) }),
      );
      await expect(service.preview(TOKEN)).rejects.toBeInstanceOf(
        GoneException,
      );
    });

    it('recusa convite de quem já ativou o acesso', async () => {
      repo.findByTokenHash.mockResolvedValue(
        invite({
          user: {
            id: 'c1',
            name: 'Ana',
            email: 'ana@exemplo.com',
            active: true,
            acceptedAt: new Date(),
          },
        }),
      );
      await expect(service.preview(TOKEN)).rejects.toBeInstanceOf(
        GoneException,
      );
    });

    it('distingue o acesso desativado do convite inválido', async () => {
      repo.findByTokenHash.mockResolvedValue(
        invite({
          user: {
            id: 'c1',
            name: 'Ana',
            email: 'ana@exemplo.com',
            active: false,
            acceptedAt: null,
          },
        }),
      );
      await expect(service.preview(TOKEN)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('accept', () => {
    it('grava a senha com hash e devolve o id do colaborador', async () => {
      await expect(service.accept(TOKEN, 'senha-segura')).resolves.toBe('c1');

      const { passwordHash } = repo.consumeAndActivate.mock.calls[0][0];
      expect(passwordHash).not.toBe('senha-segura');
      await expect(argon2.verify(passwordHash, 'senha-segura')).resolves.toBe(
        true,
      );
    });

    it('recusa quando o convite foi consumido em paralelo (uso único)', async () => {
      repo.consumeAndActivate.mockResolvedValue(false);
      await expect(
        service.accept(TOKEN, 'senha-segura'),
      ).rejects.toBeInstanceOf(GoneException);
    });

    it('registra o aceite na trilha com o convidado como autor', async () => {
      await service.accept(TOKEN, 'senha-segura');

      // Rota pública: sem CLS de acesso, mas o autor é conhecido.
      expect(audit.registrarPeloSistema).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: 'owner-1',
          actorType: 'USER',
          actorId: 'c1',
          actorName: 'Ana',
          entity: 'USER',
          entityId: 'c1',
          action: 'ACEITAR',
          extra: { conviteId: 'i1' },
        }),
      );
    });
  });
});
