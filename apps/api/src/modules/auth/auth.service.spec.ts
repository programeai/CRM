import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

describe('AuthService', () => {
  let service: AuthService;
  let users: jest.Mocked<
    Pick<UsersService, 'findByEmail' | 'findById' | 'setRefreshTokenHash'>
  >;
  let jwt: jest.Mocked<Pick<JwtService, 'signAsync'>>;

  beforeEach(() => {
    users = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      setRefreshTokenHash: jest.fn().mockResolvedValue(undefined),
    };
    jwt = { signAsync: jest.fn().mockResolvedValue('token') };
    const config = {
      get: jest.fn().mockReturnValue('x'),
    } as unknown as ConfigService;
    service = new AuthService(
      users as unknown as UsersService,
      jwt as unknown as JwtService,
      config,
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
      users.findByEmail.mockResolvedValue({ id: 'u1', passwordHash } as any);
      const result = await service.login('a@b.com', 'senha-correta');
      expect(result).toEqual({ accessToken: 'token', refreshToken: 'token' });
      expect(users.setRefreshTokenHash).toHaveBeenCalledWith(
        'u1',
        expect.any(String),
      );
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
      users.findById.mockResolvedValue({ id: 'u1', refreshTokenHash } as any);
      const result = await service.refresh('u1', token);
      expect(result).toEqual({ accessToken: 'token', refreshToken: 'token' });
    });
  });
});
