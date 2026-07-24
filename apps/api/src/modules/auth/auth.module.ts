import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { MailModule } from '../../mail/mail.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { OAuthService } from './oauth/oauth.service';
import { CaptchaService } from './captcha/captcha.service';

@Module({
  imports: [UsersModule, MailModule, JwtModule.register({})],
  providers: [AuthService, OAuthService, CaptchaService],
  controllers: [AuthController],
  exports: [JwtModule],
})
export class AuthModule {}
