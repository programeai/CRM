export type TipoDeTitular = 'CLIENT' | 'CONTACT';

/** Um item do catálogo de finalidades (`GET /consentimentos/finalidades`). */
export interface FinalidadeDeConsentimento {
  key: string;
  label: string;
  description: string;
}

/** Uma manifestação registrada. */
export interface RegistroDeConsentimento {
  id: string;
  subjectType: TipoDeTitular;
  subjectId: string;
  purpose: string;
  /** `true` = consentiu; `false` = revogou. */
  granted: boolean;
  textVersion: string;
  channel: string;
  evidence: string | null;
  informedRetention: string | null;
  recordedByName: string;
  occurredAt: string;
  createdAt: string;
}

/** A situação VIGENTE de uma finalidade: a última manifestação vence. */
export interface SituacaoDeConsentimento {
  purpose: string;
  granted: boolean;
  occurredAt: string;
  textVersion: string;
}

export interface HistoricoDeConsentimento {
  situacao: SituacaoDeConsentimento[];
  historico: RegistroDeConsentimento[];
}

/** O texto vigente, já com o controlador (o owner) preenchido. */
export interface TextoDeConsentimento {
  version: string;
  text: string;
}

export interface RegistrarConsentimentoBody {
  subjectType: TipoDeTitular;
  subjectId: string;
  purpose: string;
  granted: boolean;
  channel: string;
  evidence?: string;
  informedRetention?: string;
  occurredAt?: string;
}
