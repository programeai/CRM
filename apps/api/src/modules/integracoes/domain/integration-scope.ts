/**
 * Escopos de chave de integração — o que uma chave PODE fazer. Fonte única,
 * consumida pelo service (validação), pela API (resposta) e pelo front (rótulo).
 *
 * Não é permissão de pessoa: permissão limita quem usa o CRM pela interface
 * (`shared/permissions.ts`); escopo limita o que uma credencial de máquina
 * alcança. Os dois catálogos são independentes de propósito — a chave não é
 * "um usuário robô".
 */
export const INTEGRATION_SCOPES = [
  {
    key: 'lead:receber',
    label: 'Receber lead',
    description:
      'Entregar lead capturado fora do CRM (site, landing page, automação)',
  },
] as const;

export type IntegrationScope = (typeof INTEGRATION_SCOPES)[number]['key'];

/** O escopo da ingestão de lead. Importado pelo módulo `leads`. */
export const ESCOPO_RECEBER_LEAD: IntegrationScope = 'lead:receber';

const CHAVES = new Set<string>(INTEGRATION_SCOPES.map((e) => e.key));

export function isIntegrationScope(valor: string): valor is IntegrationScope {
  return CHAVES.has(valor);
}
