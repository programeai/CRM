import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../../prisma/prisma.service';
import { TokenLegadoService } from './token-legado.service';

const TOKEN = 'token-de-ingestao-do-ambiente';

describe('TokenLegadoService', () => {
  const OWNER = 'owner-1';

  let env: Record<string, string>;
  let findFirst: jest.Mock;
  let service: TokenLegadoService;

  beforeEach(() => {
    env = {
      LEAD_INTAKE_TOKEN: TOKEN,
      LEAD_INTAKE_OWNER_EMAIL: 'dono@teste.local',
    };
    findFirst = jest.fn().mockResolvedValue({ id: OWNER });
    service = new TokenLegadoService(
      { get: (chave: string) => env[chave] } as unknown as ConfigService,
      { db: { user: { findFirst } } } as unknown as PrismaService,
    );
  });

  describe('confere', () => {
    it('reconhece o token do ambiente', () => {
      expect(service.confere(TOKEN)).toBe(true);
    });

    it('recusa token diferente', () => {
      // Tamanho diferente de propósito: o digest normaliza os dois em 32 bytes,
      // então `timingSafeEqual` não lança (e não vaza o tamanho do segredo).
      expect(service.confere('outro-valor-qualquer-bem-mais-longo')).toBe(
        false,
      );
    });

    it('sem LEAD_INTAKE_TOKEN configurado devolve false, e não lança', () => {
      env = {};
      // É o estado NORMAL depois da migração: a credencial segue para a
      // autenticação por chave, que é o caminho novo.
      expect(service.confere(TOKEN)).toBe(false);
    });
  });

  describe('resolverOwner', () => {
    it('devolve o owner do e-mail configurado', async () => {
      await expect(service.resolverOwner()).resolves.toBe(OWNER);
      // Colaborador não serve: a busca exige ownerId nulo (dono de workspace).
      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { email: 'dono@teste.local', ownerId: null },
        }),
      );
    });

    it('recusa a ingestão sem conta de destino configurada', async () => {
      env = { LEAD_INTAKE_TOKEN: TOKEN };

      await expect(service.resolverOwner()).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('recusa quando o e-mail configurado não corresponde a nenhum owner', async () => {
      findFirst.mockResolvedValue(null);

      await expect(service.resolverOwner()).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });
});
