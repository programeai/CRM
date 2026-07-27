import { assigneeMudou } from './assignee-changed';

describe('assigneeMudou', () => {
  it('undefined (campo não tocado) → false', () => {
    expect(assigneeMudou(undefined, 'u1')).toBe(false);
    expect(assigneeMudou(undefined, null)).toBe(false);
  });

  it('mesmo valor (PATCH que só mexeu em outro campo) → false', () => {
    expect(assigneeMudou('u1', 'u1')).toBe(false);
  });

  it('null (removeu o responsável, não há quem notificar) → false', () => {
    expect(assigneeMudou(null, 'u1')).toBe(false);
  });

  it('valor novo sobre null → true', () => {
    expect(assigneeMudou('u2', null)).toBe(true);
  });

  it('valor novo sobre outro valor → true', () => {
    expect(assigneeMudou('u2', 'u1')).toBe(true);
  });
});
