import {
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { ehEventoDeWebhook } from '../../domain/owner-webhook-event';

/**
 * Evento fora do catálogo recusa a requisição inteira. Descartar em silêncio
 * criaria webhook que nunca recebe nada e não explica por quê — e aqui a lista
 * vem de formulário, não de código.
 */
@ValidatorConstraint({ name: 'eventosDeWebhook' })
export class EventosDeWebhook implements ValidatorConstraintInterface {
  validate(valor: unknown): boolean {
    return (
      Array.isArray(valor) &&
      valor.every((v) => typeof v === 'string' && ehEventoDeWebhook(v))
    );
  }
  defaultMessage(): string {
    return 'Há evento inválido na lista. Use os eventos de GET /webhooks/eventos.';
  }
}
