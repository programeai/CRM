import type { AuditEntity, NotificationType } from '@prisma/client';

/**
 * O FATO, como o gatilho o conhece — ids e rótulos, nada de texto pronto. É a
 * primeira das três costuras; `montarConteudo` faz a segunda, e o adapter a terceira.
 */
export type EventoDeNotificacao =
  | {
      tipo: 'RECORD_ASSIGNED';
      entity: AuditEntity;
      entityId: string;
      /** Rótulo humano do registro no momento da atribuição ("Site institucional"). */
      entityLabel: string;
      /** Só quando `entity = ACTIVITY`: a timeline mora sob o cliente. */
      clientId?: string;
    }
  | {
      tipo: 'FOLLOW_UP_DUE';
      entityId: string;
      /** Trecho do conteúdo da atividade — atividade não tem título. */
      descricao: string;
      clienteNome: string;
      /** A timeline mora sob o cliente; sem ele não há tela de destino. */
      clientId: string;
      dataAlvo: Date;
    }
  | {
      tipo: 'PROPOSAL_EXPIRING';
      entityId: string;
      /** Número da proposta ("PROP-2026-0042"). */
      numero: string;
      clienteNome: string;
      dataAlvo: Date;
    }
  | {
      tipo: 'PAYMENT_DUE' | 'PAYMENT_OVERDUE';
      entityId: string;
      descricao: string;
      clienteNome: string;
      valor: number;
      dataAlvo: Date;
    }
  | {
      tipo: 'TASK_OVERDUE';
      entityId: string;
      titulo: string;
      clienteNome: string;
      dataAlvo: Date;
    }
  | {
      tipo: 'LEAD_RECEIVED';
      /** O cliente criado (ou reencontrado) pela ingestão — o registro a abrir. */
      entityId: string;
      /** Nome de quem preencheu, que nem sempre é o nome do cliente (pode ser a empresa). */
      leadNome: string;
      /** Rótulo da origem como a integração o enviou ("site-institucional"). */
      origem: string;
      /** Cenário que a qualificação apontou, quando a origem faz qualificação. */
      cenario?: string;
      /** Ingestão de contato que já existia: o corpo avisa, senão parece lead novo. */
      reincidente?: boolean;
    };

/**
 * O que o SERVIÇO sabe e o gatilho não precisa buscar. `autorNome` sai do
 * `AccessContext` do CLS e é injetado pelo `NotificationsService` — o gatilho
 * nunca o passa, senão os quatro pontos de emissão teriam de ler o CLS sozinhos
 * (era exatamente a duplicação que este parâmetro elimina).
 *
 * `null` no caminho do cron e, no futuro, numa regra da Fase 16: ninguém agiu.
 */
export interface ContextoDeEmissao {
  autorNome: string | null;
}

export interface ConteudoNeutro {
  tipo: NotificationType;
  entity: AuditEntity;
  entityId: string;
  title: string;
  body: string;
  link: string | null;
  data: Record<string, unknown> | null;
}

/** Rótulo do registro em pt-BR. Espelha `AUDIT_ENTITY_LABELS` do apps/web. */
const ENTIDADE: Record<AuditEntity, string> = {
  CLIENT: 'o cliente',
  CONTACT: 'o contato',
  DEAL: 'a oportunidade',
  PROPOSAL: 'a proposta',
  PROJECT: 'o projeto',
  TASK: 'a demanda',
  CONTRACT: 'o contrato',
  PAYMENT: 'a cobrança',
  ROLE: 'o papel',
  USER: 'o colaborador',
  SUBSCRIPTION: 'a assinatura',
  ACTIVITY: 'a atividade',
  // A importação (Fase 14-A) nunca dispara notificação — nenhum gatilho
  // aponta `entity: 'IMPORT'` — mas o Record é exaustivo sobre AuditEntity.
  IMPORT: 'a importação',
  // A chave de integração (Fase 17-A) também nunca dispara notificação —
  // emissão/rotação viram trilha de auditoria, não aviso.
  INTEGRATION: 'a integração',
};

/**
 * Caminho no FRONT, relativo. Nem todo registro tem tela própria: oportunidade
 * abre o quadro e demanda abre "Minhas demandas" — é onde a pessoa acha o item.
 */
export function linkDoRegistro(
  entity: AuditEntity,
  entityId: string,
  clientId?: string,
): string | null {
  switch (entity) {
    case 'CLIENT':
      return `/clientes/${entityId}`;
    case 'ACTIVITY':
      return clientId ? `/clientes/${clientId}/timeline` : null;
    case 'DEAL':
      return '/pipeline';
    case 'TASK':
      return '/demandas';
    case 'PROPOSAL':
      return `/propostas/${entityId}`;
    case 'PAYMENT':
      return '/financeiro';
    case 'PROJECT':
      return `/projetos/${entityId}`;
    default:
      return null;
  }
}

