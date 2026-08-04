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
  {
    key: 'cliente:escrever',
    label: 'Criar clientes',
    description: 'Abrir cadastro de cliente ou lead na base da workspace',
  },
  {
    key: 'negociacao:escrever',
    label: 'Criar oportunidades',
    description: 'Abrir oportunidade no funil de um cliente existente',
  },
  {
    key: 'atividade:escrever',
    label: 'Registrar atividades',
    description:
      'Lançar atividade no histórico de um cliente (contato feito, reunião, follow-up)',
  },
  {
    key: 'tarefa:escrever',
    label: 'Criar demandas',
    description: 'Abrir demanda no quadro de um projeto existente',
  },
] as const;

export type IntegrationScope = (typeof INTEGRATION_SCOPES)[number]['key'];

/** O escopo da ingestão de lead. Importado pelo módulo `leads`. */
export const ESCOPO_RECEBER_LEAD: IntegrationScope = 'lead:receber';

const CHAVES = new Set<string>(INTEGRATION_SCOPES.map((e) => e.key));

export function isIntegrationScope(valor: string): valor is IntegrationScope {
  return CHAVES.has(valor);
}

/**
 * Os escopos que uma chave AVULSA (`POST /integracoes/chaves`) pode ter.
 * `lead:receber` fica de fora de propósito: chave com esse escopo e sem canal
 * gravaria lead sem roteamento nem fonte — o estado que a 17-A recusou, e a
 * razão pela qual a criação avulsa não existia. A restrição era do escopo de
 * lead, não da máquina.
 */
export const ESCOPOS_DA_API_PUBLICA = INTEGRATION_SCOPES.filter(
  (e) => e.key !== ESCOPO_RECEBER_LEAD,
).map((e) => e.key);

export function ehEscopoDaApiPublica(valor: string): boolean {
  return (ESCOPOS_DA_API_PUBLICA as string[]).includes(valor);
}
