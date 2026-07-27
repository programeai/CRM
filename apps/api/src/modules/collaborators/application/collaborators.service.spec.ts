import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CollaboratorsService } from './collaborators.service';
import type {
  CollaboratorRepository,
  CollaboratorView,
} from '../domain/collaborator.repository';
import type { InvitesService } from './invites.service';
import type { RolesService } from './roles.service';
import type { AuditService } from '../../audit/audit.service';

const OWNER = 'owner-1';

function collaborator(
  overrides: Partial<CollaboratorView> = {},
): CollaboratorView {
  return {
    id: 'c1',
    name: 'Ana',
    email: 'ana@exemplo.com',
    active: true,
    acceptedAt: new Date('2026-07-10T00:00:00Z'),
    createdAt: new Date('2026-07-01T00:00:00Z'),
    role: { id: 'r1', name: 'Comercial', system: false },
    ...overrides,
  };
}

describe('CollaboratorsService', () => {
  let repo: jest.Mocked<CollaboratorRepository>;
  let roles: jest.Mocked<Pick<RolesService, 'findOrFail'>>;
  let invites: jest.Mocked<Pick<InvitesService, 'issue'>>;
  let audit: { registrar: jest.Mock };
  let service: CollaboratorsService;

  beforeEach(() => {
    repo = {
      findManyByOwner: jest.fn(),
      findByIdAndOwner: jest.fn(),
      findOwnerName: jest.fn().mockResolvedValue('Edson'),
      existsByEmail: jest.fn().mockResolvedValue(false),
      create: jest.fn().mockResolvedValue(collaborator({ acceptedAt: null })),
      update: jest.fn().mockResolvedValue(collaborator()),
      revokeSessions: jest.fn().mockResolvedValue(1),
    };
    roles = {
      findOrFail: jest
        .fn()
        .mockResolvedValue({ id: 'r1', name: 'Comercial', system: false }),
    };
    invites = { issue: jest.fn().mockResolvedValue('https://crm/convite/tok') };

    audit = { registrar: jest.fn().mockResolvedValue(undefined) };

    service = new CollaboratorsService(
      repo,
      roles as unknown as RolesService,
      invites as unknown as InvitesService,
      audit as unknown as AuditService,
    );
  });

  describe('invite', () => {
    it('normaliza o e-mail, cria sem senha e devolve o link do convite', async () => {
      const result = await service.invite(OWNER, {
        name: '  Ana  ',
        email: '  Ana@Exemplo.com ',
        roleId: 'r1',
      });

      expect(repo.create).toHaveBeenCalledWith({
        ownerId: OWNER,
        name: 'Ana',
        email: 'ana@exemplo.com',
        roleId: 'r1',
      });
      expect(result.inviteUrl).toBe('https://crm/convite/tok');
      expect(result.collaborator.status).toBe('PENDING');
    });

    it('rejeita e-mail que já existe em qualquer conta', async () => {
      repo.existsByEmail.mockResolvedValue(true);

      await expect(
        service.invite(OWNER, {
          name: 'Ana',
          email: 'ana@exemplo.com',
          roleId: 'r1',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('cria colaborador por convite mesmo com o autocadastro fechado', async () => {
      // Contrato explícito: REGISTRATION_ENABLED só freia AUTOcadastro (o
      // register e a criação de conta nova por OAuth, ambos no AuthService).
      // Convite é ação deliberada do owner e não passa por lá — este serviço
      // não lê a flag de lugar nenhum, nem por ConfigService nem por env.
      const anterior = process.env.REGISTRATION_ENABLED;
      process.env.REGISTRATION_ENABLED = 'false';
      try {
        const result = await service.invite(OWNER, {
          name: 'Ana',
          email: 'ana@exemplo.com',
          roleId: 'r1',
        });
        expect(repo.create).toHaveBeenCalled();
        expect(result.inviteUrl).toBe('https://crm/convite/tok');
      } finally {
        if (anterior === undefined) delete process.env.REGISTRATION_ENABLED;
        else process.env.REGISTRATION_ENABLED = anterior;
      }
    });

    it('rejeita papel que não é do owner', async () => {
      roles.findOrFail.mockRejectedValue(new NotFoundException());

      await expect(
        service.invite(OWNER, {
          name: 'Ana',
          email: 'ana@exemplo.com',
          roleId: 'de-outro-owner',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('resendInvite', () => {
    it('recusa reenviar para quem já ativou o acesso', async () => {
      repo.findByIdAndOwner.mockResolvedValue(collaborator());

      await expect(service.resendInvite(OWNER, 'c1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(invites.issue).not.toHaveBeenCalled();
    });

    it('reemite para convite pendente', async () => {
      repo.findByIdAndOwner.mockResolvedValue(
        collaborator({ acceptedAt: null }),
      );

      await expect(service.resendInvite(OWNER, 'c1')).resolves.toEqual({
        inviteUrl: 'https://crm/convite/tok',
      });
    });
  });

  describe('update', () => {
    it('impede alterar o próprio acesso', async () => {
      await expect(
        service.update({ ownerId: OWNER, requesterId: 'c1' }, 'c1', {
          active: false,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('falha com 404 para colaborador de outro owner', async () => {
      repo.findByIdAndOwner.mockResolvedValue(null);

      await expect(
        service.update({ ownerId: OWNER, requesterId: OWNER }, 'x', {
          active: false,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('revoga a sessão ao desativar', async () => {
      repo.findByIdAndOwner.mockResolvedValue(collaborator());
      repo.update.mockResolvedValue(collaborator({ active: false }));

      await service.update({ ownerId: OWNER, requesterId: OWNER }, 'c1', {
        active: false,
      });

      expect(repo.revokeSessions).toHaveBeenCalledWith('c1', OWNER);
    });

    it('registra a desativação na trilha de auditoria', async () => {
      repo.findByIdAndOwner.mockResolvedValue(collaborator());
      repo.update.mockResolvedValue(collaborator({ active: false }));

      await service.update({ ownerId: OWNER, requesterId: OWNER }, 'c1', {
        active: false,
      });

      expect(audit.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'USER',
          action: 'DESATIVAR',
          entityId: 'c1',
          entityLabel: 'Ana',
        }),
      );
    });

    it('registra a troca de papel com o NOME do papel no diff', async () => {
      repo.findByIdAndOwner.mockResolvedValue(collaborator());
      repo.update.mockResolvedValue(
        collaborator({ role: { id: 'r2', name: 'Financeiro', system: false } }),
      );

      await service.update({ ownerId: OWNER, requesterId: OWNER }, 'c1', {
        roleId: 'r2',
      });

      expect(audit.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'USER',
          action: 'ALTERAR_PAPEL',
          entityId: 'c1',
          antes: { papel: 'Comercial' },
          depois: { papel: 'Financeiro' },
        }),
      );
    });

    it('não revoga a sessão ao apenas trocar o papel', async () => {
      repo.findByIdAndOwner.mockResolvedValue(collaborator());
      roles.findOrFail.mockResolvedValue({
        id: 'r2',
        name: 'Financeiro',
        system: false,
      });

      await service.update({ ownerId: OWNER, requesterId: OWNER }, 'c1', {
        roleId: 'r2',
      });

      expect(repo.update).toHaveBeenCalledWith('c1', OWNER, { roleId: 'r2' });
      expect(repo.revokeSessions).not.toHaveBeenCalled();
    });

    it('valida que o novo papel é do owner antes de trocar', async () => {
      repo.findByIdAndOwner.mockResolvedValue(collaborator());
      roles.findOrFail.mockRejectedValue(new NotFoundException());

      await expect(
        service.update({ ownerId: OWNER, requesterId: OWNER }, 'c1', {
          roleId: 'de-outro-owner',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.update).not.toHaveBeenCalled();
    });
  });
});
