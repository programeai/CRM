/**
 * Tradução pt-BR dos enums de domínio (fonte: apps/api/prisma/schema.prisma).
 *
 * Regra: nenhum identificador técnico de enum aparece cru na UI — sempre passe
 * pelo tradutor correspondente. Ao adicionar um valor novo ao schema, inclua a
 * tradução aqui no mesmo PR (ver apps/web/CLAUDE.md).
 */

function make<T extends string>(map: Record<T, string>) {
  return (value: T | null | undefined): string =>
    value == null ? '' : (map[value] ?? value);
}

export const PERSON_TYPE_LABELS = {
  INDIVIDUAL: 'Pessoa física',
  COMPANY: 'Pessoa jurídica',
} as const;
export const translatePersonType = make(PERSON_TYPE_LABELS);

export const LEAD_SOURCE_LABELS = {
  REFERRAL: 'Indicação',
  PAID_TRAFFIC: 'Tráfego pago',
  ORGANIC: 'Orgânico',
  OUTBOUND: 'Prospecção ativa',
  OTHER: 'Outro',
} as const;
export const translateLeadSource = make(LEAD_SOURCE_LABELS);

export const CLIENT_STATUS_LABELS = {
  LEAD: 'Lead',
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  LOST: 'Perdido',
} as const;
export const translateClientStatus = make(CLIENT_STATUS_LABELS);

export const SERVICE_TYPE_LABELS = {
  SOFTWARE: 'Software',
  WEBSITE: 'Website',
  PAID_TRAFFIC: 'Tráfego pago',
} as const;
export const translateServiceType = make(SERVICE_TYPE_LABELS);

export const PROPOSAL_STATUS_LABELS = {
  DRAFT: 'Rascunho',
  SENT: 'Enviada',
  NEGOTIATING: 'Em negociação',
  ACCEPTED: 'Aceita',
  REJECTED: 'Recusada',
  EXPIRED: 'Expirada',
} as const;
export const translateProposalStatus = make(PROPOSAL_STATUS_LABELS);

export const PROJECT_STATUS_LABELS = {
  ACTIVE: 'Ativo',
  PAUSED: 'Pausado',
  DONE: 'Concluído',
  CANCELED: 'Cancelado',
} as const;
export const translateProjectStatus = make(PROJECT_STATUS_LABELS);

export const TASK_STATUS_LABELS = {
  BACKLOG: 'Backlog',
  TODO: 'A fazer',
  IN_PROGRESS: 'Em andamento',
  REVIEW: 'Em revisão',
  DONE: 'Concluída',
} as const;
export const translateTaskStatus = make(TASK_STATUS_LABELS);

export const TASK_PRIORITY_LABELS = {
  LOW: 'Baixa',
  MEDIUM: 'Média',
  HIGH: 'Alta',
  URGENT: 'Urgente',
} as const;
export const translateTaskPriority = make(TASK_PRIORITY_LABELS);

export const BILLING_TYPE_LABELS = {
  RECURRING: 'Recorrente',
  INSTALLMENTS: 'Parcelado',
  ONE_TIME: 'Pagamento único',
} as const;
export const translateBillingType = make(BILLING_TYPE_LABELS);

export const CONTRACT_STATUS_LABELS = {
  ACTIVE: 'Ativo',
  PAUSED: 'Pausado',
  FINISHED: 'Encerrado',
  CANCELED: 'Cancelado',
} as const;
export const translateContractStatus = make(CONTRACT_STATUS_LABELS);

export const PAYMENT_STATUS_LABELS = {
  PENDING: 'Pendente',
  PAID: 'Pago',
  OVERDUE: 'Vencido',
  CANCELED: 'Cancelado',
} as const;
export const translatePaymentStatus = make(PAYMENT_STATUS_LABELS);

export const PAYMENT_METHOD_LABELS = {
  PIX: 'Pix',
  TRANSFER: 'Transferência',
  BOLETO: 'Boleto',
  CARD: 'Cartão',
  CASH: 'Dinheiro',
} as const;
export const translatePaymentMethod = make(PAYMENT_METHOD_LABELS);

export const SUBSCRIPTION_STATUS_LABELS = {
  TRIALING: 'Em teste',
  ACTIVE: 'Ativa',
  PAST_DUE: 'Pagamento atrasado',
  CANCELED: 'Cancelada',
  INCOMPLETE: 'Incompleta',
} as const;
export const translateSubscriptionStatus = make(SUBSCRIPTION_STATUS_LABELS);

export const ACTIVITY_TYPE_LABELS = {
  NOTE: 'Anotação',
  CALL: 'Ligação',
  MEETING: 'Reunião',
  EMAIL: 'E-mail',
  WHATSAPP: 'WhatsApp',
  FOLLOW_UP: 'Follow-up',
} as const;
export const translateActivityType = make(ACTIVITY_TYPE_LABELS);

// --- auditoria (Fase 8B) ---

export const AUDIT_ACTOR_TYPE_LABELS = {
  USER: 'Pessoa',
  CRON: 'Rotina automática',
  WEBHOOK: 'Integração',
  SISTEMA: 'Sistema',
} as const;
export const translateAuditActorType = make(AUDIT_ACTOR_TYPE_LABELS);

export const AUDIT_ENTITY_LABELS = {
  CLIENT: 'Cliente',
  CONTACT: 'Contato',
  DEAL: 'Oportunidade',
  PROPOSAL: 'Proposta',
  PROJECT: 'Projeto',
  TASK: 'Demanda',
  CONTRACT: 'Contrato',
  PAYMENT: 'Cobrança',
  ROLE: 'Papel',
  USER: 'Colaborador',
  SUBSCRIPTION: 'Assinatura',
} as const;
export const translateAuditEntity = make(AUDIT_ENTITY_LABELS);

/** Verbo no passado: a linha da trilha se lê "Fulana <ação> <registro>". */
export const AUDIT_ACTION_LABELS = {
  CRIAR: 'Criou',
  ATUALIZAR: 'Editou',
  EXCLUIR: 'Excluiu',
  ARQUIVAR: 'Arquivou',
  RESTAURAR: 'Restaurou',
  EXPURGAR: 'Excluiu em definitivo',
  PAGAR: 'Deu baixa',
  ESTORNAR: 'Estornou',
  CANCELAR: 'Cancelou',
  PAUSAR: 'Pausou',
  RETOMAR: 'Retomou',
  ENVIAR: 'Enviou',
  ACEITAR: 'Aceitou',
  RECUSAR: 'Recusou',
  NOVA_VERSAO: 'Criou nova versão',
  CONVIDAR: 'Convidou',
  ATIVAR: 'Reativou',
  DESATIVAR: 'Desativou',
  ALTERAR_PAPEL: 'Alterou o papel',
  EXPIRAR: 'Expirou',
  VENCER: 'Marcou como vencida',
} as const;
export const translateAuditAction = make(AUDIT_ACTION_LABELS);
