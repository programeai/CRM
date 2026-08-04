import { api } from '@/lib/api';
import type {
  CadastroDeSegundoFator,
  CodigosDeRecuperacao,
  Reautenticacao,
  StatusDoSegundoFator,
} from './types';

export const segurancaApi = {
  status: () =>
    api.get<StatusDoSegundoFator>('/auth/2fa').then((r) => r.data),
  /** Gera o segredo e devolve o QR. **Não liga** o 2FA. */
  iniciar: () =>
    api.post<CadastroDeSegundoFator>('/auth/2fa/setup').then((r) => r.data),
  /** Confirma e liga. Devolve os 16 códigos, uma única vez. */
  confirmar: (codigo: string) =>
    api
      .post<CodigosDeRecuperacao>('/auth/2fa/confirm', { codigo })
      .then((r) => r.data),
  /** Regenera os códigos, invalidando os antigos. Exige reautenticação. */
  regenerarCodigos: (body: Reautenticacao) =>
    api
      .post<CodigosDeRecuperacao>('/auth/2fa/recovery-codes', body)
      .then((r) => r.data),
  /** Desliga. Exige reautenticação. */
  desativar: (body: Reautenticacao) =>
    // `data` no DELETE: o axios só envia corpo em DELETE por esta chave.
    api.delete('/auth/2fa', { data: body }).then((r) => r.data),
};
