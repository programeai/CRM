import { randomBytes } from 'node:crypto';
import {
  cifrarSegredo,
  decifrarSegredo,
  VERSAO_DA_CHAVE_ATUAL,
} from './segredo-cifrado';

/*
  Instancia o `node:crypto` de verdade — é a regra do `apps/api/CLAUDE.md`: classe
  que fala com infraestrutura direto tem spec que a exercita, porque para o
  adapter em si o mock testa o mock.
*/
const CHAVE = randomBytes(32).toString('hex');
const OUTRA_CHAVE = randomBytes(32).toString('hex');
const SEGREDO = 'JBSWY3DPEHPK3PXP';

describe('segredo cifrado (AES-256-GCM)', () => {
  it('ida e volta preserva o valor exatamente', () => {
    const guardado = cifrarSegredo(SEGREDO, CHAVE);
    expect(decifrarSegredo(guardado, CHAVE)).toBe(SEGREDO);
  });

  it('o valor em claro não aparece em nenhum campo do que é guardado', () => {
    const guardado = cifrarSegredo(SEGREDO, CHAVE);
    expect(JSON.stringify(guardado)).not.toContain(SEGREDO);
  });

  it('grava a versão da chave junto do dado — é o que permite rotacionar depois', () => {
    expect(cifrarSegredo(SEGREDO, CHAVE).keyVersion).toBe(
      VERSAO_DA_CHAVE_ATUAL,
    );
  });

  /*
    Reusar IV em GCM é catastrófico: revela o XOR dos claros e permite forjar tag.
    Este caso trava o IV aleatório por operação.
  */
  it('dois cifrar do MESMO claro produzem ciphertext e IV diferentes', () => {
    const a = cifrarSegredo(SEGREDO, CHAVE);
    const b = cifrarSegredo(SEGREDO, CHAVE);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    // …e as duas decifram para o mesmo valor.
    expect(decifrarSegredo(a, CHAVE)).toBe(decifrarSegredo(b, CHAVE));
  });

  it('formato: IV de 12 bytes e tag de 16 bytes, em hex', () => {
    const guardado = cifrarSegredo(SEGREDO, CHAVE);
    expect(guardado.iv).toMatch(/^[0-9a-f]{24}$/);
    expect(guardado.tag).toMatch(/^[0-9a-f]{32}$/);
  });

  /*
    O modo autenticado é o ponto: sem verificação de tag, um byte trocado no banco
    viraria um segredo DIFERENTE e silenciosamente errado, e o 2FA passaria a
    recusar todo código sem ninguém saber por quê.
  */
  it('tag adulterada faz decifrar LANÇAR, não devolver lixo', () => {
    const guardado = cifrarSegredo(SEGREDO, CHAVE);
    const tagRuim = {
      ...guardado,
      tag: guardado.tag.replace(/^./, (c) => (c === '0' ? '1' : '0')),
    };
    expect(() => decifrarSegredo(tagRuim, CHAVE)).toThrow();
  });

  it('ciphertext adulterado faz decifrar LANÇAR', () => {
    const guardado = cifrarSegredo(SEGREDO, CHAVE);
    const corpoRuim = {
      ...guardado,
      ciphertext: guardado.ciphertext.replace(/^./, (c) =>
        c === '0' ? '1' : '0',
      ),
    };
    expect(() => decifrarSegredo(corpoRuim, CHAVE)).toThrow();
  });

  it('chave errada faz decifrar LANÇAR', () => {
    const guardado = cifrarSegredo(SEGREDO, CHAVE);
    expect(() => decifrarSegredo(guardado, OUTRA_CHAVE)).toThrow();
  });

  it('keyVersion desconhecida lança com mensagem clara, antes de tentar decifrar', () => {
    const guardado = { ...cifrarSegredo(SEGREDO, CHAVE), keyVersion: 99 };
    expect(() => decifrarSegredo(guardado, CHAVE)).toThrow(
      /Versão de chave de cifra desconhecida \(99\)/,
    );
  });

  it('chave fora de 32 bytes é erro de CONFIGURAÇÃO, e estoura alto', () => {
    expect(() => cifrarSegredo(SEGREDO, 'abcd')).toThrow(
      /Chave de cifra inválida/,
    );
    expect(() =>
      cifrarSegredo(SEGREDO, randomBytes(16).toString('hex')),
    ).toThrow(/Chave de cifra inválida/);
  });
});
