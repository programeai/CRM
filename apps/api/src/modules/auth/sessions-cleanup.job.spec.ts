import {
  RETENCAO_SESSAO_VENCIDA_DIAS,
  SessionsCleanupJob,
} from './sessions-cleanup.job';
import type { SessionsService } from './sessions.service';

const DIA_MS = 24 * 60 * 60 * 1000;

function criarJob(removidas: number) {
  const sessions = {
    // Tipado para o `cutoff` capturado sair como Date, e não como `any`.
    purgeExpiredBefore: jest
      .fn<Promise<number>, [Date]>()
      .mockResolvedValue(removidas),
  };
  return {
    sessions,
    job: new SessionsCleanupJob(sessions as unknown as SessionsService),
  };
}

describe('SessionsCleanupJob', () => {
  it('apaga o que venceu antes da janela de retenção, e nada mais recente', async () => {
    const { sessions, job } = criarJob(0);
    const antes = Date.now();

    await job.run();

    const [cutoff] = sessions.purgeExpiredBefore.mock.calls[0];
    const esperado = antes - RETENCAO_SESSAO_VENCIDA_DIAS * DIA_MS;
    // Margem de segundos: o relógio anda entre o `antes` e a chamada.
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(esperado - 5_000);
    expect(cutoff.getTime()).toBeLessThanOrEqual(esperado + 5_000);
  });

  it('não loga quando não havia nada a apagar', async () => {
    const { job } = criarJob(0);
    const logger = jest.spyOn(job['logger'], 'log');
    await job.run();
    expect(logger).not.toHaveBeenCalled();
  });

  it('loga a quantidade quando apagou', async () => {
    const { job } = criarJob(7);
    const logger = jest.spyOn(job['logger'], 'log').mockImplementation();
    await job.run();
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({ evento: 'sessoes.expurgadas', quantidade: 7 }),
    );
  });
});
