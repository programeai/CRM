import { Controller, Get, Query } from '@nestjs/common';
import { TrashService } from '../application/trash.service';
import { CurrentOwnerId } from '../../../shared/current-user.decorator';
import { RequirePermission } from '../../access/require-permission.decorator';
import { ListTrashQueryDto } from './dto/list-trash-query.dto';

@Controller('trash')
export class TrashController {
  constructor(private readonly trash: TrashService) {}

  @RequirePermission('lixeira:ver')
  @Get()
  list(@CurrentOwnerId() ownerId: string, @Query() query: ListTrashQueryDto) {
    return this.trash.list(ownerId, query);
  }
}
