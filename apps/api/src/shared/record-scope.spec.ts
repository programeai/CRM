import type { AccessContext } from '../modules/access/domain/access-context';
import { assigneeScopeWhere, resolveAssigneeScope } from './record-scope';

describe('resolveAssigneeScope', () => {
  const access = (permissions: string[]): AccessContext => ({
    userId: 'u1',
    userName: 'Usuária',
    ownerId: 'o1',
    isOwner: false,
    roleId: 'r1',
    roleName: 'Comercial',
    permissions: permissions,
  });

  it('sem a chave ampla, restringe aos próprios e aos sem responsável', () => {
    expect(resolveAssigneeScope(access([]), 'oportunidade:ver_todas')).toEqual({
      kind: 'mineOrUnassigned',
      userId: 'u1',
    });
  });

  it('com a chave ampla, não restringe', () => {
    expect(
      resolveAssigneeScope(
        access(['oportunidade:ver_todas']),
        'oportunidade:ver_todas',
      ),
    ).toEqual({ kind: 'all' });
  });

  it('onlyMine vence a chave ampla (alternador é o recorte mais estrito)', () => {
    expect(
      resolveAssigneeScope(
        access(['oportunidade:ver_todas']),
        'oportunidade:ver_todas',
        true,
      ),
    ).toEqual({ kind: 'mine', userId: 'u1' });
  });

  it('onlyMine também estreita quem já era restrito (tira os sem responsável)', () => {
    expect(
      resolveAssigneeScope(access([]), 'oportunidade:ver_todas', true),
    ).toEqual({
      kind: 'mine',
      userId: 'u1',
    });
  });
});

describe('assigneeScopeWhere', () => {
  it('devolve null em `all` (nada a compor)', () => {
    expect(assigneeScopeWhere({ kind: 'all' })).toBeNull();
  });

  it('restringe ao usuário em `mine`', () => {
    expect(assigneeScopeWhere({ kind: 'mine', userId: 'u1' })).toEqual({
      assigneeId: 'u1',
    });
  });

  it('inclui os sem responsável em `mineOrUnassigned`', () => {
    expect(
      assigneeScopeWhere({ kind: 'mineOrUnassigned', userId: 'u1' }),
    ).toEqual({
      OR: [{ assigneeId: 'u1' }, { assigneeId: null }],
    });
  });
});
