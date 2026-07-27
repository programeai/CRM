import { AuditService } from './audit.service';
import {
  ACCESS_CONTEXT,
  type AccessContext,
} from '../access/domain/access-context';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PrismaAdminService } from '../../prisma/prisma-admin.service';

const ACCESS: AccessContext = {
  userId: 'u1',
  userName: 'Colaboradora',
  ownerId: 'owner-1',
  isOwner: false,
  roleId: 'r1',
  roleName: 'Comercial',
  permissions: [],
};

describe('AuditService', () => {
  let auditLogCreate: jest.Mock;
  let adminAuditLogCreate: jest.Mock;
  let prisma: PrismaService;
  let admin: PrismaAdminService;
  let cls: { get: jest.Mock; getId: jest.Mock };
  let service: AuditService;

  beforeEach(() => {
    auditLogCreate = jest.fn().mockResolvedValue(undefined);
    adminAuditLogCreate = jest.fn().mockResolvedValue(undefined);
    prisma = {
      db: { auditLog: { create: auditLogCreate } },
    } as unknown as PrismaService;
    admin = {
      auditLog: { create: adminAuditLogCreate },
    } as unknown as PrismaAdminService;
    cls = { get: jest.fn(), getId: jest.fn().mockReturnValue('req-1') };
    service = new AuditService(prisma, admin, cls as never);
  });

  describe('registrar', () => {
    it('grava actorType USER com actorId/actorName vindos do CLS', async () => {
      cls.get.mockReturnValue(ACCESS);

      await service.registrar({
        entity: 'PAYMENT',
        entityId: 'p1',
        entityLabel: 'Mensalidade 07/2026',
        action: 'PAGAR',
        antes: { status: 'PENDING' },
        depois: { status: 'PAID' },
      });

      expect(cls.get).toHaveBeenCalledWith(ACCESS_CONTEXT);
      expect(auditLogCreate).toHaveBeenCalledWith({
        data: {
          ownerId: 'owner-1',
          actorType: 'USER',
          actorId: 'u1',
          actorName: 'Colaboradora',
          entity: 'PAYMENT',
          entityId: 'p1',
          entityLabel: 'Mensalidade 07/2026',
          action: 'PAGAR',
          diff: { status: { antes: 'PENDING', depois: 'PAID' } },
          requestId: 'req-1',
        },
      });
    });

    it('sem contexto no CLS, não grava e emite auditoria.sem_contexto', async () => {
      cls.get.mockReturnValue(undefined);
      const warnSpy = jest
        .spyOn(
          (service as unknown as { logger: { warn: jest.Mock } }).logger,
          'warn',
        )
        .mockImplementation(() => undefined);

      await service.registrar({
        entity: 'CLIENT',
        entityId: 'c1',
        entityLabel: 'Cliente X',
        action: 'ARQUIVAR',
      });

      expect(auditLogCreate).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ evento: 'auditoria.sem_contexto' }),
      );
    });

    it('propaga a exceção do create (garante a atomicidade)', async () => {
      cls.get.mockReturnValue(ACCESS);
      auditLogCreate.mockRejectedValue(new Error('falhou'));

      await expect(
        service.registrar({
          entity: 'PAYMENT',
          entityId: 'p1',
          entityLabel: 'Mensalidade',
          action: 'PAGAR',
        }),
      ).rejects.toThrow('falhou');
    });
  });

  describe('registrarPeloSistema', () => {
    it('usa o client admin e grava actorId null', async () => {
      await service.registrarPeloSistema({
        ownerId: 'owner-2',
        actorType: 'CRON',
        actorName: 'Rotina diária',
        entity: 'PAYMENT',
        entityId: 'p2',
        entityLabel: 'Mensalidade 08/2026',
        action: 'VENCER',
        antes: { status: 'PENDING' },
        depois: { status: 'OVERDUE' },
      });

      expect(adminAuditLogCreate).toHaveBeenCalledWith({
        data: {
          ownerId: 'owner-2',
          actorType: 'CRON',
          actorId: null,
          actorName: 'Rotina diária',
          entity: 'PAYMENT',
          entityId: 'p2',
          entityLabel: 'Mensalidade 08/2026',
          action: 'VENCER',
          diff: { status: { antes: 'PENDING', depois: 'OVERDUE' } },
          requestId: 'req-1',
        },
      });
      expect(auditLogCreate).not.toHaveBeenCalled();
    });

    it('não propaga exceção — engole e loga auditoria.registro_falhou', async () => {
      adminAuditLogCreate.mockRejectedValue(new Error('conexão caiu'));
      const errorSpy = jest
        .spyOn(
          (service as unknown as { logger: { error: jest.Mock } }).logger,
          'error',
        )
        .mockImplementation(() => undefined);

      await expect(
        service.registrarPeloSistema({
          ownerId: 'owner-2',
          actorType: 'CRON',
          actorName: 'Rotina diária',
          entity: 'PAYMENT',
          entityId: 'p2',
          entityLabel: 'Mensalidade',
          action: 'VENCER',
        }),
      ).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ evento: 'auditoria.registro_falhou' }),
        expect.any(String),
      );
    });
  });

  describe('diff', () => {
    it('sai undefined quando antes/depois não são passados e não há extra', async () => {
      cls.get.mockReturnValue(ACCESS);

      await service.registrar({
        entity: 'CLIENT',
        entityId: 'c1',
        entityLabel: 'Cliente X',
        action: 'ARQUIVAR',
      });

      expect(auditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ diff: undefined }),
        }),
      );
    });

    it('extra é mesclado ao diff calculado', async () => {
      cls.get.mockReturnValue(ACCESS);

      await service.registrar({
        entity: 'CONTRACT',
        entityId: 'ct1',
        entityLabel: 'Contrato X',
        action: 'CANCELAR',
        antes: { status: 'ACTIVE' },
        depois: { status: 'CANCELED' },
        extra: { cobrancasCanceladas: 3 },
      });

      expect(auditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            diff: {
              status: { antes: 'ACTIVE', depois: 'CANCELED' },
              cobrancasCanceladas: 3,
            },
          }),
        }),
      );
    });

    it('extra sozinho (sem antes/depois) também gera diff', async () => {
      cls.get.mockReturnValue(ACCESS);

      await service.registrar({
        entity: 'PROPOSAL',
        entityId: 'pr1',
        entityLabel: 'PROP-2026-0001',
        action: 'ACEITAR',
        extra: { dealMovidoParaGanhou: true },
      });

      expect(auditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            diff: { dealMovidoParaGanhou: true },
          }),
        }),
      );
    });
  });
});
