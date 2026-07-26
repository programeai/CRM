import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ContractsService } from '../application/contracts.service';
import { CurrentOwnerId } from '../../../shared/current-user.decorator';
import { RequirePermission } from '../../access/require-permission.decorator';
import { CreateContractDto } from './dto/create-contract.dto';
import { UpdateContractDto } from './dto/update-contract.dto';
import { ListContractsQueryDto } from './dto/list-contracts-query.dto';

@Controller('contracts')
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @RequirePermission('financeiro:ver', 'financeiro:gerenciar')
  @Get()
  list(
    @CurrentOwnerId() ownerId: string,
    @Query() query: ListContractsQueryDto,
  ) {
    return this.contracts.list(ownerId, query);
  }

  @RequirePermission('financeiro:gerenciar')
  @Post()
  create(@CurrentOwnerId() ownerId: string, @Body() dto: CreateContractDto) {
    return this.contracts.create(ownerId, dto);
  }

  @RequirePermission('financeiro:ver', 'financeiro:gerenciar')
  @Get(':id')
  findOne(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.contracts.findOne(ownerId, id);
  }

  @RequirePermission('financeiro:gerenciar')
  @Patch(':id')
  update(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateContractDto,
  ) {
    return this.contracts.update(ownerId, id, dto);
  }

  @RequirePermission('financeiro:gerenciar')
  @Post(':id/pause')
  pause(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.contracts.pause(ownerId, id);
  }

  @RequirePermission('financeiro:gerenciar')
  @Post(':id/resume')
  resume(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.contracts.resume(ownerId, id);
  }

  @RequirePermission('financeiro:gerenciar')
  @Post(':id/cancel')
  cancel(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.contracts.cancel(ownerId, id);
  }
}
