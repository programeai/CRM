export interface PageMeta {
  total: number;
  page: number;
  limit: number;
}
export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/** Normaliza page/limit para valores seguros (>=1, limit<=MAX_LIMIT). */
export function normalizePage(page?: number, limit?: number) {
  const p =
    Number.isFinite(page) && page! > 0 ? Math.floor(page!) : DEFAULT_PAGE;
  const l =
    Number.isFinite(limit) && limit! > 0
      ? Math.min(Math.floor(limit!), MAX_LIMIT)
      : DEFAULT_LIMIT;
  return { page: p, limit: l, skip: (p - 1) * l, take: l };
}

export function paginated<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): Paginated<T> {
  return { data, meta: { total, page, limit } };
}
