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
import { CurrentUserId } from '../../../shared/current-user.decorator';
import { CreateProposalDto } from './dto/create-proposal.dto';
import { UpdateProposalDto } from './dto/update-proposal.dto';
import { ListProposalsQueryDto } from './dto/list-proposals-query.dto';

@Controller('proposals')
export class ProposalsController {
  constructor(private readonly proposals: ProposalsService) {}

  @Get() list(
    @CurrentUserId() ownerId: string,
    @Query() query: ListProposalsQueryDto,
  ) {
    return this.proposals.list(ownerId, query);
  }

  @Post() create(
    @CurrentUserId() ownerId: string,
    @Body() dto: CreateProposalDto,
  ) {
    return this.proposals.create(ownerId, dto);
  }

  @Get(':id') findOne(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
  ) {
    return this.proposals.findOne(ownerId, id);
  }

  @Get(':id/versions') versions(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
  ) {
    return this.proposals.versions(ownerId, id);
  }

  @Patch(':id') update(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateProposalDto,
  ) {
    return this.proposals.update(ownerId, id, dto);
  }

  @Delete(':id') remove(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
  ) {
    return this.proposals.delete(ownerId, id);
  }

  @Post(':id/send') send(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
  ) {
    return this.proposals.send(ownerId, id);
  }

  @Post(':id/accept') accept(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
  ) {
    return this.proposals.accept(ownerId, id);
  }

  @Post(':id/reject') reject(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
  ) {
    return this.proposals.reject(ownerId, id);
  }

  @Post(':id/new-version') newVersion(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
  ) {
    return this.proposals.newVersion(ownerId, id);
  }
}
