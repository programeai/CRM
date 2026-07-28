import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { AuditService } from '../../audit/audit.service';
import type { CatalogosService } from '../../catalogos/application/catalogos.service';
import type { IntegrationKeysService } from '../../integracoes/application/integration-keys.service';
import type { WorkspaceMembersService } from '../../workspace/application/workspace-members.service';
import { LeadIntakeChannelsService } from './lead-intake-channels.service';
import type {
  LeadIntakeChannelRecord,
  LeadIntakeChannelRepository,
} from '../domain/lead-intake-channel.repository';

const OWNER = 'owner-1';
const VALOR_BRUTO = 'crm_valorbrutoqueaparece_uma_unica_vez';

function canal(
  overrides: Partial<LeadIntakeChannelRecord> = {},
): LeadIntakeChannelRecord {
  return {
    id: 'canal-1',
    ownerId: OWNER,
    name: 'Site',
    assigneeId: null,
    sourceId: null,
    keyId: 'chave-1',
    createdAt: new Date(),
    ...overrides,
  };
}

describe('LeadIntakeChannelsService', () => {
  let repo: jest.Mocked<LeadIntakeChannelRepository>;
  let keys: {
    emitir: jest.Mock;
    apagar: jest.Mock;
    list: jest.Mock;
  };
  let members: { assertMember: jest.Mock; list: jest.Mock };
  let catalogos: { assertUtilizavel: jest.Mock; list: jest.Mock };
  let audit: { registrar: jest.Mock };
  let service: LeadIntakeChannelsService;
  /** Ordem das etapas — prova que a chave nasce antes do canal. */
  let ordem: string[];

  beforeEach(() => {
    ordem = [];
    repo = {
      findManyByOwner: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue(canal()),
      findByKeyId: jest.fn().mockResolvedValue(canal()),
      create: jest.fn().mockImplementation((data: { name: string }) => {
        ordem.push('criou canal');
        return Promise.resolve(canal({ name: data.name }));
      }),
      update: jest.fn().mockResolvedValue(canal({ name: 'Site novo' })),
      delete: jest.fn().mockImplementation(() => {
        ordem.push('apagou canal');
        return Promise.resolve();
      }),
    };
    keys = {
      emitir: jest.fn().mockImplementation(() => {
        ordem.push('emitiu chave');
        return Promise.resolve({
          chave: {
            id: 'chave-1',
            nome: 'Site',
            mascarada: 'crm_aabbccdd••••••••',
            escopos: ['lead:receber'],
            criadaEm: new Date(),
            ultimoUsoEm: null,
            revogadaEm: null,
          },
          valor: VALOR_BRUTO,
        });
      }),
      apagar: jest.fn().mockImplementation(() => {
        ordem.push('apagou chave');
        return Promise.resolve();
      }),
      list: jest.fn().mockResolvedValue([
        {
          id: 'chave-1',
          nome: 'Site',
          mascarada: 'crm_aabbccdd••••••••',
          escopos: ['lead:receber'],
          criadaEm: new Date(),
          ultimoUsoEm: null,
          revogadaEm: null,
        },
      ]),
    };
    members = {
      assertMember: jest.fn().mockResolvedValue(undefined),
      list: jest
        .fn()
        .mockResolvedValue([{ id: 'colab-1', name: 'Ana', isOwner: false }]),
    };
    catalogos = {
      assertUtilizavel: jest.fn().mockResolvedValue({
        id: 'fonte-1',
        ownerId: OWNER,
        name: 'Tráfego pago',
        active: true,
      }),
      list: jest
        .fn()
        .mockResolvedValue([
          { id: 'fonte-1', ownerId: OWNER, name: 'Tráfego pago', active: true },
        ]),
    };
    audit = { registrar: jest.fn().mockResolvedValue(undefined) };

    service = new LeadIntakeChannelsService(
      repo,
      keys as unknown as IntegrationKeysService,
      members as unknown as WorkspaceMembersService,
      catalogos as unknown as CatalogosService,
      audit as unknown as AuditService,
    );
  });

  describe('create', () => {
    it('emite a chave ANTES de criar o canal: emissão que falha não deixa canal mudo', async () => {
      await service.create(OWNER, { name: 'Site' });

      expect(ordem).toEqual(['emitiu chave', 'criou canal']);
      expect(keys.emitir).toHaveBeenCalledWith({
        ownerId: OWNER,
        name: 'Site',
        scopes: ['lead:receber'],
      });
    });

    it('devolve o valor bruto da chave UMA vez, e o canal já mascarado', async () => {
      const resultado = await service.create(OWNER, { name: 'Site' });

      expect(resultado.chave).toBe(VALOR_BRUTO);
      // O canal que vai à tela carrega só a máscara.
      expect(JSON.stringify(resultado.canal)).not.toContain(VALOR_BRUTO);
      expect(resultado.canal.chave?.mascarada).toBe('crm_aabbccdd••••••••');
    });

    it('valida o responsável e a fonte antes de emitir chave nenhuma', async () => {
      members.assertMember.mockRejectedValue(
        new UnprocessableEntityException('Responsável inválido.'),
      );

      await expect(
        service.create(OWNER, { name: 'Site', assigneeId: 'de-outra-conta' }),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(keys.emitir).not.toHaveBeenCalled();
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('valida a fonte de lead pelo catálogo do owner', async () => {
      await service.create(OWNER, { name: 'Site', sourceId: 'fonte-1' });

      expect(catalogos.assertUtilizavel).toHaveBeenCalledWith(
        OWNER,
        'fontes-de-lead',
        'fonte-1',
      );
    });

    it('recusa nome repetido no mesmo owner com 409, antes de emitir chave', async () => {
      repo.findManyByOwner.mockResolvedValue([canal({ name: 'Site' })]);

      await expect(service.create(OWNER, { name: 'Site' })).rejects.toThrow(
        ConflictException,
      );
      expect(keys.emitir).not.toHaveBeenCalled();
    });

    it('resolve os nomes do responsável e da fonte para a tela', async () => {
      repo.create.mockResolvedValue(
        canal({ assigneeId: 'colab-1', sourceId: 'fonte-1' }),
      );

      const { canal: paraApi } = await service.create(OWNER, { name: 'Site' });

      expect(paraApi.assignee).toEqual({ id: 'colab-1', name: 'Ana' });
      expect(paraApi.source).toEqual({
        id: 'fonte-1',
        name: 'Tráfego pago',
        active: true,
      });
    });
  });

  describe('update', () => {
    it('registra ATUALIZAR na trilha e loga o canal atualizado', async () => {
      await service.update(OWNER, 'canal-1', { assigneeId: 'colab-1' });

      expect(repo.update).toHaveBeenCalledWith(OWNER, 'canal-1', {
        assigneeId: 'colab-1',
      });
      expect(audit.registrar).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'INTEGRATION', action: 'ATUALIZAR' }),
      );
    });

    it('não emite chave nova: editar canal não rotaciona credencial', async () => {
      await service.update(OWNER, 'canal-1', { name: 'Site novo' });

      expect(keys.emitir).not.toHaveBeenCalled();
    });

    it('canal de outro owner responde 404', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        service.update(OWNER, 'canal-2', { name: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('delete', () => {
    it('apaga o canal E a chave: credencial órfã continuaria autenticando', async () => {
      await service.delete(OWNER, 'canal-1');

      expect(ordem).toEqual(['apagou canal', 'apagou chave']);
      expect(keys.apagar).toHaveBeenCalledWith(OWNER, 'chave-1');
      expect(audit.registrar).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'INTEGRATION', action: 'EXCLUIR' }),
      );
    });

    it('canal sem chave apaga sem tentar apagar credencial nenhuma', async () => {
      repo.findById.mockResolvedValue(canal({ keyId: null }));

      await service.delete(OWNER, 'canal-1');

      expect(keys.apagar).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('devolve lista vazia sem consultar lookup nenhum', async () => {
      await expect(service.list(OWNER)).resolves.toEqual([]);
      expect(members.list).not.toHaveBeenCalled();
      expect(catalogos.list).not.toHaveBeenCalled();
    });

    it('busca a fonte de lead INCLUINDO as inativas', async () => {
      repo.findManyByOwner.mockResolvedValue([canal({ sourceId: 'fonte-1' })]);

      await service.list(OWNER);

      // Um canal configurado com fonte depois excluída precisa continuar
      // dizendo qual era.
      expect(catalogos.list).toHaveBeenCalledWith(
        OWNER,
        'fontes-de-lead',
        true,
      );
    });
  });
});
