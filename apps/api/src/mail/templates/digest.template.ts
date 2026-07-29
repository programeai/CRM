import { button, divider, escapeHtml, paragraph, renderLayout } from './layout';
import type { EmailContent } from './password-reset.template';

/** Quantos itens de cada grupo aparecem antes do "e mais N". */
const MAX_POR_GRUPO = 5;

export interface ItemDeDigest {
  /** Rótulo pt-BR do tipo, já traduzido pelo chamador. */
  grupo: string;
  titulo: string;
  corpo: string;
}

type Input = {
  /** Itens já agrupados na ordem em que devem aparecer. */
  itens: ItemDeDigest[];
  /** Base pública do CRM (`FRONTEND_URL`). */
  appUrl: string;
};

/**
 * Digest diário: as notificações das últimas 24h, agrupadas por tipo, com
 * contagem e até {@link MAX_POR_GRUPO} itens por grupo.
 *
 * `paragraph()` recebe **HTML cru** — todo dado de negócio passa por
 * `escapeHtml`, porque título e corpo carregam nome de cliente e valor de
 * cobrança digitados pelo usuário.
 */
export function digestEmail({ itens, appUrl }: Input): EmailContent {
  const porGrupo = new Map<string, ItemDeDigest[]>();
  for (const item of itens) {
    const lista = porGrupo.get(item.grupo) ?? [];
    lista.push(item);
    porGrupo.set(item.grupo, lista);
  }

  const blocosHtml: string[] = [
    paragraph(
      itens.length === 1
        ? 'Você tem 1 novidade no CRM desde ontem:'
        : `Você tem ${itens.length} novidades no CRM desde ontem:`,
      { top: '14px' },
    ),
  ];
  const blocosTexto: string[] = [];

  for (const [grupo, doGrupo] of porGrupo) {
    const cabecalho = `${grupo} (${doGrupo.length})`;
    blocosHtml.push(
      paragraph(
        `<strong style="font-weight:700;">${escapeHtml(cabecalho)}</strong>`,
        {
          top: '22px',
        },
      ),
    );
    blocosTexto.push('', cabecalho);

    for (const item of doGrupo.slice(0, MAX_POR_GRUPO)) {
      blocosHtml.push(
        paragraph(escapeHtml(item.corpo), { tone: 'muted', top: '8px' }),
      );
      blocosTexto.push(`  - ${item.corpo}`);
    }
    const restantes = doGrupo.length - MAX_POR_GRUPO;
    if (restantes > 0) {
      const rodape =
        restantes === 1 ? 'e mais 1 item.' : `e mais ${restantes} itens.`;
      blocosHtml.push(
        paragraph(escapeHtml(rodape), { tone: 'muted', top: '8px' }),
      );
      blocosTexto.push(`  ${rodape}`);
    }
  }

  blocosHtml.push(divider(), button(appUrl, 'Abrir o CRM'));

  return {
    subject:
      itens.length === 1
        ? 'Seu resumo do dia: 1 novidade — ProgrameAi CRM'
        : `Seu resumo do dia: ${itens.length} novidades — ProgrameAi CRM`,
    text: [
      'Seu resumo do dia — ProgrameAi CRM',
      ...blocosTexto,
      '',
      appUrl,
      '',
      '—',
      `E-mail automático do ProgrameAi CRM · ${appUrl}`,
    ].join('\n'),
    html: renderLayout({
      preheader:
        itens.length === 1
          ? '1 novidade no CRM desde ontem.'
          : `${itens.length} novidades no CRM desde ontem.`,
      eyebrow: 'resumo do dia',
      title: 'Seu resumo do dia',
      content: blocosHtml.join('\n                    '),
      appUrl,
    }),
  };
}
