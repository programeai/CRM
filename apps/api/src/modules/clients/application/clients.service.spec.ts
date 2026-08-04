import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ClientsService } from './clients.service';
import type { ClientRepository } from '../domain/client.repository';
import type { WorkspaceMembersService } from '../../workspace/application/workspace-members.service';
import type { AuditService } from '../../audit/audit.service';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { CatalogosService } from '../../catalogos/application/catalogos.service';
import type { ExportService } from '../../data/application/export.service';
import { webhooksEmitterFake } from '../../webhooks/application/webhooks-emitter.mock';

describe('ClientsService', () => {
  let repo: jest.Mocked<ClientRepository>;
  let members: jest.Mocked<WorkspaceMembersService>;
  let audit: { registrar: jest.Mock };
  let notifications: { notificar: jest.Mock };
  let catalogos: { assertUtilizavel: jest.Mock };
  let exporter: { gerar: jest.Mock };
  let service: ClientsService;

  beforeEach(() => {
    repo = {
      create: jest.fn(),
      findById: jest.fn(),
      findManyAndCount: jest.fn(),
      update: jest.fn(),
      archive: jest.fn(),
      restore: jest.fn(),
      delete: jest.fn(),
      countChildren: jest.fn(),
      findByPhoneDigits: jest.fn(),
      existsByDocument: jest.fn(),
      listOwnerTags: jest.fn(),
      findByTag: jest.fn(),
      removeTagFromAll: jest.fn(),
      findAllRefs: jest.fn(),
    };
    members = {
      list: jest.fn(),
      assertMember: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<WorkspaceMembersService>;
    audit = { registrar: jest.fn().mockResolvedValue(undefined) };
    notifications = { notificar: jest.fn().mockResolvedValue(undefined) };
    catalogos = {
      assertUtilizavel: jest.fn().mockResolvedValue({ id: 'fonte-1' }),
    };
    exporter = { gerar: jest.fn().mockResolvedValue('arquivo') };
    service = new ClientsService(
      repo,
      members,
      audit as unknown as AuditService,
      notifications as unknown as NotificationsService,
      webhooksEmitterFake(),
      catalogos as unknown as CatalogosService,
      exporter as unknown as ExportService,
    );
  });

  it('registra o arquivamento na trilha de auditoria', async () => {
    repo.findById.mockResolvedValue({ id: 'c1', name: 'Acme' } as never);
    repo.archive.mockResolvedValue({ id: 'c1' } as never);

    await service.archive('owner-1', 'c1');

    expect(audit.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'CLIENT',
        action: 'ARQUIVAR',
        entityId: 'c1',
        entityLabel: 'Acme',
      }),
    );
  });

  describe('promoverParaAtivo', () => {
    it('lead vira ativo e a mudança entra na trilha com antes/depois', async () => {
      repo.findById.mockResolvedValue({
        id: 'c1',
        name: 'Acme',
        status: 'LEAD',
      } as never);
      repo.update.mockResolvedValue({ id: 'c1' } as never);

      await service.promoverParaAtivo('owner-1', 'c1');

      expect(repo.update).toHaveBeenCalledWith('c1', 'owner-1', {
        status: 'ACTIVE',
      });
      expect(audit.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'CLIENT',
          action: 'ATUALIZAR',
          entityId: 'c1',
          entityLabel: 'Acme',
          antes: { status: 'LEAD' },
          depois: { status: 'ACTIVE' },
        }),
      );
    });

    it('quem já é ativo não é reescrito — idempotente e sem trilha', async () => {
      repo.findById.mockResolvedValue({
        id: 'c1',
        name: 'Acme',
        status: 'ACTIVE',
      } as never);

      await service.promoverParaAtivo('owner-1', 'c1');

      expect(repo.update).not.toHaveBeenCalled();
      expect(audit.registrar).not.toHaveBeenCalled();
    });

    it.each(['INACTIVE', 'LOST'])(
      'não reativa cliente %s — reativar é decisão de pessoa',
      async (status) => {
        repo.findById.mockResolvedValue({
          id: 'c1',
          name: 'Acme',
          status,
        } as never);

        await service.promoverParaAtivo('owner-1', 'c1');

        expect(repo.update).not.toHaveBeenCalled();
      },
    );

    it('cliente de outro owner não é promovido (404 do findOne)', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        service.promoverParaAtivo('owner-1', 'c1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  it('cria cliente derivando ownerId e limpando o documento', async () => {
    repo.existsByDocument.mockResolvedValue(false);
    repo.create.mockResolvedValue({ id: 'c1' } as never);
    await service.create('owner-1', {
      name: 'Acme',
      document: '11.222.333/0001-81',
    });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'owner-1',
        document: '11222333000181',
      }),
    );
  });

  it('deduz COMPANY de um CNPJ e INDIVIDUAL de um CPF', async () => {
    repo.existsByDocument.mockResolvedValue(false);
    repo.create.mockResolvedValue({ id: 'c1' } as never);

    await service.create('owner-1', {
      name: 'Acme',
      document: '11.222.333/0001-81',
    });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ personType: 'COMPANY' }),
    );

    await service.create('owner-1', {
      name: 'Fulano',
      document: '390.533.447-05',
    });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ personType: 'INDIVIDUAL' }),
    );
  });

  it('deixa o tipo de pessoa a cargo do default quando não há documento', async () => {
    repo.create.mockResolvedValue({ id: 'c1' } as never);
    await service.create('owner-1', { name: 'Sem documento' });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ personType: undefined }),
    );
  });

  it('reclassifica a pessoa quando o documento muda na edição', async () => {
    repo.findById.mockResolvedValue({
      id: 'c1',
      name: 'Acme',
      personType: 'COMPANY',
    } as never);
    repo.existsByDocument.mockResolvedValue(false);
    repo.update.mockResolvedValue({ id: 'c1', name: 'Acme' } as never);

    await service.update('owner-1', 'c1', { document: '390.533.447-05' });

    expect(repo.update).toHaveBeenCalledWith(
      'c1',
      'owner-1',
      expect.objectContaining({
        document: '39053344705',
        personType: 'INDIVIDUAL',
      }),
    );
  });

  it('preserva o tipo de pessoa ao limpar o documento', async () => {
    repo.findById.mockResolvedValue({
      id: 'c1',
      name: 'Fulano',
      personType: 'INDIVIDUAL',
    } as never);
    repo.update.mockResolvedValue({ id: 'c1', name: 'Fulano' } as never);

    await service.update('owner-1', 'c1', { document: '' });

    const [, , data] = repo.update.mock.calls[0];
    expect(data).toMatchObject({ document: null });
    expect(data).not.toHaveProperty('personType');
  });

  it('rejeita documento sem tamanho de CPF nem de CNPJ', async () => {
    await expect(
      service.create('owner-1', { name: 'X', document: '123' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita CPF com 11 dígitos mas dígito verificador errado', async () => {
    await expect(
      service.create('owner-1', {
        name: 'X',
        document: '390.533.447-06',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita documento duplicado com ConflictException', async () => {
    repo.existsByDocument.mockResolvedValue(true);
    await expect(
      service.create('owner-1', {
        name: 'X',
        document: '390.533.447-05',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lança NotFoundException ao buscar id inexistente', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findOne('owner-1', 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lança NotFoundException ao atualizar id inexistente', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(
      service.update('owner-1', 'nope', { name: 'Novo' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lança NotFoundException ao arquivar id inexistente', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.archive('owner-1', 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('registra a restauração na trilha de auditoria', async () => {
    repo.findById.mockResolvedValue({ id: 'c1', name: 'Acme' } as never);
    repo.restore.mockResolvedValue({ id: 'c1', archivedAt: null } as never);

    await service.restore('owner-1', 'c1');

    expect(repo.restore).toHaveBeenCalledWith('c1', 'owner-1');
    expect(audit.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'CLIENT',
        action: 'RESTAURAR',
        entityId: 'c1',
        entityLabel: 'Acme',
      }),
    );
  });

  it('lança UnprocessableEntityException ao expurgar cliente ainda ativo', async () => {
    repo.findById.mockResolvedValue({
      id: 'c1',
      name: 'Acme',
      archivedAt: null,
    } as never);
    await expect(service.purge('owner-1', 'c1')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('lança ConflictException com a descrição dos vínculos ao expurgar cliente com registros', async () => {
    repo.findById.mockResolvedValue({
      id: 'c1',
      name: 'Acme',
      archivedAt: new Date(),
    } as never);
    repo.countChildren.mockResolvedValue({
      total: 2,
      descricao: '1 oportunidade(s), 1 contrato(s)',
    });
    await expect(service.purge('owner-1', 'c1')).rejects.toThrow(
      /1 oportunidade\(s\), 1 contrato\(s\)/,
    );
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('expurga o cliente arquivado sem vínculos e registra na trilha', async () => {
    repo.findById.mockResolvedValue({
      id: 'c1',
      name: 'Acme',
      archivedAt: new Date(),
    } as never);
    repo.countChildren.mockResolvedValue({ total: 0, descricao: '' });

    await service.purge('owner-1', 'c1');

    expect(repo.delete).toHaveBeenCalledWith('c1');
    expect(audit.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'CLIENT',
        action: 'EXPURGAR',
        entityId: 'c1',
        entityLabel: 'Acme',
      }),
    );
  });

  it('passa skip/take corretos ao repo na paginação', async () => {
    repo.findManyAndCount.mockResolvedValue({ data: [], total: 0 });
    await service.list('owner-1', { page: 3, limit: 10 });
    expect(repo.findManyAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'owner-1', skip: 20, take: 10 }),
    );
  });

  // O create faz spread do DTO: sem a validação explícita, `assigneeId` chegaria
  // ao Prisma sem passar por lugar nenhum.
  it('valida o responsável antes de gravar', async () => {
    members.assertMember.mockRejectedValue(
      new UnprocessableEntityException(
        'Responsável inválido: escolha alguém da sua equipe.',
      ),
    );
    await expect(
      service.create('owner-1', {
        name: 'Acme',
        assigneeId: 'de-outro-owner',
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  // `sourceId` entra pelo spread do DTO: sem a validação explícita, um id de
  // outro owner iria ao banco e estouraria na FK como 500 em vez de 404/422.
  it('valida a fonte de lead antes de gravar', async () => {
    repo.existsByDocument.mockResolvedValue(false);
    repo.create.mockResolvedValue({ id: 'c1' } as never);
    await service.create('owner-1', {
      name: 'Acme',
      sourceId: 'fonte-1',
    });
    expect(catalogos.assertUtilizavel).toHaveBeenCalledWith(
      'owner-1',
      'fontes-de-lead',
      'fonte-1',
    );
  });

  it('não consulta o catálogo quando sourceId não é informado', async () => {
    repo.existsByDocument.mockResolvedValue(false);
    repo.create.mockResolvedValue({ id: 'c1' } as never);
    await service.create('owner-1', { name: 'Acme' });
    expect(catalogos.assertUtilizavel).not.toHaveBeenCalled();
  });

  it('não zera o responsável quando o patch não traz o campo', async () => {
    repo.findById.mockResolvedValue({
      id: 'c1',
      personType: 'COMPANY',
    } as never);
    repo.update.mockResolvedValue({ id: 'c1' } as never);
    await service.update('owner-1', 'c1', { name: 'Novo' });
    expect(repo.update).toHaveBeenCalledWith(
      'c1',
      'owner-1',
      expect.not.objectContaining({ assigneeId: expect.anything() }),
    );
    expect(notifications.notificar).not.toHaveBeenCalled();
  });

  it('notifica o novo responsável ao criar já atribuído', async () => {
    repo.existsByDocument.mockResolvedValue(false);
    repo.create.mockResolvedValue({ id: 'c1', name: 'Acme' } as never);

    await service.create('owner-1', {
      name: 'Acme',
      assigneeId: 'u2',
    });

    expect(notifications.notificar).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u2',
        evento: expect.objectContaining({
          tipo: 'RECORD_ASSIGNED',
          entity: 'CLIENT',
          entityId: 'c1',
          entityLabel: 'Acme',
        }),
      }),
    );
  });

  it('lança UnprocessableEntityException quando o filtro excede o teto de exportação', async () => {
    repo.findManyAndCount.mockResolvedValue({ data: [], total: 5001 });
    await expect(
      service.export('owner-1', { formato: 'csv' } as never),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(exporter.gerar).not.toHaveBeenCalled();
  });

  it('repassa o scope recebido ao repositório na exportação', async () => {
    repo.findManyAndCount.mockResolvedValue({ data: [], total: 0 });
    const scope = { kind: 'mine', userId: 'u1' } as const;
    await service.export('owner-1', { formato: 'xlsx' } as never, scope);
    expect(repo.findManyAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'owner-1', scope }),
    );
  });

  it('notifica quando o responsável muda no update', async () => {
    repo.findById.mockResolvedValue({
      id: 'c1',
      personType: 'COMPANY',
      assigneeId: 'u1',
    } as never);
    repo.update.mockResolvedValue({ id: 'c1', name: 'Acme' } as never);

    await service.update('owner-1', 'c1', { assigneeId: 'u2' });

    expect(notifications.notificar).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u2',
        evento: expect.objectContaining({
          tipo: 'RECORD_ASSIGNED',
          entity: 'CLIENT',
        }),
      }),
    );
  });

  /*
    A opção existe para a ingestão externa de lead (Fase 17-A): rota `@Public()`
    sem `AccessContext` no CLS, onde `notificar` cairia no early-return
    `notificacao.sem_contexto` a cada lead. O aviso de quem recebeu o lead é o
    `LEAD_RECEIVED`, emitido pelo caminho de sistema. O default preserva o
    comportamento de todos os outros chamadores.
  */
  describe('avisarResponsavel: false', () => {
    it('não notifica no create, e ainda assim grava a atribuição', async () => {
      repo.existsByDocument.mockResolvedValue(false);
      repo.create.mockResolvedValue({ id: 'c1', name: 'Acme' } as never);

      await service.create(
        'owner-1',
        { name: 'Acme', assigneeId: 'u2' },
        { avisarResponsavel: false },
      );

      expect(notifications.notificar).not.toHaveBeenCalled();
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ assigneeId: 'u2' }),
      );
    });

    it('não notifica no update, e ainda assim grava a atribuição', async () => {
      repo.findById.mockResolvedValue({
        id: 'c1',
        personType: 'COMPANY',
        assigneeId: null,
      } as never);
      repo.update.mockResolvedValue({ id: 'c1', name: 'Acme' } as never);

      await service.update(
        'owner-1',
        'c1',
        { assigneeId: 'u2' },
        { avisarResponsavel: false },
      );

      expect(notifications.notificar).not.toHaveBeenCalled();
      expect(repo.update).toHaveBeenCalledWith(
        'c1',
        'owner-1',
        expect.objectContaining({ assigneeId: 'u2' }),
      );
    });

    it('o default continua notificando (nenhum outro chamador muda)', async () => {
      repo.existsByDocument.mockResolvedValue(false);
      repo.create.mockResolvedValue({ id: 'c1', name: 'Acme' } as never);

      await service.create('owner-1', { name: 'Acme', assigneeId: 'u2' });

      expect(notifications.notificar).toHaveBeenCalled();
    });
  });
});
