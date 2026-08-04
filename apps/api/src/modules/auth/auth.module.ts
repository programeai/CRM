import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { MailModule } from '../../mail/mail.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { SessionsService } from './sessions.service';
import { SessionsCleanupJob } from './sessions-cleanup.job';
import { AccessRecordsService } from './access-records.service';
import { AccessRecordsCleanupJob } from './access-records-cleanup.job';
import { OAuthService } from './oauth/oauth.service';
import { CaptchaService } from './captcha/captcha.service';
import { TotpService } from './totp/totp.service';
import { TOTP_REPOSITORY } from './totp/totp.repository';
import { PrismaTotpRepository } from './totp/prisma-totp.repository';

@Module({
  imports: [UsersModule, MailModule, JwtModule.register({})],
  providers: [
    AuthService,
    SessionsService,
    SessionsCleanupJob,
    AccessRecordsService,
    AccessRecordsCleanupJob,
    OAuthService,
    CaptchaService,
    TotpService,
    { provide: TOTP_REPOSITORY, useClass: PrismaTotpRepository },
  ],
  controllers: [AuthController],
  // AuthService é exportado para o aceite de convite (modules/collaborators)
  // emitir a sessão do colaborador — o convidado já entra logado. SessionsService
  // não é usado fora daqui (CollaboratorsModule usa o repositório próprio), mas
  // o export mantém a fronteira explícita para o futuro.
  // `TotpService` NÃO é exportado: quem precisa dele é o próprio `AuthService`
  // (login em dois passos e as rotas de gestão), e nada fora deste módulo tem
  // motivo para verificar segundo fator por conta própria.
  exports: [JwtModule, AuthService, SessionsService],
})
export class AuthModule {}
