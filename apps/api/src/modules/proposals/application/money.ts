/** Converte reais (number, 2 casas) para centavos inteiros. */
export function toCents(value: number): number {
  return Math.round(value * 100);
}

/** Centavos inteiros → reais (number, 2 casas) para gravar no Decimal. */
export function fromCents(cents: number): number {
  return cents / 100;
}

/**
 * Calcula o total (em reais, 2 casas) a partir dos itens e desconto.
 * Cada linha é arredondada isolada (Σ round(qty×unit)); desconto subtraído
 * ao fim; nunca negativo. Tudo em centavos para evitar erro de float.
 */
export function computeTotal(
  items: { quantity: number; unitPrice: number }[],
  discount?: number,
): number {
  const gross = items.reduce(
    (sum, it) => sum + toCents(it.quantity * it.unitPrice),
    0,
  );
  const net = Math.max(0, gross - toCents(discount ?? 0));
  return fromCents(net);
}
