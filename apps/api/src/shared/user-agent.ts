/**
 * Rótulo legível de dispositivo a partir do User-Agent — "Chrome no Windows".
 *
 * Heurística curta e deliberadamente burra, sem dependência: `ua-parser-js` v2
 * é AGPLv3 (incompatível com a Apache-2.0 deste repositório) e trazer uma lib
 * MIT quebraria o padrão "nenhuma dependência nova" dos planos anteriores.
 * O custo aceito é errar em User-Agent exótico — nesses casos devolvemos a
 * string crua truncada, que ainda diz alguma coisa a quem olha.
 *
 * A ORDEM DOS TESTES IMPORTA: Edge e Opera se declaram Chrome, e Chrome se
 * declara Safari. Do mais específico para o mais genérico.
 */

const NAVEGADORES: ReadonlyArray<[RegExp, string]> = [
  [/edg[ea]?\//i, 'Edge'],
  [/opr\/|opera/i, 'Opera'],
  [/samsungbrowser/i, 'Samsung Internet'],
  [/firefox\/|fxios/i, 'Firefox'],
  [/chrome\/|crios/i, 'Chrome'],
  [/safari\//i, 'Safari'],
];

const SISTEMAS: ReadonlyArray<[RegExp, string]> = [
  [/windows nt/i, 'Windows'],
  [/iphone|ipad|ipod/i, 'iOS'],
  [/android/i, 'Android'],
  [/mac os x|macintosh/i, 'macOS'],
  [/linux/i, 'Linux'],
];

const RESERVA_MAX = 60;

function primeiro(
  tabela: ReadonlyArray<[RegExp, string]>,
  ua: string,
): string | null {
  return tabela.find(([re]) => re.test(ua))?.[1] ?? null;
}

/** `null`/vazio → "Dispositivo desconhecido". Nunca lança. */
export function describeUserAgent(ua?: string | null): string {
  if (!ua) return 'Dispositivo desconhecido';
  const navegador = primeiro(NAVEGADORES, ua);
  const sistema = primeiro(SISTEMAS, ua);
  if (navegador && sistema) return `${navegador} no ${sistema}`;
  if (navegador) return navegador;
  if (sistema) return sistema;
  return ua.length > RESERVA_MAX ? `${ua.slice(0, RESERVA_MAX)}…` : ua;
}
