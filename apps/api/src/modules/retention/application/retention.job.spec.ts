import { RetentionJob } from './retention.job';
import {
  RETENCAO_AUDITORIA_DIAS,
  RETENCAO_LIXEIRA_DIAS,
  RETENCAO_NOTIFICACAO_DIAS,
} from '../domain/retencao';
import type { RetentionRepository } from '../domain/retention.repository';

const AGORA = new Date('2026-08-04T02:00:00.000Z');
const DIA = 24 * 60 * 60 * 1000;

describe('RetentionJob', () => {
  let repo: jest.Mocked<RetentionRepository>;
  let job: RetentionJob;
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers({ now: AGORA, doNotFake: ['nextTick'] });
    repo = {
      expurgarLixeira: jest
        .fn()
        .mockResolvedValue({ contagem: {}, pulados: {} }),
      expurgarNotificacoes: jest.fn().mockResolvedValue({}),
      expurgarAuditoria: jest.fn().mockResolvedValue({}),
    };
    job = new RetentionJob(repo);
    logSpy = jest
      .spyOn((job as unknown as { logger: { log: jest.Mock } }).logger, 'log')
      .mockImplementation(() => undefined);
    errorSpy = jest
      .spyOn(
        (job as unknown as { logger: { error: jest.Mock } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('datas de corte', () => {
    it('cada varredura recebe `agora − o seu prazo`', async () => {
      await job.run();

      const [corteLixeira] = repo.expurgarLixeira.mock.calls[0];
      const [corteNotificacoes] = repo.expurgarNotificacoes.mock.calls[0];
      const [corteAuditoria] = repo.expurgarAuditoria.mock.calls[0];

      expect(corteLixeira).toEqual(
        new Date(AGORA.getTime() - RETENCAO_LIXEIRA_DIAS * DIA),
      );
      expect(corteNotificacoes).toEqual(
        new Date(AGORA.getTime() - RETENCAO_NOTIFICACAO_DIAS * DIA),
      );
      expect(corteAuditoria).toEqual(
        new Date(AGORA.getTime() - RETENCAO_AUDITORIA_DIAS * DIA),
      );
    });

    it('as três varreduras rodam, e uma vez cada', async () => {
      await job.run();
      expect(repo.expurgarLixeira).toHaveBeenCalledTimes(1);
      expect(repo.expurgarNotificacoes).toHaveBeenCalledTimes(1);
      expect(repo.expurgarAuditoria).toHaveBeenCalledTimes(1);
    });
  });

  describe('log', () => {
    it('NÃO loga quando não houve nada a apagar — a linha diária fica silenciosa', async () => {
      await job.run();
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('loga por varredura, com as contagens e o prazo aplicado', async () => {
      repo.expurgarLixeira.mockResolvedValue({
        contagem: { clientes: 3, contatos: 5, demandas: 0 },
        pulados: {},
      });
      repo.expurgarNotificacoes.mockResolvedValue({
        notificacoes: 120,
        entregas: 240,
      });
      repo.expurgarAuditoria.mockResolvedValue({ trilha: 7 });

      await job.run();

      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          evento: 'retencao.lixeira_expurgada',
          dias: RETENCAO_LIXEIRA_DIAS,
          clientes: 3,
          contatos: 5,
        }),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          evento: 'retencao.notificacoes_expurgadas',
          notificacoes: 120,
          entregas: 240,
        }),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          evento: 'retencao.auditoria_expurgada',
          trilha: 7,
        }),
      );
    });

    /*
      Pai além do prazo com filho não arquivado NÃO é apagado — é a doutrina
      "nenhuma cascata". Sem esta linha no log, "0 apagados" seria lido como "nada
      a fazer", quando o que houve foi "havia o que fazer e eu não pude".
    */
    it('loga os registros PULADOS mesmo quando nada foi apagado', async () => {
      repo.expurgarLixeira.mockResolvedValue({
        contagem: { clientes: 0 },
        pulados: { clientes: 2, projetos: 1 },
      });

      await job.run();

      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          evento: 'retencao.registro_pulado',
          clientes: 2,
          projetos: 1,
        }),
      );
    });
  });

  /*
    Um erro na lixeira não pode deixar a trilha crescer sem teto por um ano —
    mesma decisão do `AccountPurgeJob`, que isola a falha por owner.
  */
  describe('isolamento de falha entre varreduras', () => {
    it('erro na lixeira NÃO impede notificações e auditoria', async () => {
      repo.expurgarLixeira.mockRejectedValue(new Error('deadlock'));

      await expect(job.run()).resolves.toBeUndefined();

      expect(repo.expurgarNotificacoes).toHaveBeenCalledTimes(1);
      expect(repo.expurgarAuditoria).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          evento: 'retencao.varredura_falhou',
          varredura: 'lixeira',
        }),
        expect.anything(),
      );
    });

    it('erro no meio não impede a última', async () => {
      repo.expurgarNotificacoes.mockRejectedValue(new Error('timeout'));

      await job.run();

      expect(repo.expurgarAuditoria).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ varredura: 'notificacoes' }),
        expect.anything(),
      );
    });

    it('erro na última varredura não deixa a promessa rejeitar', async () => {
      repo.expurgarAuditoria.mockRejectedValue(new Error('permission denied'));
      await expect(job.run()).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ varredura: 'auditoria' }),
        expect.anything(),
      );
    });
  });

  /*
    Prazo não é decisão de instância (precedente da 19-A). Este caso trava o que a
    Política de Privacidade publica: se um número mudar, a Política tem de mudar
    junto — e é o teste que obriga a lembrar disso.
  */
  describe('os prazos são constantes, e são estes', () => {
    it('lixeira 180 dias, notificações 90, trilha 5 anos', () => {
      expect(RETENCAO_LIXEIRA_DIAS).toBe(180);
      expect(RETENCAO_NOTIFICACAO_DIAS).toBe(90);
      expect(RETENCAO_AUDITORIA_DIAS).toBe(5 * 365);
    });
  });
});
