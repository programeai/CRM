import * as argon2 from 'argon2';
import { clientAdmin } from './banco';

export const SENHA_PADRAO = 'senha-de-teste-123';

/** Owner (User.ownerId nulo) com senha conhecida e convite já aceito. */
export async function criarOwner(email: string) {
  return clientAdmin().user.create({
    data: {
      email,
      name: `Owner ${email}`,
      passwordHash: await argon2.hash(SENHA_PADRAO),
      acceptedAt: new Date(),
    },
  });
}

/** Colaborador vinculado a um owner, com o papel informado. */
export async function criarColaborador(
  email: string,
  ownerId: string,
  roleId: string,
) {
  return clientAdmin().user.create({
    data: {
      email,
      name: `Colab ${email}`,
      passwordHash: await argon2.hash(SENHA_PADRAO),
      acceptedAt: new Date(),
      ownerId,
      roleId,
    },
  });
}

/** Papel de colaborador com as chaves informadas — sem `system` (vale só o catálogo). */
export async function criarPapel(ownerId: string, permissions: string[]) {
  return clientAdmin().role.create({
    data: {
      ownerId,
      name: `Papel de teste ${Math.random().toString(36).slice(2, 8)}`,
      permissions,
    },
  });
}
