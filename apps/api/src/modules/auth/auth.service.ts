import {
  ConflictException,
  GoneException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OAuthProvider } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { UsersService } from '../users/users.service';
import { MailService } from '../../mail/mail.service';
import type { OAuthProfile } from './oauth/oauth.service';

/** Validade do token de redefinição de senha. */
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora

@Injectable()
export class AuthService {
  constructor(
    private users: UsersService,
    private jwt: JwtService,
    private config: ConfigService,
    private mail: MailService,
  ) {}

  async register(name: string, email: string, password: string) {
    const existing = await this.users.findByEmail(email);
    if (existing) {
      throw new ConflictException('Já existe uma conta com este e-mail.');
    }
    const user = await this.users.create({
      name,
      email,
      passwordHash: await this.hashSecret(password),
    });
    return this.issueTokens(user.id);
  }

  /**
   * Entra ou cadastra via OAuth. Se a identidade do provedor já é conhecida,
   * loga direto. Caso contrário, vincula por e-mail **verificado** a uma conta
   * existente ou cria uma nova conta sem senha.
   */
  async oauthLogin(provider: OAuthProvider, profile: OAuthProfile) {
    const linked = await this.users.findByProviderAccount(
      provider,
      profile.providerAccountId,
    );
    if (linked) return this.issueTokens(linked.id);

    if (!profile.email || !profile.emailVerified) {
      throw new UnauthorizedException(
        'Não foi possível obter um e-mail verificado do provedor.',
      );
    }

    const existing = await this.users.findByEmail(profile.email);
    if (existing) {
      await this.users.linkOAuthAccount(
        existing.id,
        provider,
        profile.providerAccountId,
      );
      return this.issueTokens(existing.id);
    }

    const created = await this.users.createWithOAuth({
      name: profile.name,
      email: profile.email,
      provider,
      providerAccountId: profile.providerAccountId,
    });
    return this.issueTokens(created.id);
  }

  async login(email: string, password: string) {
    const user = await this.users.findByEmail(email);
    if (
      !user ||
      !user.passwordHash ||
      !(await argon2.verify(user.passwordHash, password))
    ) {
      throw new UnauthorizedException('Credenciais inválidas');
    }
    return this.issueTokens(user.id);
  }

  /**
   * Inicia a redefinição de senha. Anti-enumeração: nunca revela se o e-mail
   * existe — contas inexistentes ou sem senha (só-OAuth) simplesmente não
   * recebem e-mail, mas o retorno é sempre o mesmo. Invalida tokens pendentes
   * anteriores antes de emitir um novo.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user || !user.passwordHash) return;

    await this.users.deletePendingResetTokens(user.id);

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashResetToken(rawToken);
    await this.users.createPasswordResetToken({
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    });

    const base = this.config.get<string>('FRONTEND_URL') ?? '';
    const resetUrl = `${base}/redefinir-senha?token=${rawToken}`;
    await this.mail.sendPasswordReset(user.email, resetUrl);
  }

  /**
   * Conclui a redefinição: valida o token, troca a senha e revoga a sessão
   * ativa (refresh token) para forçar novo login.
   */
  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const record = await this.users.findResetTokenByHash(
      this.hashResetToken(rawToken),
    );
    if (!record) {
      throw new GoneException(
        'Link de redefinição inválido. Solicite um novo.',
      );
    }
    if (record.usedAt) {
      throw new GoneException(
        'Este link de redefinição já foi utilizado. Solicite um novo.',
      );
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new GoneException(
        'Este link de redefinição expirou. Solicite um novo.',
      );
    }

    await this.users.updatePassword(
      record.userId,
      await this.hashSecret(newPassword),
    );
    await this.users.markResetTokenUsed(record.id, new Date());
    await this.users.deletePendingResetTokens(record.userId);
    // Revoga a sessão vigente: qualquer refresh token existente deixa de valer.
    await this.users.setRefreshTokenHash(record.userId, null);
  }

  /** Hash determinístico (sha256) do token bruto — permite busca indexada. */
  private hashResetToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  /**
   * `argon2.hash` é tipado como `Promise<any>` na lib; sem `raw: true` sempre
   * retorna a hash codificada (string). Encapsula para conter o `any` num único
   * ponto e expor `Promise<string>` ao restante do serviço.
   */
  private hashSecret(plain: string): Promise<string> {
    return argon2.hash(plain) as Promise<string>;
  }

  async refresh(userId: string, refreshToken: string) {
    const user = await this.users.findById(userId);
    if (
      !user?.refreshTokenHash ||
      !(await argon2.verify(user.refreshTokenHash, refreshToken))
    ) {
      throw new UnauthorizedException();
    }
    return this.issueTokens(user.id);
  }

  async me(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    const { passwordHash, refreshTokenHash, ...safe } = user;
    return safe;
  }

  /**
   * Atualiza os dados cadastrais (nome e e-mail) do próprio usuário.
   * Como `email` é único, valida conflito com outra conta antes de gravar.
   */
  async updateProfile(userId: string, data: { name: string; email: string }) {
    const existing = await this.users.findByEmail(data.email);
    if (existing && existing.id !== userId) {
      throw new ConflictException('Já existe uma conta com este e-mail.');
    }
    const user = await this.users.updateProfile(userId, data);
    const { passwordHash, refreshTokenHash, ...safe } = user;
    return safe;
  }

  async logout(userId: string) {
    await this.users.setRefreshTokenHash(userId, null);
  }

  private async issueTokens(sub: string) {
    const accessToken = await this.jwt.signAsync(
      { sub },
      {
        secret: this.config.get('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get('JWT_ACCESS_TTL'),
      },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub },
      {
        secret: this.config.get('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get('JWT_REFRESH_TTL'),
      },
    );
    await this.users.setRefreshTokenHash(
      sub,
      await this.hashSecret(refreshToken),
    );
    return { accessToken, refreshToken };
  }
}
