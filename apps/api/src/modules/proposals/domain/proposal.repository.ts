import type { Prisma } from '@prisma/client';

export const PROPOSAL_REPOSITORY = Symbol('PROPOSAL_REPOSITORY');

/** Proposta + itens (ordenados) + dados mínimos do cliente para listagem/ficha. */
export type ProposalWithItems = Prisma.ProposalGetPayload<{
  include: {
    items: true;
    client: { select: { id: true; name: true } };
    serviceType: { select: { id: true; name: true; active: true } };
  };
}>;

export interface ProposalListFilter {
  ownerId: string; // filtra por client.ownerId
  search?: string; // nº da proposta ou nome/email do cliente (contains, case-insensitive)
  clientId?: string;
  status?: import('@prisma/client').ProposalStatus;
  skip: number;
  take: number;
}

/** Proposta expirada pela rotina — a trilha (`status` = o anterior) e a notificação. */
export interface PropostaExpirada {
  id: string;
  ownerId: string;
  number: string;
  status: import('@prisma/client').ProposalStatus;
  clienteNome: string;
  /** Derivado por `deal ?? client` (D2). Null → o gatilho cai no owner. */
  assigneeId: string | null;
  /** O `validUntil` que motivou a expiração — compõe o corpo da notificação. */
  validUntil: Date;
}

export interface ProposalRepository {
  create(data: Prisma.ProposalUncheckedCreateInput): Promise<ProposalWithItems>;
  findById(id: string): Promise<ProposalWithItems | null>;
  findManyAndCount(
    filter: ProposalListFilter,
  ): Promise<{ data: ProposalWithItems[]; total: number }>;
  /**
   * Substitui os itens (deleteMany + create) e aplica o patch numa transação.
   * `ownerId` de cada item é derivado internamente a partir do ownerId da
   * própria proposta — o chamador não precisa (nem deve) informá-lo.
   */
  updateWithItems(
    id: string,
    data: Prisma.ProposalUpdateInput,
    items: Omit<
      Prisma.ProposalItemUncheckedCreateWithoutProposalInput,
      'ownerId'
    >[],
  ): Promise<ProposalWithItems>;
  /** Patch de campos escalares (status/datas) sem tocar nos itens. */
  update(
    id: string,
    data: Prisma.ProposalUpdateInput,
  ): Promise<ProposalWithItems>;
  delete(id: string): Promise<void>;
  /** Maior sequencial (sufixo NNNN) entre as propostas do ano informado; 0 se não houver. */
  maxSequenceForYear(year: number): Promise<number>;
  /** Todas as versões de uma cadeia (mesmo `number`), ordenadas por `version`. */
  findVersionsByNumber(number: string): Promise<ProposalWithItems[]>;
  /** Expira as SENT|NEGOTIATING vencidas e devolve **quais** foram (a trilha precisa dos ids). */
  expireOverdue(now: Date): Promise<PropostaExpirada[]>;
}
