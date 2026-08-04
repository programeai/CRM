import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { IntegrationKeysService } from '../../integracoes/application/integration-keys.service';
import { ClientsService } from '../../clients/application/clients.service';
import { DealsService } from '../../pipeline/application/deals.service';
import { ActivitiesService } from '../../activities/application/activities.service';
import { TasksService } from '../../projects/application/tasks.service';
import type { ContextoDaApi } from '../api/api-context';
import type { PublicCreateClientDto } from '../api/dto/public-create-client.dto';
import type { PublicCreateDealDto } from '../api/dto/public-create-deal.dto';
import type { PublicCreateActivityDto } from '../api/dto/public-create-activity.dto';
import type { PublicCreateTaskDto } from '../api/dto/public-create-task.dto';

/** O que a API pública devolve: o id do registro criado e o mínimo de estado. */
export interface RegistroCriado {
  id: string;
}

/**
 * Escrita pela API pública. Toda operação segue a MESMA costura, que é a da
 * ingestão de lead (`LeadsIntakeService`) e existe por três restrições que se
 * somam:
 *
 *  1. **`executarComoOwner`** — a rota é `@Public()` e não passa pelo
 *     `OwnerContextInterceptor`. Sem `app.owner_id` o RLS não estoura: grava
 *     zero linha e a rota responde sucesso. É por isso que o e2e afirma a linha
 *     no banco, e não só o status da resposta.
 *  2. **Nada de I/O de rede dentro da transação** (timeout de 5s do Prisma). O
 *     aviso ao responsável sai DEPOIS do commit.
 *  3. **`avisarResponsavel: false`** nos services de negócio. Eles chamam
 *     `NotificationsService.notificar`, que exige `AccessContext` no CLS — aqui
 *     não há ator humano, então `notificar` cairia no early-return
 *     `notificacao.sem_contexto` e poria um `warn` em cada requisição legítima.
 *     Nesta fase nenhuma rota pública atribui responsável, então não há aviso a
 *     emitir; a opção existe para o dia em que houver, e para o log ficar limpo.
 */
@Injectable()
export class PublicWriteService {
  private readonly logger = new Logger(PublicWriteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly keys: IntegrationKeysService,
    private readonly clients: ClientsService,
    private readonly deals: DealsService,
    private readonly activities: ActivitiesService,
    private readonly tasks: TasksService,
    private readonly audit: AuditService,
  ) {}

  criarCliente(
    dto: PublicCreateClientDto,
    ctx: ContextoDaApi,
  ): Promise<RegistroCriado & { status: string }> {
    return this.executar(ctx, 'cliente', async () => {
      const criado = await this.clients.create(
        ctx.ownerId,
        { ...dto },
        { avisarResponsavel: false },
      );
      await this.audit.registrarComoIntegracao({
        ownerId: ctx.ownerId,
        keyId: ctx.keyId,
        keyName: ctx.keyName,
        entity: 'CLIENT',
        entityId: criado.id,
        entityLabel: criado.name,
        action: 'CRIAR',
      });
      return { id: criado.id, status: criado.status };
    });
  }

  criarOportunidade(
    dto: PublicCreateDealDto,
    ctx: ContextoDaApi,
  ): Promise<RegistroCriado & { stageId: string }> {
    return this.executar(ctx, 'oportunidade', async () => {
      const criada = await this.deals.create(
        ctx.ownerId,
        { ...dto },
        { avisarResponsavel: false },
      );
      await this.audit.registrarComoIntegracao({
        ownerId: ctx.ownerId,
        keyId: ctx.keyId,
        keyName: ctx.keyName,
        entity: 'DEAL',
        entityId: criada.id,
        entityLabel: criada.title,
        action: 'CRIAR',
      });
      return { id: criada.id, stageId: criada.stageId };
    });
  }

  criarAtividade(
    dto: PublicCreateActivityDto,
    ctx: ContextoDaApi,
  ): Promise<RegistroCriado> {
    return this.executar(ctx, 'atividade', async () => {
      const criada = await this.activities.create(
        ctx.ownerId,
        { ...dto },
        { avisarResponsavel: false },
      );
      await this.audit.registrarComoIntegracao({
        ownerId: ctx.ownerId,
        keyId: ctx.keyId,
        keyName: ctx.keyName,
        entity: 'ACTIVITY',
        entityId: criada.id,
        // Atividade não tem título: o rótulo é o começo do conteúdo, mesmo
        // desenho denormalizado do resto da trilha.
        entityLabel: criada.content.slice(0, 80),
        action: 'CRIAR',
      });
      return { id: criada.id };
    });
  }

  criarDemanda(
    dto: PublicCreateTaskDto,
    ctx: ContextoDaApi,
  ): Promise<RegistroCriado & { status: string }> {
    return this.executar(ctx, 'demanda', async () => {
      const criada = await this.tasks.create(
        ctx.ownerId,
        { ...dto },
        { avisarResponsavel: false },
      );
      await this.audit.registrarComoIntegracao({
        ownerId: ctx.ownerId,
        keyId: ctx.keyId,
        keyName: ctx.keyName,
        entity: 'TASK',
        entityId: criada.id,
        entityLabel: criada.title,
        action: 'CRIAR',
      });
      return { id: criada.id, status: criada.status };
    });
  }

  /**
   * A moldura comum: contexto de RLS, marca de uso da chave e log agregado.
   *
   * `registrarUso` vem PRIMEIRO e DENTRO da transação, como na ingestão:
   * rollback não deve registrar uso, e `lastUsedAt` responde "esta credencial
   * ainda está viva?", não "quantos registros ela criou?".
   */
  private async executar<T extends RegistroCriado>(
    ctx: ContextoDaApi,
    recurso: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const inicio = Date.now();
    const resultado = await this.prisma.executarComoOwner(
      ctx.ownerId,
      async () => {
        await this.keys.registrarUso(ctx.ownerId, ctx.keyId);
        return fn();
      },
    );
    // Sem nome, e-mail nem telefone: a linha vive 30 dias num Grafana publicado.
    this.logger.log({
      evento: 'api_publica.registro_criado',
      msg: 'Registro criado pela API pública.',
      recurso,
      registroId: resultado.id,
      chaveId: ctx.keyId,
      ms: Date.now() - inicio,
    });
    return resultado;
  }
}
