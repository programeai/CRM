import { AccessRecordsService } from './access-records.service';
import type { PrismaService } from '../../prisma/prisma.service';

describe('AccessRecordsService', () => {
  let create: jest.Mock;
  let deleteMany: jest.Mock;
  let prisma: {
    db: { accessRecord: { create: jest.Mock; deleteMany: jest.Mock } };
  };
  let service: AccessRecordsService;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    create = jest.fn().mockResolvedValue(undefined);
    deleteMany = jest.fn().mockResolvedValue({ count: 3 });
    prisma = { db: { accessRecord: { create, deleteMany } } };
    service = new AccessRecordsService(prisma as unknown as PrismaService);
    errorSpy = jest
      .spyOn(
        (service as unknown as { logger: { error: jest.Mock } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);
  });

  describe('registrar', () => {
    it('grava com o userAgent truncado em 255 caracteres', async () => {
      const userAgent = 'x'.repeat(400);
      await service.registrar({ userId: 'u1', kind: 'LOGIN', userAgent });

      const [{ data }] = create.mock.calls[0] as [
        { data: { userAgent: string } },
      ];
      expect(data.userAgent).toHaveLength(255);
    });

    it('falha do banco é engolida e logada em error, não propaga', async () => {
      create.mockRejectedValue(new Error('conexão perdida'));
      await expect(
        service.registrar({ userId: 'u1', kind: 'LOGIN' }),
      ).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ evento: 'acesso.registro_falhou' }),
        expect.any(String),
      );
    });
  });

  describe('purgeBefore', () => {
    it('usa lt na data de corte e devolve a contagem', async () => {
      const corte = new Date('2026-01-01');
      const resultado = await service.purgeBefore(corte);

      expect(deleteMany).toHaveBeenCalledWith({
        where: { createdAt: { lt: corte } },
      });
      expect(resultado).toBe(3);
    });
  });
});
