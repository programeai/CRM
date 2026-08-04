/**
 * Tradução pt-BR dos enums de domínio (fonte: apps/api/prisma/schema.prisma).
 *
 * Regra: nenhum identificador técnico de enum aparece cru na UI — sempre passe
 * pelo tradutor correspondente. Ao adicionar um valor novo ao schema, inclua a
 * tradução aqui no mesmo PR (ver apps/web/CLAUDE.md).
 *
 * O que NÃO vive aqui: as quatro listas configuráveis pelo owner (tipos de
 * serviço, fontes de lead, tipos de atividade e motivos de perda). Elas vêm de
 * `GET /catalogos/:kind` já em pt-BR — o rótulo é o dado. Ver
 * `features/catalogos`.
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

export const CLIENT_STATUS_LABELS = {
  LEAD: 'Lead',
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  LOST: 'Perdido',
} as const;
export const translateClientStatus = make(CLIENT_STATUS_LABELS);

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
  ACTIVITY: 'Atividade',
  IMPORT: 'Importação',
  INTEGRATION: 'Integração',
  ACCOUNT: 'Conta',
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
  IMPORTAR: 'Importou',
  ROTACIONAR: 'Rotacionou a chave',
  EXPORTAR: 'Exportou os dados',
  ENCERRAR: 'Pediu o encerramento',
} as const;
export const translateAuditAction = make(AUDIT_ACTION_LABELS);

// --- lixeira (Fase 8C) ---

export const TRASH_TYPE_LABELS = {
  CLIENT: 'Cliente',
  CONTACT: 'Contato',
  DEAL: 'Oportunidade',
  PROJECT: 'Projeto',
  TASK: 'Demanda',
} as const;
export const translateTrashType = make(TRASH_TYPE_LABELS);

// --- notificações (Fase 9) ---

export const NOTIFICATION_TYPE_LABELS = {
  FOLLOW_UP_DUE: 'Follow-up de hoje',
  DEAL_STALE: 'Oportunidade esfriando',
  PROPOSAL_EXPIRING: 'Proposta a expirar',
  PAYMENT_DUE: 'Cobrança a vencer',
  PAYMENT_OVERDUE: 'Cobrança vencida',
  TASK_OVERDUE: 'Demanda atrasada',
  RECORD_ASSIGNED: 'Atribuído a você',
  LEAD_RECEIVED: 'Lead recebido',
} as const;
export const translateNotificationType = make(NOTIFICATION_TYPE_LABELS);

/**
 * Os tipos de notificação na ordem do catálogo — o map de rótulos acima é a
 * fonte da ordem. A tupla (em vez de um array) é o que deixa `z.enum()` valer
 * no schema dos diálogos de destino.
 */
export const NOTIFICATION_TYPES = Object.keys(NOTIFICATION_TYPE_LABELS) as [
  keyof typeof NOTIFICATION_TYPE_LABELS,
  ...(keyof typeof NOTIFICATION_TYPE_LABELS)[],
];

/**
 * Quando cada aviso sai. Vive junto do rótulo porque tem dois consumidores em
 * features distintas: a matriz de eventos em Configurações → Notificações e a
 * página de ajuda que ensina a integrar.
 *
 * Sem número de dias: as janelas de proposta e de cobrança são constantes do
 * backend (`DIAS_PROPOSTA`/`DIAS_COBRANCA`) e um "3 dias" escrito aqui
 * envelheceria calado.
 */
export const NOTIFICATION_TYPE_DESCRIPTIONS: Record<
  keyof typeof NOTIFICATION_TYPE_LABELS,
  string
> = {
  FOLLOW_UP_DUE: 'Follow-up da timeline agendado para hoje.',
  DEAL_STALE:
    'Oportunidade parada no mesmo estágio — o mesmo limite do selo "Esfriando" no quadro.',
  PROPOSAL_EXPIRING: 'Alguns dias antes de uma proposta expirar.',
  PAYMENT_DUE: 'Alguns dias antes de uma cobrança vencer.',
  PAYMENT_OVERDUE: 'Cobrança que passou do vencimento sem baixa.',
  TASK_OVERDUE: 'Demanda com prazo vencido e ainda não concluída.',
  RECORD_ASSIGNED: 'Alguém define você como responsável por um registro.',
  LEAD_RECEIVED: 'Um lead entra por integração (site, landing page).',
};

export const NOTIFICATION_CHANNEL_KIND_LABELS = {
  IN_APP: 'Central de notificações',
  EMAIL: 'E-mail',
  WEBHOOK: 'Webhook',
  SLACK: 'Slack',
  DISCORD: 'Discord',
  TELEGRAM: 'Telegram',
} as const;
export const translateNotificationChannelKind = make(
  NOTIFICATION_CHANNEL_KIND_LABELS,
);

/**
 * Tipo de titular do livro-razão de consentimento (Fase 19-B). As FINALIDADES
 * **não** entram aqui: elas vêm de `GET /consentimentos/finalidades`, como as
 * permissões e os escopos de integração — rótulo de catálogo do backend não é
 * duplicado no front.
 */
export const CONSENT_SUBJECT_TYPE_LABELS = {
  CLIENT: 'Cliente',
  CONTACT: 'Contato',
} as const;
export const translateConsentSubjectType = make(CONSENT_SUBJECT_TYPE_LABELS);
