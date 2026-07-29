import { ConflictException, ForbiddenException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AccountDeletionService } from './account-deletion.service';
import type {
  AccountRepository,
  ContaDoTitular,
} from '../domain/account.repository';
import type { AuditService } from '../../audit/audit.service';
import type { MailService } from '../../../mail/mail.service';

const OWNER = 'owner-1';
const SENHA = 'senha-de-teste-123';

function conta(overrides: Partial<ContaDoTitular> = {}): ContaDoTitular {
  return {
    id: OWNER,
    name: 'Fulana',
    email: 'fulana@teste.local',
    passwordHash: null,
    passwordSetAt: null,
    deletionRequestedAt: null,
    deletionScheduledFor: null,
    ...overrides,
  };
}

describe('AccountDeletionService', () => {
  let repo: jest.Mocked<AccountRepository>;
  let audit: { registrar: jest.Mock };
  let mail: { sendAccountDeletionScheduled: jest.Mock };
  let service: AccountDeletionService;
  let hashDaSenha: string;

  beforeAll(async () => {
    hashDaSenha = await argon2.hash(SENHA);
  });

  beforeEach(() => {
    repo = {
      findById: jest
        .fn()
        .mockResolvedValue(
          conta({ passwordHash: hashDaSenha, passwordSetAt: new Date() }),
        ),
      agendarEncerramento: jest.fn().mockResolvedValue(undefined),
      cancelarEncerramento: jest.fn().mockResolvedValue(undefined),
    };
    audit = { registrar: jest.fn().mockResolvedValue(undefined) };
    mail = {
      sendAccountDeletionScheduled: jest.fn().mockResolvedValue(undefined),
    };
    service = new AccountDeletionService(
      repo,
      audit as unknown as AuditService,
      mail as unknown as MailService,
    );
  });

  describe('solicitar — conta com senha', () => {
    it('senha certa agenda hoje + 30 dias', async () => {
      const resultado = await service.solicitar(OWNER, { password: SENHA });
      const dias =
        (resultado.scheduledFor.getTime() - resultado.requestedAt.getTime()) /
        (24 * 60 * 60 * 1000);
      expect(dias).toBeCloseTo(30, 5);
      expect(repo.agendarEncerramento).toHaveBeenCalledWith(OWNER, resultado);
    });

    it('senha errada lança ForbiddenException e não grava nada', async () => {
      await expect(
        service.solicitar(OWNER, { password: 'errada' }),
      ).rejects.toThrow(ForbiddenException);
      expect(repo.agendarEncerramento).not.toHaveBeenCalled();
    });

    it('e-mail enviado no lugar da senha não substitui: rejeita', async () => {
      await expect(
        service.solicitar(OWNER, { email: 'fulana@teste.local' }),
      ).rejects.toThrow(ForbiddenException);
      expect(repo.agendarEncerramento).not.toHaveBeenCalled();
    });

    it('registra a trilha com ACCOUNT/ENCERRAR e envia o e-mail de aviso', async () => {
      await service.solicitar(OWNER, { password: SENHA });
      expect(audit.registrar).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'ACCOUNT', action: 'ENCERRAR' }),
      );
      expect(mail.sendAccountDeletionScheduled).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'fulana@teste.local' }),
      );
    });
  });

  describe('solicitar — conta de login social (senha aleatória)', () => {
    beforeEach(() => {
      // A conta criada por OAuth TEM hash — o da senha aleatória do cadastro —
      // e mesmo assim confirma por e-mail, porque `passwordSetAt` é nulo. É o
      // ramo que trancaria o titular para fora se alguém voltasse a decidir
      // pelo `passwordHash`.
      repo.findById.mockResolvedValue(
        conta({ passwordHash: hashDaSenha, passwordSetAt: null }),
      );
    });

    it('e-mail exato agenda o encerramento', async () => {
      await service.solicitar(OWNER, { email: 'fulana@teste.local' });
      expect(repo.agendarEncerramento).toHaveBeenCalled();
    });

    it('e-mail com caixa/espaço diferentes ainda é aceito', async () => {
      await service.solicitar(OWNER, { email: '  Fulana@Teste.Local  ' });
      expect(repo.agendarEncerramento).toHaveBeenCalled();
    });

    it('e-mail errado lança ForbiddenException', async () => {
      await expect(
        service.solicitar(OWNER, { email: 'outro@teste.local' }),
      ).rejects.toThrow(ForbiddenException);
      expect(repo.agendarEncerramento).not.toHaveBeenCalled();
    });

    it('senha enviada numa conta de login social não substitui o e-mail', async () => {
      // `SENHA` casa com o hash guardado: se o ramo olhasse `passwordHash`,
      // este encerramento passaria. Tem de reprovar mesmo assim.
      await expect(
        service.solicitar(OWNER, { password: SENHA }),
      ).rejects.toThrow(ForbiddenException);
      expect(repo.agendarEncerramento).not.toHaveBeenCalled();
    });
  });

  it('segundo pedido com agendamento vigente responde 409', async () => {
    repo.findById.mockResolvedValue(
      conta({
        passwordHash: hashDaSenha,
        passwordSetAt: new Date(),
        deletionScheduledFor: new Date(),
      }),
    );
    await expect(service.solicitar(OWNER, { password: SENHA })).rejects.toThrow(
      ConflictException,
    );
  });

  describe('cancelar', () => {
    it('zera o agendamento e registra ACCOUNT/CANCELAR', async () => {
      repo.findById.mockResolvedValue(
        conta({ deletionScheduledFor: new Date() }),
      );
      await service.cancelar(OWNER);
      expect(repo.cancelarEncerramento).toHaveBeenCalledWith(OWNER);
      expect(audit.registrar).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'ACCOUNT', action: 'CANCELAR' }),
      );
    });

    it('cancelar sem agendamento responde 409', async () => {
      repo.findById.mockResolvedValue(conta({ deletionScheduledFor: null }));
      await expect(service.cancelar(OWNER)).rejects.toThrow(ConflictException);
    });
  });

  it('nenhum caminho chama o Stripe — o service não conhece billing', async () => {
    // Não há injeção de StripeService/BillingService no construtor: se algum
    // caminho precisasse dele, o TypeScript já teria barrado a compilação.
    await service.solicitar(OWNER, { password: SENHA });
    expect(Object.keys(service)).not.toContain('stripe');
    expect(Object.keys(service)).not.toContain('billing');
  });
});
