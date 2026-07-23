import { ProposalsExpirationJob } from './proposals-expiration.job';
import type { ProposalRepository } from '../domain/proposal.repository';

describe('ProposalsExpirationJob', () => {
  it('chama expireOverdue com a data atual', async () => {
    const repo = {
      expireOverdue: jest.fn().mockResolvedValue(2),
    } as unknown as ProposalRepository;
    const job = new ProposalsExpirationJob(repo);
    await job.run();
    expect(repo.expireOverdue).toHaveBeenCalledWith(expect.any(Date));
  });
});
