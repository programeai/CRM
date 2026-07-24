import { Injectable } from '@nestjs/common';
import { OAuthProvider } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaAdminService } from '../../prisma/prisma-admin.service';

/** Duração do trial concedido no cadastro. */
const TRIAL_DAYS = 14;

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private admin: PrismaAdminService,
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

  create(data: { name: string; email: string; passwordHash: string }) {
    return this.admin.user.create({
      data: { ...data, subscription: { create: this.trialSubscription() } },
    });
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
  createWithOAuth(data: {
    name: string;
    email: string;
    provider: OAuthProvider;
    providerAccountId: string;
  }) {
    return this.admin.user.create({
      data: {
        name: data.name,
        email: data.email,
        oauthAccounts: {
          create: {
            provider: data.provider,
            providerAccountId: data.providerAccountId,
          },
        },
        subscription: { create: this.trialSubscription() },
      },
    });
  }
  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }
  setRefreshTokenHash(id: string, refreshTokenHash: string | null) {
    return this.prisma.user.update({
      where: { id },
      data: { refreshTokenHash },
    });
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
