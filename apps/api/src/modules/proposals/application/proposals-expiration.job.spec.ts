import { ProposalsExpirationJob } from './proposals-expiration.job';
import type { ProposalRepository } from '../domain/proposal.repository';
import type { AuditService } from '../../audit/audit.service';
import type { NotificationsService } from '../../notifications/notifications.service';
import { webhooksEmitterFake } from '../../webhooks/application/webhooks-emitter.mock';

function auditMock() {
  return { registrarPeloSistema: jest.fn().mockResolvedValue(undefined) };
}

function notificationsMock() {
  return { notificarPeloSistema: jest.fn().mockResolvedValue(undefined) };
}

describe('ProposalsExpirationJob', () => {
  it('chama expireOverdue com a data atual', async () => {
    const repo = {
      expireOverdue: jest.fn().mockResolvedValue([]),
    } as unknown as ProposalRepository;
    const job = new ProposalsExpirationJob(
      repo,
      auditMock() as unknown as AuditService,
      notificationsMock() as unknown as NotificationsService,
      webhooksEmitterFake(),
    );
    await job.run();
    expect(repo.expireOverdue).toHaveBeenCalledWith(expect.any(Date));
  });

  it('registra uma linha por proposta expirada, com o status anterior no diff', async () => {
    const repo = {
      expireOverdue: jest.fn().mockResolvedValue([
        {
          id: 'p1',
          ownerId: 'owner-a',
          number: 'PROP-2026-0001',
          status: 'SENT',
          clienteNome: 'Acme',
          assigneeId: 'u2',
          validUntil: new Date('2026-07-20'),
        },
        {
          id: 'p2',
          ownerId: 'owner-b',
          number: 'PROP-2026-0002',
          status: 'NEGOTIATING',
          clienteNome: 'Beta',
          assigneeId: null,
          validUntil: new Date('2026-07-21'),
        },
      ]),
    } as unknown as ProposalRepository;
    const audit = auditMock();
    const job = new ProposalsExpirationJob(
      repo,
      audit as unknown as AuditService,
      notificationsMock() as unknown as NotificationsService,
      webhooksEmitterFake(),
    );

    await job.run();

    expect(audit.registrarPeloSistema).toHaveBeenCalledTimes(2);
    expect(audit.registrarPeloSistema).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'owner-a',
        actorType: 'CRON',
        actorName: 'Rotina diária',
        entity: 'PROPOSAL',
        entityId: 'p1',
        entityLabel: 'PROP-2026-0001',
        action: 'EXPIRAR',
        antes: { status: 'SENT' },
        depois: { status: 'EXPIRED' },
      }),
    );
    expect(audit.registrarPeloSistema).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'owner-b',
        antes: { status: 'NEGOTIATING' },
      }),
    );
  });

  it('notifica uma vez por proposta, com o userId derivado e o dedupeKey de "já expirou"', async () => {
    const repo = {
      expireOverdue: jest.fn().mockResolvedValue([
        {
          id: 'p1',
          ownerId: 'owner-a',
          number: 'PROP-2026-0001',
          status: 'SENT',
          clienteNome: 'Acme',
          assigneeId: 'u2',
          validUntil: new Date('2026-07-20'),
        },
      ]),
    } as unknown as ProposalRepository;
    const notifications = notificationsMock();
    const job = new ProposalsExpirationJob(
      repo,
      auditMock() as unknown as AuditService,
      notifications as unknown as NotificationsService,
      webhooksEmitterFake(),
    );

    await job.run();

    expect(notifications.notificarPeloSistema).toHaveBeenCalledTimes(1);
    expect(notifications.notificarPeloSistema).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'owner-a',
        userId: 'u2',
        // Chave distinta da do lembrete "vai expirar" — os dois avisos coexistem.
        dedupeKey: 'PROPOSAL_EXPIRED:p1',
        evento: expect.objectContaining({
          tipo: 'PROPOSAL_EXPIRING',
          entityId: 'p1',
          numero: 'PROP-2026-0001',
          clienteNome: 'Acme',
        }),
      }),
    );
  });

  it('cai no owner quando não há responsável derivável', async () => {
    const repo = {
      expireOverdue: jest.fn().mockResolvedValue([
        {
          id: 'p2',
          ownerId: 'owner-b',
          number: 'PROP-2026-0002',
          status: 'NEGOTIATING',
          clienteNome: 'Beta',
          assigneeId: null,
          validUntil: new Date('2026-07-21'),
        },
      ]),
    } as unknown as ProposalRepository;
    const notifications = notificationsMock();
    const job = new ProposalsExpirationJob(
      repo,
      auditMock() as unknown as AuditService,
      notifications as unknown as NotificationsService,
      webhooksEmitterFake(),
    );

    await job.run();

    expect(notifications.notificarPeloSistema).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'owner-b', userId: 'owner-b' }),
    );
  });
});
