import { UnprocessableEntityException } from '@nestjs/common';
import { WorkspaceMembersService } from './workspace-members.service';
import type { WorkspaceMemberRepository } from '../domain/workspace-member.repository';

describe('WorkspaceMembersService', () => {
  let repo: jest.Mocked<WorkspaceMemberRepository>;
  let service: WorkspaceMembersService;

  beforeEach(() => {
    repo = { findManyByOwner: jest.fn(), isMember: jest.fn() };
    service = new WorkspaceMembersService(repo);
  });

  it('aceita responsável ausente sem consultar o repositório', async () => {
    await expect(service.assertMember('o1', null)).resolves.toBeUndefined();
    await expect(
      service.assertMember('o1', undefined),
    ).resolves.toBeUndefined();
    expect(repo.isMember).not.toHaveBeenCalled();
  });

  it('rejeita responsável de fora da workspace com 422', async () => {
    repo.isMember.mockResolvedValue(false);
    await expect(
      service.assertMember('o1', 'u-de-outro-owner'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('aceita membro da workspace', async () => {
    repo.isMember.mockResolvedValue(true);
    await expect(service.assertMember('o1', 'u1')).resolves.toBeUndefined();
    expect(repo.isMember).toHaveBeenCalledWith('o1', 'u1');
  });

  it('lista os membros do owner', async () => {
    repo.findManyByOwner.mockResolvedValue([
      { id: 'o1', name: 'Dono', isOwner: true },
    ]);
    await expect(service.list('o1')).resolves.toEqual([
      { id: 'o1', name: 'Dono', isOwner: true },
    ]);
  });
});
