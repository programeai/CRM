import {
  ArrayNotEmpty,
  IsArray,
  IsString,
  MaxLength,
  MinLength,
  Validate,
} from 'class-validator';
import { EscoposDaApiPublica } from './escopos-da-api-publica.validator';

/**
 * A validação é **estrita aqui**, ao contrário de `emitir`, que descarta escopo
 * desconhecido em silêncio (decisão 17-A, `integration-keys.service.ts:79`). O
 * motivo é o oposto do que parece contradição: `emitir` recebe uma lista
 * montada por código (`[ESCOPO_RECEBER_LEAD]`), esta rota recebe entrada de
 * formulário. Um typo silencioso criaria chave com zero escopos, que responde
 * 403 em tudo e não explica por quê.
 */
export class CreateIntegrationKeyDto {
  @IsString({ message: 'O nome é obrigatório.' })
  @MinLength(2, { message: 'O nome deve ter no mínimo 2 caracteres.' })
  @MaxLength(80, { message: 'O nome deve ter no máximo 80 caracteres.' })
  nome: string;

  @IsArray({ message: 'Os escopos devem ser uma lista.' })
  @ArrayNotEmpty({ message: 'Escolha ao menos um escopo para a chave.' })
  @Validate(EscoposDaApiPublica)
  escopos: string[];
}
