import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

/**
 * Converte um valor tipado de filtro de/para a string do query param.
 *
 * `decode` lê o valor a partir do param (ausente → `null`); `encode` escreve o
 * valor no param e retorna `null` quando ele deve ser **omitido** da URL — o que
 * mantém a URL limpa para valores no padrão (ex.: `status = 'ALL'`, `page = 1`).
 */
export interface FilterCodec<T> {
  decode: (raw: string | null) => T;
  encode: (value: T) => string | null;
}

/** Texto livre (ex.: busca). Vazio é omitido da URL. */
export function stringFilter(fallback = ''): FilterCodec<string> {
  return {
    decode: (raw) => raw ?? fallback,
    encode: (value) => (value === fallback ? null : value),
  };
}

/**
 * Enum de domínio com sentinela de "sem filtro" (`fallback`, tipicamente `'ALL'`).
 * Valores fora da lista permitida caem para o `fallback`, protegendo contra URLs
 * adulteradas. O `fallback` nunca aparece na URL.
 */
export function enumFilter<T extends string, F extends string = T>(
  allowed: readonly T[],
  fallback: F,
): FilterCodec<T | F> {
  const set = new Set<string>(allowed);
  return {
    decode: (raw) => (raw && set.has(raw) ? (raw as T) : fallback),
    encode: (value) => (value === fallback ? null : (value as string)),
  };
}

/**
 * Id de item de catálogo (lista de runtime), com sentinela de "sem filtro".
 * Diferente de `enumFilter`, **não** há allowlist compilada para validar contra:
 * o catálogo é dado do owner. A proteção contra URL adulterada passa a ser do
 * servidor — o DTO exige `@IsUUID`, e um uuid de outro owner não casa a policy
 * de RLS e devolve lista vazia.
 */
export function idFilter(fallback = 'ALL' as const): FilterCodec<string> {
  return {
    decode: (raw) => raw ?? fallback,
    encode: (value) => (value === fallback ? null : value),
  };
}

/** Número (ex.: página). O `fallback` é omitido da URL. */
export function numberFilter(fallback: number): FilterCodec<number> {
  return {
    decode: (raw) => {
      const n = raw ? Number(raw) : NaN;
      return Number.isFinite(n) ? n : fallback;
    },
    encode: (value) => (value === fallback ? null : String(value)),
  };
}

/** Alternador ligado/desligado (ex.: "Somente meus"). `false` é omitido da URL. */
export function booleanFilter(): FilterCodec<boolean> {
  return {
    decode: (raw) => raw === 'true',
    encode: (value) => (value ? 'true' : null),
  };
}

/** Lista de strings serializada como valores separados por vírgula. Vazia → omitida. */
export function stringArrayFilter(): FilterCodec<string[]> {
  return {
    decode: (raw) => (raw ? raw.split(',').filter(Boolean) : []),
    encode: (value) => (value.length ? value.join(',') : null),
  };
}

// `any` no valor do mapa é intencional: `FilterCodec` é contravariante em `T`
// (por causa de `encode`), então `FilterCodec<unknown>` rejeitaria os codecs
// concretos. A tipagem forte volta via `Values<M>` na saída do hook.
type CodecMap = Record<string, FilterCodec<any>>; // eslint-disable-line @typescript-eslint/no-explicit-any

type Values<M extends CodecMap> = {
  [K in keyof M]: M[K] extends FilterCodec<infer T> ? T : never;
};

/**
 * Mantém um conjunto de filtros de listagem sincronizado com os query params da URL.
 *
 * A URL passa a ser a fonte de verdade dos filtros: navegar para uma tela de detalhe
 * e voltar (`navigate(-1)` ou o botão do navegador) restaura a listagem exatamente
 * como estava, porque o estado vive na entrada de histórico.
 *
 * `set` aplica um patch parcial e reescreve **todos** os params afetados numa única
 * navegação (evita corridas entre updates, ex.: mudar o filtro e voltar para a página 1
 * ao mesmo tempo). Usa `replace` para não empilhar uma entrada de histórico a cada
 * ajuste de filtro — assim o "voltar" sai da listagem, não desfaz filtros um a um.
 *
 * `codecs` deve ser um objeto **estável** (definido fora do componente).
 */
export function useUrlFilters<M extends CodecMap>(
  codecs: M,
): { values: Values<M>; set: (patch: Partial<Values<M>>) => void; reset: () => void } {
  const [searchParams, setSearchParams] = useSearchParams();

  const values = useMemo(() => {
    const out = {} as Values<M>;
    for (const key in codecs) {
      out[key] = codecs[key].decode(searchParams.get(key)) as Values<M>[typeof key];
    }
    return out;
  }, [searchParams, codecs]);

  const set = useCallback(
    (patch: Partial<Values<M>>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const key in patch) {
            const encoded = codecs[key].encode(patch[key]);
            if (encoded === null) next.delete(key);
            else next.set(key, encoded);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams, codecs],
  );

  const reset = useCallback(
    () => setSearchParams({}, { replace: true }),
    [setSearchParams],
  );

  return { values, set, reset };
}
