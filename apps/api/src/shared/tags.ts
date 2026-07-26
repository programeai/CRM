import { BadRequestException } from '@nestjs/common';

/**
 * Tags são um `String[]` no próprio registro (cliente, tarefa, …) — não há
 * catálogo próprio. Estes tipos/helpers são compartilhados pelos módulos que
 * expõem as rotas de tags (`/<recurso>/tags`) para o seletor da interface.
 */

/** Uma tag do dono e em quantos registros ela é usada. */
export interface TagUsage {
  tag: string;
  count: number;
}

/** Valida e normaliza a tag recebida na query string. */
export function normalizeTag(tag: string): string {
  const trimmed = tag?.trim();
  if (!trimmed) throw new BadRequestException('Tag inválida.');
  return trimmed;
}

/** Agrega tags de vários registros em pares tag/contagem, do mais usado ao menos. */
export function countTags(rows: { tags: string[] }[]): TagUsage[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const tag of row.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'pt-BR'));
}
