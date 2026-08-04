/**
 * Finalidades de tratamento com base em consentimento. **Uma linha de
 * `ConsentRecord` por finalidade** — art. 8º § 4º: *"O consentimento deverá
 * referir-se a finalidades determinadas, e as autorizações genéricas para o
 * tratamento de dados pessoais serão nulas."* Um "aceito tudo" agregado seria
 * nulo por lei, e é por isso que não existe um booleano só.
 *
 * O que **não** entra aqui: a execução do contrato e os procedimentos
 * preliminares a pedido do titular (art. 7º, V). Cobrança, aviso de vencimento e
 * resposta a um pedido de proposta **não dependem de consentimento**, e pedir
 * consentimento para eles ensinaria errado a quem usa. Art. 7º § 6º fecha o outro
 * lado: a dispensa do consentimento não dispensa as demais obrigações.
 */
export const CONSENT_PURPOSES = [
  {
    key: 'comunicacao_marketing',
    label: 'Comunicação de marketing',
    description:
      'Enviar oferta, novidade e conteúdo promocional que o titular não pediu',
  },
  {
    key: 'comunicacao_whatsapp',
    label: 'Contato por WhatsApp',
    description:
      'Falar com o titular por WhatsApp fora do atendimento que ele iniciou',
  },
  {
    key: 'compartilhamento_terceiro',
    label: 'Compartilhamento com terceiro',
    description:
      'Repassar os dados a parceiro ou fornecedor. Art. 7º § 5º exige consentimento ESPECÍFICO e separado',
  },
  {
    key: 'retencao_pos_contrato',
    label: 'Retenção após o fim do contrato',
    description:
      'Guardar o histórico depois de encerrada a relação, para retomada futura',
  },
] as const;

export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number]['key'];

const CHAVES = new Set<string>(CONSENT_PURPOSES.map((p) => p.key));

export function ehFinalidade(valor: string): valor is ConsentPurpose {
  return CHAVES.has(valor);
}
