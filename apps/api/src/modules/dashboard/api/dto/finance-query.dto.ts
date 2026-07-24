import { IsOptional, Matches } from 'class-validator';

/** Filtros do resumo financeiro do dashboard. */
export class FinanceQueryDto {
  /**
   * Mês de referência dos totais previstos/recebidos, no formato `AAAA-MM`.
   * Ausente → mês corrente. (MRR, atraso e próximos vencimentos são sempre atuais.)
   */
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'Mês inválido. Use o formato AAAA-MM.',
  })
  month?: string;
}
