import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SessionsService } from './sessions.service';

/**
 * Quanto tempo a sessão vencida ainda fica no banco. Os 30 dias espelham a
 * retenção dos logs no Loki: passado esse prazo não há mais com o que cruzar a
 * linha numa investigação, então guardá-la é só volume.
 */
export const RETENCAO_SESSAO_VENCIDA_DIAS = 30;

/**
 * Faxina da tabela `Session`. Nada aqui é visível ao usuário — a lista de
 * dispositivos já ignora sessão vencida ou revogada. Sem esta rotina a tabela
 * cresce sem teto: cada login deixa uma linha e nada nunca a removia.
 */
@Injectable()
export class SessionsCleanupJob {
  private readonly logger = new Logger(SessionsCleanupJob.name);

  constructor(private readonly sessions: SessionsService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'sessoes-faxina' })
  async run(): Promise<void> {
    const cutoff = new Date(
      Date.now() - RETENCAO_SESSAO_VENCIDA_DIAS * 24 * 60 * 60 * 1000,
    );
    const quantidade = await this.sessions.purgeExpiredBefore(cutoff);
    if (quantidade > 0) {
      this.logger.log({
        evento: 'sessoes.expurgadas',
        msg: 'Sessões vencidas removidas pela rotina diária.',
        quantidade,
        retencaoDias: RETENCAO_SESSAO_VENCIDA_DIAS,
      });
    }
  }
}
