/**
 * A nota do lead: o bloco de texto que a ingestão escreve em `Client.notes`.
 *
 * Existe porque a captação e o CRM têm públicos diferentes. A origem manda dois
 * formatos da mesma coisa (`qualificacao` em código, `resumo` por extenso), e o
 * que serve no minuto antes de ligar é o segundo — em texto corrido, com a
 * origem e a hora em cima. Função pura, para o formato ser testado sem banco.
 */

/** Teto de `Client.notes` no CRM (`CreateClientDto`). A nota respeita o mesmo. */
export const LIMITE_DE_NOTA = 5000;

export interface DadosDaNota {
  origem: string;
  pagina?: string | null;
  recebidoEm?: string | null;
  cenario?: string | null;
  resumo?: string | null;
  mensagem?: string | null;
  email?: string | null;
  cidade?: string | null;
}

/** Data e hora em pt-BR ("27/07/2026 14:32"). Entrada inválida cai em `null`. */
function quando(iso?: string | null): string | null {
  if (!iso) return null;
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return null;
  return data.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Monta o bloco de uma ingestão. A ordem é a de quem vai atender: primeiro de
 * onde veio e quando, depois o cenário (é o que decide o tom da conversa),
 * depois o que a pessoa respondeu e escreveu.
 */
export function montarNotaDeLead(dados: DadosDaNota): string {
  const hora = quando(dados.recebidoEm);
  const linhas: string[] = [
    hora
      ? `Lead recebido em ${hora} por ${dados.origem}.`
      : `Lead recebido por ${dados.origem}.`,
  ];

  if (dados.pagina) linhas.push(`Página: ${dados.pagina}`);
  if (dados.cidade) linhas.push(`Cidade informada: ${dados.cidade}`);
  if (dados.email) linhas.push(`E-mail informado: ${dados.email}`);
  if (dados.cenario) linhas.push(`Cenário: ${dados.cenario}`);
  if (dados.resumo) linhas.push('', dados.resumo.trim());
  if (dados.mensagem) linhas.push('', `Mensagem: ${dados.mensagem.trim()}`);

  return linhas.join('\n').slice(0, LIMITE_DE_NOTA);
}

/**
 * Empilha a nota nova SOBRE a que já existia, e corta no limite.
 *
 * A nova vai em cima de propósito: quem abre o cadastro de um lead que voltou
 * quer ler o contato de hoje, não rolar o histórico. E o corte, quando ele
 * acontece, come o passado em vez de perder o que acabou de chegar.
 */
export function empilharNota(atual: string | null, nova: string): string {
  const anterior = atual?.trim();
  if (!anterior) return nova.slice(0, LIMITE_DE_NOTA);
  return `${nova}\n\n---\n\n${anterior}`.slice(0, LIMITE_DE_NOTA);
}
