import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '../../shared/permissions';

export const REQUIRE_PERMISSION_KEY = 'requirePermission';

/**
 * Exige permissão do catálogo (`shared/permissions.ts`) para acessar a rota.
 * Aplicada pelo `AccessGuard` (global). Várias chaves valem como **OU** — é o
 * que permite liberar uma leitura para quem tem `:ver` **ou** `:gerenciar`.
 *
 * ```ts
 * @RequirePermission('cliente:ver', 'cliente:gerenciar')   // leitura
 * @RequirePermission('cliente:gerenciar')                  // escrita
 * ```
 *
 * Sem o decorator a rota só exige sessão válida (ex.: perfil, logout).
 */
export const RequirePermission = (...permissions: PermissionKey[]) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, permissions);
