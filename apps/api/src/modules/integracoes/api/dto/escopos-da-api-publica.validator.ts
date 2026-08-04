import {
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { ehEscopoDaApiPublica } from '../../domain/integration-scope';

/**
 * Escopo fora do catálogo — ou `lead:receber`, que pertence ao canal de captação
 * — recusa a requisição inteira. `emitir` descarta em silêncio porque lá a lista
 * vem de código; aqui vem de formulário.
 */
@ValidatorConstraint({ name: 'escoposDaApiPublica' })
export class EscoposDaApiPublica implements ValidatorConstraintInterface {
  validate(valor: unknown): boolean {
    return (
      Array.isArray(valor) &&
      valor.every((v) => typeof v === 'string' && ehEscopoDaApiPublica(v))
    );
  }
  defaultMessage(): string {
    return 'Há escopo inválido na lista. Use os escopos de GET /integracoes/escopos, exceto o de captação de lead.';
  }
}
