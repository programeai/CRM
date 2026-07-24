import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await argon2.hash('changeme123');
  await prisma.user.upsert({
    where: { email: 'admin@crm.local' },
    update: {},
    create: { email: 'admin@crm.local', name: 'Admin', passwordHash },
  });
  // Segundo usuário: permite testar isolamento por ownerId (Fase 3 do RLS).
  await prisma.user.upsert({
    where: { email: 'demo@crm.local' },
    update: {},
    create: { email: 'demo@crm.local', name: 'Demo', passwordHash },
  });

  const stages = [
    { name: 'Novo lead', isWon: false, isLost: false },
    { name: 'Contato feito', isWon: false, isLost: false },
    { name: 'Reunião/Diagnóstico', isWon: false, isLost: false },
    { name: 'Proposta enviada', isWon: false, isLost: false },
    { name: 'Negociação', isWon: false, isLost: false },
    { name: 'Ganhou', isWon: true, isLost: false },
    { name: 'Perdeu', isWon: false, isLost: true },
  ];
  for (const [order, s] of stages.entries()) {
    await prisma.pipelineStage.upsert({
      where: { name: s.name },
      update: {},
      create: { name: s.name, order, isWon: s.isWon, isLost: s.isLost },
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
