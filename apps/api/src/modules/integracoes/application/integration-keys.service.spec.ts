import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { IntegrationKeysService } from './integration-keys.service';
import type {
  IntegrationKeyRecord,
  IntegrationKeyRepository,
} from '../domain/integration-key.repository';
import type { AuditService } from '../../audit/audit.service';

const OWNER = 'owner-1';

function chave(
  overrides: Partial<IntegrationKeyRecord> = {},
): IntegrationKeyRecord {
  return {
    id: 'chave-1',
    ownerId: OWNER,
    name: 'Site',
    prefix: 'crm_aabbccdd',
    scopes: ['lead:receber'],
    lastUsedAt: null,
    revokedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('IntegrationKeysService', () => {
  let repo: jest.Mocked<IntegrationKeyRepository>;
  let audit: { registrar: jest.Mock };
  let service: IntegrationKeysService;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    repo = {
      findManyByOwner: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue(chave()),
      // Ecoa nome/prefixo/escopos recebidos — como o Prisma faria de verdade —
      // para o teste poder comparar a chave devolvida com o valor gerado.
      create: jest
        .fn()
        .mockImplementation(
          (data: { name: string; prefix: string; scopes: string[] }) =>
            Promise.resolve(
              chave({
                name: data.name,
                prefix: data.prefix,
                scopes: data.scopes,
              }),
            ),
        ),
      replaceSecret: jest
        .fn()
        .mockImplementation(
          (_ownerId: string, _id: string, data: { prefix: string }) =>
            Promise.resolve(chave({ prefix: data.prefix })),
        ),
      revoke: jest.fn().mockResolvedValue(chave({ revokedAt: new Date() })),
      delete: jest.fn().mockResolvedValue(undefined),
      touch: jest.fn().mockResolvedValue(undefined),
      findByHashPeloSistema: jest.fn().mockResolvedValue(chave()),
    };
    audit = { registrar: jest.fn().mockResolvedValue(undefined) };
    service = new IntegrationKeysService(
      repo,
      audit as unknown as AuditService,
    );
    logSpy = jest
      .spyOn(
        (service as unknown as { logger: { log: jest.Mock } }).logger,
        'log',
      )
      .mockImplementation(() => undefined);
    warnSpy = jest
      .spyOn(
        (service as unknown as { logger: { warn: jest.Mock } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined);
  });

  describe('emitir', () => {
    it('emite com 32 bytes de entropia, prefixo reconhecível e hash sha256 do valor', async () => {
      const { valor, chave: chaveApi } = await service.emitir({
        ownerId: OWNER,
        name: 'Site',
        scopes: ['lead:receber'],
      });

      expect(valor).toMatch(/^crm_[0-9a-f]{64}$/);
      const [{ keyHash, prefix }] = repo.create.mock.calls[0] as [
        { keyHash: string; prefix: string },
      ];
      expect(keyHash).toBe(createHash('sha256').update(valor).digest('hex'));
      expect(prefix).toBe(valor.slice(0, 12));
      // O molde de `invites.service.spec.ts:81-89`: o valor cru não sobra em lugar nenhum.
      expect(JSON.stringify(repo.create.mock.calls)).not.toContain(valor);
      expect(chaveApi.mascarada).toBe(`${prefix}••••••••`);
      expect(JSON.stringify(chaveApi)).not.toContain(valor);
    });

    it('nunca escreve o valor bruto no log', async () => {
      const { valor } = await service.emitir({
        ownerId: OWNER,
        name: 'Site',
        scopes: ['lead:receber'],
      });
      // `CHAVE_SENSIVEL` (shared/logging/log.ts:28) NÃO cobre `chave` nem
      // `prefixo`: a garantia aqui é o campo escolhido, não a rede automática.
      expect(JSON.stringify(logSpy.mock.calls)).not.toContain(valor);
    });

    it('descarta escopo fora do catálogo', async () => {
      await service.emitir({
        ownerId: OWNER,
        name: 'Site',
        scopes: ['lead:receber', 'inventado'],
      });
      const [{ scopes }] = repo.create.mock.calls[0] as [{ scopes: string[] }];
      expect(scopes).toEqual(['lead:receber']);
    });

    it('registra a emissão na trilha', async () => {
      await service.emitir({
        ownerId: OWNER,
        name: 'Site',
        scopes: ['lead:receber'],
      });
      expect(audit.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'INTEGRATION',
          action: 'CRIAR',
        }),
      );
    });
  });

  describe('autenticar', () => {
    it('autentica pelo hash e devolve o ownerId da chave', async () => {
      repo.findByHashPeloSistema.mockResolvedValue(chave());
      const resultado = await service.autenticar('crm_valor', 'lead:receber');
      expect(resultado).toEqual({ ownerId: OWNER, keyId: 'chave-1' });
      expect(repo.findByHashPeloSistema).toHaveBeenCalledWith(
        createHash('sha256').update('crm_valor').digest('hex'),
      );
    });

    it('recusa chave inexistente e chave revogada com a MESMA mensagem', async () => {
      repo.findByHashPeloSistema.mockResolvedValue(null);
      await expect(
        service.autenticar('crm_valor', 'lead:receber'),
      ).rejects.toThrow(UnauthorizedException);
      const mensagemInexistente = await service
        .autenticar('crm_valor', 'lead:receber')
        .catch((e: UnauthorizedException) => e.message);

      repo.findByHashPeloSistema.mockResolvedValue(
        chave({ revokedAt: new Date() }),
      );
      const mensagemRevogada = await service
        .autenticar('crm_valor', 'lead:receber')
        .catch((e: UnauthorizedException) => e.message);

      expect(mensagemInexistente).toBe(mensagemRevogada);
    });

    it('recusa chave sem o escopo exigido com 403', async () => {
      repo.findByHashPeloSistema.mockResolvedValue(chave({ scopes: [] }));
      await expect(
        service.autenticar('crm_valor', 'lead:receber'),
      ).rejects.toThrow(ForbiddenException);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ evento: 'integracao.escopo_insuficiente' }),
      );
    });
  });

  describe('rotacionar', () => {
    it('troca o segredo da mesma linha, zera o uso e registra ROTACIONAR', async () => {
      const { valor } = await service.rotacionar(OWNER, 'chave-1');

      expect(valor).toMatch(/^crm_[0-9a-f]{64}$/);
      expect(repo.replaceSecret).toHaveBeenCalledWith(
        OWNER,
        'chave-1',
        expect.objectContaining({
          keyHash: createHash('sha256').update(valor).digest('hex'),
        }),
      );
      expect(audit.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'INTEGRATION',
          action: 'ROTACIONAR',
        }),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ evento: 'integracao.chave_rotacionada' }),
      );
    });

    it('recusa chave de outro owner (ou inexistente) com 404', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.rotacionar(OWNER, 'chave-2')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('revogar', () => {
    it('revogar preserva a linha e registra EXCLUIR', async () => {
      const revogada = await service.revogar(OWNER, 'chave-1');
      expect(revogada.revogadaEm).toBeInstanceOf(Date);
      expect(repo.delete).not.toHaveBeenCalled();
      expect(audit.registrar).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'INTEGRATION', action: 'EXCLUIR' }),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ evento: 'integracao.chave_revogada' }),
      );
    });
  });
});
