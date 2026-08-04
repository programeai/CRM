import { createHmac } from 'node:crypto';
import {
  assinarCorpo,
  gerarSegredoDeWebhook,
  CABECALHO_ASSINATURA,
} from './webhook-signature';

describe('assinarCorpo', () => {
  const SEGREDO = 'whsec_0123456789abcdef';
  const TIMESTAMP = '1785000000';
  const CORPO = '{"tipo":"TASK_OVERDUE","titulo":"Demanda atrasada"}';

  it('assina HMAC-SHA256 sobre `<timestamp>.<body>`, em hex, com o prefixo sha256=', () => {
    // O vetor é recalculado aqui pelo `node:crypto` de propósito: o que o teste
    // trava é a FORMA da entrada (`timestamp` + `.` + corpo), que é o que o
    // receptor do outro lado precisa reproduzir. Um hex fixo no spec só
    // registraria o resultado, não a composição.
    const esperado = createHmac('sha256', SEGREDO)
      .update(`${TIMESTAMP}.${CORPO}`)
      .digest('hex');

    expect(assinarCorpo(SEGREDO, TIMESTAMP, CORPO)).toBe(`sha256=${esperado}`);
    expect(assinarCorpo(SEGREDO, TIMESTAMP, CORPO)).toMatch(
      /^sha256=[0-9a-f]{64}$/,
    );
  });

  it('o separador é um PONTO entre timestamp e corpo, não concatenação crua', () => {
    // Sem o ponto, `12` + `3{...}` e `123` + `{...}` assinariam igual: é o
    // separador que impede a ambiguidade.
    const semPonto = createHmac('sha256', SEGREDO)
      .update(`${TIMESTAMP}${CORPO}`)
      .digest('hex');
    expect(assinarCorpo(SEGREDO, TIMESTAMP, CORPO)).not.toBe(
      `sha256=${semPonto}`,
    );
  });

  it('a assinatura muda quando o timestamp muda', () => {
    expect(assinarCorpo(SEGREDO, TIMESTAMP, CORPO)).not.toBe(
      assinarCorpo(SEGREDO, '1785000001', CORPO),
    );
  });

  it('a assinatura muda quando UM byte do corpo muda', () => {
    const alterado = CORPO.replace('atrasada', 'atrasadb');
    expect(assinarCorpo(SEGREDO, TIMESTAMP, CORPO)).not.toBe(
      assinarCorpo(SEGREDO, TIMESTAMP, alterado),
    );
  });

  it('a assinatura muda quando o segredo muda', () => {
    expect(assinarCorpo(SEGREDO, TIMESTAMP, CORPO)).not.toBe(
      assinarCorpo('whsec_outro', TIMESTAMP, CORPO),
    );
  });

  it('o nome do cabeçalho é estável — mudá-lo quebra todo receptor', () => {
    expect(CABECALHO_ASSINATURA).toBe('X-CRM-Signature');
  });
});

describe('gerarSegredoDeWebhook', () => {
  it('gera 32 bytes em hex, com prefixo reconhecível num grep de segredo vazado', () => {
    expect(gerarSegredoDeWebhook()).toMatch(/^whsec_[0-9a-f]{64}$/);
  });

  it('não repete', () => {
    const amostra = new Set(
      Array.from({ length: 50 }, () => gerarSegredoDeWebhook()),
    );
    expect(amostra.size).toBe(50);
  });
});
