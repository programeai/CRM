import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { NotificationType } from '@prisma/client';

/**
 * Renomeia, liga/desliga e muda os `types`. **Não** aceita mudar o `kind` nem a
 * `config`: trocar o endereço de um destino é criar outro (o histórico de
 * entregas aponta para este id).
 */
export class UpdateNotificationTargetDto {
  @IsOptional()
  @IsString({ message: 'Informe um rótulo para o destino.' })
  @MinLength(1, { message: 'Informe um rótulo para o destino.' })
  @MaxLength(60, { message: 'O rótulo deve ter no máximo 60 caracteres.' })
  label?: string;

  @IsOptional()
  @IsBoolean({ message: 'O campo "ativo" deve ser verdadeiro ou falso.' })
  active?: boolean;

  @IsOptional()
  @IsArray({ message: 'Os tipos devem ser uma lista.' })
  @ArrayUnique({ message: 'Não repita o mesmo tipo de notificação.' })
  @IsEnum(NotificationType, {
    each: true,
    message: 'Tipo de notificação inválido.',
  })
  types?: NotificationType[];
}
