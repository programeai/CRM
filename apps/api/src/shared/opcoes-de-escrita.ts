/**
 * Opções de escrita de quem chama de fora do caminho de requisição humana.
 *
 * `avisarResponsavel: false` desliga o `RECORD_ASSIGNED`. Quem chama sem
 * `AccessContext` no CLS — ingestão de lead, API pública — precisa disso: sem a
 * opção, `NotificationsService.notificar` cai no early-return
 * `notificacao.sem_contexto` e põe um `warn` por requisição legítima.
 */
export interface OpcoesDeEscrita {
  avisarResponsavel?: boolean;
}
