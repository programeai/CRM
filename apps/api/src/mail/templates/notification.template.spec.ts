import { notificationEmail } from './notification.template';

describe('notificationEmail', () => {
  const appUrl = 'https://crm.programeai.com.br';

  it('monta assunto, texto e HTML com o corpo e o link absoluto', () => {
    const email = notificationEmail({
      conteudo: {
        titulo: 'Cobrança a vencer',
        corpo: 'Mensalidade 08/2026 de Acme, R$ 800,00, vence em 01/08/2026.',
        link: '/financeiro',
      },
      appUrl,
    });

    expect(email.subject).toBe('Cobrança a vencer — CRM ProgrameAi');
    expect(email.text).toContain('Mensalidade 08/2026 de Acme');
    expect(email.text).toContain(`${appUrl}/financeiro`);
    expect(email.html).toContain(`href="${appUrl}/financeiro"`);
    expect(email.html).toContain('Abrir no CRM');
  });

  it('sem link, não renderiza o botão', () => {
    const email = notificationEmail({
      conteudo: {
        titulo: 'Atribuíram a atividade a você',
        corpo: 'Você foi definido como responsável.',
        link: null,
      },
      appUrl,
    });

    expect(email.html).not.toContain('Abrir no CRM');
  });

  it('escapa o dado de negócio interpolado — título com script sai inerte', () => {
    const email = notificationEmail({
      conteudo: {
        titulo: 'Atribuíram <script>alert(1)</script> a você',
        corpo: 'Cliente <script>alert(2)</script> é o responsável.',
        link: null,
      },
      appUrl,
    });

    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it('não deixa barra dupla quando o appUrl termina em barra', () => {
    const email = notificationEmail({
      conteudo: { titulo: 'T', corpo: 'C', link: '/financeiro' },
      appUrl: 'https://crm.programeai.com.br/',
    });

    expect(email.html).toContain(
      'href="https://crm.programeai.com.br/financeiro"',
    );
  });
});
