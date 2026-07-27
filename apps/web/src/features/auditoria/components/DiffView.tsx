import { ArrowRight } from 'lucide-react';

/** Rótulo em pt-BR dos campos que aparecem no diff. Chave sem entrada usa o próprio nome. */
const CAMPO_LABELS: Record<string, string> = {
  status: 'Situação',
  description: 'Descrição',
  amount: 'Valor',
  paidAmount: 'Valor recebido',
  paidAt: 'Recebido em',
  dueDate: 'Vencimento',
  method: 'Forma de pagamento',
  notes: 'Observações',
  name: 'Nome',
  nome: 'Nome',
  descricao: 'Descrição',
  permissoes: 'Permissões',
  papel: 'Papel',
  monthlyAmount: 'Valor mensal',
  billingDay: 'Dia de cobrança',
  endDate: 'Término',
  sentAt: 'Enviada em',
  decidedAt: 'Decidida em',
  archivedAt: 'Arquivado em',
  trialEndsAt: 'Fim do teste',
  currentPeriodEnd: 'Fim do período',
  cancelAtPeriodEnd: 'Cancela ao fim do período',
  // Contexto extra (não é par antes/depois)
  cobrancasCanceladas: 'Cobranças canceladas',
  cobrancasGeradas: 'Cobranças geradas',
  dealMovidoParaGanhou: 'Oportunidade movida para Ganhou',
  origemId: 'Versão de origem',
  versao: 'Versão',
  papelId: 'Papel (id)',
  conviteId: 'Convite',
  contratoId: 'Contrato',
  vencimento: 'Vencimento',
  permissions: 'Permissões',
};

function rotularCampo(campo: string): string {
  return CAMPO_LABELS[campo] ?? campo;
}

/** Um par `{ antes, depois }` — a forma que `calcularDiff` grava no backend. */
function ehPar(valor: unknown): valor is { antes: unknown; depois: unknown } {
  return (
    typeof valor === 'object' &&
    valor !== null &&
    !Array.isArray(valor) &&
    'antes' in valor &&
    'depois' in valor
  );
}

/** `null`/vazio vira travessão; array vira lista legível; o resto vira texto. */
function formatarValor(valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') return '—';
  if (typeof valor === 'boolean') return valor ? 'Sim' : 'Não';
  if (Array.isArray(valor)) return valor.length ? valor.join(', ') : '—';
  if (typeof valor === 'object') return JSON.stringify(valor);
  return String(valor);
}

/**
 * Renderiza o `diff` de uma entrada da trilha.
 *
 * Duas formas convivem na mesma coluna JSONB: os pares `{ antes, depois }` dos
 * campos alterados e as chaves soltas do contexto extra da ação (ex.:
 * `cobrancasCanceladas: 3`). Cada uma se exibe do seu jeito.
 */
export function DiffView({ diff }: { diff: Record<string, unknown> | null }) {
  const entradas = Object.entries(diff ?? {});
  if (entradas.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Esta ação não registrou alteração de campo.
      </p>
    );
  }

  return (
    <dl className="flex flex-col gap-2 text-sm">
      {entradas.map(([campo, valor]) => (
        <div
          key={campo}
          className="flex flex-wrap items-baseline gap-x-2 gap-y-1"
        >
          <dt className="text-muted-foreground">{rotularCampo(campo)}:</dt>
          <dd className="flex flex-wrap items-baseline gap-2">
            {ehPar(valor) ? (
              <>
                <span className="text-muted-foreground line-through">
                  {formatarValor(valor.antes)}
                </span>
                <ArrowRight
                  className="size-3.5 shrink-0 self-center text-muted-foreground"
                  aria-hidden
                />
                <span className="font-medium">
                  {formatarValor(valor.depois)}
                </span>
              </>
            ) : (
              <span className="font-medium">{formatarValor(valor)}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
