import type { ClsService } from 'nestjs-cls';
import { OwnerWebhooksEmitterService } from './owner-webhooks-emitter.service';
import type { OwnerWebhookRepository } from '../domain/owner-webhook.repository';
import { ACCESS_CONTEXT } from '../../access/domain/access-context';

const OWNER = 'owner-1';

describe('OwnerWebhooksEmitterService', () => {
  let repo: jest.Mocked<OwnerWebhookRepository>;
  let cls: { get: jest.Mock };
  let service: OwnerWebhooksEmitterService;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    repo = {
      findManyByOwner: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      replaceSecret: jest.fn(),
      delete: jest.fn(),
      touchPeloSistema: jest.fn(),
      findAtivosPorEvento: jest.fn().mockResolvedValue([{ id: 'w1' }]),
      findAtivosPorEventoPeloSistema: jest
        .fn()
        .mockResolvedValue([{ id: 'w1' }]),
      enfileirar: jest.fn().mockResolvedValue(undefined),
      enfileirarPeloSistema: jest.fn().mockResolvedValue(undefined),
      reservarPendentes: jest.fn(),
      marcarEnviada: jest.fn(),
      marcarFalha: jest.fn(),
    };
    cls = {
      get: jest.fn((chave: string) =>
        chave === ACCESS_CONTEXT
          ? { ownerId: OWNER, userId: 'u1', userName: 'Ana' }
          : undefined,
      ),
    };
    service = new OwnerWebhooksEmitterService(
      repo,
      cls as unknown as ClsService,
    );
    warnSpy = jest
      .spyOn(
        (service as unknown as { logger: { warn: jest.Mock } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined);
    errorSpy = jest
      .spyOn(
        (service as unknown as { logger: { error: jest.Mock } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);
  });

  describe('emitir (caminho do request)', () => {
    it('enfileira uma linha por webhook elegível, com o ownerId do CLS', async () => {
      repo.findAtivosPorEvento.mockResolvedValue([
        { id: 'w1' },
        { id: 'w2' },
      ] as never);

      await service.emitir({
        evento: 'lead.recebido',
        entityId: 'cli-1',
        dados: { leadNome: 'Ana' },
      });

      expect(repo.findAtivosPorEvento).toHaveBeenCalledWith(
        OWNER,
        'lead.recebido',
      );
      const [linhas] = repo.enfileirar.mock.calls[0];
      expect(linhas).toHaveLength(2);
      expect(linhas[0]).toMatchObject({
        ownerId: OWNER,
        webhookId: 'w1',
        event: 'lead.recebido',
      });
      expect(linhas[1]).toMatchObject({ webhookId: 'w2' });
    });

    it('o payload guardado carrega evento, registro, momento e dados', async () => {
      await service.emitir({
        evento: 'cobranca.vencida',
        entityId: 'pay-1',
        dados: { valor: 1250 },
      });

      const [linhas] = repo.enfileirar.mock.calls[0];
      expect(linhas[0].payload).toEqual({
        evento: 'cobranca.vencida',
        registroId: 'pay-1',
        ocorridoEm: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        dados: { valor: 1250 },
      });
    });

    it('NÃO enfileira quando nenhum webhook assinou o evento', async () => {
      repo.findAtivosPorEvento.mockResolvedValue([]);

      await service.emitir({
        evento: 'lead.recebido',
        entityId: 'cli-1',
        dados: {},
      });

      expect(repo.enfileirar).not.toHaveBeenCalled();
    });

    it('sem AccessContext no CLS não emite, e avisa que é bug de instrumentação', async () => {
      cls.get.mockReturnValue(undefined);

      await service.emitir({
        evento: 'lead.recebido',
        entityId: 'cli-1',
        dados: {},
      });

      expect(repo.findAtivosPorEvento).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ evento: 'webhook.sem_contexto' }),
      );
    });

    /*
      A divergência deliberada em relação ao `AuditService`: um webhook que não
      pôde ser enfileirado NÃO pode derrubar a operação de negócio que o
      disparou. Mesma decisão do `NotificationsService`.
    */
    it('ENGOLE a exceção do repositório — não derruba a operação de negócio', async () => {
      repo.enfileirar.mockRejectedValue(new Error('banco fora'));

      await expect(
        service.emitir({
          evento: 'lead.recebido',
          entityId: 'cli-1',
          dados: {},
        }),
      ).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ evento: 'webhook.emissao_falhou' }),
        expect.anything(),
      );
    });

    it('não loga o conteúdo de `dados` na falha — o Grafana é público', async () => {
      repo.enfileirar.mockRejectedValue(new Error('banco fora'));

      await service.emitir({
        evento: 'lead.recebido',
        entityId: 'cli-1',
        dados: { leadNome: 'Ana Ribeiro', telefone: '84999398021' },
      });

      const linhas = JSON.stringify(errorSpy.mock.calls);
      expect(linhas).not.toContain('Ana Ribeiro');
      expect(linhas).not.toContain('84999398021');
    });
  });

  describe('emitirPeloSistema (cron cross-owner)', () => {
    it('usa o ownerId explícito e o client admin, sem tocar o CLS', async () => {
      await service.emitirPeloSistema({
        ownerId: 'owner-2',
        evento: 'demanda.atrasada',
        entityId: 't-1',
        dados: {},
      });

      expect(repo.findAtivosPorEventoPeloSistema).toHaveBeenCalledWith(
        'owner-2',
        'demanda.atrasada',
      );
      const [linhas] = repo.enfileirarPeloSistema.mock.calls[0];
      expect(linhas[0]).toMatchObject({ ownerId: 'owner-2' });
      // Nem chega a pedir contexto: o cron não tem nenhum.
      expect(repo.findAtivosPorEvento).not.toHaveBeenCalled();
    });

    it('ENGOLE a exceção também aqui', async () => {
      repo.enfileirarPeloSistema.mockRejectedValue(new Error('banco fora'));

      await expect(
        service.emitirPeloSistema({
          ownerId: 'owner-2',
          evento: 'demanda.atrasada',
          entityId: 't-1',
          dados: {},
        }),
      ).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalled();
    });
  });
});
