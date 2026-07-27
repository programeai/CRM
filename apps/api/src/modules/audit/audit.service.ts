import { Injectable, Logger } from '@nestjs/common';
import type { AuditAction, AuditEntity, Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaAdminService } from '../../prisma/prisma-admin.service';
import {
  ACCESS_CONTEXT,
  type AccessContext,
} from '../access/domain/access-context';
import { calcularDiff, type AuditDiff } from '../../shared/audit-diff';

/** Registro de uma ação humana, no caminho de requisição HTTP. */
export interface EntradaDeAuditoria {
  entity: AuditEntity;
  entityId: string;
  /** Rótulo humano do registro — "Mensalidade 07/2026", o nome do cliente… */
  entityLabel: string;
  action: AuditAction;
  /** Estados para o diff. Omitir em ação sem diff (EXCLUIR, ARQUIVAR). */
  antes?: Record<string, unknown> | null;
  depois?: Record<string, unknown> | null;
  /** Contexto extra que não é diff de campo (ex.: `{ cobrancasCanceladas: 4 }`). */
  extra?: Record<string, unknown>;
}

/**
 * Registro fora do caminho de requisição autenticada: cron, webhook, rotina —
 * ou um ator humano **conhecido** que chega por rota `@Public()` (o aceite de
 * convite, onde o autor é o próprio convidado).
 */
export interface EntradaDeSistema extends EntradaDeAuditoria {
  ownerId: string;
  actorType: 'CRON' | 'WEBHOOK' | 'SISTEMA' | 'USER';
  /** Nome exibido na tela ("Rotina diária", "Webhook do Stripe"). */
  actorName: string;
  /** Só em `actorType: 'USER'` fora do caminho de requisição (aceite de convite). */
  actorId?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: PrismaAdminService,
    private readonly cls: ClsService,
  ) {}

  /**
   * Registra uma ação humana. Roda por `prisma.db`, ou seja **dentro da
   * transação do request** aberta pelo `OwnerContextInterceptor`: a trilha
   * commita junto com a mudança de negócio, ou nenhuma das duas commita.
   *
   * Deixa a exceção subir de propósito. Se a trilha não pode ser gravada, a
   * mudança não deve ser aplicada — é o ponto inteiro de uma auditoria.
   */
  async registrar(entrada: EntradaDeAuditoria): Promise<void> {
    const access = this.cls.get<AccessContext>(ACCESS_CONTEXT);
    if (!access) {
      // Chamada fora de requisição autenticada. Não derruba o fluxo de negócio,
      // mas é bug de instrumentação: use `registrarPeloSistema`.
      this.logger.warn({
        evento: 'auditoria.sem_contexto',
        msg: 'Tentativa de registrar auditoria sem contexto de acesso.',
        entidade: entrada.entity,
        acao: entrada.action,
      });
      return;
    }
    await this.prisma.db.auditLog.create({
      data: {
        ownerId: access.ownerId,
        actorType: 'USER',
        actorId: access.userId,
        actorName: access.userName,
        entity: entrada.entity,
        entityId: entrada.entityId,
        entityLabel: entrada.entityLabel,
        action: entrada.action,
        diff: this.montarDiff(entrada),
        requestId: this.cls.getId() || null,
      },
    });
  }

  /**
   * Registra uma ação sem ator humano (cron, webhook, rotina). Usa o client
   * admin porque esses caminhos rodam cross-owner, sem `app.owner_id` — a
   * policy de RLS casaria zero linhas.
   *
   * Ao contrário de `registrar`, **engole** a exceção: um cron processa N
   * linhas de N owners, e uma trilha que falha não pode abortar o lote inteiro.
   */
  async registrarPeloSistema(entrada: EntradaDeSistema): Promise<void> {
    try {
      await this.admin.auditLog.create({
        data: {
          ownerId: entrada.ownerId,
          actorType: entrada.actorType,
          actorId: entrada.actorId ?? null,
          actorName: entrada.actorName,
          entity: entrada.entity,
          entityId: entrada.entityId,
          entityLabel: entrada.entityLabel,
          action: entrada.action,
          diff: this.montarDiff(entrada),
          requestId: this.cls.getId() || null,
        },
      });
    } catch (erro) {
      this.logger.error(
        {
          evento: 'auditoria.registro_falhou',
          msg: 'Falha ao registrar auditoria de ação do sistema.',
          entidade: entrada.entity,
          entidadeId: entrada.entityId,
          acao: entrada.action,
        },
        erro instanceof Error ? erro.stack : undefined,
      );
    }
  }

  /** Junta o diff calculado ao `extra`, ou devolve `undefined` se não há nada. */
  private montarDiff(
    entrada: EntradaDeAuditoria,
  ): Prisma.InputJsonValue | undefined {
    const diff: AuditDiff | null =
      entrada.antes && entrada.depois
        ? calcularDiff(entrada.antes, entrada.depois)
        : null;
    if (!diff && !entrada.extra) return undefined;
    return {
      ...(diff ?? {}),
      ...(entrada.extra ?? {}),
    } as Prisma.InputJsonValue;
  }
}
