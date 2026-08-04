import type { NotificationType } from '@prisma/client';

/**
 * Eventos de negócio que saem da workspace. **É contrato público**, e por isso é
 * um namespace PRÓPRIO, e não `NotificationType` reaproveitado: o enum de
 * notificação é vocabulário interno de "o que avisar a uma pessoa" e pode ser
 * renomeado; renomear um evento daqui quebra a integração de quem consome.
 *
 * Formato `substantivo.acao_no_passado`, em pt-BR, igual ao `evento` do log
 * estruturado — pela mesma razão: nome estável é o que permite contar histórico.
 * Renomear um item existente quebra integração de terceiro. **Só acrescente.**
 */
export const OWNER_WEBHOOK_EVENTS = [
  {
    key: 'lead.recebido',
    label: 'Lead recebido',
    description: 'Lead entrou por um canal de captação',
  },
  {
    key: 'registro.atribuido',
    label: 'Registro atribuído',
    description:
      'Cliente, oportunidade, demanda ou atividade ganhou responsável',
  },
  {
    key: 'negociacao.parada',
    label: 'Oportunidade parada',
    description: 'Oportunidade sem movimento no funil há tempo demais',
  },
  {
    key: 'proposta.a_vencer',
    label: 'Proposta a vencer',
    description: 'Proposta enviada perto do fim da validade',
  },
  {
    key: 'cobranca.a_vencer',
    label: 'Cobrança a vencer',
    description: 'Recebimento com vencimento próximo',
  },
  {
    key: 'cobranca.vencida',
    label: 'Cobrança vencida',
    description: 'Recebimento que passou do vencimento',
  },
  {
    key: 'demanda.atrasada',
    label: 'Demanda atrasada',
    description: 'Demanda com prazo estourado',
  },
  {
    key: 'atividade.a_fazer',
    label: 'Follow-up a fazer',
    description: 'Follow-up agendado chegou na hora',
  },
] as const;

export type OwnerWebhookEvent = (typeof OWNER_WEBHOOK_EVENTS)[number]['key'];

const CHAVES = new Set<string>(OWNER_WEBHOOK_EVENTS.map((e) => e.key));

export function ehEventoDeWebhook(valor: string): valor is OwnerWebhookEvent {
  return CHAVES.has(valor);
}

/**
 * O tipo de notificação que origina cada evento. Existe para os pontos de
 * emissão continuarem falando o vocabulário deles (`NotificationType`) e a
 * tradução para o contrato público morar num lugar só.
 *
 * O `Record<NotificationType, …>` é deliberado: acrescentar um tipo de
 * notificação sem decidir o nome público dele **não compila**, o que é a trava
 * que impede um evento sair da workspace com nome improvisado.
 */
export const EVENTO_POR_TIPO: Record<NotificationType, OwnerWebhookEvent> = {
  LEAD_RECEIVED: 'lead.recebido',
  RECORD_ASSIGNED: 'registro.atribuido',
  DEAL_STALE: 'negociacao.parada',
  PROPOSAL_EXPIRING: 'proposta.a_vencer',
  PAYMENT_DUE: 'cobranca.a_vencer',
  PAYMENT_OVERDUE: 'cobranca.vencida',
  TASK_OVERDUE: 'demanda.atrasada',
  FOLLOW_UP_DUE: 'atividade.a_fazer',
};
