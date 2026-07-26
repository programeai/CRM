import {
  ForbiddenException,
  GoneException,
  UnauthorizedException,
} from '@nestjs/common';
import { OAuthProvider } from '@prisma/client';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { MailService } from '../../mail/mail.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

describe('AuthService', () => {
  let service: AuthService;
  let users: jest.Mocked<
    Pick<
      UsersService,
      | 'findByEmail'
      | 'findById'
      | 'create'
      | 'createWithOAuth'
      | 'findByProviderAccount'
      | 'linkOAuthAccount'
      | 'setRefreshTokenHash'
      | 'updatePassword'
      | 'createPasswordResetToken'
      | 'findResetTokenByHash'
      | 'markResetTokenUsed'
      | 'deletePendingResetTokens'
    >
  >;
  let jwt: jest.Mocked<Pick<JwtService, 'signAsync'>>;
  let mail: jest.Mocked<Pick<MailService, 'sendPasswordReset'>>;
  // Valores de config por chave; o que não estiver aqui devolve 'x', como antes.
  let valoresDeConfig: Record<string, unknown>;

  beforeEach(() => {
    users = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      createWithOAuth: jest.fn(),
      findByProviderAccount: jest.fn(),
      linkOAuthAccount: jest.fn().mockResolvedValue(undefined),
      setRefreshTokenHash: jest.fn().mockResolvedValue(undefined),
      updatePassword: jest.fn().mockResolvedValue(undefined),
      createPasswordResetToken: jest.fn().mockResolvedValue(undefined),
      findResetTokenByHash: jest.fn(),
      markResetTokenUsed: jest.fn().mockResolvedValue(undefined),
      deletePendingResetTokens: jest.fn().mockResolvedValue(undefined),
    };
    jwt = { signAsync: jest.fn().mockResolvedValue('token') };
    mail = { sendPasswordReset: jest.fn().mockResolvedValue(undefined) };
    valoresDeConfig = {};
    const config = {
      get: jest.fn((chave: string) =>
        chave in valoresDeConfig ? valoresDeConfig[chave] : 'x',
      ),
    } as unknown as ConfigService;
    service = new AuthService(
      users as unknown as UsersService,
      jwt as unknown as JwtService,
      config,
      mail as unknown as MailService,
    );
  });

  describe('login', () => {
    it('rejeita senha errada com UnauthorizedException', async () => {
      const passwordHash = await argon2.hash('senha-correta');
      users.findByEmail.mockResolvedValue({ id: 'u1', passwordHash } as any);
      await expect(
        service.login('a@b.com', 'senha-errada'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejeita usuário inexistente', async () => {
      users.findByEmail.mockResolvedValue(null);
      await expect(service.login('a@b.com', 'x')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('emite tokens e persiste o hash do refresh quando a senha confere', async () => {
      const passwordHash = await argon2.hash('senha-correta');
      users.findByEmail.mockResolvedValue({
        id: 'u1',
        passwordHash,
        active: true,
      } as any);
      const result = await service.login('a@b.com', 'senha-correta');
      expect(result).toEqual({ accessToken: 'token', refreshToken: 'token' });
      expect(users.setRefreshTokenHash).toHaveBeenCalledWith(
        'u1',
        expect.any(String),
      );
    });

    it('rejeita colaborador desativado, mesmo com a senha correta', async () => {
      const passwordHash = await argon2.hash('senha-correta');
      users.findByEmail.mockResolvedValue({
        id: 'u1',
        passwordHash,
        active: false,
      } as any);
      await expect(service.login('a@b.com', 'senha-correta')).rejects.toThrow(
        'Seu acesso ao CRM foi desativado',
      );
    });

    it('rejeita convite pendente (sem senha definida) sem revelar a conta', async () => {
      users.findByEmail.mockResolvedValue({
        id: 'u1',
        passwordHash: null,
        active: true,
      } as any);
      await expect(service.login('a@b.com', 'x')).rejects.toThrow(
        'Credenciais inválidas',
      );
    });
  });

  describe('gate de autocadastro', () => {
    it('recusa register com ForbiddenException quando REGISTRATION_ENABLED=false', async () => {
      valoresDeConfig.REGISTRATION_ENABLED = false;
      await expect(
        service.register('Nome', 'a@b.com', 'senha123'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      // Barra antes de tocar o banco: nem consulta de e-mail duplicado acontece.
      expect(users.findByEmail).not.toHaveBeenCalled();
    });

    it('permite register quando a flag está ausente (default true)', async () => {
      users.findByEmail.mockResolvedValue(null);
      users.create.mockResolvedValue({ id: 'u1' } as any);
      await expect(
        service.register('Nome', 'a@b.com', 'senha123'),
      ).resolves.toMatchObject({ accessToken: 'token' });
    });

    it('recusa a criação de conta nova por OAuth quando o cadastro está fechado', async () => {
      valoresDeConfig.REGISTRATION_ENABLED = false;
      users.findByProviderAccount.mockResolvedValue(null);
      users.findByEmail.mockResolvedValue(null);
      await expect(
        service.oauthLogin(OAuthProvider.GOOGLE, {
          providerAccountId: 'g1',
          email: 'a@b.com',
          emailVerified: true,
          name: 'Nome',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(users.createWithOAuth).not.toHaveBeenCalled();
    });

    it('deixa quem já tem conta entrar por OAuth mesmo com o cadastro fechado', async () => {
      valoresDeConfig.REGISTRATION_ENABLED = false;
      users.findByProviderAccount.mockResolvedValue({
        id: 'u1',
        active: true,
      } as any);
      await expect(
        service.oauthLogin(OAuthProvider.GOOGLE, {
          providerAccountId: 'g1',
          email: 'a@b.com',
          emailVerified: true,
          name: 'Nome',
        }),
      ).resolves.toMatchObject({ accessToken: 'token' });
    });
  });

  describe('refresh', () => {
    it('rejeita quando refreshTokenHash é null', async () => {
      users.findById.mockResolvedValue({
        id: 'u1',
        refreshTokenHash: null,
      } as any);
      await expect(service.refresh('u1', 'algum-token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejeita quando o refresh token não confere com o hash', async () => {
      const refreshTokenHash = await argon2.hash('token-antigo');
      users.findById.mockResolvedValue({ id: 'u1', refreshTokenHash } as any);
      await expect(service.refresh('u1', 'token-novo')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('emite novos tokens quando o refresh confere', async () => {
      const token = 'refresh-valido';
      const refreshTokenHash = await argon2.hash(token);
      users.findById.mockResolvedValue({
        id: 'u1',
        refreshTokenHash,
        active: true,
      } as any);
      const result = await service.refresh('u1', token);
      expect(result).toEqual({ accessToken: 'token', refreshToken: 'token' });
    });

    it('rejeita o refresh de colaborador desativado', async () => {
      const token = 'refresh-valido';
      const refreshTokenHash = await argon2.hash(token);
      users.findById.mockResolvedValue({
        id: 'u1',
        refreshTokenHash,
        active: false,
      } as any);
      await expect(service.refresh('u1', token)).rejects.toThrow(
        'Seu acesso ao CRM foi desativado',
      );
    });
  });

  describe('requestPasswordReset', () => {
    it('não cria token nem envia e-mail para usuário inexistente', async () => {
      users.findByEmail.mockResolvedValue(null);
      await service.requestPasswordReset('nao@existe.com');
      expect(users.createPasswordResetToken).not.toHaveBeenCalled();
      expect(mail.sendPasswordReset).not.toHaveBeenCalled();
    });

    it('não envia e-mail para conta sem senha (só-OAuth)', async () => {
      users.findByEmail.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        passwordHash: null,
      } as any);
      await service.requestPasswordReset('a@b.com');
      expect(users.createPasswordResetToken).not.toHaveBeenCalled();
      expect(mail.sendPasswordReset).not.toHaveBeenCalled();
    });

    it('cria token e envia e-mail com link para usuário com senha', async () => {
      users.findByEmail.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        passwordHash: await argon2.hash('x'),
      } as any);
      await service.requestPasswordReset('a@b.com');
      expect(users.deletePendingResetTokens).toHaveBeenCalledWith('u1');
      expect(users.createPasswordResetToken).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          tokenHash: expect.any(String),
        }),
      );
      expect(mail.sendPasswordReset).toHaveBeenCalledWith(
        'a@b.com',
        expect.stringContaining('/redefinir-senha?token='),
      );
      // o token bruto (na URL) nunca é igual ao hash persistido
      const { tokenHash } = users.createPasswordResetToken.mock.calls[0][0];
      const url = mail.sendPasswordReset.mock.calls[0][1];
      expect(url).not.toContain(tokenHash);
    });
  });

  describe('resetPassword', () => {
    it('rejeita token inexistente com GoneException', async () => {
      users.findResetTokenByHash.mockResolvedValue(null);
      await expect(
        service.resetPassword('token-qualquer', 'novaSenha'),
      ).rejects.toBeInstanceOf(GoneException);
    });

    it('rejeita token já utilizado', async () => {
      users.findResetTokenByHash.mockResolvedValue({
        id: 't1',
        userId: 'u1',
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 10000),
      } as any);
      await expect(
        service.resetPassword('token', 'novaSenha'),
      ).rejects.toBeInstanceOf(GoneException);
    });

    it('rejeita token expirado', async () => {
      users.findResetTokenByHash.mockResolvedValue({
        id: 't1',
        userId: 'u1',
        usedAt: null,
        expiresAt: new Date(Date.now() - 10000),
      } as any);
      await expect(
        service.resetPassword('token', 'novaSenha'),
      ).rejects.toBeInstanceOf(GoneException);
    });

    it('troca a senha, marca o token como usado e revoga a sessão', async () => {
      users.findResetTokenByHash.mockResolvedValue({
        id: 't1',
        userId: 'u1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 10000),
      } as any);
      await service.resetPassword('token', 'novaSenha');
      expect(users.updatePassword).toHaveBeenCalledWith(
        'u1',
        expect.any(String),
      );
      expect(users.markResetTokenUsed).toHaveBeenCalledWith(
        't1',
        expect.any(Date),
      );
      expect(users.setRefreshTokenHash).toHaveBeenCalledWith('u1', null);
    });
  });
});
