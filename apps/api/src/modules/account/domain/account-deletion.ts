/**
 * Carência entre o pedido e o expurgo. 30 dias é o prazo que a Política de
 * Privacidade já publicou e o mesmo do GitLab SaaS. Exportado porque três lugares
 * precisam do MESMO número: o service que agenda, o e-mail que avisa e o texto
 * da Política.
 */
export const CARENCIA_DE_ENCERRAMENTO_DIAS = 30;

export interface EncerramentoAgendado {
  requestedAt: Date;
  scheduledFor: Date;
}
