import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  Validate,
} from 'class-validator';
import { EventosDeWebhook } from './eventos-de-webhook.validator';

/**
 * Todos os campos opcionais: a tela salva só o que mudou. Trocar a `url`
 * derruba a verificação no service — o CRM não sabe se o endereço novo responde.
 */
export class UpdateOwnerWebhookDto {
  @IsOptional()
  @IsString({ message: 'Nome inválido.' })
  @MinLength(2, { message: 'O nome deve ter no mínimo 2 caracteres.' })
  @MaxLength(80, { message: 'O nome deve ter no máximo 80 caracteres.' })
  nome?: string;

  @IsOptional()
  @IsUrl(
    { protocols: ['https'], require_protocol: true },
    { message: 'Informe um endereço HTTPS válido.' },
  )
  url?: string;

  @IsOptional()
  @IsArray({ message: 'Os eventos devem ser uma lista.' })
  @ArrayNotEmpty({ message: 'Escolha ao menos um evento para o webhook.' })
  @Validate(EventosDeWebhook)
  eventos?: string[];

  @IsOptional()
  @IsBoolean({ message: 'O estado do webhook deve ser verdadeiro ou falso.' })
  ativo?: boolean;
}
