import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { NotificationType } from '@prisma/client';

/**
 * Nesta fase o `POST` aceita apenas `kind: 'EMAIL'` — `IN_APP` já vem
 * provisionado e não é criável; `WEBHOOK`/`SLACK` chegam na Fase 6, atrás de
 * permissão. O `kind` não é campo do DTO por isso: a rota é de e-mail.
 */
export class CreateNotificationTargetDto {
  @IsString({ message: 'Informe um rótulo para o destino.' })
  @MinLength(1, { message: 'Informe um rótulo para o destino.' })
  @MaxLength(60, { message: 'O rótulo deve ter no máximo 60 caracteres.' })
  label!: string;

  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  email!: string;

  @IsOptional()
  @IsArray({ message: 'Os tipos devem ser uma lista.' })
  @ArrayUnique({ message: 'Não repita o mesmo tipo de notificação.' })
  @IsEnum(NotificationType, {
    each: true,
    message: 'Tipo de notificação inválido.',
  })
  types?: NotificationType[];
}
