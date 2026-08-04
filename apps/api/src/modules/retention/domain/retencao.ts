/**
 * Prazos de retenção. **Constantes exportadas, e não configuração** — mesma
 * decisão de `RETENCAO_SESSAO_VENCIDA_DIAS` (30) e
 * `RETENCAO_REGISTRO_DE_ACESSO_DIAS` (180): nenhuma delas é decisão de instância,
 * e cada uma é um número que a Política de Privacidade publica. Tornar isto
 * configurável criaria um prazo por instalação que a Política não poderia mais
 * declarar.
 *
 * A tensão que o roadmap trouxe ("política de retenção") está resolvida assim:
 * **a política existe e é pública** — não que ela seja editável. A entrega é o
 * expurgo funcionando e o prazo declarado na Política.
 *
 * A LGPD **não fixa prazo em dias** para nada disto (o art. 19, II fala de 15
 * dias, e é para confirmação/acesso, não para eliminação). O art. 16 manda
 * eliminar após o término do tratamento, ressalvando o cumprimento de obrigação
 * legal (I) e o uso exclusivo do controlador com dados anonimizados (IV). Os
 * números abaixo são, portanto, decisão de produto ancorada — cada um com o porquê
 * ao lado.
 */

/**
 * Lixeira: 180 dias. É o prazo em que um arquivamento por engano ainda é lembrado
 * por alguém; passado isso, "arquivado" é "excluído com passos extras". Vale para
 * os cinco modelos com `archivedAt` (Client, Contact, Deal, Project, Task).
 */
export const RETENCAO_LIXEIRA_DIAS = 180;

/**
 * Notificação e entrega: 90 dias. A central é operacional, não histórico — uma
 * notificação de três meses atrás não muda decisão nenhuma, e o `AuditLog` guarda
 * o fato que a originou.
 */
export const RETENCAO_NOTIFICACAO_DIAS = 90;

/**
 * Trilha de auditoria: 5 anos. É o prazo geral de prescrição das pretensões
 * comerciais mais comuns (e o do CDC), e a trilha existe justamente para responder
 * "quem alterou isso" quando alguém questiona. Menos que isso esvaziaria o art. 37
 * (obrigação de manter registro das operações); mais seria guardar PII de terceiro
 * sem finalidade.
 */
export const RETENCAO_AUDITORIA_DIAS = 5 * 365;

/** `agora − dias`, em UTC. A data de corte de uma varredura. */
export function dataDeCorte(agora: Date, dias: number): Date {
  return new Date(agora.getTime() - dias * 24 * 60 * 60 * 1000);
}
