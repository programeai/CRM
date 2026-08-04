import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  AccountDumpRepository,
  DadosDoDump,
} from '../domain/account-dump.repository';

/** `Prisma.Decimal | null` → `string | null`, pronto para o JSON. */
function decimalOuNulo(
  valor: Prisma.Decimal | null | undefined,
): string | null {
  return valor == null ? null : valor.toString();
}

/**
 * Carrega a workspace inteira para o dump de portabilidade. Um `select`
 * explícito por coleção — nunca `include` largo, nunca o registro cru do
 * Prisma. Rótulos de relação vêm resolvidos (nome do responsável, nome da
 * fonte), no mesmo espírito de `ExportColumn.value`: nada de identificador
 * técnico onde um nome legível cabe.
 */
@Injectable()
export class PrismaAccountDumpRepository implements AccountDumpRepository {
  constructor(private readonly prisma: PrismaService) {}

  async carregar(ownerId: string): Promise<DadosDoDump> {
    const db = this.prisma.db;

    // `User` está FORA do RLS: o filtro é explícito e é o que isola a leitura.
    // `{ OR: [{ id: ownerId }, { ownerId }] }` = o dono e os colaboradores dele.
    const pessoas = await db.user.findMany({
      where: { OR: [{ id: ownerId }, { ownerId }] },
      select: {
        id: true,
        name: true,
        email: true,
        active: true,
        acceptedAt: true,
        createdAt: true,
        ownerId: true,
        role: { select: { name: true } },
        oauthAccounts: { select: { provider: true, createdAt: true } },
        // O hash NUNCA entra no dump. E o que interessa ao titular não é sequer
        // "existe hash" — desde a senha aleatória do OAuth isso é sempre `true`
        // —, e sim se ELE escolheu uma senha. Daí `passwordSetAt` no lugar.
        passwordSetAt: true,
      },
    });
    const dono = pessoas.find((p) => p.id === ownerId)!;

    const [
      assinatura,
      papeis,
      estagios,
      fontesDeLead,
      tiposDeServico,
      tiposDeAtividade,
      motivosDePerda,
      canais,
      clientes,
      contatos,
      deals,
      propostas,
      projetos,
      tarefas,
      contratos,
      pagamentos,
      atividades,
      consentimentos,
    ] = await Promise.all([
      db.subscription.findUnique({
        where: { ownerId },
        select: {
          status: true,
          trialEndsAt: true,
          currentPeriodEnd: true,
          cancelAtPeriodEnd: true,
          createdAt: true,
        },
      }),
      db.role.findMany({
        where: { ownerId },
        select: {
          name: true,
          description: true,
          system: true,
          permissions: true,
          createdAt: true,
        },
      }),
      db.pipelineStage.findMany({
        where: { ownerId },
        select: { name: true, order: true, isWon: true, isLost: true },
        orderBy: { order: 'asc' },
      }),
      db.leadSourceCatalog.findMany({
        where: { ownerId },
        select: { name: true, active: true },
      }),
      db.serviceCatalog.findMany({
        where: { ownerId },
        select: { name: true, active: true },
      }),
      db.activityTypeCatalog.findMany({
        where: { ownerId },
        select: { name: true, active: true, isFollowUp: true },
      }),
      db.lostReasonCatalog.findMany({
        where: { ownerId },
        select: { name: true, active: true },
      }),
      db.leadIntakeChannel.findMany({
        where: { ownerId },
        select: {
          name: true,
          createdAt: true,
          source: { select: { name: true } },
          assignee: { select: { name: true } },
          key: { select: { prefix: true } },
        },
      }),
      db.client.findMany({
        where: { ownerId },
        select: {
          id: true,
          name: true,
          tradeName: true,
          personType: true,
          document: true,
          email: true,
          phone: true,
          website: true,
          status: true,
          tags: true,
          notes: true,
          zipCode: true,
          street: true,
          number: true,
          complement: true,
          district: true,
          city: true,
          state: true,
          archivedAt: true,
          createdAt: true,
          source: { select: { name: true } },
          assignee: { select: { name: true } },
        },
      }),
      db.contact.findMany({
        where: { ownerId },
        select: {
          name: true,
          role: true,
          email: true,
          phone: true,
          isPrimary: true,
          archivedAt: true,
          client: { select: { name: true } },
        },
      }),
      db.deal.findMany({
        where: { ownerId },
        select: {
          id: true,
          title: true,
          amount: true,
          probability: true,
          expectedClose: true,
          archivedAt: true,
          createdAt: true,
          client: { select: { name: true } },
          stage: { select: { name: true } },
          serviceType: { select: { name: true } },
          lostReason: { select: { name: true } },
          assignee: { select: { name: true } },
        },
      }),
      db.proposal.findMany({
        where: { ownerId },
        select: {
          number: true,
          version: true,
          scope: true,
          paymentTerms: true,
          deliveryTime: true,
          validUntil: true,
          discount: true,
          total: true,
          status: true,
          sentAt: true,
          decidedAt: true,
          createdAt: true,
          client: { select: { name: true } },
          serviceType: { select: { name: true } },
          parent: { select: { number: true } },
          items: {
            select: {
              description: true,
              quantity: true,
              unitPrice: true,
              order: true,
            },
            orderBy: { order: 'asc' },
          },
        },
      }),
      db.project.findMany({
        where: { ownerId },
        select: {
          name: true,
          status: true,
          startDate: true,
          dueDate: true,
          archivedAt: true,
          createdAt: true,
          client: { select: { name: true } },
          serviceType: { select: { name: true } },
        },
      }),
      db.task.findMany({
        where: { ownerId },
        select: {
          title: true,
          description: true,
          status: true,
          priority: true,
          dueDate: true,
          tags: true,
          completedAt: true,
          archivedAt: true,
          createdAt: true,
          project: { select: { name: true } },
          assignee: { select: { name: true } },
        },
      }),
      db.contract.findMany({
        where: { ownerId },
        select: {
          description: true,
          billingType: true,
          status: true,
          monthlyAmount: true,
          billingDay: true,
          startDate: true,
          endDate: true,
          downPayment: true,
          installments: true,
          installmentAmount: true,
          createdAt: true,
          client: { select: { name: true } },
          project: { select: { name: true } },
          proposal: { select: { number: true } },
        },
      }),
      db.payment.findMany({
        where: { ownerId },
        select: {
          description: true,
          amount: true,
          dueDate: true,
          status: true,
          paidAt: true,
          paidAmount: true,
          method: true,
          notes: true,
          createdAt: true,
          contract: { select: { description: true } },
        },
      }),
      db.activity.findMany({
        where: { ownerId },
        select: {
          content: true,
          scheduledFor: true,
          completedAt: true,
          createdAt: true,
          client: { select: { name: true } },
          type: { select: { name: true } },
          assignee: { select: { name: true } },
        },
      }),
      /*
        O livro-razão de consentimento (Fase 19-B). `recordedByUserId` NÃO entra:
        o que interessa ao titular é QUEM registrou pelo nome, que já está
        denormalizado em `recordedByName` — e o id de um colaborador é
        identificador técnico sem utilidade subsequente para quem recebe o dump.
      */
      db.consentRecord.findMany({
        where: { ownerId },
        orderBy: { createdAt: 'asc' },
        select: {
          subjectType: true,
          subjectId: true,
          purpose: true,
          granted: true,
          textVersion: true,
          channel: true,
          evidence: true,
          informedRetention: true,
          recordedByName: true,
          occurredAt: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      conta: {
        id: dono.id,
        nome: dono.name,
        email: dono.email,
        criadaEm: dono.createdAt,
        temSenha: dono.passwordSetAt !== null,
        loginSocial: dono.oauthAccounts.map((c) => ({
          provedor: c.provider,
          vinculadoEm: c.createdAt,
        })),
      },
      assinatura: assinatura
        ? {
            status: assinatura.status,
            trialEndsAt: assinatura.trialEndsAt,
            currentPeriodEnd: assinatura.currentPeriodEnd,
            cancelAtPeriodEnd: assinatura.cancelAtPeriodEnd,
            createdAt: assinatura.createdAt,
          }
        : null,
      colaboradores: pessoas
        .filter((p) => p.id !== ownerId)
        .map((p) => ({
          nome: p.name,
          email: p.email,
          ativo: p.active,
          papel: p.role?.name ?? null,
          conviteAceitoEm: p.acceptedAt,
          criadoEm: p.createdAt,
        })),
      papeis: papeis.map((p) => ({
        name: p.name,
        description: p.description,
        system: p.system,
        permissions: p.permissions,
        createdAt: p.createdAt,
      })),
      funil: estagios,
      catalogos: {
        fontesDeLead,
        tiposDeServico,
        tiposDeAtividade,
        motivosDePerda,
      },
      canaisDeCaptacao: canais.map((c) => ({
        name: c.name,
        fonte: c.source?.name ?? null,
        responsavel: c.assignee?.name ?? null,
        prefixoDaChave: c.key?.prefix ?? null,
        createdAt: c.createdAt,
      })),
      clientes: clientes.map((c) => ({
        id: c.id,
        name: c.name,
        tradeName: c.tradeName,
        personType: c.personType,
        document: c.document,
        email: c.email,
        phone: c.phone,
        website: c.website,
        status: c.status,
        origem: c.source?.name ?? null,
        responsavel: c.assignee?.name ?? null,
        tags: c.tags,
        notes: c.notes,
        zipCode: c.zipCode,
        street: c.street,
        number: c.number,
        complement: c.complement,
        district: c.district,
        city: c.city,
        state: c.state,
        archivedAt: c.archivedAt,
        createdAt: c.createdAt,
      })),
      contatos: contatos.map((c) => ({
        cliente: c.client.name,
        name: c.name,
        role: c.role,
        email: c.email,
        phone: c.phone,
        isPrimary: c.isPrimary,
        archivedAt: c.archivedAt,
      })),
      oportunidades: deals.map((d) => ({
        id: d.id,
        cliente: d.client.name,
        estagio: d.stage.name,
        tipoDeServico: d.serviceType.name,
        title: d.title,
        amount: decimalOuNulo(d.amount),
        probability: d.probability,
        expectedClose: d.expectedClose,
        motivoDePerda: d.lostReason?.name ?? null,
        responsavel: d.assignee?.name ?? null,
        archivedAt: d.archivedAt,
        createdAt: d.createdAt,
      })),
      propostas: propostas.map((p) => ({
        number: p.number,
        version: p.version,
        versaoDe: p.parent?.number ?? null,
        cliente: p.client.name,
        tipoDeServico: p.serviceType.name,
        status: p.status,
        scope: p.scope,
        paymentTerms: p.paymentTerms,
        deliveryTime: p.deliveryTime,
        validUntil: p.validUntil,
        discount: decimalOuNulo(p.discount),
        total: p.total.toString(),
        itens: p.items.map((i) => ({
          description: i.description,
          quantity: i.quantity.toString(),
          unitPrice: i.unitPrice.toString(),
          order: i.order,
        })),
        sentAt: p.sentAt,
        decidedAt: p.decidedAt,
        createdAt: p.createdAt,
      })),
      projetos: projetos.map((p) => ({
        cliente: p.client.name,
        tipoDeServico: p.serviceType.name,
        name: p.name,
        status: p.status,
        startDate: p.startDate,
        dueDate: p.dueDate,
        archivedAt: p.archivedAt,
        createdAt: p.createdAt,
      })),
      demandas: tarefas.map((t) => ({
        projeto: t.project.name,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        dueDate: t.dueDate,
        tags: t.tags,
        responsavel: t.assignee?.name ?? null,
        completedAt: t.completedAt,
        archivedAt: t.archivedAt,
        createdAt: t.createdAt,
      })),
      contratos: contratos.map((c) => ({
        cliente: c.client.name,
        projeto: c.project?.name ?? null,
        proposta: c.proposal?.number ?? null,
        description: c.description,
        billingType: c.billingType,
        status: c.status,
        monthlyAmount: decimalOuNulo(c.monthlyAmount),
        billingDay: c.billingDay,
        startDate: c.startDate,
        endDate: c.endDate,
        downPayment: decimalOuNulo(c.downPayment),
        installments: c.installments,
        installmentAmount: decimalOuNulo(c.installmentAmount),
        createdAt: c.createdAt,
      })),
      cobrancas: pagamentos.map((p) => ({
        contrato: p.contract.description,
        description: p.description,
        amount: p.amount.toString(),
        dueDate: p.dueDate,
        status: p.status,
        paidAt: p.paidAt,
        paidAmount: decimalOuNulo(p.paidAmount),
        method: p.method,
        notes: p.notes,
        createdAt: p.createdAt,
      })),
      atividades: atividades.map((a) => ({
        cliente: a.client.name,
        tipo: a.type.name,
        content: a.content,
        responsavel: a.assignee?.name ?? null,
        scheduledFor: a.scheduledFor,
        completedAt: a.completedAt,
        createdAt: a.createdAt,
      })),
      consentimentos: consentimentos.map((c) => ({
        titularTipo: c.subjectType,
        titularId: c.subjectId,
        finalidade: c.purpose,
        consentiu: c.granted,
        versaoDoTexto: c.textVersion,
        canal: c.channel,
        evidencia: c.evidence,
        retencaoInformada: c.informedRetention,
        registradoPor: c.recordedByName,
        manifestadoEm: c.occurredAt,
        registradoEm: c.createdAt,
      })),
    };
  }
}
