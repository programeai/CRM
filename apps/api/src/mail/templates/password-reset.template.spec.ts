import { passwordResetEmail } from './password-reset.template';

describe('passwordResetEmail', () => {
  const input = {
    resetUrl: 'https://crm.programeai.com.br/redefinir-senha?token=abc123',
    appUrl: 'https://crm.programeai.com.br',
  };

  it('monta assunto, texto e HTML com o link de redefinição', () => {
    const email = passwordResetEmail(input);

    expect(email.subject).toBe('Redefinição de senha no CRM ProgrameAi');
    expect(email.text).toContain(input.resetUrl);
    expect(email.html).toContain(`href="${input.resetUrl}"`);
    expect(email.html).toContain('Redefinir senha');
  });

  it('escapa o link para não abrir espaço a injeção de HTML', () => {
    const email = passwordResetEmail({
      ...input,
      resetUrl: 'https://crm.programeai.com.br/r?token="><script>x</script>',
    });

    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it('usa o host do app no rodapé, sem o protocolo', () => {
    const email = passwordResetEmail(input);

    expect(email.html).toContain('>crm.programeai.com.br<');
  });
});
