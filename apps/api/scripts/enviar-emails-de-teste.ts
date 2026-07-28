/**
 * Verificação manual do fluxo de SMTP: prova o handshake/autenticação com o
 * servidor e envia, um a um, os cinco e-mails que o CRM dispara — usando os
 * templates reais, não uma cópia.
 *
 * Este script não é um teste automatizado: ele existe porque `MailService`
 * **engole** a falha nos fluxos de link (ver `mail.service.ts:118`), então em
 * produção um SMTP quebrado passa em silêncio. Aqui a falha aparece.
 *
 *   pnpm --filter api mail:test -- voce@exemplo.com
 *   pnpm --filter api mail:test -- voce@exemplo.com --only=digest
 *   pnpm --filter api mail:test -- voce@exemplo.com --dry-run --html=/tmp/emails
 *
 * Lê as mesmas variáveis que a API (`apps/api/.env`): SMTP_HOST, SMTP_PORT,
 * SMTP_SECURE, SMTP_USER, SMTP_PASSWORD, MAIL_FROM, FRONTEND_URL.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as dotenv from 'dotenv';
import * as nodemailer from 'nodemailer';
import { passwordResetEmail } from '../src/mail/templates/password-reset.template';
import type { EmailContent } from '../src/mail/templates/password-reset.template';
import { collaboratorInviteEmail } from '../src/mail/templates/collaborator-invite.template';
import { accountDeletionScheduledEmail } from '../src/mail/templates/account-deletion-scheduled.template';
import { notificationEmail } from '../src/mail/templates/notification.template';
import { digestEmail } from '../src/mail/templates/digest.template';

dotenv.config({ path: resolve(__dirname, '..', '.env') });

const out = (linha: string) => process.stdout.write(`${linha}\n`);

/** Os cinco e-mails do sistema, com dados de exemplo que estressam o escape. */
function catalogo(
  appUrl: string,
): Array<{ slug: string; conteudo: EmailContent }> {
  const token = 'TOKEN-DE-TESTE-NAO-FUNCIONAL';
  return [
    {
      slug: 'password-reset',
      conteudo: passwordResetEmail({
        resetUrl: `${appUrl}/redefinir-senha?token=${token}`,
        appUrl,
      }),
    },
    {
      slug: 'collaborator-invite',
      conteudo: collaboratorInviteEmail({
        name: 'Maria de Souza',
        ownerName: 'Agência ProgrameAi',
        roleName: 'Comercial',
        inviteUrl: `${appUrl}/convite?token=${token}`,
        appUrl,
      }),
    },
    {
      slug: 'notification',
      conteudo: notificationEmail({
        conteudo: {
          titulo: 'Proposta aceita',
          corpo:
            'A proposta #128 do cliente Café & Cia <Matriz> foi aceita por R$ 12.500,00.',
          link: '/propostas/128',
        },
        appUrl,
      }),
    },
    {
      slug: 'digest',
      conteudo: digestEmail({
        itens: [
          {
            grupo: 'Propostas',
            titulo: 'Proposta aceita',
            corpo: 'A proposta #128 do cliente Café & Cia foi aceita.',
          },
          {
            grupo: 'Propostas',
            titulo: 'Proposta expirada',
            corpo: 'A proposta #119 expirou sem resposta.',
          },
          {
            grupo: 'Financeiro',
            titulo: 'Cobrança vencida',
            corpo: 'A cobrança de R$ 3.200,00 do contrato #44 venceu ontem.',
          },
        ],
        appUrl,
      }),
    },
    {
      slug: 'account-deletion-scheduled',
      conteudo: accountDeletionScheduledEmail({
        scheduledFor: new Date('2026-08-27T12:00:00.000Z'),
        appUrl,
      }),
    },
  ];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const destino = args.find((a) => !a.startsWith('--'));
  const only = args.find((a) => a.startsWith('--only='))?.split('=')[1];
  const htmlDir = args.find((a) => a.startsWith('--html='))?.split('=')[1];
  const dryRun = args.includes('--dry-run');
  const verifyOnly = args.includes('--verify');

  if (!destino && !dryRun && !verifyOnly) {
    out(
      'Uso: pnpm --filter api mail:test -- <destino@exemplo.com> [--only=slug] [--dry-run] [--html=/caminho]',
    );
    process.exitCode = 1;
    return;
  }

  const appUrl = process.env.FRONTEND_URL || 'https://crm.programeai.com.br';
  const from =
    process.env.MAIL_FROM || process.env.SMTP_USER || 'no-reply@localhost';
  const host = process.env.SMTP_HOST || '';

  const emails = catalogo(appUrl).filter((e) => !only || e.slug === only);
  if (emails.length === 0) {
    out(
      `Nenhum e-mail com slug "${only}". Slugs: ${catalogo(appUrl)
        .map((e) => e.slug)
        .join(', ')}`,
    );
    process.exitCode = 1;
    return;
  }

  if (htmlDir) {
    if (!existsSync(htmlDir)) mkdirSync(htmlDir, { recursive: true });
    for (const { slug, conteudo } of emails) {
      writeFileSync(join(htmlDir, `${slug}.html`), conteudo.html, 'utf8');
    }
    out(`HTML gravado em ${htmlDir} (${emails.length} arquivo(s)).`);
  }

  if (dryRun) {
    out('\n--dry-run: nada foi enviado. Assuntos gerados:');
    for (const { slug, conteudo } of emails)
      out(`  ${slug.padEnd(28)} ${conteudo.subject}`);
    return;
  }

  if (!host) {
    out(
      'SMTP_HOST vazio — o MailService está DESABILITADO e nada seria enviado pela API.',
    );
    process.exitCode = 1;
    return;
  }

  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: String(process.env.SMTP_SECURE ?? 'false') === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
    logger: process.env.SMTP_DEBUG === 'true',
    debug: process.env.SMTP_DEBUG === 'true',
  });

  out(
    `SMTP:    ${host}:${process.env.SMTP_PORT ?? 587} (secure=${process.env.SMTP_SECURE ?? 'false'})`,
  );
  out(`De:      ${from}`);
  out(`Para:    ${destino ?? '—'}`);
  out(`AppUrl:  ${appUrl}\n`);

  // 1) Handshake + autenticação. Falha aqui = credencial/porta/TLS errados,
  //    e nenhum e-mail vale a pena tentar.
  try {
    await transporter.verify();
    out('✔ Conexão e autenticação OK.\n');
  } catch (err) {
    out(
      `✘ Falha na conexão/autenticação SMTP: ${err instanceof Error ? err.message : String(err)}`,
    );
    transporter.close();
    process.exitCode = 1;
    return;
  }

  if (verifyOnly) {
    transporter.close();
    out('--verify: nada foi enviado.');
    return;
  }

  // 2) Um envio por template, com o resultado real do servidor.
  let falhas = 0;
  for (const { slug, conteudo } of emails) {
    try {
      const info = await transporter.sendMail({
        from,
        to: destino,
        subject: `[TESTE] ${conteudo.subject}`,
        text: conteudo.text,
        html: conteudo.html,
      });
      out(
        `✔ ${slug.padEnd(28)} aceito=${(info.accepted ?? []).join(',') || '—'} recusado=${(info.rejected ?? []).join(',') || '—'}`,
      );
      out(
        `  ${''.padEnd(28)} messageId=${info.messageId} resposta=${String(info.response ?? '').trim()}`,
      );
    } catch (err) {
      falhas++;
      out(
        `✘ ${slug.padEnd(28)} ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  transporter.close();
  out(`\n${emails.length - falhas}/${emails.length} enviado(s).`);
  if (falhas > 0) process.exitCode = 1;
}

void main();
