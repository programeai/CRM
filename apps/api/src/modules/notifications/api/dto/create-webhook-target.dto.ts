import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import { NotificationType } from '@prisma/client';

/**
 * Destino de integração (`WEBHOOK`, `SLACK`, `DISCORD` ou `TELEGRAM`). Atrás de
 * `@RequirePermission('notificacao:integrar')` — ver **D4**.
 *
 * O `IsUrl` é só a primeira barreira (formato); a trava que importa é
 * `validarUrlDeWebhook`, que exige HTTPS e recusa endereço de rede interna.
 */
export class CreateWebhookTargetDto {
  @IsString({ message: 'Informe um rótulo para o destino.' })
  @MinLength(1, { message: 'Informe um rótulo para o destino.' })
  @MaxLength(60, { message: 'O rótulo deve ter no máximo 60 caracteres.' })
  label!: string;

  @IsIn(['WEBHOOK', 'SLACK', 'DISCORD', 'TELEGRAM'], {
    message:
      'O tipo de integração deve ser WEBHOOK, SLACK, DISCORD ou TELEGRAM.',
  })
  kind!: 'WEBHOOK' | 'SLACK' | 'DISCORD' | 'TELEGRAM';

  @IsUrl(
    { protocols: ['https'], require_protocol: true },
    { message: 'Informe uma URL HTTPS válida.' },
  )
  url!: string;

  @IsOptional()
  @IsArray({ message: 'Os tipos devem ser uma lista.' })
  @ArrayUnique({ message: 'Não repita o mesmo tipo de notificação.' })
  @IsEnum(NotificationType, {
    each: true,
    message: 'Tipo de notificação inválido.',
  })
  types?: NotificationType[];
}
