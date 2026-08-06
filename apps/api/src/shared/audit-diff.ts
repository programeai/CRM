/**
 * Diff de auditoria: `{ campo: { antes, depois } }`, só com o que mudou.
 *
 * A redação automática de segredo do log (`CHAVE_SENSIVEL` em
 * `shared/logging/log.ts`) **não** alcança uma coluna JSONB persistida — a
 * omissão aqui é explícita e por nome de campo.
 */

/** Nunca entram no diff. Segredo, dado pessoal sensível ou ruído. */
const CAMPOS_OMITIDOS = new Set([
  'passwordHash',
  'tokenHash',
  'keyHash', // sha256 da chave de integração (Fase 17-A)
  'prefix', // pedaço em claro da chave: não é segredo, mas é ruído na trilha
  'refreshTokenHash',
  'stripeCustomerId',
  'stripeSubscriptionId',
  'document', // CPF/CNPJ: dado pessoal que a trilha não precisa repetir
  // Atribuição de anúncio. Hoje NENHUMA escrita de `Client` passa `antes`/
  // `depois` ao `AuditService` (só `promoverParaAtivo`, com `{ status }`), então
  // isto é seguro preventivo, não conserto: no dia em que uma escrita de cliente
  // passar a diffar, um identificador publicitário iria para `AuditLog.diff`,
  // que retém 5 anos (`retention/domain/retencao.ts:42`) contra o "enquanto a
  // conta existir" do próprio `Client` — sobreviveria ao cliente. Mesma razão de
  // `document`. A lista canônica é `modules/clients/domain/ad-attribution.ts`;
  // aqui ela é repetida porque `shared` não pode depender de `modules`.
  'fbclid',
  'fbclidAt',
  'fbp',
  'gclid',
  'utmSource',
  'utmMedium',
  'utmCampaign',
  'utmContent',
  'utmTerm',
  'landingUrl',
  'secret', // segredo HMAC do destino/webhook (Fase 19-B)
  'config', // Json do destino de notificação: carrega URL-credencial e segredo
  'updatedAt', // muda em toda escrita; diria só "houve escrita"
  'createdAt',
  // Relações carregadas junto do registro (`ContractWithPayments`,
  // `ProposalWithItems`, …). O diff é RASO, de campo escalar: despejar o array
  // inteiro aqui contraria a decisão de gravar um registro agregado — o cancelamento
  // de um contrato com 12 parcelas viraria um blob com as 12, duas vezes.
  // O que interessa da relação entra por `extra` (ex.: `cobrancasCanceladas`).
  'payments',
  'items',
  'contract',
  'client',
  'assignee',
  'role',
]);

/** Reconhece um `Decimal` do Prisma sem depender do tipo (evita import cruzado). */
interface ValorDecimal {
  toFixed(): string;
  toString(): string;
}

function ehDecimal(valor: object): valor is ValorDecimal {
  return 'toFixed' in valor;
}

/** Valor pronto para JSONB: Decimal e Date viram string; o resto passa. */
function normalizar(valor: unknown): unknown {
  if (valor == null) return null;
  if (valor instanceof Date) return valor.toISOString();
  // Decimal do Prisma (e qualquer objeto com toString próprio que não seja Object).
  if (typeof valor === 'object' && ehDecimal(valor)) {
    return valor.toString();
  }
  return valor;
}

export type AuditDiff = Record<string, { antes: unknown; depois: unknown }>;

/**
 * Compara dois estados do mesmo registro. Devolve `null` quando nada mudou —
 * a trilha grava `diff: null` em ação sem diff (ex.: EXCLUIR, ARQUIVAR).
 *
 * A comparação é rasa e por `JSON.stringify` do valor normalizado: basta para
 * os campos escalares do domínio, e evita falso positivo entre `Decimal(10.00)`
 * e `Decimal(10)`.
 */
export function calcularDiff(
  antes: Record<string, unknown>,
  depois: Record<string, unknown>,
  omitir: ReadonlySet<string> = CAMPOS_OMITIDOS,
): AuditDiff | null {
  const out: AuditDiff = {};
  for (const campo of new Set([
    ...Object.keys(antes),
    ...Object.keys(depois),
  ])) {
    if (omitir.has(campo)) continue;
    const a = normalizar(antes[campo]);
    const d = normalizar(depois[campo]);
    if (JSON.stringify(a) !== JSON.stringify(d))
      out[campo] = { antes: a, depois: d };
  }
  return Object.keys(out).length > 0 ? out : null;
}
