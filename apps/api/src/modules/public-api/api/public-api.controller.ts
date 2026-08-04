import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../auth/public.decorator';
import { PublicWriteService } from '../application/public-write.service';
import { ApiContext, type ContextoDaApi } from './api-context';
import { EscopoExigido } from './escopo-exigido.decorator';
import { PublicApiKeyGuard } from './public-api-key.guard';
import { PublicApiThrottlerGuard } from './public-api-throttler.guard';
import { PublicCreateClientDto } from './dto/public-create-client.dto';
import { PublicCreateDealDto } from './dto/public-create-deal.dto';
import { PublicCreateActivityDto } from './dto/public-create-activity.dto';
import { PublicCreateTaskDto } from './dto/public-create-task.dto';

/** Erros comuns às quatro rotas — a autenticação e o teto são os mesmos. */
const ERROS_COMUNS = [
  { status: 400, description: 'Corpo inválido ou campo fora do contrato.' },
  {
    status: 401,
    description: 'Chave de integração ausente, inexistente ou revogada.',
  },
  {
    status: 403,
    description: 'A chave existe, mas não tem o escopo exigido pela rota.',
  },
  {
    status: 429,
    description: 'Mais de 120 requisições por minuto com a mesma chave.',
  },
] as const;

/**
 * A API pública de escrita. Quatro rotas, um escopo cada.
 *
 * Três decorators andam SEMPRE juntos em cada rota, e remover qualquer um
 * publica escrita sem credencial na internet:
 *   `Public`        → desliga o JwtAuthGuard;
 *   `UseGuards`     → `PublicApiKeyGuard` (a única porta) + `PublicApiThrottlerGuard`;
 *   `EscopoExigido` → o escopo da rota; sem ele o guard FECHA a rota.
 *
 * Um grep pelos três decorators nesta classe tem de devolver o mesmo número, e
 * esse número é a quantidade de rotas.
 *
 * O `201` default do Nest no POST está correto aqui: ao contrário de
 * `/leads/intake`, estas rotas sempre criam registro novo — não há dedupe.
 */
@ApiTags('API pública')
@ApiBearerAuth('chaveDeIntegracao')
@ApiResponse(ERROS_COMUNS[0])
@ApiResponse(ERROS_COMUNS[1])
@ApiResponse(ERROS_COMUNS[2])
@ApiResponse(ERROS_COMUNS[3])
@Controller('public')
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class PublicApiController {
  constructor(private readonly service: PublicWriteService) {}

  @ApiOperation({
    summary: 'Criar cliente',
    description:
      'Abre cadastro de cliente (ou lead) na workspace da chave. O ownerId vem ' +
      'da chave, nunca do corpo. Escopo: cliente:escrever.',
  })
  @ApiResponse({
    status: 201,
    description: 'Cliente criado.',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        status: { type: 'string', example: 'LEAD' },
      },
    },
  })
  @ApiResponse({
    status: 409,
    description: 'Já existe um cliente com este documento.',
  })
  @Public()
  @UseGuards(PublicApiKeyGuard, PublicApiThrottlerGuard)
  @EscopoExigido('cliente:escrever')
  @Post('clients')
  criarCliente(
    @Body() dto: PublicCreateClientDto,
    @ApiContext() contexto: ContextoDaApi,
  ) {
    return this.service.criarCliente(dto, contexto);
  }

  @ApiOperation({
    summary: 'Criar oportunidade',
    description:
      'Abre oportunidade no funil de um cliente existente. Sem stageId, nasce ' +
      'no primeiro estágio do funil do owner. Escopo: negociacao:escrever.',
  })
  @ApiResponse({
    status: 201,
    description: 'Oportunidade criada.',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        stageId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description:
      'Cliente, estágio ou tipo de serviço inexistente (ou de outro owner).',
  })
  @Public()
  @UseGuards(PublicApiKeyGuard, PublicApiThrottlerGuard)
  @EscopoExigido('negociacao:escrever')
  @Post('deals')
  criarOportunidade(
    @Body() dto: PublicCreateDealDto,
    @ApiContext() contexto: ContextoDaApi,
  ) {
    return this.service.criarOportunidade(dto, contexto);
  }

  @ApiOperation({
    summary: 'Registrar atividade',
    description:
      'Lança atividade no histórico de um cliente. Com scheduledFor, nasce ' +
      'agendada e entra nos lembretes. Escopo: atividade:escrever.',
  })
  @ApiResponse({
    status: 201,
    description: 'Atividade registrada.',
    schema: {
      type: 'object',
      properties: { id: { type: 'string', format: 'uuid' } },
    },
  })
  @ApiResponse({
    status: 404,
    description:
      'Cliente, tipo de atividade ou oportunidade inexistente (ou de outro owner).',
  })
  @Public()
  @UseGuards(PublicApiKeyGuard, PublicApiThrottlerGuard)
  @EscopoExigido('atividade:escrever')
  @Post('activities')
  criarAtividade(
    @Body() dto: PublicCreateActivityDto,
    @ApiContext() contexto: ContextoDaApi,
  ) {
    return this.service.criarAtividade(dto, contexto);
  }

  @ApiOperation({
    summary: 'Criar demanda',
    description:
      'Abre demanda no quadro de um projeto existente. Escopo: tarefa:escrever.',
  })
  @ApiResponse({
    status: 201,
    description: 'Demanda criada.',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        status: { type: 'string', example: 'BACKLOG' },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Projeto inexistente (ou de outro owner).',
  })
  @Public()
  @UseGuards(PublicApiKeyGuard, PublicApiThrottlerGuard)
  @EscopoExigido('tarefa:escrever')
  @Post('tasks')
  criarDemanda(
    @Body() dto: PublicCreateTaskDto,
    @ApiContext() contexto: ContextoDaApi,
  ) {
    return this.service.criarDemanda(dto, contexto);
  }
}
