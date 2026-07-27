import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';

/**
 * Guardas do expurgo, compartilhadas pelos cinco recursos.
 *
 * Regra 1: só se expurga o que já está na lixeira. Sem isso, `DELETE /deals/:id`
 * continuaria sendo um hard delete de um registro ativo — exatamente o que esta
 * fase remove.
 *
 * Regra 2: nenhuma cascata. As FKs de negócio são ON DELETE RESTRICT e as
 * remoções em cascata do projeto são feitas à mão nos repositórios. Um expurgo
 * com filho pendurado responderia 500 de FK; aqui vira 409 com instrução.
 */
export function assertArquivado(
  archivedAt: Date | null,
  recurso: string,
): void {
  if (!archivedAt) {
    throw new UnprocessableEntityException(
      `Só é possível excluir em definitivo ${recurso} que já esteja na lixeira. Arquive antes.`,
    );
  }
}

export function assertSemFilhos(quantidade: number, mensagem: string): void {
  if (quantidade > 0) throw new ConflictException(mensagem);
}
