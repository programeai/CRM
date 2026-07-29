import type { ContratoDerivado } from './proposal-plan';
import type { BillingPlan } from '../../../shared/billing-plan';

/**
 * O que a tela de conferência precisa para se desenhar inteira numa chamada:
 * a proposta (para o cabeçalho e o total), o plano em vigor (para preencher os
 * campos), o derivado (para a agenda) e os contratos que já existem na cadeia
 * (para desabilitar o botão em vez de deixar o usuário levar um 409).
 *
 * `derivado` é null quando a proposta não tem plano (histórico) — a tela abre
 * com os campos vazios e o usuário preenche à mão.
 */
export interface PreviaDeContrato {
  proposta: {
    id: string;
    number: string;
    version: number;
    status: string;
    total: unknown; // Decimal → string no JSON
    decidedAt: Date | null;
    clientId: string;
    client: { id: string; name: string };
  };
  plano: BillingPlan | null;
  derivado: ContratoDerivado | null;
  descricaoSugerida: string;
  contratosExistentes: {
    id: string;
    description: string;
    status: string;
    proposalId: string | null;
  }[];
}
