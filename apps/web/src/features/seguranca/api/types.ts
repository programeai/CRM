/** Estado do segundo fator, como a API o devolve. */
export interface StatusDoSegundoFator {
  /**
   * `false` = **a instância** não tem chave de cifra configurada e o 2FA não
   * existe aqui. Mesmo tratamento de SMTP e captcha: a tela explica, sem botão.
   */
  disponivel: boolean;
  /** `true` = o autenticador já foi confirmado e o login exige código. */
  ativo: boolean;
  codigosRestantes: number;
}

/** O material do cadastro: o MESMO segredo em três codificações. */
export interface CadastroDeSegundoFator {
  /** PNG em `data:` URI, para um `<img>`. */
  qrDataUrl: string;
  uri: string;
  /** Para quem digita à mão no app, em vez de ler o QR. */
  segredoBase32: string;
}

export interface CodigosDeRecuperacao {
  codigosDeRecuperacao: string[];
}

/** A senha **ou** um código válido do autenticador (OWASP ASVS 3.7.1). */
export interface Reautenticacao {
  password?: string;
  codigo?: string;
}
