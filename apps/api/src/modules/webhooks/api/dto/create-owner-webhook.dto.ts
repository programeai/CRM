import {
  ArrayNotEmpty,
  IsArray,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  Validate,
} from 'class-validator';
import { EventosDeWebhook } from './eventos-de-webhook.validator';

export class CreateOwnerWebhookDto {
  @IsString({ message: 'O nome é obrigatório.' })
  @MinLength(2, { message: 'O nome deve ter no mínimo 2 caracteres.' })
  @MaxLength(80, { message: 'O nome deve ter no máximo 80 caracteres.' })
  nome: string;

  /**
   * `@IsUrl` só confere a FORMA. Quem recusa HTTP, porta fora de 443 e endereço
   * de rede interna é `validarUrlDeWebhook` no service — precisa resolver DNS, o
   * que não cabe num validador de DTO.
   */
  @IsUrl(
    { protocols: ['https'], require_protocol: true },
    { message: 'Informe um endereço HTTPS válido.' },
  )
  url: string;

  @IsArray({ message: 'Os eventos devem ser uma lista.' })
  @ArrayNotEmpty({ message: 'Escolha ao menos um evento para o webhook.' })
  @Validate(EventosDeWebhook)
  eventos: string[];
}
