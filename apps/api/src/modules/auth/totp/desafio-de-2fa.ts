/**
 * O desafio entre a senha e a sessão.
 *
 * É um JWT curto (5 min) com `{ sub, tipo: 'mfa' }`, assinado com
 * `JWT_ACCESS_SECRET` — e **não** uma tabela nova, de propósito: ele não precisa
 * ser revogável (expira em 5 minutos), não precisa ser listado e não sobrevive ao
 * fluxo. Uma tabela pediria migration, faxina e um segundo lugar onde revogar.
 *
 * `tipo: 'mfa'` é obrigatório na verificação: sem ele, um **access token** válido
 * seria aceito como desafio e o segundo fator viraria decoração.
 *
 * Consequência assumida: o desafio pode ser reapresentado dentro dos 5 minutos.
 * Isso não dá acesso a nada — leva ao mesmo prompt de código, que continua
 * exigindo o segundo fator e continua sujeito ao limite por conta.
 */
export const TTL_DO_DESAFIO = '5m';
export const TIPO_DO_DESAFIO = 'mfa';

/** O payload do desafio. `tipo` é o que o distingue de um access token. */
export interface PayloadDoDesafio {
  sub: string;
  tipo: typeof TIPO_DO_DESAFIO;
}
