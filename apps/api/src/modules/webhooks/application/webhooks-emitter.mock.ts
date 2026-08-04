import type { OwnerWebhooksEmitterService } from './owner-webhooks-emitter.service';

/**
 * Emitter de webhook mockado, para os specs dos serviços de negócio.
 *
 * Existe porque a Fase 19-B acrescentou o emissor gêmeo em **oito** pontos de
 * emissão: repetir o objeto em oito specs faria de cada evento novo uma
 * alteração em oito arquivos. Devolve `jest.Mock`s para o spec poder afirmar
 * a chamada quando ela é o que está sendo testado.
 */
export function webhooksEmitterMock() {
  return {
    emitir: jest.fn().mockResolvedValue(undefined),
    emitirPeloSistema: jest.fn().mockResolvedValue(undefined),
  };
}

/** O mock já convertido para o tipo do construtor. */
export function webhooksEmitterFake(): OwnerWebhooksEmitterService {
  return webhooksEmitterMock() as unknown as OwnerWebhooksEmitterService;
}
