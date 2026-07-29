import { digestEmail } from './digest.template';

const appUrl = 'https://crm.programeai.com.br';

describe('digestEmail', () => {
  it('agrupa por tipo, com a contagem de cada grupo no cabeçalho', () => {
    const email = digestEmail({
      appUrl,
      itens: [
        { grupo: 'Cobrança a vencer', titulo: 'T1', corpo: 'Cobrança 1.' },
        { grupo: 'Cobrança a vencer', titulo: 'T2', corpo: 'Cobrança 2.' },
        { grupo: 'Demanda atrasada', titulo: 'T3', corpo: 'Demanda 1.' },
      ],
    });

    expect(email.subject).toBe(
      'Seu resumo do dia: 3 novidades — ProgrameAi CRM',
    );
    expect(email.html).toContain('Cobrança a vencer (2)');
    expect(email.html).toContain('Demanda atrasada (1)');
    expect(email.text).toContain('Cobrança a vencer (2)');
  });

  it('usa o singular com um único item', () => {
    const email = digestEmail({
      appUrl,
      itens: [{ grupo: 'Atribuído a você', titulo: 'T', corpo: 'Corpo.' }],
    });

    expect(email.subject).toBe(
      'Seu resumo do dia: 1 novidade — ProgrameAi CRM',
    );
    expect(email.html).toContain('1 novidade');
  });

  it('mostra no máximo 5 itens por grupo e resume o resto', () => {
    const email = digestEmail({
      appUrl,
      itens: Array.from({ length: 8 }, (_, i) => ({
        grupo: 'Demanda atrasada',
        titulo: `T${i}`,
        corpo: `Demanda ${i}.`,
      })),
    });

    expect(email.html).toContain('Demanda 4.');
    expect(email.html).not.toContain('Demanda 5.');
    expect(email.html).toContain('e mais 3 itens.');
  });

  it('escapa o dado de negócio — corpo com script sai inerte', () => {
    const email = digestEmail({
      appUrl,
      itens: [
        {
          grupo: 'Cobrança a vencer',
          titulo: 'T',
          corpo: 'Cliente <script>alert(1)</script> deve R$ 10,00.',
        },
      ],
    });

    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it('inclui o botão para a central', () => {
    const email = digestEmail({
      appUrl,
      itens: [{ grupo: 'Atribuído a você', titulo: 'T', corpo: 'Corpo.' }],
    });

    expect(email.html).toContain('Abrir o CRM');
    expect(email.html).toContain(`href="${appUrl}"`);
  });
});
