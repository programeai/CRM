import {
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { ehFinalidade } from '../../domain/consent-purpose';

/**
 * Finalidade fora do catálogo recusa a requisição. Descartar em silêncio gravaria
 * uma linha de prova apontando para uma finalidade que não existe — e o art. 8º
 * § 4º é justamente sobre a finalidade ser determinada.
 */
@ValidatorConstraint({ name: 'finalidadeDeConsentimento' })
export class FinalidadeDeConsentimento implements ValidatorConstraintInterface {
  validate(valor: unknown): boolean {
    return typeof valor === 'string' && ehFinalidade(valor);
  }
  defaultMessage(): string {
    return 'Finalidade inválida. Use uma das finalidades de GET /consentimentos/finalidades.';
  }
}
