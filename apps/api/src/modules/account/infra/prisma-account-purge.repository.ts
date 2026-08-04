import { Injectable } from '@nestjs/common';
import { PrismaAdminService } from '../../../prisma/prisma-admin.service';
import type {
  AccountPurgeRepository,
  LinhasApagadas,
  OwnerVencido,
} from '../domain/account-purge.repository';

/**
 * Expurgo da workspace. Único lugar do projeto que usa o `PrismaAdminService`
 * fora do `AccessGuard`/cadastro — e o uso previsto pelo docblock dele ("crons
 * cross-owner e seed"): roda sem `app.owner_id`, apaga `AuditLog` (que o
 * `crm_app` não pode apagar, por `REVOKE`) e vê `User`.
 *
 * **Exceção declarada à doutrina de `shared/purge.ts`.** Lá, filho pendurado é
 * `409` com instrução de expurgar de baixo para cima; é a regra certa para o
 * expurgo de UM registro pela lixeira. Encerrar conta não pode pedir que o
 * titular esvazie 12 tabelas à mão, então aqui a cascata é feita — explicitamente,
 * na ordem, por este método. A regra não foi relaxada: foi excetuada num único
 * ponto, para uma operação que o próprio titular pediu.
 */
@Injectable()
export class PrismaAccountPurgeRepository implements AccountPurgeRepository {
  constructor(private readonly admin: PrismaAdminService) {}

  async vencidos(agora: Date): Promise<OwnerVencido[]> {
    const owners = await this.admin.user.findMany({
      where: { deletionScheduledFor: { lte: agora } },
      select: { id: true, deletionRequestedAt: true },
    });
    return owners.map((o) => ({
      id: o.id,
      deletionRequestedAt: o.deletionRequestedAt!,
    }));
  }

  async pendentesDeCancelamento(): Promise<string[]> {
    const owners = await this.admin.user.findMany({
      where: {
        deletionScheduledFor: { not: null },
        subscription: { cancelAtPeriodEnd: false },
      },
      select: { id: true },
    });
    return owners.map((o) => o.id);
  }

  async expurgar(ownerId: string): Promise<LinhasApagadas> {
    // Timeout explícito — a única `$transaction` do projeto com opções, e a razão
    // é literal: apagar 12 tabelas de uma workspace grande não cabe nos 5s
    // default que o `OwnerContextInterceptor` usa por request. Aqui não há
    // request esperando.
    return this.admin.$transaction(
      async (tx) => {
        const onde = { where: { ownerId } };
        const contagem: LinhasApagadas = {};
        const apagar = async (
          nome: string,
          fn: () => Promise<{ count: number }>,
        ) => {
          contagem[nome] = (await fn()).count;
        };

        /*
          1. Negócio, na ordem de `prisma/seed.ts:242-251` — a mesma que a
             limpeza idempotente do seed exercita a cada execução.

          O consentimento vem ANTES de `Client`/`Contact` porque ele aponta para
          os dois (`subjectId`, sem FK): apagar o titular primeiro deixaria a
          linha órfã até o `DELETE FROM "User"` levá-la por cascata, e a ordem
          explícita é a doutrina de `shared/purge.ts` ("nenhuma cascata").

          Ele é apagado, e não preservado: o `REVOKE DELETE` vale para `crm_app` e
          é o que impede a APLICAÇÃO de reescrever a prova; o expurgo roda por
          `PrismaAdminService` (`crm_user`), como já faz com o `AuditLog`. E pela
          mesma razão da 19-A: o registro carrega PII de TERCEIRO, e retê-la
          depois do encerramento seria tratar fora das instruções (LGPD art. 42,
          § 1º, I).
        */
        await apagar('consentimentos', () => tx.consentRecord.deleteMany(onde));
        await apagar('cobrancas', () => tx.payment.deleteMany(onde));
        await apagar('demandas', () => tx.task.deleteMany(onde));
        await apagar('atividades', () => tx.activity.deleteMany(onde));
        await apagar('itensDeProposta', () => tx.proposalItem.deleteMany(onde));
        await apagar('contratos', () => tx.contract.deleteMany(onde));
        await apagar('projetos', () => tx.project.deleteMany(onde));
        await apagar('propostas', () => tx.proposal.deleteMany(onde));
        await apagar('oportunidades', () => tx.deal.deleteMany(onde));
        await apagar('contatos', () => tx.contact.deleteMany(onde));
        await apagar('clientes', () => tx.client.deleteMany(onde));

        // 2. Configuração que PRENDE catálogo por RESTRICT.
        //    `LeadIntakeChannel.sourceId` é Restrict E o canal é alvo de cascata
        //    do mesmo `DELETE FROM "User"`; em Postgres RESTRICT é checado na
        //    hora (não é NO ACTION diferível), então esse par colidiria sozinho
        //    mesmo numa workspace sem nenhum dado de negócio. Apagar o canal
        //    aqui, explicitamente, é o que remove o problema.
        await apagar('canaisDeCaptacao', () =>
          tx.leadIntakeChannel.deleteMany(onde),
        );
        await apagar('chavesDeIntegracao', () =>
          tx.integrationKey.deleteMany(onde),
        );

        // 3. Catálogos — agora sem ninguém apontando.
        await apagar('tiposDeAtividade', () =>
          tx.activityTypeCatalog.deleteMany(onde),
        );
        await apagar('tiposDeServico', () =>
          tx.serviceCatalog.deleteMany(onde),
        );
        await apagar('motivosDePerda', () =>
          tx.lostReasonCatalog.deleteMany(onde),
        );
        await apagar('fontesDeLead', () =>
          tx.leadSourceCatalog.deleteMany(onde),
        );
        await apagar('estagiosDoFunil', () =>
          tx.pipelineStage.deleteMany(onde),
        );

        // 4. A trilha. Só `crm_user` alcança (a migration de AuditLog revoga
        //    DELETE de `crm_app`), e ela CARREGA dado pessoal de terceiro em
        //    `diff` — nome, e-mail e telefone de cliente podem entrar num diff de
        //    CLIENT. Retê-la depois de o controlador ter pedido a exclusão seria
        //    tratar fora das instruções (LGPD art. 42, § 1º, I). O registro do
        //    EVENTO é gravado depois do commit, sem PII (ver o job).
        await apagar('trilhaDeAuditoria', () => tx.auditLog.deleteMany(onde));

        // 5. A conta. Cascateia, num só statement: Session, OAuthAccount,
        //    PasswordResetToken, Subscription, Role, CollaboratorInvite,
        //    Notification (+ NotificationDelivery), UserNotificationTarget — e os
        //    `User` COLABORADORES, que cascateiam os próprios filhos.
        await tx.user.delete({ where: { id: ownerId } });
        contagem['conta'] = 1;

        return contagem;
      },
      { timeout: 120_000, maxWait: 15_000 },
    );
  }
}
