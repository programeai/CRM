import { PrismaClient } from '@prisma/client';

let admin: PrismaClient | null = null;

/** Client privilegiado (crm_user) — bypassa RLS, usado para fixture e limpeza. */
export function clientAdmin(): PrismaClient {
  admin ??= new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL! } },
  });
  return admin;
}

/** Zera as tabelas entre testes. `_prisma_migrations` fica de fora. */
export async function limparBanco(): Promise<void> {
  const db = clientAdmin();
  const tabelas = await db.$queryRaw<{ nome: string }[]>`
    SELECT tablename AS nome FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  const lista = tabelas.map((t) => `"${t.nome}"`).join(', ');
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE ${lista} RESTART IDENTITY CASCADE`,
  );
}

export async function fecharBanco(): Promise<void> {
  await admin?.$disconnect();
  admin = null;
}
