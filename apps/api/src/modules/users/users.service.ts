import { Inject, Injectable, Logger } from '@nestjs/common';
import { OAuthProvider, type NotificationChannelKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaAdminService } from '../../prisma/prisma-admin.service';
import {
  DEFAULT_PIPELINE_STAGES,
  defaultPipelineStages,
} from '../../shared/default-pipeline-stages';
import {
  defaultLeadSourceCatalog,
  defaultLostReasonCatalog,
  defaultActivityTypeCatalog,
  defaultServiceCatalog,
  totalDeItensDeCatalogo,
} from '../../shared/default-catalogs';
import {
  NOTIFICATION_TARGET_REPOSITORY,
  type NotificationTargetRepository,
} from '../notifications/domain/notification-target.repository';

/** Duração do trial concedido no cadastro. */
const TRIAL_DAYS = 14;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private prisma: PrismaService,
    private admin: PrismaAdminService,
    @Inject(NOTIFICATION_TARGET_REPOSITORY)
    private readonly notificationTargets: NotificationTargetRepository,
  ) {}

  /**
   * Dados do trial concedido no cadastro. Vale para autohospedagem e SaaS: sem
   * billing o gate ignora; com billing dá os 14 dias iniciais. `Subscription`
   * tem RLS e o cadastro não tem contexto de owner → criado via client admin
   * (nested create atômico com o User).
   */
  private trialSubscription() {
    return {
      status: 'TRIALING' as const,
      trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
    };
  }

  /**
   * Papel "Administrador" da workspace, criado junto com a conta do owner: é o
   * papel que ele atribui ao primeiro colaborador com acesso total. `system`
   * significa imexível e valendo o catálogo INTEIRO (resolvido no
   * `AccessService`), por isso `permissions` nasce vazio.
   *
   * Também tem RLS e, como o cadastro não tem contexto de owner, entra pelo
   * client admin no mesmo nested create do `User`.
   */
  private systemRole() {
    return {
      name: 'Administrador',
      description:
        'Acesso total ao CRM. Papel do sistema — não pode ser editado nem excluído.',
      system: true,
    };
  }

  /**
   * Funil padrão da workspace, criado junto com a conta do owner. `PipelineStage`
   * tem RLS e o cadastro não tem contexto de owner — entra pelo client admin, no
   * mesmo nested create do `User` (atômico, sem $transaction explícito), pela
   * mesma razão de `Subscription` e `Role`.
   */
  private defaultStages() {
    return defaultPipelineStages();
  }

  /** Log do provisionamento — vale para os dois caminhos de cadastro. */
  private logStagesProvisioned(ownerId: string) {
    this.logger.log({
      evento: 'funil.estagios_provisionados',
      msg: 'Funil padrão criado para a conta nova.',
      ownerId,
      quantidade: DEFAULT_PIPELINE_STAGES.length,
    });
  }

  /**
   * Log do provisionamento dos catálogos — vale para os dois caminhos de
   * cadastro. Um só evento para as quatro listas: elas nascem juntas.
   */
  private logCatalogsProvisioned(ownerId: string, quantidade: number) {
    this.logger.log({
      evento: 'catalogo.itens_provisionados',
      msg: 'Catálogos padrão criados para a conta nova.',
      ownerId,
      quantidade,
    });
  }

  /**
   * Destinos de notificação padrão da conta nova. O in-app é um canal como os
   * outros (D1): sem esta linha o sino nunca receberia nada. `ownerId` = `id` do
   * próprio usuário, porque owner tem `User.ownerId` nulo — ele É a workspace.
   *
   * Tem RLS e o cadastro não tem contexto de owner → entra pelo client admin.
   * Não cabe no nested create do `User`: o `id` do usuário (que aqui é o
   * `ownerId` do destino) só existe depois do `create` acima.
   */
  private async provisionarDestinos(
    userId: string,
    email: string,
  ): Promise<void> {
    const kinds: NotificationChannelKind[] = ['IN_APP', 'EMAIL'];
    await this.notificationTargets.provisionarPadraoPeloSistema({
      ownerId: userId,
      userId,
      email,
      kinds,
    });
    this.logger.log({
      evento: 'notificacao.destinos_provisionados',
      msg: 'Destinos de notificação padrão criados para a conta nova.',
      ownerId: userId,
      userId,
      quantidade: kinds.length,
    });
  }

  async create(data: { name: string; email: string; passwordHash: string }) {
    const user = await this.admin.user.create({
      data: {
        ...data,
        // Owner: `ownerId` nulo (é a própria workspace) e conta já ativa.
        acceptedAt: new Date(),
        subscription: { create: this.trialSubscription() },
        ownedRoles: { create: this.systemRole() },
        pipelineStages: { create: this.defaultStages() },
        leadSourceCatalog: { create: defaultLeadSourceCatalog() },
        lostReasonCatalog: { create: defaultLostReasonCatalog() },
        serviceCatalog: { create: defaultServiceCatalog() },
        activityTypeCatalog: { create: defaultActivityTypeCatalog() },
        // `ownerId` do destino não pode sair daqui (o id ainda não existe) — é
        // preenchido logo abaixo, no único ponto do projeto onde ele é conhecido.
      },
    });
    await this.provisionarDestinos(user.id, user.email);
    this.logStagesProvisioned(user.id);
    this.logCatalogsProvisioned(user.id, totalDeItensDeCatalogo());
    return user;
  }
  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  /** Retorna o usuário vinculado a uma identidade de provedor OAuth, se existir. */
  async findByProviderAccount(
    provider: OAuthProvider,
    providerAccountId: string,
  ) {
    const account = await this.prisma.oAuthAccount.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId } },
      include: { user: true },
    });
    return account?.user ?? null;
  }

  /** Vincula uma identidade de provedor OAuth a um usuário já existente. */
  linkOAuthAccount(
    userId: string,
    provider: OAuthProvider,
    providerAccountId: string,
  ) {
    return this.prisma.oAuthAccount.create({
      data: { userId, provider, providerAccountId },
    });
  }

  /** Cria um usuário sem senha (origem OAuth) já vinculado à identidade do provedor. */
  async createWithOAuth(data: {
    name: string;
    email: string;
    provider: OAuthProvider;
    providerAccountId: string;
  }) {
    const user = await this.admin.user.create({
      data: {
        name: data.name,
        email: data.email,
        acceptedAt: new Date(),
        oauthAccounts: {
          create: {
            provider: data.provider,
            providerAccountId: data.providerAccountId,
          },
        },
        subscription: { create: this.trialSubscription() },
        ownedRoles: { create: this.systemRole() },
        pipelineStages: { create: this.defaultStages() },
        leadSourceCatalog: { create: defaultLeadSourceCatalog() },
        lostReasonCatalog: { create: defaultLostReasonCatalog() },
        serviceCatalog: { create: defaultServiceCatalog() },
        activityTypeCatalog: { create: defaultActivityTypeCatalog() },
      },
    });
    await this.provisionarDestinos(user.id, user.email);
    this.logStagesProvisioned(user.id);
    this.logCatalogsProvisioned(user.id, totalDeItensDeCatalogo());
    return user;
  }
  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }
  updatePassword(id: string, passwordHash: string) {
    return this.prisma.user.update({ where: { id }, data: { passwordHash } });
  }
  updateProfile(id: string, data: { name: string; email: string }) {
    return this.prisma.user.update({ where: { id }, data });
  }

  // --- Tokens de redefinição de senha ---

  createPasswordResetToken(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }) {
    return this.prisma.passwordResetToken.create({ data });
  }

  /** Busca um token de reset pelo hash, incluindo o usuário. Não valida validade/uso. */
  findResetTokenByHash(tokenHash: string) {
    return this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
  }

  markResetTokenUsed(id: string, usedAt: Date) {
    return this.prisma.passwordResetToken.update({
      where: { id },
      data: { usedAt },
    });
  }

  /** Remove os tokens de reset ainda não usados de um usuário (invalida pendentes). */
  deletePendingResetTokens(userId: string) {
    return this.prisma.passwordResetToken.deleteMany({
      where: { userId, usedAt: null },
    });
  }
}
