/**
 * Identificação de quem opera o serviço, usada pelos documentos legais públicos
 * (Termos de Uso e Política de Privacidade). Fica centralizado aqui para que os
 * dois documentos nunca divirjam entre si.
 *
 * Os dados societários vêm do contrato social da PROGRAMEAI LTDA (mesmos usados
 * nos contratos de prestação de serviço). Estes documentos são páginas públicas:
 * só entra aqui o que pode ser exibido a qualquer visitante — nunca CPF do
 * sócio, dado bancário ou e-mail pessoal.
 */
export const EMPRESA = {
  /** Marca / nome comercial. */
  nome: 'ProgrameAi',
  /** Nome do produto na instância hospedada. */
  produto: 'ProgrameAi CRM',

  /** Razão social da pessoa jurídica que opera o serviço hospedado. */
  razaoSocial: 'PROGRAMEAI LTDA',
  cnpj: '49.284.729/0001-26',
  endereco:
    'Avenida Francisco Mota, nº 99, Apt. 301 C — Alto de São Manoel, Mossoró/RN, CEP 59625-300',
  /** Sócio-administrador que representa a empresa. */
  representante: 'Edson César de Alencar',
  /** Comarca eleita como foro — a da sede, igual à dos contratos. */
  foro: 'Comarca de Mossoró/RN',

  /** Caixa de contato geral. Precisa existir e ser respondida. */
  emailContato: 'atendimento@programeai.com',
  /** Canal do encarregado de dados (LGPD, art. 41). Hoje é a mesma caixa. */
  emailPrivacidade: 'atendimento@programeai.com',
  /** Encarregado pelo tratamento de dados pessoais (DPO). */
  encarregado: 'Edson César de Alencar',

  dominio: 'crm.programeai.com.br',
  url: 'https://crm.programeai.com.br',
  repositorio: 'https://github.com/Edsonalencar/CRM',
} as const;

/** Data de vigência exibida nos dois documentos. Atualize a cada revisão. */
export const ATUALIZADO_EM = '28 de julho de 2026';

/** Preço vigente do plano hospedado, citado nos Termos. */
export const PRECO_PLANO = 'R$ 27,97 por mês';

/** Duração do período de teste concedido no cadastro. */
export const DIAS_DE_TESTE = 14;
