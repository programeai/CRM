import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';

config({ path: join(__dirname, '.env.test'), override: true });

/** `CREATE DATABASE` não aceita bind param e não roda dentro de transação. */
async function garantirBanco(url: string, nome: string) {
  // Conecta no banco administrativo `postgres` para poder criar o outro.
  const admin = new PrismaClient({
    datasources: { db: { url: url.replace(`/${nome}`, '/postgres') } },
  });
  try {
    const existe = await admin.$queryRaw<{ um: number }[]>`
      SELECT 1 AS um FROM pg_database WHERE datname = ${nome}
    `;
    if (existe.length === 0) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${nome}"`);
    }
  } finally {
    await admin.$disconnect();
  }
}

export default async function globalSetup() {
  const url = process.env.DATABASE_URL!;
  await garantirBanco(url, 'crm_test');
  // `migrate deploy` traz schema, role crm_app (idempotente) e as policies.
  execSync('pnpm exec prisma migrate deploy', {
    cwd: join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}
