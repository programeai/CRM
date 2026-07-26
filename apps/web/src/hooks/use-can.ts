import { useMe } from '@/features/perfil/api/hooks';

/**
 * Permissões do usuário logado, para esconder navegação e ações.
 *
 * O backend é a autoridade (`AccessGuard` responde 403); aqui só evitamos
 * mostrar o que não seria aceito. Os rótulos das permissões vêm de
 * `GET /permissions` — nunca duplique textos de permissão no front.
 *
 * `loading` importa: enquanto `/auth/me` não responde não sabemos nada, e
 * esconder por padrão faria a interface "piscar" itens ao carregar.
 */
export function useCan() {
  const { data: me, isPending } = useMe();
  const permissions = me?.permissions;

  const can = (permission?: string) => {
    // Item sem permissão declarada é livre (ex.: Dashboard).
    if (!permission) return true;
    return permissions?.includes(permission) ?? false;
  };

  return {
    can,
    /** Basta ter uma das chaves — espelha o OU do `@RequirePermission`. */
    canAny: (required: string[]) =>
      required.length === 0 || required.some((p) => can(p)),
    isOwner: me?.isOwner ?? false,
    roleName: me?.role?.name ?? null,
    loading: isPending,
  };
}
