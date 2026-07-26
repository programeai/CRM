/**
 * Funil padrão de uma conta nova. **Não** é um catálogo global: é o ponto de
 * partida copiado para cada owner na criação da conta (ver `UsersService`), que
 * depois renomeia, reordena, acrescenta e exclui livremente.
 *
 * Fonte única — consumida pelo provisionamento da conta e pelo `prisma/seed.ts`.
 * A migration 20260726120000_pipeline_stages_per_owner replicou esta mesma lista
 * (via o template global que existia) para os owners anteriores ao deploy.
 */
export const DEFAULT_PIPELINE_STAGES = [
  { name: 'Novo lead', isWon: false, isLost: false },
  { name: 'Contato feito', isWon: false, isLost: false },
  { name: 'Reunião/Diagnóstico', isWon: false, isLost: false },
  { name: 'Proposta enviada', isWon: false, isLost: false },
  { name: 'Negociação', isWon: false, isLost: false },
  { name: 'Ganhou', isWon: true, isLost: false },
  { name: 'Perdeu', isWon: false, isLost: true },
] as const;

/** A mesma lista com `order` sequencial — pronta para um nested create. */
export function defaultPipelineStages(): {
  name: string;
  order: number;
  isWon: boolean;
  isLost: boolean;
}[] {
  return DEFAULT_PIPELINE_STAGES.map((stage, order) => ({ ...stage, order }));
}
