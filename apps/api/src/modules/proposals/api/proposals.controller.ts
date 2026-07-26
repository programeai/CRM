import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ProposalsService } from '../application/proposals.service';
import { CurrentOwnerId } from '../../../shared/current-user.decorator';
import { RequirePermission } from '../../access/require-permission.decorator';
import { CreateProposalDto } from './dto/create-proposal.dto';
import { UpdateProposalDto } from './dto/update-proposal.dto';
import { ListProposalsQueryDto } from './dto/list-proposals-query.dto';

@Controller('proposals')
export class ProposalsController {
  constructor(private readonly proposals: ProposalsService) {}

  @RequirePermission('proposta:ver', 'proposta:gerenciar')
  @Get()
  list(
    @CurrentOwnerId() ownerId: string,
    @Query() query: ListProposalsQueryDto,
  ) {
    return this.proposals.list(ownerId, query);
  }

  @RequirePermission('proposta:gerenciar')
  @Post()
  create(@CurrentOwnerId() ownerId: string, @Body() dto: CreateProposalDto) {
    return this.proposals.create(ownerId, dto);
  }

  @RequirePermission('proposta:ver', 'proposta:gerenciar')
  @Get(':id')
  findOne(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.proposals.findOne(ownerId, id);
  }

  @RequirePermission('proposta:ver', 'proposta:gerenciar')
  @Get(':id/versions')
  versions(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.proposals.versions(ownerId, id);
  }

  @RequirePermission('proposta:gerenciar')
  @Patch(':id')
  update(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateProposalDto,
  ) {
    return this.proposals.update(ownerId, id, dto);
  }

  @RequirePermission('proposta:gerenciar')
  @Delete(':id')
  remove(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.proposals.delete(ownerId, id);
  }

  @RequirePermission('proposta:gerenciar')
  @Post(':id/send')
  send(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.proposals.send(ownerId, id);
  }

  @RequirePermission('proposta:gerenciar')
  @Post(':id/accept')
  accept(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.proposals.accept(ownerId, id);
  }

  @RequirePermission('proposta:gerenciar')
  @Post(':id/reject')
  reject(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.proposals.reject(ownerId, id);
  }

  @RequirePermission('proposta:gerenciar')
  @Post(':id/new-version')
  newVersion(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.proposals.newVersion(ownerId, id);
  }
}
