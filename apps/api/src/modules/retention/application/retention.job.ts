import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  dataDeCorte,
  RETENCAO_AUDITORIA_DIAS,
  RETENCAO_LIXEIRA_DIAS,
  RETENCAO_NOTIFICACAO_DIAS,
} from '../domain/retencao';
import {
  RETENTION_REPOSITORY,
  type RetentionRepository,
} from '../domain/retention.repository';

/**
 * Faxina de retenção. Três varreduras por data de corte, uma vez por dia.
 *
 * `timeZone` explícito (o container roda em UTC), como nos crons diários que já
 * existem, e às **2h** para não competir com a faxina de sessão (3h), a de registro
 * de acesso (4h) e o expurgo de conta (5h) — que também tocam tabelas grandes.
 *
 * **Uma varredura que falha não impede as outras** (`try/catch` por varredura,
 * como o `AccountPurgeJob` faz por owner): um erro na lixeira não pode deixar a
 * trilha crescer sem teto por um ano.
 *
 * Log agregado por varredura, com guard `> 0`: é o padrão dos jobs existentes e é o
 * que mantém a linha diária silenciosa quando não há nada a apagar.
 */
@Injectable()
export class RetentionJob {
  private readonly logger = new Logger(RetentionJob.name);

  constructor(
    @Inject(RETENTION_REPOSITORY)
    private readonly repo: RetentionRepository,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM, {
    name: 'retencao-faxina',
    timeZone: 'America/Sao_Paulo',
  })
  async run(): Promise<void> {
    const agora = new Date();
    await this.varrer('lixeira', async () => {
      const { contagem, pulados } = await this.repo.expurgarLixeira(
        dataDeCorte(agora, RETENCAO_LIXEIRA_DIAS),
      );
      const totalPulado = Object.values(pulados).reduce((a, b) => a + b, 0);
      if (totalPulado > 0) {
        /*
          Pai arquivado há mais tempo que o corte, com filho que NÃO está
          arquivado. Não é erro — é o desenho ("nenhuma cascata") —, mas tem de
          aparecer: sem esta linha, "0 apagados" seria lido como "nada a fazer".
        */
        this.logger.log({
          evento: 'retencao.registro_pulado',
          msg: 'Registro além do prazo não expurgado: ainda tem filho não arquivado.',
          dias: RETENCAO_LIXEIRA_DIAS,
          ...pulados,
        });
      }
      return {
        evento: 'retencao.lixeira_expurgada',
        msg: 'Lixeira expurgada por prazo de retenção.',
        dias: RETENCAO_LIXEIRA_DIAS,
        ...contagem,
      };
    });

    await this.varrer('notificacoes', async () => ({
      evento: 'retencao.notificacoes_expurgadas',
      msg: 'Notificações expurgadas por prazo de retenção.',
      dias: RETENCAO_NOTIFICACAO_DIAS,
      ...(await this.repo.expurgarNotificacoes(
        dataDeCorte(agora, RETENCAO_NOTIFICACAO_DIAS),
      )),
    }));

    await this.varrer('auditoria', async () => ({
      evento: 'retencao.auditoria_expurgada',
      msg: 'Trilha de auditoria expurgada por prazo de retenção.',
      dias: RETENCAO_AUDITORIA_DIAS,
      ...(await this.repo.expurgarAuditoria(
        dataDeCorte(agora, RETENCAO_AUDITORIA_DIAS),
      )),
    }));
  }

  /**
   * Roda uma varredura, loga o resultado só se ela apagou algo, e **engole a
   * exceção** para as varreduras seguintes acontecerem.
   */
  private async varrer(
    nome: string,
    fn: () => Promise<Record<string, unknown>>,
  ): Promise<void> {
    try {
      const linha = await fn();
      const total = Object.entries(linha)
        .filter(([k, v]) => typeof v === 'number' && k !== 'dias')
        .reduce((a, [, v]) => a + (v as number), 0);
      if (total > 0) this.logger.log(linha);
    } catch (erro) {
      this.logger.error(
        {
          evento: 'retencao.varredura_falhou',
          msg: 'Falha numa varredura de retenção. As demais continuam.',
          varredura: nome,
        },
        erro instanceof Error ? erro.stack : undefined,
      );
    }
  }
}
