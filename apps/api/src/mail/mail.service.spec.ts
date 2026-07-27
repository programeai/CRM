import type { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { MailService } from './mail.service';

// A fronteira externa é o nodemailer — é ele que é mockado. Mockar o
// `MailService` aqui seria testar o mock (apps/api/CLAUDE.md:100-111).
jest.mock('nodemailer');

const criarTransport = nodemailer.createTransport as jest.MockedFunction<
  typeof nodemailer.createTransport
>;

/** ConfigService mínimo: só o `get` que o service consulta. */
function configMock(valores: Record<string, unknown>): ConfigService {
  return {
    get: (chave: string) => valores[chave],
  } as unknown as ConfigService;
}

const CONTEUDO = { subject: 'Assunto', text: 'Texto', html: '<p>HTML</p>' };

describe('MailService', () => {
  let sendMail: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    sendMail = jest.fn().mockResolvedValue(undefined);
    criarTransport.mockReturnValue({ sendMail } as never);
  });

  describe('sem SMTP_HOST (serviço opcional desligado)', () => {
    it('sendNotification devolve disabled e NÃO cria transporter', async () => {
      const service = new MailService(configMock({}));

      await expect(
        service.sendNotification('a@b.com', CONTEUDO),
      ).resolves.toEqual({ status: 'disabled' });
      expect(criarTransport).not.toHaveBeenCalled();
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('sendPasswordReset emite email.smtp_desabilitado', async () => {
      const service = new MailService(configMock({}));
      const warnSpy = jest
        .spyOn(
          (service as unknown as { logger: { warn: jest.Mock } }).logger,
          'warn',
        )
        .mockImplementation(() => undefined);

      await service.sendPasswordReset('a@b.com', 'https://crm/r?token=x');

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ evento: 'email.smtp_desabilitado' }),
      );
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('em produção, o log do SMTP desabilitado NÃO inclui a resetUrl', async () => {
      const anterior = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const service = new MailService(configMock({}));
        const warnSpy = jest
          .spyOn(
            (service as unknown as { logger: { warn: jest.Mock } }).logger,
            'warn',
          )
          .mockImplementation(() => undefined);

        await service.sendPasswordReset(
          'a@b.com',
          'https://crm/r?token=SEGREDO',
        );

        const [linha] = warnSpy.mock.calls[0] as [Record<string, unknown>];
        expect(linha).not.toHaveProperty('resetUrl');
        expect(JSON.stringify(linha)).not.toContain('SEGREDO');
      } finally {
        process.env.NODE_ENV = anterior;
      }
    });
  });

  describe('com SMTP configurado', () => {
    const config = configMock({
      SMTP_HOST: 'smtp.teste.local',
      SMTP_PORT: 2525,
      SMTP_USER: 'usuario',
      SMTP_PASSWORD: 'senha',
      MAIL_FROM: 'crm@programeai.com.br',
      FRONTEND_URL: 'https://crm.programeai.com.br',
    });

    it('sendMail recebe from/to/subject/text/html', async () => {
      const service = new MailService(config);

      await expect(
        service.sendNotification('a@b.com', CONTEUDO),
      ).resolves.toEqual({ status: 'sent' });
      expect(sendMail).toHaveBeenCalledWith({
        from: 'crm@programeai.com.br',
        to: 'a@b.com',
        subject: 'Assunto',
        text: 'Texto',
        html: '<p>HTML</p>',
      });
    });

    it('o transporter é criado UMA vez em dois envios (lazy e memoizado)', async () => {
      const service = new MailService(config);

      await service.sendNotification('a@b.com', CONTEUDO);
      await service.sendDigest('c@d.com', CONTEUDO);

      expect(criarTransport).toHaveBeenCalledTimes(1);
      expect(sendMail).toHaveBeenCalledTimes(2);
    });

    it('sendNotification PROPAGA a exceção do SMTP (é o que alimenta o retry)', async () => {
      sendMail.mockRejectedValue(new Error('conexão recusada'));
      const service = new MailService(config);

      await expect(
        service.sendNotification('a@b.com', CONTEUDO),
      ).rejects.toThrow('conexão recusada');
    });

    it('sendPasswordReset NÃO propaga e emite email.envio_falhou', async () => {
      sendMail.mockRejectedValue(new Error('conexão recusada'));
      const service = new MailService(config);
      const errorSpy = jest
        .spyOn(
          (service as unknown as { logger: { error: jest.Mock } }).logger,
          'error',
        )
        .mockImplementation(() => undefined);

      await expect(
        service.sendPasswordReset('a@b.com', 'https://crm/r?token=x'),
      ).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ evento: 'email.envio_falhou' }),
        expect.any(String),
      );
    });

    it('sendCollaboratorInvite NÃO propaga e emite email.envio_falhou', async () => {
      sendMail.mockRejectedValue(new Error('conexão recusada'));
      const service = new MailService(config);
      const errorSpy = jest
        .spyOn(
          (service as unknown as { logger: { error: jest.Mock } }).logger,
          'error',
        )
        .mockImplementation(() => undefined);

      await expect(
        service.sendCollaboratorInvite({
          to: 'a@b.com',
          name: 'Ana',
          ownerName: 'Edson',
          roleName: 'Comercial',
          inviteUrl: 'https://crm/convite/x',
        }),
      ).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ evento: 'email.envio_falhou' }),
        expect.any(String),
      );
    });
  });
});
