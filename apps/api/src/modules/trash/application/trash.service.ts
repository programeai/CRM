import { Inject, Injectable } from '@nestjs/common';
import {
  TRASH_REPOSITORY,
  type TrashRepository,
} from '../domain/trash.repository';
import { normalizePage, paginated } from '../../../shared/pagination';
import type { ListTrashQueryDto } from '../api/dto/list-trash-query.dto';

/**
 * Read model da lixeira: atravessa cinco tabelas, no mesmo desenho do
 * `DashboardModule` (que já lê `deal`, `proposal`, `task`, `payment` e
 * `activity` por um repositório próprio). Agregar leituras de módulos
 * diferentes num repositório de leitura é mais honesto que fazer cinco
 * módulos exportarem services só para isso.
 */
@Injectable()
export class TrashService {
  constructor(
    @Inject(TRASH_REPOSITORY) private readonly repo: TrashRepository,
  ) {}

  async list(ownerId: string, query: ListTrashQueryDto) {
    const { page, limit, skip, take } = normalizePage(query.page, query.limit);
    const { data, total } = await this.repo.findManyAndCount({
      ownerId,
      type: query.type,
      skip,
      take,
    });
    return paginated(data, total, page, limit);
  }
}
