import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ContractsService } from '../application/contracts.service';
import { CurrentOwnerId } from '../../../shared/current-user.decorator';
import { RequirePermission } from '../../access/require-permission.decorator';
import { CreateContractDto } from './dto/create-contract.dto';
import { UpdateContractDto } from './dto/update-contract.dto';
import { ListContractsQueryDto } from './dto/list-contracts-query.dto';
import { ExportContractsQueryDto } from './dto/export-contracts-query.dto';
import { DeriveContractFromProposalDto } from './dto/derive-contract-from-proposal.dto';

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

  // Rota literal declarada antes de `:id` para não ser capturada por ele.
  @RequirePermission('financeiro:ver', 'financeiro:gerenciar')
  @Get('export')
  export(
    @CurrentOwnerId() ownerId: string,
    @Query() query: ExportContractsQueryDto,
  ): Promise<StreamableFile> {
    return this.contracts.export(ownerId, query);
  }

  // Rotas literais antes das de `:id`, no mesmo cuidado de `GET /contracts/export`
  // (comentário em L38): `from-proposal`/`by-proposal` não colidem com as rotas
  // de hoje, mas a ordem é a convenção do arquivo e protege de colisão futura.

  @RequirePermission('financeiro:gerenciar')
  @Post('from-proposal/:proposalId/preview')
  previewFromProposal(
    @CurrentOwnerId() ownerId: string,
    @Param('proposalId') proposalId: string,
    @Body() dto: DeriveContractFromProposalDto,
  ) {
    return this.contracts.previewFromProposal(ownerId, proposalId, dto);
  }

  @RequirePermission('financeiro:gerenciar')
  @Post('from-proposal/:proposalId')
  createFromProposal(
    @CurrentOwnerId() ownerId: string,
    @Param('proposalId') proposalId: string,
    @Body() dto: DeriveContractFromProposalDto,
  ) {
    return this.contracts.createFromProposal(ownerId, proposalId, dto);
  }

  @RequirePermission('financeiro:ver', 'financeiro:gerenciar')
  @Get('by-proposal/:proposalId')
  listByProposal(
    @CurrentOwnerId() ownerId: string,
    @Param('proposalId') proposalId: string,
  ) {
    return this.contracts.listByProposal(ownerId, proposalId);
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
