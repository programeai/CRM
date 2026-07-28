import { AccountPurgeJob } from './account-purge.job';
import type { AccountPurgeRepository } from '../domain/account-purge.repository';
import type { BillingService } from '../../billing/application/billing.service';
import type { AuditService } from '../../audit/audit.service';

describe('AccountPurgeJob', () => {
  let repo: jest.Mocked<AccountPurgeRepository>;
  let billing: {
    agendarCancelamentoPorEncerramento: jest.Mock;
    cancelarAgoraPorExpurgo: jest.Mock;
  };
  let audit: { registrarPeloSistema: jest.Mock };
  let job: AccountPurgeJob;

  beforeEach(() => {
    repo = {
      vencidos: jest.fn().mockResolvedValue([]),
      pendentesDeCancelamento: jest.fn().mockResolvedValue([]),
      expurgar: jest.fn().mockResolvedValue({ conta: 1 }),
    };
    billing = {
      agendarCancelamentoPorEncerramento: jest.fn().mockResolvedValue(true),
      cancelarAgoraPorExpurgo: jest.fn().mockResolvedValue(true),
    };
    audit = { registrarPeloSistema: jest.fn().mockResolvedValue(undefined) };
    job = new AccountPurgeJob(
      repo,
      billing as unknown as BillingService,
      audit as unknown as AuditService,
    );
  });

  it('sem vencidos, não chama expurgar nem registrarPeloSistema', async () => {
    await job.run();
    expect(repo.expurgar).not.toHaveBeenCalled();
    expect(audit.registrarPeloSistema).not.toHaveBeenCalled();
  });

  it('com um vencido, chama cancelarAgoraPorExpurgo ANTES de expurgar, e registrarPeloSistema DEPOIS', async () => {
    repo.vencidos.mockResolvedValue([
      { id: 'owner-1', deletionRequestedAt: new Date('2026-07-01') },
    ]);
    const ordem: string[] = [];
    billing.cancelarAgoraPorExpurgo.mockImplementation(() => {
      ordem.push('cancelarStripe');
      return Promise.resolve(true);
    });
    repo.expurgar.mockImplementation(() => {
      ordem.push('expurgar');
      return Promise.resolve({ conta: 1, clientes: 3 });
    });
    audit.registrarPeloSistema.mockImplementation(() => {
      ordem.push('trilha');
      return Promise.resolve(undefined);
    });

    await job.run();

    expect(ordem).toEqual(['cancelarStripe', 'expurgar', 'trilha']);
    expect(audit.registrarPeloSistema).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'owner-1',
        actorType: 'CRON',
        entity: 'ACCOUNT',
        action: 'EXPURGAR',
        extra: expect.objectContaining({
          linhasPorTabela: { conta: 1, clientes: 3 },
        }),
      }),
    );
  });

  it('Stripe lançando: expurgar NÃO é chamado, o owner é pulado, o próximo é processado', async () => {
    repo.vencidos.mockResolvedValue([
      { id: 'owner-falha', deletionRequestedAt: new Date() },
      { id: 'owner-ok', deletionRequestedAt: new Date() },
    ]);
    billing.cancelarAgoraPorExpurgo.mockImplementation((ownerId: string) =>
      ownerId === 'owner-falha'
        ? Promise.reject(new Error('Stripe indisponível'))
        : Promise.resolve(true),
    );

    await job.run();

    expect(repo.expurgar).toHaveBeenCalledTimes(1);
    expect(repo.expurgar).toHaveBeenCalledWith('owner-ok');
  });

  it('extra.linhasPorTabela não contém e-mail nem nome', async () => {
    repo.vencidos.mockResolvedValue([
      { id: 'owner-1', deletionRequestedAt: new Date() },
    ]);
    repo.expurgar.mockResolvedValue({ conta: 1, clientes: 2 });

    await job.run();

    const [{ extra }] = audit.registrarPeloSistema.mock.calls[0] as [
      { extra: { linhasPorTabela: Record<string, number> } },
    ];
    expect(JSON.stringify(extra.linhasPorTabela)).not.toContain('@');
    expect(extra.linhasPorTabela).toEqual({ conta: 1, clientes: 2 });
  });
});
