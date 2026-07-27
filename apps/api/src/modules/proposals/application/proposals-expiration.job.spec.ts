import { ProposalsExpirationJob } from './proposals-expiration.job';
import type { ProposalRepository } from '../domain/proposal.repository';
import type { AuditService } from '../../audit/audit.service';

function auditMock() {
  return { registrarPeloSistema: jest.fn().mockResolvedValue(undefined) };
}

describe('ProposalsExpirationJob', () => {
  it('chama expireOverdue com a data atual', async () => {
    const repo = {
      expireOverdue: jest.fn().mockResolvedValue([]),
    } as unknown as ProposalRepository;
    const job = new ProposalsExpirationJob(
      repo,
      auditMock() as unknown as AuditService,
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
        },
        {
          id: 'p2',
          ownerId: 'owner-b',
          number: 'PROP-2026-0002',
          status: 'NEGOTIATING',
        },
      ]),
    } as unknown as ProposalRepository;
    const audit = auditMock();
    const job = new ProposalsExpirationJob(
      repo,
      audit as unknown as AuditService,
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
});
