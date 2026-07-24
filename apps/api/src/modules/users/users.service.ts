import { Injectable } from '@nestjs/common';
import { OAuthProvider } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}
  create(data: { name: string; email: string; passwordHash: string }) {
    return this.prisma.user.create({ data });
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
    return this.prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        oauthAccounts: {
          create: {
            provider: data.provider,
            providerAccountId: data.providerAccountId,
          },
        },
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
}
