import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Cifra simétrica autenticada para segredo que precisa ser RECUPERADO em claro
 * (hoje: o segredo TOTP). AES-256-GCM porque a OWASP Cryptographic Storage põe
 * GCM/CCM como primeira preferência para dado recuperável, e porque o modo
 * autenticado detecta adulteração — sem ele, um byte trocado no banco viraria um
 * segredo diferente e silenciosamente errado.
 *
 * `keyVersion` viaja com o dado, e não é enfeite: *"It is important that the code
 * and processes required to rotate a key are in place before they are required."*
 * Com a versão gravada, rotacionar é acrescentar a chave nova, decifrar pela
 * versão de cada linha e recifrar em background — sem ela, rotacionar significa
 * invalidar o 2FA de todo mundo de uma vez.
 *
 * **Não use isto para senha.** Senha não é recuperável: é `argon2` e ponto. Isto
 * existe só para o caso em que o valor em claro é obrigatório na verificação.
 */
export interface SegredoCifrado {
  ciphertext: string; // hex
  iv: string; // hex, 12 bytes (o recomendado para GCM)
  tag: string; // hex, 16 bytes
  keyVersion: number;
}

/** A versão que as linhas NOVAS recebem. Rotação: suba isto e mapeie a chave. */
export const VERSAO_DA_CHAVE_ATUAL = 1;

/** 12 bytes é o tamanho de nonce recomendado para GCM (NIST SP 800-38D). */
const TAMANHO_DO_IV = 12;
/** 32 bytes = AES-256. A chave chega em hex, com 64 caracteres. */
const TAMANHO_DA_CHAVE = 32;

function chaveEmBytes(chaveHex: string): Buffer {
  const bytes = Buffer.from(chaveHex, 'hex');
  if (bytes.length !== TAMANHO_DA_CHAVE) {
    // Erro de configuração, não de dado: melhor estourar alto do que cifrar com
    // uma chave curta e só descobrir no dia em que o backup vazar.
    throw new Error(
      `Chave de cifra inválida: esperados ${TAMANHO_DA_CHAVE} bytes em hex (${TAMANHO_DA_CHAVE * 2} caracteres).`,
    );
  }
  return bytes;
}

export function cifrarSegredo(claro: string, chaveHex: string): SegredoCifrado {
  // IV aleatório por operação. Reusar IV em GCM é catastrófico (revela o XOR dos
  // claros e permite forjar tag), e é o erro mais comum do modo.
  const iv = randomBytes(TAMANHO_DO_IV);
  const cipher = createCipheriv('aes-256-gcm', chaveEmBytes(chaveHex), iv);
  const ciphertext = Buffer.concat([
    cipher.update(claro, 'utf8'),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString('hex'),
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    keyVersion: VERSAO_DA_CHAVE_ATUAL,
  };
}

/**
 * Decifra e **verifica a tag**. Tag que não casa faz o `final()` lançar — é o que
 * transforma adulteração no banco em erro alto, em vez de num segredo diferente
 * e silenciosamente errado.
 */
export function decifrarSegredo(
  guardado: SegredoCifrado,
  chaveHex: string,
): string {
  if (guardado.keyVersion !== VERSAO_DA_CHAVE_ATUAL) {
    throw new Error(
      `Versão de chave de cifra desconhecida (${guardado.keyVersion}): não há como decifrar este segredo com a chave atual.`,
    );
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    chaveEmBytes(chaveHex),
    Buffer.from(guardado.iv, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(guardado.tag, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(guardado.ciphertext, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}
