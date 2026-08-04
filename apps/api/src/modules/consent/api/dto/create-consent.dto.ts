import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  Validate,
} from 'class-validator';
import { ConsentSubjectType } from '@prisma/client';
import { FinalidadeDeConsentimento } from './finalidade.validator';

/**
 * Uma manifestação do titular. **`textVersion` NÃO entra aqui**: ela vem de
 * `textoVigente(purpose)` no service. Aceitar a versão pelo corpo deixaria
 * registrar consentimento a um texto que nunca foi exibido, o que é o oposto de
 * comprovar (art. 8º § 2º).
 */
export class CreateConsentDto {
  @IsEnum(ConsentSubjectType, {
    message: 'Tipo de titular inválido: use CLIENT ou CONTACT.',
  })
  subjectType: ConsentSubjectType;

  @IsUUID('4', { message: 'Titular inválido.' })
  subjectId: string;

  @Validate(FinalidadeDeConsentimento)
  purpose: string;

  @IsBoolean({
    message: 'Informe se o titular consentiu (true) ou revogou (false).',
  })
  granted: boolean;

  /** Como se manifestou. Texto livre: a realidade tem mais canais que um enum. */
  @IsString({ message: 'Informe como o titular se manifestou.' })
  @MinLength(2, { message: 'O canal deve ter no mínimo 2 caracteres.' })
  @MaxLength(60, { message: 'O canal deve ter no máximo 60 caracteres.' })
  channel: string;

  @IsOptional()
  @IsString({ message: 'Evidência inválida.' })
  @MaxLength(500, { message: 'A evidência deve ter no máximo 500 caracteres.' })
  evidence?: string;

  /**
   * Prazo de retenção informado ao titular. O guia da ANPD é explícito: a ausência
   * dessa informação viola a exigência de consentimento informado.
   */
  @IsOptional()
  @IsString({ message: 'Prazo de retenção inválido.' })
  @MaxLength(200, {
    message: 'O prazo informado deve ter no máximo 200 caracteres.',
  })
  informedRetention?: string;

  /** Quando o titular se manifestou. Em branco, vale agora. */
  @IsOptional()
  @IsDateString({}, { message: 'Data da manifestação inválida.' })
  occurredAt?: string;
}