const moedaFmt = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

/** Valor monetário em pt-BR ("R$ 1.250,00"). */
function moeda(valor: number): string {
  return moedaFmt.format(valor);
}

/** Data curta em pt-BR ("01/08/2026"). */
function data(valor: Date): string {
  return valor.toLocaleDateString('pt-BR');
}

/** Evento de domínio → conteúdo neutro em pt-BR. Texto puro, NUNCA HTML. */
export function montarConteudo(
  evento: EventoDeNotificacao,
  contexto: ContextoDeEmissao,
): ConteudoNeutro {
  switch (evento.tipo) {
    case 'RECORD_ASSIGNED':
      return {
        tipo: 'RECORD_ASSIGNED',
        entity: evento.entity,
        entityId: evento.entityId,
        title: `Atribuíram ${ENTIDADE[evento.entity]} a você`,
        // Sem autor conhecido (cron, ou uma regra da Fase 16), a frase é
        // impessoal em vez de inventar um sujeito.
        body: contexto.autorNome
          ? `${contexto.autorNome} definiu você como responsável por ${evento.entityLabel}.`
          : `Você foi definido como responsável por ${evento.entityLabel}.`,
        link: linkDoRegistro(evento.entity, evento.entityId, evento.clientId),
        data: { entity: evento.entity, entityId: evento.entityId },
      };

    case 'FOLLOW_UP_DUE':
      return {
        tipo: 'FOLLOW_UP_DUE',
        entity: 'ACTIVITY',
        entityId: evento.entityId,
        title: 'Follow-up agendado para hoje',
        body: `Follow-up com ${evento.clienteNome}: ${evento.descricao}.`,
        link: linkDoRegistro('ACTIVITY', evento.entityId, evento.clientId),
        data: { clienteNome: evento.clienteNome },
      };

    case 'PROPOSAL_EXPIRING':
      return {
        tipo: 'PROPOSAL_EXPIRING',
        entity: 'PROPOSAL',
        entityId: evento.entityId,
        title: 'Proposta a expirar',
        body: `A proposta ${evento.numero} para ${evento.clienteNome} expira em ${data(evento.dataAlvo)}.`,
        link: linkDoRegistro('PROPOSAL', evento.entityId),
        data: { numero: evento.numero, clienteNome: evento.clienteNome },
      };

    case 'PAYMENT_DUE':
      return {
        tipo: 'PAYMENT_DUE',
        entity: 'PAYMENT',
        entityId: evento.entityId,
        title: 'Cobrança a vencer',
        body: `${evento.descricao} de ${evento.clienteNome}, ${moeda(evento.valor)}, vence em ${data(evento.dataAlvo)}.`,
        link: linkDoRegistro('PAYMENT', evento.entityId),
        data: { clienteNome: evento.clienteNome, valor: evento.valor },
      };

    case 'PAYMENT_OVERDUE':
      return {
        tipo: 'PAYMENT_OVERDUE',
        entity: 'PAYMENT',
        entityId: evento.entityId,
        title: 'Cobrança vencida',
        body: `${evento.descricao} de ${evento.clienteNome}, ${moeda(evento.valor)}, venceu em ${data(evento.dataAlvo)}.`,
        link: linkDoRegistro('PAYMENT', evento.entityId),
        data: { clienteNome: evento.clienteNome, valor: evento.valor },
      };

    case 'TASK_OVERDUE':
      return {
        tipo: 'TASK_OVERDUE',
        entity: 'TASK',
        entityId: evento.entityId,
        title: 'Demanda atrasada',
        body: `A demanda ${evento.titulo} (${evento.clienteNome}) passou do prazo em ${data(evento.dataAlvo)}.`,
        link: linkDoRegistro('TASK', evento.entityId),
        data: { titulo: evento.titulo, clienteNome: evento.clienteNome },
      };

    /*
      O corpo carrega o cenário porque este aviso costuma ser lido no celular, e
      o que decide se a pessoa para o que está fazendo para responder é o cenário,
      não o nome. Telefone e e-mail NÃO entram: o corpo viaja para Telegram,
      Slack e webhook, e dado de contato de lead não deve morar nesses históricos
      — quem for atender abre o registro pelo link.
    */
    case 'LEAD_RECEIVED':
      return {
        tipo: 'LEAD_RECEIVED',
        entity: 'CLIENT',
        entityId: evento.entityId,
        title: evento.reincidente ? 'Lead voltou a procurar' : 'Lead novo',
        body: [
          `${evento.leadNome} chegou por ${evento.origem}`,
          evento.cenario ? `. Cenário: ${evento.cenario}` : '',
          '.',
          evento.reincidente ? ' Já havia um cadastro com este contato.' : '',
        ].join(''),
        link: linkDoRegistro('CLIENT', evento.entityId),
        data: { leadNome: evento.leadNome, origem: evento.origem },
      };
  }
}
