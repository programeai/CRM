const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Formata um Decimal serializado (string) ou number como moeda pt-BR; '—' se nulo. */
export function formatMoney(value?: string | number | null): string {
  if (value == null || value === '') return '—';
  return currency.format(Number(value));
}
