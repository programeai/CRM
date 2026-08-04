import { Injectable } from '@nestjs/common';
import { PrismaAdminService } from '../../../prisma/prisma-admin.service';
import type {
  LinhasExpurgadas,
  RetentionRepository,
} from '../domain/retention.repository';

/**
 * Expurgo por data de corte, cross-owner. `PrismaAdminService` por duas razões
 * independentes, e cada uma bastaria: o cron roda sem `app.owner_id` (o RLS
 * casaria zero linhas), e `AuditLog` tem `REVOKE UPDATE, DELETE … FROM crm_app` —
 * a aplicação **não consegue** apagar a trilha nem se quisesse. Mesma mecânica do
 * `AccountPurgeJob`.
 */
@Injectable()
export class PrismaRetentionRepository implements RetentionRepository {
  constructor(private readonly admin: PrismaAdminService) {}

  /**
   * Lixeira, em ordem topológica e **sem cascata** — a doutrina de
   * `shared/purge.ts`: as FKs de negócio são RESTRICT, e as remoções em cascata do
   * projeto são feitas à mão. Um `deleteMany` na ordem errada responde erro de FK
   * e aborta o lote inteiro.
   *
   * Ordem: Task → Activity → Contact → Deal → Project → Client. Filho arquivado
   * há mais tempo que o pai sai primeiro.
   *
   * **Pai com filho NÃO arquivado não sai**, e o número de pulados é devolvido:
   * o silêncio de "0 linhas" seria lido como "nada a fazer", quando o que houve foi
   * "havia o que fazer e eu não pude".
   */
  async expurgarLixeira(cutoff: Date): Promise<{
    contagem: LinhasExpurgadas;
    pulados: LinhasExpurgadas;
  }> {
    const contagem: LinhasExpurgadas = {};
    const pulados: LinhasExpurgadas = {};
    const arquivadoAntes = { archivedAt: { not: null, lt: cutoff } };

    /*
      1. Folhas. `Task` e `Activity` não têm filho que as prenda, então saem
         direto — e é a saída delas que libera `Project`/`Deal`/`Client` abaixo.
    */
    contagem.demandas = (
      await this.admin.task.deleteMany({ where: arquivadoAntes })
    ).count;
    contagem.atividades = (
      await this.admin.activity.deleteMany({
        // `Activity` não tem `archivedAt`: ela é filha e sai com o cliente. O que
        // se apaga aqui é a atividade de um CLIENTE que já passou do corte —
        // senão o `deleteMany` de `Client` estouraria na FK RESTRICT.
        where: { client: arquivadoAntes },
      })
    ).count;
    contagem.contatos = (
      await this.admin.contact.deleteMany({ where: arquivadoAntes })
    ).count;

    /*
      2. `Deal` só sai sem proposta, projeto e atividade pendurados. As FKs de
         `Proposal.dealId`/`Project.dealId`/`Activity.dealId` são SET NULL, então
         elas não prendem — o que prende é o contrário (o projeto aponta para o
         deal e sobrevive a ele).
    */
    contagem.oportunidades = (
      await this.admin.deal.deleteMany({ where: arquivadoAntes })
    ).count;

    /*
      3. `Project` prende por `Task` (RESTRICT) e por `Contract`. Só sai o que não
         tem nenhum dos dois — os que têm são contados como pulados.
    */
    const projetosNoCorte = await this.admin.project.findMany({
      where: arquivadoAntes,
      select: {
        id: true,
        _count: { select: { tasks: true, contracts: true } },
      },
    });
    const projetosLivres = projetosNoCorte
      .filter((p) => p._count.tasks === 0 && p._count.contracts === 0)
      .map((p) => p.id);
    pulados.projetos = projetosNoCorte.length - projetosLivres.length;
    contagem.projetos = (
      await this.admin.project.deleteMany({
        where: { id: { in: projetosLivres } },
      })
    ).count;

    /*
      4. `Client` prende por TUDO (contato, atividade, oportunidade, proposta,
         projeto, contrato — todas RESTRICT). Só sai o cliente sem nenhum filho.
    */
    const clientesNoCorte = await this.admin.client.findMany({
      where: arquivadoAntes,
      select: {
        id: true,
        _count: {
          select: {
            contacts: true,
            activities: true,
            deals: true,
            proposals: true,
            projects: true,
            contracts: true,
          },
        },
      },
    });
    const clientesLivres = clientesNoCorte
      .filter((c) => Object.values(c._count).every((n) => n === 0))
      .map((c) => c.id);
    pulados.clientes = clientesNoCorte.length - clientesLivres.length;
    contagem.clientes = (
      await this.admin.client.deleteMany({
        where: { id: { in: clientesLivres } },
      })
    ).count;

    return { contagem, pulados };
  }

  /**
   * Notificação e as entregas dela. As entregas saem por cascata da FK
   * (`NotificationDelivery.notificationId` é `onDelete: Cascade`) — diferente do
   * resto do domínio, e é o desenho da Fase 9: a entrega não faz sentido sem a
   * notificação. Ainda assim a contagem é lida ANTES, para o log dizer quantas
   * linhas de fato saíram.
   */
  async expurgarNotificacoes(cutoff: Date): Promise<LinhasExpurgadas> {
    const entregas = await this.admin.notificationDelivery.count({
      where: { notification: { createdAt: { lt: cutoff } } },
    });
    const notificacoes = (
      await this.admin.notification.deleteMany({
        where: { createdAt: { lt: cutoff } },
      })
    ).count;
    return { notificacoes, entregas };
  }

  /** A trilha. Só o client admin alcança: `crm_app` tem `REVOKE DELETE` nela. */
  async expurgarAuditoria(cutoff: Date): Promise<LinhasExpurgadas> {
    const trilha = (
      await this.admin.auditLog.deleteMany({
        where: { createdAt: { lt: cutoff } },
      })
    ).count;
    return { trilha };
  }
}
