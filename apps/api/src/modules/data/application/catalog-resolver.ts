import { Injectable } from '@nestjs/common';
import { CatalogosService } from '../../catalogos/application/catalogos.service';
import type { CatalogItem } from '../../catalogos/domain/catalog.repository';
import { normalizar } from './normalizar';

/**
 * Texto da planilha → item do catálogo do owner.
 *
 * Carrega o catálogo UMA vez por requisição e resolve em memória: o orçamento
 * é de 5s para o request inteiro, e uma consulta por linha seriam 500
 * round-trips dentro dele. Catálogo de owner é lista curta (dezenas de itens),
 * então cabe.
 *
 * Inclui os DESATIVADOS: casar com item desativado é legítimo (o dado histórico
 * do owner existe e o registro antigo continua rotulado por ele). O que não faz
 * sentido é *criar* item novo desativado — e isso a criação não faz.
 */
@Injectable()
export class CatalogResolver {
  constructor(private readonly catalogos: CatalogosService) {}

  async carregar(ownerId: string): Promise<CatalogoResolvido> {
    const itens = await this.catalogos.list(ownerId, 'fontes-de-lead', true);
    return new CatalogoResolvido(itens);
  }
}

export class CatalogoResolvido {
  private readonly porNome: Map<string, CatalogItem>;

  constructor(itens: CatalogItem[]) {
    this.porNome = new Map(itens.map((i) => [normalizar(i.name), i]));
  }

  resolver(texto: string): CatalogItem | null {
    return this.porNome.get(normalizar(texto)) ?? null;
  }

  /**
   * Valores distintos que não casaram, na primeira grafia vista. Distintos
   * **por forma normalizada**: "Instagram" e "instagram" são o mesmo
   * desconhecido, e listar os dois faria o usuário criar duas vezes o item —
   * o que estouraria no `@@unique([ownerId, name])` no meio da importação.
   */
  desconhecidos(valores: string[]): string[] {
    const vistos = new Map<string, string>();
    for (const valor of valores) {
      const chave = normalizar(valor);
      if (!chave || this.porNome.has(chave) || vistos.has(chave)) continue;
      vistos.set(chave, valor.trim());
    }
    return [...vistos.values()];
  }

  /** Registra um item recém-criado, para as linhas seguintes já o encontrarem. */
  registrar(item: CatalogItem): void {
    this.porNome.set(normalizar(item.name), item);
  }

  /**
   * Alia o texto exato da planilha a um item JÁ existente escolhido pelo
   * usuário (ação "usar uma existente") — diferente de `registrar`, que
   * indexa pelo `name` do próprio item. Sem isto, uma planilha com "Insta" e
   * a decisão de usar o item "Instagram" nunca casaria: os textos são
   * distintos por forma normalizada.
   */
  registrarAlias(texto: string, item: CatalogItem): void {
    this.porNome.set(normalizar(texto), item);
  }
}
