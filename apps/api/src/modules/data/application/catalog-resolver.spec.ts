import { CatalogoResolvido } from './catalog-resolver';
import type { CatalogItem } from '../../catalogos/domain/catalog.repository';

function item(nome: string, ativo = true): CatalogItem {
  return { id: nome, ownerId: 'owner-1', name: nome, active: ativo };
}

describe('CatalogoResolvido', () => {
  it('casa por nome ignorando acento e caixa', () => {
    const resolvido = new CatalogoResolvido([item('Tráfego pago')]);
    expect(resolvido.resolver('tráfego PAGO')?.name).toBe('Tráfego pago');
    expect(resolvido.resolver('trafego pago')?.name).toBe('Tráfego pago');
  });

  it('casa com item desativado — dado histórico continua rotulado por ele', () => {
    const resolvido = new CatalogoResolvido([item('Indicação', false)]);
    expect(resolvido.resolver('indicacao')?.name).toBe('Indicação');
  });

  it('devolve null quando não há casamento', () => {
    const resolvido = new CatalogoResolvido([item('Orgânico')]);
    expect(resolvido.resolver('Instagram')).toBeNull();
  });

  it('deduplica desconhecidos pela forma normalizada, mantendo a primeira grafia', () => {
    const resolvido = new CatalogoResolvido([]);
    const desconhecidos = resolvido.desconhecidos([
      'Instagram',
      'instagram',
      'INSTAGRAM',
      'Facebook',
      '',
    ]);
    expect(desconhecidos).toEqual(['Instagram', 'Facebook']);
  });

  it('não lista como desconhecido um valor já presente no catálogo', () => {
    const resolvido = new CatalogoResolvido([item('Indicação')]);
    expect(resolvido.desconhecidos(['indicação', 'Instagram'])).toEqual([
      'Instagram',
    ]);
  });

  it('registrar faz a linha seguinte já encontrar o item recém-criado', () => {
    const resolvido = new CatalogoResolvido([]);
    expect(resolvido.resolver('Instagram')).toBeNull();
    resolvido.registrar(item('Instagram'));
    expect(resolvido.resolver('instagram')?.name).toBe('Instagram');
  });
});
