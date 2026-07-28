import { SetMetadata } from '@nestjs/common';

export const OWNER_ONLY_KEY = 'ownerOnly';

/**
 * Restringe a rota ao **dono da workspace** (`AccessContext.isOwner`). Aplicado
 * pelo `AccessGuard` (global), antes do `@RequirePermission()`.
 *
 * Não é uma permissão de propósito. Owner recebe todas as chaves do catálogo por
 * definição, mas uma chave nova também poderia ser atribuída a um papel de
 * colaborador — e colaborador não encerra nem exporta a conta de ninguém. Este é
 * o único portão do CRM que não é delegável.
 */
export const OwnerOnly = () => SetMetadata(OWNER_ONLY_KEY, true);
