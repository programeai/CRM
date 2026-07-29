import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  AccessRecordsService,
  RETENCAO_REGISTRO_DE_ACESSO_DIAS,
} from './access-records.service';

/**
 * Faxina do registro de acesso, por data de corte. Molde exato de
 * `sessions-cleanup.job.ts`, em horário próprio (3h já é da faxina de sessões).
 */
@Injectable()
export class AccessRecordsCleanupJob {
  private readonly logger = new Logger(AccessRecordsCleanupJob.name);

  constructor(private readonly registros: AccessRecordsService) {}

  // `timeZone` explícito (container em UTC) para o horário ser o que o nome diz.
  @Cron(CronExpression.EVERY_DAY_AT_4AM, {
    name: 'acessos-faxina',
    timeZone: 'America/Sao_Paulo',
  })
  async run(): Promise<void> {
    const cutoff = new Date(
      Date.now() - RETENCAO_REGISTRO_DE_ACESSO_DIAS * 24 * 60 * 60 * 1000,
    );
    const quantidade = await this.registros.purgeBefore(cutoff);
    if (quantidade > 0) {
      this.logger.log({
        evento: 'acessos.expurgados',
        msg: 'Registros de acesso além da retenção legal removidos pela rotina diária.',
        quantidade,
        retencaoDias: RETENCAO_REGISTRO_DE_ACESSO_DIAS,
      });
    }
  }
}
