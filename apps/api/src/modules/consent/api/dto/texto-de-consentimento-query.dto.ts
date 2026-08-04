import { Validate } from 'class-validator';
import { FinalidadeDeConsentimento } from './finalidade.validator';

export class TextoDeConsentimentoQueryDto {
  @Validate(FinalidadeDeConsentimento)
  purpose: string;
}
