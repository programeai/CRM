import { ConfigService } from '@nestjs/config';
import { PrismaAdminService } from '../src/prisma/prisma-admin.service';
import { PrismaNotificationTriggersRepository } from '../src/modules/notifications/infra/prisma-notification-triggers.repository';
import { clientAdmin, limparBanco, fecharBanco } from './helpers/banco';
import { criarOwner } from './helpers/fixtures';

/**
 * O caminho mais perigoso da Fase 13-A: `followUpsDoDia` roda no cron das 6h,
 * **cross-owner e sem `app.owner_id`**, pelo client admin. Trocar o antigo
 * `type: 'FOLLOW_UP'` (literal do enum) por `type: { isFollowUp: true }` (regra
 * do catálogo por owner) é o único ponto da fase onde um erro **silencia**
 * notificações em vez de estourar: zero item marcado = zero lembrete, sem log
 * de erro.
 *
 * Por isso este spec instancia o repositório **de verdade** contra o banco
 * (regra de `apps/api/CLAUDE.md`: classe que fala com infraestrutura direto tem
 * spec que a instancia), com DOIS owners, cada um com o SEU catálogo e o SEU
 * item marcado. Mock aqui testaria o mock.
 */
describe('followUpsDoDia — cron cross-owner (e2e)', () => {
  let admin: PrismaAdminService;
  let repo: PrismaNotificationTriggersRepository;

  beforeAll(() => {
    // ConfigService mínimo: o PrismaAdminService só lê DATABASE_URL.
    const config = {
      getOrThrow: () => process.env.DATABASE_URL!,
    } as unknown as ConfigService;
    admin = new PrismaAdminService(config);
    repo = new PrismaNotificationTriggersRepository(admin);
  });
  beforeEach(limparBanco);
  afterAll(async () => {
    await admin.$disconnect();
    await fecharBanco();
  });

  /** Owner com catálogo próprio, cliente e um follow-up agendado para hoje. */
  async function semearOwnerComFollowUp(email: string, nomeDoTipo: string) {
    const owner = await criarOwner(email);
    const tipoFollowUp = await clientAdmin().activityTypeCatalog.create({
      data: { ownerId: owner.id, name: nomeDoTipo, isFollowUp: true },
    });
    const tipoComum = await clientAdmin().activityTypeCatalog.create({
      data: { ownerId: owner.id, name: 'Anotação', isFollowUp: false },
    });
    const cliente = await clientAdmin().client.create({
      data: { name: `Cliente de ${email}`, ownerId: owner.id },
    });
    const agora = new Date();
    const followUp = await clientAdmin().activity.create({
      data: {
        ownerId: owner.id,
        clientId: cliente.id,
        typeId: tipoFollowUp.id,
        content: `Follow-up de ${email}`,
        scheduledFor: agora,
      },
    });
    // Ruído: mesma janela, tipo NÃO marcado — não pode virar lembrete.
    await clientAdmin().activity.create({
      data: {
        ownerId: owner.id,
        clientId: cliente.id,
        typeId: tipoComum.id,
        content: 'Anotação qualquer',
        scheduledFor: agora,
      },
    });
    return { owner, followUp };
  }

  /** Janela do dia, como o job monta. */
  function janelaDeHoje() {
    const de = new Date();
    de.setHours(0, 0, 0, 0);
    const ate = new Date();
    ate.setHours(23, 59, 59, 999);
    return { de, ate };
  }

  it('devolve o follow-up dos DOIS owners, cada um pelo seu próprio catálogo', async () => {
    // Nomes de tipo DIFERENTES de propósito: prova que a regra é `isFollowUp`,
    // não o nome — o owner pode renomear "Follow-up" para o que quiser.
    const a = await semearOwnerComFollowUp('a@teste.local', 'Follow-up');
    const b = await semearOwnerComFollowUp('b@teste.local', 'Retomar contato');

    const { de, ate } = janelaDeHoje();
    const alvos = await repo.followUpsDoDia(de, ate);

    expect(alvos.map((x) => x.entityId).sort()).toEqual(
      [a.followUp.id, b.followUp.id].sort(),
    );
    expect(alvos.map((x) => x.ownerId).sort()).toEqual(
      [a.owner.id, b.owner.id].sort(),
    );
  });

  it('ignora a atividade cujo tipo não está marcado como follow-up', async () => {
    const { owner } = await semearOwnerComFollowUp(
      'a@teste.local',
      'Follow-up',
    );
    // Desmarca a regra: o lembrete tem de sumir, mesmo com a atividade intacta.
    await clientAdmin().activityTypeCatalog.updateMany({
      where: { ownerId: owner.id },
      data: { isFollowUp: false },
    });

    const { de, ate } = janelaDeHoje();
    await expect(repo.followUpsDoDia(de, ate)).resolves.toEqual([]);
  });

  it('ignora follow-up já concluído', async () => {
    const { followUp } = await semearOwnerComFollowUp(
      'a@teste.local',
      'Follow-up',
    );
    await clientAdmin().activity.update({
      where: { id: followUp.id },
      data: { completedAt: new Date() },
    });

    const { de, ate } = janelaDeHoje();
    await expect(repo.followUpsDoDia(de, ate)).resolves.toEqual([]);
  });
});
