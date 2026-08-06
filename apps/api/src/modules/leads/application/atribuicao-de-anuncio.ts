/**
 * Atribuição de anúncio: a tradução do que a captação mandou para o que o
 * `Client` guarda. Função pura, ao lado de `nota-de-lead.ts`, e pelo mesmo
 * motivo — o formato é o que precisa de teste, não o banco.
 *
 * Duas coisas moram aqui e não podiam morar em outro lugar:
 *
 *  1. **O instante do `fbclid`.** A doc da Meta manda usar "o instante em que
 *     você primeiro observou este fbclid", e esse instante não é reconstruível
 *     depois — é o único dado desta fase que se perde para sempre se não for
 *     gravado agora. Ele é derivado, nunca recebido: um campo a mais no corpo
 *     seria um campo a mais para a origem esquecer.
 *  2. **O vazio.** Enquanto o `site-v2` não enviar nada, TODOS os campos chegam
 *     ausentes em todo lead. `temAtribuicao` é o portão que evita uma leitura e
 *     uma escrita por lead para gravar dez nulos.
 */

import type { AtribuicaoDeAnuncio } from '../../clients/domain/ad-attribution';

/** O que o `IntakeLeadDto` traz. Nomes do CONTRATO HTTP, não das colunas. */
export interface DadosDaAtribuicao {
  fbclid?: string | null;
  fbp?: string | null;
  gclid?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  urlDeEntrada?: string | null;
  /** `recebidoEm` do lead: quando a ORIGEM observou o clique. */
  recebidoEm?: string | null;
}

/**
 * Texto aproveitável, ou `null`. Nunca string vazia: `''` leria como "tem
 * valor" em todo `IS NOT NULL` daqui para a frente, e é o que a invariante do
 * banco proíbe. O `trim` é a ÚNICA transformação — em particular a caixa do
 * `fbclid` é preservada, porque a Meta a trata como significativa.
 */
function texto(valor?: string | null): string | null {
  const limpo = valor?.trim();
  return limpo ? limpo : null;
}

/**
 * O instante do clique. `recebidoEm` é preferido à hora da ingestão porque é
 * quando a ORIGEM viu o clique, e a chamada ao CRM pode vir minutos ou horas
 * depois (fila, retry, automação que roda de hora em hora).
 *
 * Data ilegível cai na hora da ingestão em vez de derrubar o lead: um `fbc` com
 * timestamp aproximado ainda casa dentro da janela, e lead perdido não volta. É
 * a mesma escolha que `quando()` em `nota-de-lead.ts` faz — só que lá o fallback
 * é omitir a linha, e aqui é usar `agora`, porque o par `fbclid`+`fbclidAt` não
 * admite metade.
 */
function instanteDoClique(
  recebidoEm: string | null | undefined,
  agora: Date,
): Date {
  if (!recebidoEm) return agora;
  const data = new Date(recebidoEm);
  return Number.isNaN(data.getTime()) ? agora : data;
}

/** `agora` é injetável para o teste do fallback não depender do relógio. */
export function montarAtribuicao(
  dados: DadosDaAtribuicao,
  agora: Date = new Date(),
): AtribuicaoDeAnuncio {
  const fbclid = texto(dados.fbclid);
  return {
    fbclid,
    // Nasce junto do `fbclid` ou não nasce: sem o par não há `fbc` a montar.
    fbclidAt: fbclid ? instanteDoClique(dados.recebidoEm, agora) : null,
    fbp: texto(dados.fbp),
    gclid: texto(dados.gclid),
    utmSource: texto(dados.utmSource),
    utmMedium: texto(dados.utmMedium),
    utmCampaign: texto(dados.utmCampaign),
    utmContent: texto(dados.utmContent),
    utmTerm: texto(dados.utmTerm),
    landingUrl: texto(dados.urlDeEntrada),
  };
}

/**
 * Algum campo chegou? Enquanto o emissor não envia atribuição, isto é `false`
 * em todo lead — e é o que mantém o custo desta fase em zero até lá.
 */
export function temAtribuicao(atribuicao: AtribuicaoDeAnuncio): boolean {
  return Object.values(atribuicao).some((valor) => valor !== null);
}
