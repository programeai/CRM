/** A chave como a API a devolve: mascarada, **nunca** com o valor bruto. */
export interface ChaveDeIntegracao {
  id: string;
  nome: string;
  /** `crm_a1b2c3d4••••••••` — o que a interface exibe. */
  mascarada: string;
  escopos: string[];
  criadaEm: string;
  ultimoUsoEm: string | null;
  revogadaEm: string | null;
}

export interface CanalDeCaptacao {
  id: string;
  name: string;
  assignee: { id: string; name: string } | null;
  source: { id: string; name: string; active: boolean } | null;
  chave: ChaveDeIntegracao | null;
  createdAt: string;
}

/** Resposta do POST: a ÚNICA que carrega o valor da chave. */
export interface CanalCriado {
  canal: CanalDeCaptacao;
  /** Existe uma vez. Não é relido de lugar nenhum depois desta resposta. */
  chave: string;
}

/** Resposta da rotação: idem — o valor volta uma vez. */
export interface ChaveEmitida {
  chave: ChaveDeIntegracao;
  valor: string;
}

export interface CanalBody {
  name: string;
  assigneeId?: string | null;
  sourceId?: string | null;
}
