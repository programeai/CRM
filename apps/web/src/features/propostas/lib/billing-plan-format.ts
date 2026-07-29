import { translateBillingType } from '@/lib/labels';
import type { Proposal } from '../api/types';
import { formatMoney } from './proposal-format';

/**
 * O plano em uma frase, do jeito que se fala numa reunião: "Parcelado —
 * entrada de 30% em 5 dias + 8 parcelas a partir de 30 dias do aceite".
 *
 * Uma frase e não uma grade de oito campos: o plano é uma coisa só, e a ficha
 * já tem grade demais. A grade fica na tela de conferência, onde se edita.
 */
export function describeBillingPlan(proposal: Proposal): string | null {
  if (!proposal.billingType) return null;
  const regime = translateBillingType(proposal.billingType);
  const inicio = emDias(proposal.startOffsetDays ?? 0);

  if (proposal.billingType === 'RECURRING') {
    const duracao = proposal.durationMonths
      ? `por ${proposal.durationMonths} ${proposal.durationMonths === 1 ? 'mês' : 'meses'}`
      : 'por tempo indeterminado';
    return `${regime} — vencimento todo dia ${proposal.billingDay}, começando ${inicio}, ${duracao}`;
  }
  if (proposal.billingType === 'ONE_TIME') {
    return `${regime} — vencimento ${inicio}`;
  }
  const entrada =
    proposal.downPaymentPercent != null
      ? `entrada de ${Number(proposal.downPaymentPercent)}%`
      : proposal.downPaymentAmount != null
        ? `entrada de ${formatMoney(proposal.downPaymentAmount)}`
        : null;
  const partes = [
    entrada && `${entrada} ${emDias(proposal.downPaymentOffsetDays ?? 0)}`,
    // "começando", não "a partir de": `emDias` já devolve a preposição ("em 30
    // dias" / "no aceite"), e "a partir de em 30 dias" não é português.
    `${proposal.installments} parcelas começando ${inicio}`,
  ].filter(Boolean);
  return `${regime} — ${partes.join(' + ')}`;
}

/** "no aceite" / "em 1 dia" / "em 30 dias" — o offset lido em português. */
function emDias(dias: number): string {
  if (dias === 0) return 'no aceite';
  return `em ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
}
