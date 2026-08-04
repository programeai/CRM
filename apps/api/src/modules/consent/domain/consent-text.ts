import type { ConsentPurpose } from './consent-purpose';

/**
 * O texto apresentado ao titular, versionado. O `textVersion` da linha aponta
 * para uma entrada daqui, e é o que responde **"a QUE ele consentiu"**.
 *
 * **Nunca edite um texto no lugar.** Art. 8º § 6º e art. 9º § 1º: alterar a
 * informação obriga a re-informar com destaque e faculta ao titular revogar. Texto
 * mudou = versão nova, e as linhas antigas continuam apontando para a versão
 * antiga — que é exatamente a prova que o § 2º cobra.
 *
 * Cada texto cobre o que o art. 9º manda ter sido informado: I finalidade
 * específica, II forma e duração, III controlador, IV contato, V uso
 * compartilhado, VI responsabilidades, VII direitos do art. 18.
 *
 * `{controlador}` e `{contato}` são substituídos na exibição pelo nome e pelo
 * e-mail do owner: o **controlador desses dados é o owner**, não a ProgrameAi (que
 * é operadora). Codificar o nome aqui faria o texto mentir em toda instância.
 */
export interface TextoDeConsentimento {
  purpose: ConsentPurpose;
  /** `AAAA-MM-N`. Nunca reutilizada, nunca editada. */
  version: string;
  text: string;
}

export const CONSENT_TEXTS: readonly TextoDeConsentimento[] = [
  {
    purpose: 'comunicacao_marketing',
    version: '2026-08-1',
    text: `Autorizo {controlador} a me enviar comunicações de marketing — ofertas, novidades e conteúdo promocional — pelos meios de contato que informei (e-mail, telefone, WhatsApp).

Finalidade: divulgação de produtos e serviços de {controlador}.
Forma e duração: os dados de contato ficam guardados no CRM de {controlador} enquanto esta autorização valer.
Controlador: {controlador}. Contato para assuntos de dados: {contato}.
Uso compartilhado: não há compartilhamento com terceiros por esta autorização.
Meus direitos: posso, a qualquer momento e sem custo, confirmar o tratamento, acessar, corrigir, pedir a eliminação, pedir a portabilidade e REVOGAR esta autorização, bastando comunicar {contato}. A revogação não desfaz o que foi feito enquanto ela valia.`,
  },
  {
    purpose: 'comunicacao_whatsapp',
    version: '2026-08-1',
    text: `Autorizo {controlador} a me contatar por WhatsApp, inclusive fora de um atendimento que eu tenha iniciado.

Finalidade: contato comercial e de relacionamento por WhatsApp.
Forma e duração: o número informado fica guardado no CRM de {controlador} enquanto esta autorização valer.
Controlador: {controlador}. Contato para assuntos de dados: {contato}.
Uso compartilhado: não há compartilhamento com terceiros por esta autorização.
Meus direitos: posso, a qualquer momento e sem custo, confirmar o tratamento, acessar, corrigir, pedir a eliminação, pedir a portabilidade e REVOGAR esta autorização, bastando comunicar {contato}. A revogação não desfaz o que foi feito enquanto ela valia.`,
  },
  {
    purpose: 'compartilhamento_terceiro',
    version: '2026-08-1',
    text: `Autorizo {controlador} a compartilhar os meus dados de contato e do meu atendimento com parceiros e fornecedores dele, para a execução dos serviços contratados ou propostos.

Finalidade: viabilizar a prestação do serviço com apoio de parceiro ou fornecedor.
Forma e duração: os dados são repassados apenas ao parceiro envolvido, e enquanto esta autorização valer.
Controlador: {controlador}. Contato para assuntos de dados: {contato}.
Uso compartilhado: ESTA autorização é especificamente sobre o compartilhamento (art. 7º, § 5º da LGPD). Ela é separada das demais e não decorre de nenhuma outra.
Meus direitos: posso, a qualquer momento e sem custo, confirmar o tratamento, acessar, corrigir, pedir a eliminação, pedir a portabilidade e REVOGAR esta autorização, bastando comunicar {contato}. A revogação não desfaz o que foi feito enquanto ela valia.`,
  },
  {
    purpose: 'retencao_pos_contrato',
    version: '2026-08-1',
    text: `Autorizo {controlador} a manter o meu histórico de atendimento depois de encerrada a nossa relação, para o caso de eu voltar a contratar.

Finalidade: preservar o histórico para retomada futura, sem que eu precise repetir informações.
Forma e duração: os dados ficam no CRM de {controlador} enquanto esta autorização valer.
Controlador: {controlador}. Contato para assuntos de dados: {contato}.
Uso compartilhado: não há compartilhamento com terceiros por esta autorização.
Meus direitos: posso, a qualquer momento e sem custo, confirmar o tratamento, acessar, corrigir, pedir a eliminação, pedir a portabilidade e REVOGAR esta autorização, bastando comunicar {contato}. A revogação não desfaz o que foi feito enquanto ela valia.`,
  },
];

/**
 * O texto VIGENTE de uma finalidade — sempre a última versão do catálogo. É ele
 * que o service grava em `textVersion`, e é ele que a tela exibe antes de
 * registrar: aceitar a versão pelo corpo da requisição deixaria registrar
 * consentimento a um texto que nunca foi mostrado, o que é o oposto de comprovar.
 */
export function textoVigente(purpose: ConsentPurpose): TextoDeConsentimento {
  const todos = CONSENT_TEXTS.filter((t) => t.purpose === purpose);
  const vigente = todos.at(-1);
  if (!vigente) {
    // Finalidade no catálogo sem texto é bug de código, não entrada de usuário:
    // registrar consentimento sem texto seria registrar prova de nada.
    throw new Error(`Finalidade sem texto de consentimento: ${purpose}`);
  }
  return vigente;
}

/**
 * Aplica o nome e o contato do controlador ao texto. O **controlador desses dados
 * é o owner**, não a ProgrameAi — que é operadora. Ver o docblock do arquivo.
 */
export function textoPreenchido(
  texto: TextoDeConsentimento,
  controlador: { nome: string; contato: string },
): string {
  return texto.text
    .replaceAll('{controlador}', controlador.nome)
    .replaceAll('{contato}', controlador.contato);
}
