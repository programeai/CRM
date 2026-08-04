import { api } from '@/lib/api';
import type {
  FinalidadeDeConsentimento,
  HistoricoDeConsentimento,
  RegistrarConsentimentoBody,
  RegistroDeConsentimento,
  TextoDeConsentimento,
  TipoDeTitular,
} from './types';

export const consentimentoApi = {
  finalidades: () =>
    api
      .get<FinalidadeDeConsentimento[]>('/consentimentos/finalidades')
      .then((r) => r.data),
  /** O texto que a tela exibe ANTES de registrar. */
  texto: (purpose: string) =>
    api
      .get<TextoDeConsentimento>('/consentimentos/texto', {
        params: { purpose },
      })
      .then((r) => r.data),
  historico: (subjectType: TipoDeTitular, subjectId: string) =>
    api
      .get<HistoricoDeConsentimento>('/consentimentos', {
        params: { subjectType, subjectId },
      })
      .then((r) => r.data),
  /** Registrar. **Revogar é isto com `granted: false`** — não há PATCH/DELETE. */
  registrar: (body: RegistrarConsentimentoBody) =>
    api
      .post<RegistroDeConsentimento>('/consentimentos', body)
      .then((r) => r.data),
};
