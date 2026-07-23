/** Converte reais (number, 2 casas) para centavos inteiros. */
export function toCents(value: number): number {
  return Math.round(value * 100);
}

/** Centavos inteiros → reais (number, 2 casas) para gravar no Decimal. */
export function fromCents(cents: number): number {
  return cents / 100;
}
