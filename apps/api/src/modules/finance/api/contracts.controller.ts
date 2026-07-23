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
import { CurrentUserId } from '../../../shared/current-user.decorator';
import { CreateContractDto } from './dto/create-contract.dto';
import { UpdateContractDto } from './dto/update-contract.dto';
import { ListContractsQueryDto } from './dto/list-contracts-query.dto';

@Controller('contracts')
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @Get() list(
    @CurrentUserId() ownerId: string,
    @Query() query: ListContractsQueryDto,
  ) {
    return this.contracts.list(ownerId, query);
  }

  @Post() create(
    @CurrentUserId() ownerId: string,
    @Body() dto: CreateContractDto,
  ) {
    return this.contracts.create(ownerId, dto);
  }

  @Get(':id') findOne(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
  ) {
    return this.contracts.findOne(ownerId, id);
  }

  @Patch(':id') update(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateContractDto,
  ) {
    return this.contracts.update(ownerId, id, dto);
  }

  @Post(':id/pause') pause(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
  ) {
    return this.contracts.pause(ownerId, id);
  }

  @Post(':id/resume') resume(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
  ) {
    return this.contracts.resume(ownerId, id);
  }

  @Post(':id/cancel') cancel(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
  ) {
    return this.contracts.cancel(ownerId, id);
  }
}
