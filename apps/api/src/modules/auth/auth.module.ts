import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { MailModule } from '../../mail/mail.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { SessionsService } from './sessions.service';
import { OAuthService } from './oauth/oauth.service';
import { CaptchaService } from './captcha/captcha.service';

@Module({
  imports: [UsersModule, MailModule, JwtModule.register({})],
  providers: [AuthService, SessionsService, OAuthService, CaptchaService],
  controllers: [AuthController],
  // AuthService é exportado para o aceite de convite (modules/collaborators)
  // emitir a sessão do colaborador — o convidado já entra logado. SessionsService
  // não é usado fora daqui (CollaboratorsModule usa o repositório próprio), mas
  // o export mantém a fronteira explícita para o futuro.
  exports: [JwtModule, AuthService, SessionsService],
})
export class AuthModule {}
