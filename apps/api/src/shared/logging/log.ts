/**
 * Emissor de log estruturado: **uma linha JSON por evento** no stdout.
 *
 * É esse formato que a stack de observabilidade da VPS (Alloy → Loki → Grafana)
 * sabe abrir: `level` vira label indexado, `evento` vira metadado estruturado e
 * qualquer outro campo fica filtrável com `| json`. Ver `docs/observabilidade.md`.
 *
 * Ninguém precisa chamar `console.log` nem montar JSON à mão: código de negócio
 * usa o `Logger` do Nest (que passa por aqui via JsonLogger) e o código
 * transversal — middleware, filtro de exceção, bootstrap — usa `registrarLog`.
 */
import { ClsServiceManager } from 'nestjs-cls';

export type NivelLog = 'debug' | 'info' | 'warn' | 'error';

export type CamposLog = {
  /** Nome curto e estável do que aconteceu (`auth.login_recusado`). */
  evento?: string;
  /** Texto livre para leitura humana. */
  msg?: string;
  [campo: string]: unknown;
};

/**
 * Chaves cujo valor nunca é escrito no log. O Grafana é publicado na internet e
 * a linha vive 30 dias — segredo que entra aqui não sai mais.
 */
const CHAVE_SENSIVEL =
  /senha|password|secret|token|authorization|cookie|api[-_]?key|credential|passwordhash/i;

const VALOR_REDIGIDO = '[redigido]';

/** Teto por string: evita que um stack gigante estoure o limite de linha do Loki. */
const LIMITE_TEXTO = 8_000;

const PROFUNDIDADE_MAXIMA = 4;

function truncar(texto: string): string {
  return texto.length > LIMITE_TEXTO
    ? `${texto.slice(0, LIMITE_TEXTO)}…[truncado]`
    : texto;
}

function redigir(valor: unknown, profundidade = 0): unknown {
  if (typeof valor === 'string') return truncar(valor);
  if (valor instanceof Error) {
    return { msg: valor.message, stack: truncar(valor.stack ?? '') };
  }
  if (typeof valor === 'bigint') return valor.toString();
  if (Array.isArray(valor)) {
    if (profundidade >= PROFUNDIDADE_MAXIMA) return '[…]';
    return valor.map((item) => redigir(item, profundidade + 1));
  }
  if (valor !== null && typeof valor === 'object') {
    if (profundidade >= PROFUNDIDADE_MAXIMA) return '[…]';
    const saida: Record<string, unknown> = {};
    for (const [chave, item] of Object.entries(valor)) {
      saida[chave] = CHAVE_SENSIVEL.test(chave)
        ? VALOR_REDIGIDO
        : redigir(item, profundidade + 1);
    }
    return saida;
  }
  return valor;
}

export function redigirCampos(
  campos: Record<string, unknown>,
): Record<string, unknown> {
  const saida: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(campos)) {
    if (valor === undefined) continue;
    saida[chave] = CHAVE_SENSIVEL.test(chave) ? VALOR_REDIGIDO : redigir(valor);
  }
  return saida;
}

/**
 * Id da requisição em curso, quando há uma. Vem do CLS (ver `AppModule`), que é
 * alimentado pelo cabeçalho `x-request-id` definido em `contextoDaRequisicao` —
 * então todas as linhas de um mesmo acesso carregam o mesmo id.
 */
function requestIdAtual(): string | undefined {
  try {
    return ClsServiceManager.getClsService().getId();
  } catch {
    // Fora de um contexto CLS (bootstrap, cron, testes) simplesmente não há id.
    return undefined;
  }
}

/** Em produção o `debug` é ruído: encurta a linha e economiza retenção. */
function nivelHabilitado(nivel: NivelLog): boolean {
  return nivel !== 'debug' || process.env.NODE_ENV !== 'production';
}

export function registrarLog(nivel: NivelLog, campos: CamposLog): void {
  if (!nivelHabilitado(nivel)) return;

  const { evento, msg, ...resto } = campos;
  const requestId = requestIdAtual();
  const linha = {
    level: nivel,
    time: new Date().toISOString(),
    ...(evento !== undefined ? { evento } : {}),
    ...(msg !== undefined ? { msg: truncar(String(msg)) } : {}),
    ...(requestId !== undefined ? { requestId } : {}),
    ...redigirCampos(resto),
  };

  let serializada: string;
  try {
    serializada = JSON.stringify(linha);
  } catch {
    // Referência circular ou valor exótico: não perca o evento por causa do
    // contexto — publique o mínimo que ainda é útil para investigar.
    serializada = JSON.stringify({
      level: nivel,
      time: linha.time,
      evento,
      msg: 'Log não serializável; contexto descartado.',
    });
  }
  process.stdout.write(`${serializada}\n`);
}
