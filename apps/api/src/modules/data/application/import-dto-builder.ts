import type { CreateClientDto } from '../../clients/api/dto/create-client.dto';
import type { CreateContactDto } from '../../contacts/api/dto/create-contact.dto';
import type { CatalogoResolvido } from './catalog-resolver';
import { resolverStatus } from './import-rules';

function vazioParaUndefined(valor?: string): string | undefined {
  const limpo = valor?.trim();
  return limpo ? limpo : undefined;
}

/** "Sim"/"Não" (e variações) da planilha → booleano. Ausente ou irreconhecível = indefinido. */
function paraBooleano(valor?: string): boolean | undefined {
  const limpo = valor?.trim().toLowerCase();
  if (!limpo) return undefined;
  if (['sim', 's', 'true', '1', 'verdadeiro'].includes(limpo)) return true;
  if (['não', 'nao', 'n', 'false', '0', 'falso'].includes(limpo)) return false;
  return undefined;
}

/**
 * Linha de clientes já mapeada (chave de campo → texto) → DTO de criação.
 * `sourceId` só resolve se a origem já estiver no `CatalogoResolvido` — a
 * própria, uma recém-criada ou aliada pela decisão do usuário (ver
 * `catalog-resolver.ts`). Origem "deixar em branco" simplesmente não resolve,
 * e a linha grava sem origem — não é erro.
 */
export function construirDtoDeCliente(
  linha: Record<string, string>,
  catalogo: CatalogoResolvido,
): CreateClientDto {
  const origem = linha.sourceId ? catalogo.resolver(linha.sourceId) : null;
  return {
    name: linha.name.trim(),
    tradeName: vazioParaUndefined(linha.tradeName),
    document: vazioParaUndefined(linha.document),
    email: vazioParaUndefined(linha.email),
    phone: vazioParaUndefined(linha.phone),
    website: vazioParaUndefined(linha.website),
    sourceId: origem?.id,
    status: linha.status
      ? (resolverStatus(linha.status) ?? undefined)
      : undefined,
    tags: linha.tags
      ? linha.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : undefined,
    notes: vazioParaUndefined(linha.notes),
    zipCode: vazioParaUndefined(linha.zipCode),
    street: vazioParaUndefined(linha.street),
    number: vazioParaUndefined(linha.number),
    complement: vazioParaUndefined(linha.complement),
    district: vazioParaUndefined(linha.district),
    city: vazioParaUndefined(linha.city),
    state: vazioParaUndefined(linha.state),
  };
}

/** Linha de contatos já mapeada → DTO de criação. O cliente-pai é resolvido à parte (`resolverCliente`). */
export function construirDtoDeContato(
  linha: Record<string, string>,
): CreateContactDto {
  return {
    name: linha.name.trim(),
    role: vazioParaUndefined(linha.role),
    email: vazioParaUndefined(linha.email),
    phone: vazioParaUndefined(linha.phone),
    isPrimary: paraBooleano(linha.isPrimary),
  };
}
