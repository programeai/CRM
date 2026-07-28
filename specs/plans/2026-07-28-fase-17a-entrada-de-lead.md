---
date: 2026-07-28T10:55:57-03:00
author: claude
source_prd: specs/research/2026-07-28-fase-17a-entrada-de-lead.md
git_commit: 916814462bd5a9a74006c272f9b68823cb44ea3c
branch: main
status: implemented
tags: [spec, leads, integracoes, chave-de-api, rls, assignee, catalogos]
---

# Spec: Fase 17-A — Entrada de lead por integração

## Overview

A ingestão externa de lead já roda em produção, mas é single-tenant por construção: o segredo é um token de instância (`LEAD_INTAKE_TOKEN`) e a conta de destino vem de um e-mail no ambiente (`LEAD_INTAKE_OWNER_EMAIL`). Esta fase troca as duas coisas por **chave de integração com hash no banco, por owner**, e usa a chave apresentada para descobrir três coisas que hoje não existem: qual workspace recebe, **quem** é o responsável do lead e **qual fonte de lead do catálogo** o classifica.

A máquina de segredo-por-registro que a Fase 19-B reservava (geração, exibição única, mascaramento, rotação, ausência em log e no diff da auditoria) **nasce aqui, já genérica e com escopos** — decisão tomada no planejamento desta fase. Ela vive num módulo novo (`integracoes`) que não conhece lead nenhum; o que é do domínio de lead (responsável, fonte, nome do canal) vive numa segunda tabela, no módulo `leads`. A dependência aponta **leads → integracoes**, nunca o contrário, e é isso que permite à 19-B acrescentar escopo de webhook sem tocar em captação.

Dos cinco itens do recorte original, o **formulário público de captação saiu do escopo** por decisão de produto: nesta fase o lead entra apenas por integração servidor-a-servidor. A estratégia de corte em produção é aceitar as duas credenciais durante uma janela — chave do banco **ou** token do ambiente — porque o emissor (`site-v2`) vive em outro repositório e um corte não coordenado perde lead em silêncio.

## Current State

- `POST /api/v1/leads/intake` é `@Public()` + `LeadIntakeTokenGuard` (`timingSafeEqual` sobre sha256 do token de ambiente) + `@Throttle(30/min)` + `@HttpCode(200)`.
- `LeadsIntakeService.receber` resolve o owner por `LEAD_INTAKE_OWNER_EMAIL`, escreve sob `PrismaService.executarComoOwner`, deduplica por dígitos do telefone (`contains`), grava `Client` status `LEAD` com `tags: [origem]` + `Contact` principal, e emite `LEAD_RECEIVED` para o **owner**, depois do commit.
- `LeadsModule` não tem `domain/` nem `infra/` — não é dono de tabela.
- O lead nasce **sem responsável** e **sem `sourceId`**.
- Detalhes completos no PRD.

## Desired End State

1. Existe `IntegrationKey`: credencial de máquina por owner, `keyHash` sha256 `@unique`, `prefix` em claro para reconhecimento, `scopes[]`, `lastUsedAt`, `revokedAt`. Tem RLS. O valor bruto existe **uma única vez**, na resposta que a criou; não aparece em log, em resposta posterior nem no diff da auditoria.
2. Existe `LeadIntakeChannel`: o canal de captação do owner ("Site institucional", "n8n"), com `assigneeId?`, `sourceId?` e a chave que o autentica (`keyId @unique`). Tem RLS.
3. `POST /leads/intake` autentica pela chave (`Authorization: Bearer crm_…`), descobre o owner pela chave — **nunca pelo corpo** —, e grava o lead com o responsável e a fonte de lead do canal.
4. O token de ambiente continua aceito, com log de aviso próprio, e o caminho legado se comporta **exatamente como hoje** (sem roteamento, sem fonte). Remover as duas variáveis é um passo posterior, fora desta fase.
5. Lead reincidente empilha a nota como hoje; assume o responsável do canal **só se o cadastro estiver sem ninguém**. Origem, tags e fonte do cadastro existente não são sobrescritas.
6. `LEAD_RECEIVED` vai para o responsável roteado; sem responsável, vai para o owner, como hoje.
7. A permissão `integracao:gerenciar` existe no catálogo, categoria `Organização`, e **não** é concedida por backfill a papéis existentes.
8. `/administracao/captacao` lista os canais, cria canal já com chave (exibida uma vez), rotaciona, revoga e edita responsável e fonte.
9. `docs/observabilidade.md` cataloga os seis eventos `lead.*` que já existiam e os novos.

## What We're NOT Doing

- **Formulário público de captação** — removido do escopo por decisão de produto. Sem rota pública no `apps/web`, sem `publicSlug` no canal, sem Turnstile na ingestão, sem `CaptchaService` exportado do `AuthModule`. Nada no desenho impede acrescentá-lo depois: o canal é o registro que um formulário usaria.
- **Recuperar chave perdida.** Não é implementável com hash determinístico e não será simulada: quem perde a chave rotaciona.
- **Remover `LEAD_INTAKE_TOKEN` / `LEAD_INTAKE_OWNER_EMAIL`.** Elas saem quando o `site-v2` estiver migrado, em PR próprio. Aqui elas viram caminho legado explícito.
- **Escopos além de `lead:receber`.** A máquina é genérica, mas só um escopo existe. Webhook de saída, HMAC e API pública continuam na 19-B.
- **Round-robin de responsável.** O roteamento é fixo por canal, determinístico.
- **Mudar os nomes dos campos de `IntakeLeadDto`.** É o contrato com o `site-v2`, que vive fora deste repositório.
- **Renomear qualquer evento `lead.*` existente.** Quebraria contagem histórica no Grafana.
- **Detecção de duplicidade da 14-B.** A ingestão convive com o dedup por telefone que já existe.
- **`docs/deploy.md`, `.env.example` e `ROADMAP.md`** — fora do escopo por decisão no planejamento. Só `ENDPOINTS.md` (obrigatória por Definition of Done) e `docs/observabilidade.md`.

---

## Phase 1: Máquina de chave de integração

### Goal

O módulo `integracoes` emite, autentica, mascara, rotaciona e revoga chaves de integração por owner — genérico, sem saber que lead existe.

### Changes

#### Modelo de dados

**Modify**: `apps/api/prisma/schema.prisma`

Acrescentar o modelo depois de `CollaboratorInvite` (fica junto do outro segredo-por-registro, de propósito):

```prisma
// Chave de integração do owner: credencial de MÁQUINA (servidor a servidor).
//
// Guarda apenas o sha256 do valor bruto — que só existe na resposta que o
// emitiu. Determinístico e `@unique` (não argon2, como `Session`) porque a
// chave chega SOZINHA no header `Authorization`, sem identificador ao lado: a
// autenticação tem de ser um `findUnique` indexado, e não N `argon2.verify`.
// Mesma decisão de `CollaboratorInvite.tokenHash`.
//
// Genérico de propósito: o que a chave pode fazer está em `scopes`, e escopo
// novo (webhook de saída, API pública — Fase 19-B) entra sem tocar em nada
// aqui. Este modelo NÃO conhece lead: a configuração de captação vive em
// `LeadIntakeChannel`.
model IntegrationKey {
  id         String    @id @default(uuid())
  ownerId    String
  owner      User      @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  /// Nome dado por quem criou ("Site institucional", "n8n").
  name       String
  keyHash    String    @unique // sha256 do valor bruto
  /// Os 12 primeiros caracteres do valor bruto, em claro (`crm_` + 8 hex). É o
  /// que a interface exibe para a pessoa reconhecer qual chave é qual — os
  /// outros 224 bits de entropia continuam só no hash.
  prefix     String
  scopes     String[]  @default([])
  /// Último uso BEM-SUCEDIDO (a transação da ingestão commitou).
  lastUsedAt DateTime?
  /// Revogada: continua no banco para a trilha e para a tela dizerem o que
  /// aconteceu, mas não autentica mais nada.
  revokedAt  DateTime?
  createdAt  DateTime  @default(now())

  @@index([ownerId])
}
```

E a back-relation em `User`:

```prisma
model User {
  // …
  integrationKeys IntegrationKey[]
}
```

**Create**: `apps/api/prisma/migrations/20260811100000_integration_key/migration.sql`

```sql
-- ===========================================================================
-- 1. Tabela
-- ===========================================================================
CREATE TABLE "IntegrationKey" (
  "id"         TEXT NOT NULL,
  "ownerId"    TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "keyHash"    TEXT NOT NULL,
  "prefix"     TEXT NOT NULL,
  "scopes"     TEXT[] DEFAULT ARRAY[]::TEXT[],
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt"  TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IntegrationKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntegrationKey_keyHash_key" ON "IntegrationKey"("keyHash");
CREATE INDEX "IntegrationKey_ownerId_idx" ON "IntegrationKey"("ownerId");
ALTER TABLE "IntegrationKey" ADD CONSTRAINT "IntegrationKey_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- 2. Enums da auditoria — a emissão e a rotação de chave entram na trilha
-- ===========================================================================
ALTER TYPE "AuditEntity" ADD VALUE 'INTEGRATION';
ALTER TYPE "AuditAction" ADD VALUE 'ROTACIONAR';

-- ===========================================================================
-- 3. RLS por ownerId (molde de 20260805100000_lead_source_catalog)
-- ===========================================================================
ALTER TABLE "IntegrationKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IntegrationKey" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "IntegrationKey"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "IntegrationKey" TO crm_app;
```

> `ALTER TYPE … ADD VALUE` não roda dentro de bloco de transação em versões antigas do Postgres; no 16 roda, e o `migrate deploy` aplica cada arquivo numa transação. Se o portão de migration reclamar, separar os dois `ALTER TYPE` num arquivo próprio antes deste.

**Modify**: `apps/api/prisma/fixtures/invariantes.sql`

Acrescentar `'IntegrationKey'` à lista do bloco final de RLS (o `IN (…)` de tabelas novas):

```sql
     AND c.relname IN (
       'LeadSourceCatalog', 'LostReasonCatalog', 'ServiceCatalog',
       'ActivityTypeCatalog', 'IntegrationKey'
     )
```

#### Módulo `integracoes`

**Create**: `apps/api/src/modules/integracoes/domain/integration-scope.ts`

```ts
/**
 * Escopos de chave de integração — o que uma chave PODE fazer. Fonte única,
 * consumida pelo service (validação), pela API (resposta) e pelo front (rótulo).
 *
 * Não é permissão de pessoa: permissão limita quem usa o CRM pela interface
 * (`shared/permissions.ts`); escopo limita o que uma credencial de máquina
 * alcança. Os dois catálogos são independentes de propósito — a chave não é
 * "um usuário robô".
 */
export const INTEGRATION_SCOPES = [
  {
    key: 'lead:receber',
    label: 'Receber lead',
    description:
      'Entregar lead capturado fora do CRM (site, landing page, automação)',
  },
] as const;

export type IntegrationScope = (typeof INTEGRATION_SCOPES)[number]['key'];

/** O escopo da ingestão de lead. Importado pelo módulo `leads`. */
export const ESCOPO_RECEBER_LEAD: IntegrationScope = 'lead:receber';

const CHAVES = new Set<string>(INTEGRATION_SCOPES.map((e) => e.key));

export function isIntegrationScope(valor: string): valor is IntegrationScope {
  return CHAVES.has(valor);
}
```

**Create**: `apps/api/src/modules/integracoes/domain/integration-key.repository.ts`

```ts
export const INTEGRATION_KEY_REPOSITORY = Symbol('INTEGRATION_KEY_REPOSITORY');

/** A chave como o resto do sistema a conhece. NUNCA carrega o valor bruto. */
export interface IntegrationKeyRecord {
  id: string;
  ownerId: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface IntegrationKeyRepository {
  findManyByOwner(ownerId: string): Promise<IntegrationKeyRecord[]>;
  findById(ownerId: string, id: string): Promise<IntegrationKeyRecord | null>;
  create(data: {
    ownerId: string;
    name: string;
    keyHash: string;
    prefix: string;
    scopes: string[];
  }): Promise<IntegrationKeyRecord>;
  /**
   * Troca o segredo da MESMA linha e zera `lastUsedAt`/`revokedAt`. Rotacionar
   * em vez de criar outra linha é o que mantém o canal apontando para a chave
   * sem religar FK — mesmo desenho do `replaceForUser` do convite.
   */
  replaceSecret(
    ownerId: string,
    id: string,
    data: { keyHash: string; prefix: string },
  ): Promise<IntegrationKeyRecord>;
  revoke(ownerId: string, id: string): Promise<IntegrationKeyRecord>;
  delete(ownerId: string, id: string): Promise<void>;
  /** Marca uso. Roda dentro do contexto de owner de quem usou a chave. */
  touch(ownerId: string, id: string): Promise<void>;
  /**
   * Busca pelo hash SEM contexto de owner — é a autenticação, que acontece
   * antes de existir `app.owner_id`. Client admin, como
   * `prisma-invite.repository.ts:37`.
   */
  findByHashPeloSistema(keyHash: string): Promise<IntegrationKeyRecord | null>;
}
```

**Create**: `apps/api/src/modules/integracoes/infra/prisma-integration-key.repository.ts`

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { PrismaAdminService } from '../../../prisma/prisma-admin.service';
import type {
  IntegrationKeyRecord,
  IntegrationKeyRepository,
} from '../domain/integration-key.repository';

/** `keyHash` fica FORA de todo `select`: o que não sai do banco não vaza. */
const CAMPOS = {
  id: true,
  ownerId: true,
  name: true,
  prefix: true,
  scopes: true,
  lastUsedAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

@Injectable()
export class PrismaIntegrationKeyRepository implements IntegrationKeyRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: PrismaAdminService,
  ) {}

  findManyByOwner(ownerId: string): Promise<IntegrationKeyRecord[]> {
    return this.prisma.db.integrationKey.findMany({
      where: { ownerId },
      select: CAMPOS,
      orderBy: { createdAt: 'asc' },
    });
  }

  findById(ownerId: string, id: string) {
    return this.prisma.db.integrationKey.findFirst({
      where: { id, ownerId },
      select: CAMPOS,
    });
  }

  create(data: {
    ownerId: string;
    name: string;
    keyHash: string;
    prefix: string;
    scopes: string[];
  }) {
    return this.prisma.db.integrationKey.create({ data, select: CAMPOS });
  }

  replaceSecret(
    ownerId: string,
    id: string,
    data: { keyHash: string; prefix: string },
  ) {
    return this.prisma.db.integrationKey.update({
      where: { id },
      data: { ...data, lastUsedAt: null, revokedAt: null },
      select: CAMPOS,
    });
  }

  revoke(ownerId: string, id: string) {
    return this.prisma.db.integrationKey.update({
      where: { id },
      data: { revokedAt: new Date() },
      select: CAMPOS,
    });
  }

  async delete(ownerId: string, id: string): Promise<void> {
    await this.prisma.db.integrationKey.delete({ where: { id } });
  }

  async touch(ownerId: string, id: string): Promise<void> {
    await this.prisma.db.integrationKey.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }

  /**
   * Autenticação: roda ANTES de qualquer `app.owner_id` (é ela que descobre
   * qual owner é), então `IntegrationKey` — que tem RLS — só é visível pelo
   * client admin. Precedente: `AccessService` e `prisma-invite.repository.ts`.
   */
  findByHashPeloSistema(keyHash: string) {
    return this.admin.integrationKey.findUnique({
      where: { keyHash },
      select: CAMPOS,
    });
  }
}
```

> `update`/`delete` usam `where: { id }` (PK) e não `{ id, ownerId }` porque o RLS já fecha a linha de outro owner: `FORCE ROW LEVEL SECURITY` faz o `UPDATE` casar zero linhas e o Prisma responder `P2025`. O `ownerId` continua no `findById` do service, que é quem transforma isso em `404` legível.

**Create**: `apps/api/src/modules/integracoes/application/integration-keys.service.ts`

```ts
import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../../audit/audit.service';
import {
  INTEGRATION_KEY_REPOSITORY,
  type IntegrationKeyRecord,
  type IntegrationKeyRepository,
} from '../domain/integration-key.repository';
import { isIntegrationScope } from '../domain/integration-scope';

/** Prefixo do valor bruto. Reconhecível num grep de segredo vazado. */
const PREFIXO = 'crm_';
/** `crm_` + 8 hex: o bastante para a pessoa reconhecer a chave na tela. */
const TAMANHO_DO_PREFIXO = PREFIXO.length + 8;

/** A chave para a API. Sem `keyHash`, sem valor bruto — mascarada. */
export interface ChaveParaApi {
  id: string;
  nome: string;
  /** `crm_a1b2c3d4••••••••` — o que a interface exibe. */
  mascarada: string;
  escopos: string[];
  criadaEm: Date;
  ultimoUsoEm: Date | null;
  revogadaEm: Date | null;
}

/** Emissão e rotação: o ÚNICO retorno que carrega o valor bruto. */
export interface ChaveEmitida {
  chave: ChaveParaApi;
  /** Existe uma vez. Não é relido de lugar nenhum depois desta resposta. */
  valor: string;
}

/**
 * Chaves de integração do owner — a máquina de segredo-por-registro.
 *
 * Cinco garantias, e cada uma tem um lugar no código:
 *  1. **Geração** — 32 bytes de `randomBytes`, hex, com prefixo reconhecível.
 *  2. **Exibição única** — o valor bruto só existe no retorno de `emitir` e
 *     `rotacionar`; o repositório nunca faz `select` de `keyHash`.
 *  3. **Mascaramento** — `paraApi` é o único caminho para a fronteira HTTP.
 *  4. **Ausência em log e no diff da auditoria** — os logs daqui carregam
 *     `chaveId` e `prefixo`, nunca o valor; `keyHash`/`prefix` estão em
 *     `CAMPOS_OMITIDOS` (`shared/audit-diff.ts`).
 *  5. **Rotação** — troca o segredo da MESMA linha, e a anterior morre na hora.
 *
 * **Recuperar chave perdida não existe, e não é omissão**: o banco guarda hash.
 * Quem perdeu rotaciona.
 */
@Injectable()
export class IntegrationKeysService {
  private readonly logger = new Logger(IntegrationKeysService.name);

  constructor(
    @Inject(INTEGRATION_KEY_REPOSITORY)
    private readonly repo: IntegrationKeyRepository,
    private readonly audit: AuditService,
  ) {}

  async list(ownerId: string): Promise<ChaveParaApi[]> {
    const chaves = await this.repo.findManyByOwner(ownerId);
    return chaves.map((c) => this.paraApi(c));
  }

  /** Emite uma chave nova. O valor bruto volta UMA vez, aqui. */
  async emitir(params: {
    ownerId: string;
    name: string;
    scopes: string[];
  }): Promise<ChaveEmitida> {
    const escopos = params.scopes.filter(isIntegrationScope);
    const valor = this.gerar();
    const criada = await this.repo.create({
      ownerId: params.ownerId,
      name: params.name.trim(),
      keyHash: this.hash(valor),
      prefix: valor.slice(0, TAMANHO_DO_PREFIXO),
      scopes: escopos,
    });
    await this.audit.registrar({
      entity: 'INTEGRATION',
      entityId: criada.id,
      entityLabel: criada.name,
      action: 'CRIAR',
      extra: { escopos },
    });
    this.logger.log({
      evento: 'integracao.chave_emitida',
      msg: 'Chave de integração emitida.',
      chaveId: criada.id,
      prefixo: criada.prefix,
      escopos,
    });
    return { chave: this.paraApi(criada), valor };
  }

  /**
   * Troca o segredo e devolve o novo, uma vez. A chave anterior deixa de
   * autenticar IMEDIATAMENTE — não há janela de convivência, como no convite
   * de colaborador. Rotacionar uma chave revogada a reativa.
   */
  async rotacionar(ownerId: string, id: string): Promise<ChaveEmitida> {
    const atual = await this.assertDoOwner(ownerId, id);
    const valor = this.gerar();
    const nova = await this.repo.replaceSecret(ownerId, id, {
      keyHash: this.hash(valor),
      prefix: valor.slice(0, TAMANHO_DO_PREFIXO),
    });
    await this.audit.registrar({
      entity: 'INTEGRATION',
      entityId: id,
      entityLabel: atual.name,
      action: 'ROTACIONAR',
    });
    this.logger.warn({
      evento: 'integracao.chave_rotacionada',
      msg: 'Chave de integração rotacionada: a anterior deixou de valer.',
      chaveId: id,
      prefixo: nova.prefix,
    });
    return { chave: this.paraApi(nova), valor };
  }

  /** Revoga sem apagar: a tela precisa dizer que a chave existia e morreu. */
  async revogar(ownerId: string, id: string): Promise<ChaveParaApi> {
    const atual = await this.assertDoOwner(ownerId, id);
    const revogada = await this.repo.revoke(ownerId, id);
    await this.audit.registrar({
      entity: 'INTEGRATION',
      entityId: id,
      entityLabel: atual.name,
      action: 'EXCLUIR',
    });
    this.logger.warn({
      evento: 'integracao.chave_revogada',
      msg: 'Chave de integração revogada.',
      chaveId: id,
      prefixo: revogada.prefix,
    });
    return this.paraApi(revogada);
  }

  /** Apaga a linha. Usado quando o registro que ela credencia deixa de existir. */
  async apagar(ownerId: string, id: string): Promise<void> {
    await this.repo.delete(ownerId, id);
  }

  /**
   * Autentica o valor apresentado no header e exige o escopo.
   *
   * Sem `timingSafeEqual`: a comparação não é feita em código, é um
   * `findUnique` pelo sha256 — não existe segredo local com que comparar byte
   * a byte, e o índice não vaza o valor.
   */
  async autenticar(
    valor: string,
    escopo: string,
  ): Promise<{ ownerId: string; keyId: string }> {
    const chave = await this.repo.findByHashPeloSistema(this.hash(valor));
    if (!chave || chave.revokedAt) {
      // Nunca logar o valor recebido: a linha vive 30 dias num Grafana publicado.
      this.logger.warn({
        evento: 'integracao.chave_recusada',
        msg: 'Chave de integração inexistente ou revogada.',
      });
      throw new UnauthorizedException('Chave de integração inválida.');
    }
    if (!chave.scopes.includes(escopo)) {
      this.logger.warn({
        evento: 'integracao.escopo_insuficiente',
        msg: 'Chave de integração sem o escopo exigido pela rota.',
        chaveId: chave.id,
        escopoExigido: escopo,
      });
      throw new ForbiddenException(
        'Esta chave de integração não tem permissão para esta operação.',
      );
    }
    return { ownerId: chave.ownerId, keyId: chave.id };
  }

  /** Marca o último uso. Chamado DENTRO do contexto de owner de quem usou. */
  registrarUso(ownerId: string, keyId: string): Promise<void> {
    return this.repo.touch(ownerId, keyId);
  }

  private async assertDoOwner(
    ownerId: string,
    id: string,
  ): Promise<IntegrationKeyRecord> {
    const chave = await this.repo.findById(ownerId, id);
    if (!chave) throw new NotFoundException('Chave de integração não encontrada.');
    return chave;
  }

  /** 32 bytes: mesma entropia do token de convite (`invites.service.ts:67`). */
  private gerar(): string {
    return `${PREFIXO}${randomBytes(32).toString('hex')}`;
  }

  /** Hash determinístico: permite busca indexada pelo valor apresentado. */
  private hash(valor: string): string {
    return createHash('sha256').update(valor).digest('hex');
  }

  /** A única saída para a fronteira HTTP. Mascara, nunca revela. */
  private paraApi(c: IntegrationKeyRecord): ChaveParaApi {
    return {
      id: c.id,
      nome: c.name,
      mascarada: `${c.prefix}${'•'.repeat(8)}`,
      escopos: c.scopes,
      criadaEm: c.createdAt,
      ultimoUsoEm: c.lastUsedAt,
      revogadaEm: c.revokedAt,
    };
  }
}
```

**Create**: `apps/api/src/modules/integracoes/api/integracoes.controller.ts`

```ts
import { Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentOwnerId } from '../../../shared/current-user.decorator';
import { RequirePermission } from '../../access/require-permission.decorator';
import { IntegrationKeysService } from '../application/integration-keys.service';
import { INTEGRATION_SCOPES } from '../domain/integration-scope';

/**
 * Chaves de integração do owner. Não há POST de criação avulsa: chave nasce
 * junto do registro que ela credencia (hoje, o canal de captação) — chave com
 * escopo `lead:receber` e sem canal autenticaria uma ingestão sem roteamento
 * nem fonte, um estado que não serve para nada.
 */
@Controller('integracoes')
export class IntegracoesController {
  constructor(private readonly keys: IntegrationKeysService) {}

  /** Catálogo de escopos — o front consome os rótulos daqui, não os duplica. */
  @Get('escopos')
  @RequirePermission('integracao:gerenciar')
  escopos() {
    return INTEGRATION_SCOPES;
  }

  @Get('chaves')
  @RequirePermission('integracao:gerenciar')
  list(@CurrentOwnerId() ownerId: string) {
    return this.keys.list(ownerId);
  }

  /** Devolve o valor bruto da chave nova — a última vez que ele existe. */
  @Post('chaves/:id/rotacionar')
  @RequirePermission('integracao:gerenciar')
  rotacionar(
    @CurrentOwnerId() ownerId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.keys.rotacionar(ownerId, id);
  }

  /** Revoga (a linha continua no banco, para a tela e a trilha explicarem). */
  @Delete('chaves/:id')
  @RequirePermission('integracao:gerenciar')
  revogar(
    @CurrentOwnerId() ownerId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.keys.revogar(ownerId, id);
  }
}
```

**Create**: `apps/api/src/modules/integracoes/integracoes.module.ts`

```ts
import { Module } from '@nestjs/common';
import { IntegracoesController } from './api/integracoes.controller';
import { IntegrationKeysService } from './application/integration-keys.service';
import { INTEGRATION_KEY_REPOSITORY } from './domain/integration-key.repository';
import { PrismaIntegrationKeyRepository } from './infra/prisma-integration-key.repository';

/**
 * Credencial de máquina por owner. Não importa módulo de negócio nenhum e não
 * conhece lead: é o que permite a Fase 19-B acrescentar escopo de webhook
 * reusando esta máquina sem passar por captação. Quem depende é `leads`.
 */
@Module({
  controllers: [IntegracoesController],
  providers: [
    IntegrationKeysService,
    {
      provide: INTEGRATION_KEY_REPOSITORY,
      useClass: PrismaIntegrationKeyRepository,
    },
  ],
  exports: [IntegrationKeysService],
})
export class IntegracoesModule {}
```

**Modify**: `apps/api/src/app.module.ts`

Importar o módulo novo logo antes de `CatalogosModule` (`:65`), e registrar na lista de `imports`:

```ts
import { IntegracoesModule } from './modules/integracoes/integracoes.module';
// …
    WorkspaceModule,
    IntegracoesModule,
    CatalogosModule,
```

#### Permissão e auditoria

**Modify**: `apps/api/src/shared/permissions.ts`

Acrescentar ao fim do bloco `Organização` (depois de `dados:importar`, `:194`):

```ts
  {
    key: 'integracao:gerenciar',
    label: 'Gerenciar integrações',
    description:
      'Criar canais de captação e emitir, rotacionar e revogar as chaves que permitem a sistemas de fora gravar na workspace',
    category: 'Organização',
  },
```

> **Sem backfill.** Diferente de `20260727100000_assignee_per_record/migration.sql:40-60`, nenhuma migration concede esta chave a papéis existentes: ela emite credencial que escreve na workspace, e ninguém deve recebê-la por herança. Owner e papel `system` já a têm em runtime (`ALL_PERMISSION_KEYS`).

**Modify**: `apps/api/src/shared/audit-diff.ts`

```ts
const CAMPOS_OMITIDOS = new Set([
  'passwordHash',
  'tokenHash',
  'keyHash', // sha256 da chave de integração (Fase 17-A)
  'prefix', // pedaço em claro da chave: não é segredo, mas é ruído na trilha
  'refreshTokenHash',
  // …
```

**Modify**: `apps/web/src/lib/labels.ts`

```ts
export const AUDIT_ENTITY_LABELS = {
  // …
  IMPORT: 'Importação',
  INTEGRATION: 'Integração',
} as const;

export const AUDIT_ACTION_LABELS = {
  // …
  IMPORTAR: 'Importou',
  ROTACIONAR: 'Rotacionou a chave',
} as const;
```

#### Testes

**Modify**: `apps/api/test/rls.e2e-spec.ts`

A contagem-âncora sobe de 22 para 23 (`:82-90`) — o comentário do próprio teste manda fazer isso junto da migration:

```ts
    it('as 23 tabelas protegidas hoje continuam protegidas', async () => {
      // …
      expect(Number(total)).toBe(23);
```

**Create**: `apps/api/src/modules/integracoes/application/integration-keys.service.spec.ts`

Repositório e auditoria mockados (é spec de regra). Casos obrigatórios:

```ts
it('emite com 32 bytes de entropia, prefixo reconhecível e hash sha256 do valor', async () => {
  const { valor, chave } = await service.emitir({ ownerId: OWNER, name: 'Site', scopes: ['lead:receber'] });

  expect(valor).toMatch(/^crm_[0-9a-f]{64}$/);
  const [{ keyHash, prefix }] = repo.create.mock.calls[0] as [{ keyHash: string; prefix: string }];
  expect(keyHash).toBe(createHash('sha256').update(valor).digest('hex'));
  expect(prefix).toBe(valor.slice(0, 12));
  // O molde de `invites.service.spec.ts:81-89`: o valor cru não sobra em lugar nenhum.
  expect(JSON.stringify(repo.create.mock.calls)).not.toContain(valor);
  expect(chave.mascarada).toBe(`${prefix}••••••••`);
  expect(JSON.stringify(chave)).not.toContain(valor);
});

it('nunca escreve o valor bruto no log', async () => {
  const { valor } = await service.emitir({ ownerId: OWNER, name: 'Site', scopes: ['lead:receber'] });
  // `CHAVE_SENSIVEL` (shared/logging/log.ts:28) NÃO cobre `chave` nem `prefixo`:
  // a garantia aqui é o campo escolhido, não a rede automática.
  expect(JSON.stringify(logSpy.mock.calls)).not.toContain(valor);
});

it('descarta escopo fora do catálogo', /* scopes: ['lead:receber', 'inventado'] → ['lead:receber'] */);
it('autentica pelo hash e devolve o ownerId da chave', /* … */);
it('recusa chave inexistente e chave revogada com a MESMA mensagem', /* 401 nos dois */);
it('recusa chave sem o escopo exigido com 403', /* … */);
it('rotacionar troca o segredo da mesma linha, zera o uso e registra ROTACIONAR', /* … */);
it('revogar preserva a linha e registra EXCLUIR', /* … */);
```

**Create**: `apps/api/test/integracoes.e2e-spec.ts`

Chaves semeadas por `clientAdmin()` (não há endpoint de criação avulsa nesta fase):

```ts
it('lista as chaves mascaradas, sem hash nenhum no corpo', /* … */);
it('rotacionar devolve o valor novo uma vez e invalida o anterior no banco', /* … */);
it('a chave de outro owner responde 404, não 403', /* RLS: a linha é invisível */);
it('sem `integracao:gerenciar` a rota responde 403', /* criarPapel sem a chave */);
it('revogar preenche revokedAt e a linha continua no banco', /* … */);
```

### Success Criteria

#### Automated Verification

- [x] `docker compose up -d` — Postgres de pé em `localhost:5435`
- [x] `pnpm --filter api prisma migrate dev` — a migration aplica no banco local
- [x] `DATABASE_URL=postgresql://crm_user:crm_password@localhost:5435/crm_db apps/api/scripts/validar-migrations-com-dados.sh` — o portão de migration com dado dentro passa, incluindo a invariante de RLS da tabela nova
- [x] `pnpm --filter api lint` — sem erro
- [x] `pnpm --filter api build` — compila
- [x] `pnpm --filter api test -- integration-keys` — o spec do service passa, incluindo as duas asserções de não-vazamento
- [x] `pnpm --filter api test:e2e -- integracoes` — o e2e novo passa
- [x] `pnpm --filter api test:e2e -- rls` — a âncora de 23 policies passa
- [x] `pnpm --filter web build` — o front compila com os rótulos novos de auditoria

#### Manual Verification

- [ ] `GET /api/v1/integracoes/chaves` com sessão de owner devolve `[]` e nenhum campo `keyHash` aparece na resposta
- [ ] `GET /api/v1/integracoes/escopos` devolve `lead:receber` com rótulo em pt-BR
- [ ] Com uma chave semeada à mão, `POST /integracoes/chaves/:id/rotacionar` devolve `valor` uma vez; repetir o GET não devolve `valor` nenhum
- [ ] Nenhuma linha de log da rotação contém o valor bruto (`docker compose logs api | grep crm_`)
- [ ] A trilha em `/administracao/auditoria` mostra "Rotacionou a chave — Integração"

**⏸ PAUSE**: Depois da verificação automatizada, parar para confirmação humana dos testes manuais antes da Fase 2.

---

## Phase 2: Canal de captação e ingestão multi-owner

### Goal

A ingestão descobre a workspace pela chave apresentada, e não pelo ambiente; o token de ambiente continua aceito como caminho legado.

### Changes

#### Modelo de dados

**Modify**: `apps/api/prisma/schema.prisma`

```prisma
// Canal de captação de lead: uma origem externa que entrega lead ao CRM
// ("Site institucional", "Landing agenda cheia", "n8n").
//
// Guarda a configuração de ROTEAMENTO — quem atende e como o lead é
// classificado — e a chave que autentica a entrega. Um canal, uma chave:
// revogar um canal não derruba os outros, que é o ponto de existirem N.
//
// Esta tabela é do domínio de lead e mora em `modules/leads`; a credencial em
// si é genérica e mora em `modules/integracoes`. A dependência aponta
// leads → integracoes, nunca o contrário.
model LeadIntakeChannel {
  id         String             @id @default(uuid())
  ownerId    String
  owner      User               @relation("OwnerLeadIntakeChannels", fields: [ownerId], references: [id], onDelete: Cascade)
  name       String
  /// Responsável de todo lead que entra por aqui. Opcional: sem ele o lead
  /// nasce sem responsável e continua visível para a workspace inteira
  /// (`shared/record-scope.ts:10-11`). `SetNull` porque apagar um usuário não
  /// pode apagar a configuração do owner.
  assigneeId String?
  assignee   User?              @relation("AssignedLeadIntakeChannels", fields: [assigneeId], references: [id], onDelete: SetNull)
  /// Fonte de lead gravada no cadastro. `Restrict` como `Client.sourceId`:
  /// excluir uma fonte em uso não apaga a configuração.
  sourceId   String?
  source     LeadSourceCatalog? @relation(fields: [sourceId], references: [id], onDelete: Restrict)
  /// A chave que autentica este canal. `SetNull` para o canal sobreviver ao
  /// apagar da chave — sem chave ele existe, configurado e mudo.
  keyId      String?            @unique
  key        IntegrationKey?    @relation(fields: [keyId], references: [id], onDelete: SetNull)
  createdAt  DateTime           @default(now())
  updatedAt  DateTime           @updatedAt

  @@unique([ownerId, name])
  @@index([ownerId])
  @@index([sourceId])
}
```

Back-relations:

```prisma
model User {
  // …
  leadIntakeChannels  LeadIntakeChannel[] @relation("OwnerLeadIntakeChannels")
  assignedLeadIntakeChannels LeadIntakeChannel[] @relation("AssignedLeadIntakeChannels")
}

model LeadSourceCatalog {
  // …
  leadIntakeChannels LeadIntakeChannel[]
}

model IntegrationKey {
  // …
  leadIntakeChannel LeadIntakeChannel?
}
```

**Create**: `apps/api/prisma/migrations/20260812100000_lead_intake_channel/migration.sql`

```sql
CREATE TABLE "LeadIntakeChannel" (
  "id"         TEXT NOT NULL,
  "ownerId"    TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "assigneeId" TEXT,
  "sourceId"   TEXT,
  "keyId"      TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeadIntakeChannel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeadIntakeChannel_ownerId_name_key" ON "LeadIntakeChannel"("ownerId", "name");
CREATE UNIQUE INDEX "LeadIntakeChannel_keyId_key" ON "LeadIntakeChannel"("keyId");
CREATE INDEX "LeadIntakeChannel_ownerId_idx" ON "LeadIntakeChannel"("ownerId");
CREATE INDEX "LeadIntakeChannel_sourceId_idx" ON "LeadIntakeChannel"("sourceId");

ALTER TABLE "LeadIntakeChannel" ADD CONSTRAINT "LeadIntakeChannel_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadIntakeChannel" ADD CONSTRAINT "LeadIntakeChannel_assigneeId_fkey"
  FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- RESTRICT: excluir uma fonte de lead em uso não apaga a configuração do canal.
ALTER TABLE "LeadIntakeChannel" ADD CONSTRAINT "LeadIntakeChannel_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "LeadSourceCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeadIntakeChannel" ADD CONSTRAINT "LeadIntakeChannel_keyId_fkey"
  FOREIGN KEY ("keyId") REFERENCES "IntegrationKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS por ownerId (molde de 20260805100000_lead_source_catalog)
ALTER TABLE "LeadIntakeChannel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeadIntakeChannel" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "LeadIntakeChannel"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "LeadIntakeChannel" TO crm_app;
```

> **Sem backfill, de propósito.** Um canal provisionado por migration nasceria sem chave (a migration não pode gerar um segredo que ninguém vê) e portanto sem receber nada — configuração morta. Quem já capta continua captando pelo caminho legado, e cria o canal na tela quando quiser migrar. Por não haver backfill nem troca de constraint, a única invariante nova é a de RLS.

**Modify**: `apps/api/prisma/fixtures/invariantes.sql`

Acrescentar `'LeadIntakeChannel'` ao `IN (…)` do bloco de RLS, e um bloco novo para o isolamento das FKs cruzadas:

```sql
-- Canal de captação não pode apontar para a fonte de lead de OUTRO owner.
DO $$
DECLARE cruzados INT;
BEGIN
  SELECT count(*) INTO cruzados
    FROM "LeadIntakeChannel" ch
    JOIN "LeadSourceCatalog" s ON s."id" = ch."sourceId"
   WHERE s."ownerId" <> ch."ownerId";
  IF cruzados > 0 THEN
    RAISE EXCEPTION 'Há % canal(is) de captação apontando para fonte de OUTRO owner — isolamento por ownerId quebrado.', cruzados;
  END IF;
END $$;
```

#### `LeadsModule` passa a ser dono de tabela

**Create**: `apps/api/src/modules/leads/domain/lead-intake-channel.repository.ts`

```ts
export const LEAD_INTAKE_CHANNEL_REPOSITORY = Symbol(
  'LEAD_INTAKE_CHANNEL_REPOSITORY',
);

export interface LeadIntakeChannelRecord {
  id: string;
  ownerId: string;
  name: string;
  assigneeId: string | null;
  sourceId: string | null;
  keyId: string | null;
  createdAt: Date;
}

export interface LeadIntakeChannelRepository {
  findManyByOwner(ownerId: string): Promise<LeadIntakeChannelRecord[]>;
  findById(
    ownerId: string,
    id: string,
  ): Promise<LeadIntakeChannelRecord | null>;
  /** O canal que a chave autentica. Roda DENTRO do contexto do owner. */
  findByKeyId(
    ownerId: string,
    keyId: string,
  ): Promise<LeadIntakeChannelRecord | null>;
  create(data: {
    ownerId: string;
    name: string;
    assigneeId?: string | null;
    sourceId?: string | null;
    keyId: string;
  }): Promise<LeadIntakeChannelRecord>;
  update(
    ownerId: string,
    id: string,
    data: { name?: string; assigneeId?: string | null; sourceId?: string | null },
  ): Promise<LeadIntakeChannelRecord>;
  delete(ownerId: string, id: string): Promise<void>;
}
```

**Create**: `apps/api/src/modules/leads/infra/prisma-lead-intake-channel.repository.ts`

Implementação direta por `this.prisma.db.leadIntakeChannel`, com `select` explícito dos campos de `LeadIntakeChannelRecord`. `findByKeyId` usa `findFirst({ where: { keyId, ownerId } })`. Sem client admin: **todas** as leituras deste repositório acontecem dentro de contexto de owner (as do CRUD pelo `OwnerContextInterceptor`, a da ingestão dentro de `executarComoOwner`).

**Create**: `apps/api/src/modules/leads/application/lead-intake-channels.service.ts`

```ts
/**
 * Canais de captação do owner.
 *
 * Canal e chave nascem e morrem juntos: criar um canal emite a chave (e é a
 * única vez que o valor bruto existe), apagar o canal apaga a chave. Canal sem
 * chave não recebe nada, e chave com escopo `lead:receber` sem canal gravaria
 * lead sem roteamento e sem fonte — nenhum dos dois estados serve.
 */
@Injectable()
export class LeadIntakeChannelsService {
  constructor(
    @Inject(LEAD_INTAKE_CHANNEL_REPOSITORY)
    private readonly repo: LeadIntakeChannelRepository,
    private readonly keys: IntegrationKeysService,
    private readonly members: WorkspaceMembersService,
    private readonly catalogos: CatalogosService,
    private readonly audit: AuditService,
  ) {}

  async create(ownerId: string, dto: CreateLeadIntakeChannelDto) {
    await this.validar(ownerId, dto);
    // A chave primeiro: se a emissão falhar, não sobra canal mudo no banco.
    const emitida = await this.keys.emitir({
      ownerId,
      name: dto.name,
      scopes: [ESCOPO_RECEBER_LEAD],
    });
    const canal = await this.repo.create({
      ownerId,
      name: dto.name.trim(),
      assigneeId: dto.assigneeId ?? null,
      sourceId: dto.sourceId ?? null,
      keyId: emitida.chave.id,
    });
    this.logger.log({
      evento: 'lead.canal_criado',
      msg: 'Canal de captação de lead criado.',
      canalId: canal.id,
      chaveId: emitida.chave.id,
      roteado: Boolean(canal.assigneeId),
    });
    // `valor` só existe aqui. A tela exibe uma vez e não relê.
    return { canal: this.paraApi(canal, emitida.chave), chave: emitida.valor };
  }

  async update(ownerId: string, id: string, dto: UpdateLeadIntakeChannelDto) {
    await this.assertDoOwner(ownerId, id);
    await this.validar(ownerId, dto);
    const atualizado = await this.repo.update(ownerId, id, { ...dto });
    // …audit ATUALIZAR + log `lead.canal_atualizado`
    return atualizado;
  }

  /** Apaga o canal E a chave: credencial órfã continuaria autenticando. */
  async delete(ownerId: string, id: string): Promise<void> {
    const canal = await this.assertDoOwner(ownerId, id);
    await this.repo.delete(ownerId, id);
    if (canal.keyId) await this.keys.apagar(ownerId, canal.keyId);
    // …audit EXCLUIR + log `lead.canal_excluido`
  }

  /**
   * Responsável tem de ser membro da workspace (`User` não tem RLS — este é o
   * único portão) e fonte de lead tem de estar utilizável.
   */
  private async validar(
    ownerId: string,
    dto: { assigneeId?: string | null; sourceId?: string | null },
  ): Promise<void> {
    await this.members.assertMember(ownerId, dto.assigneeId);
    if (dto.sourceId) {
      await this.catalogos.assertUtilizavel(ownerId, 'fontes-de-lead', dto.sourceId);
    }
  }
}
```

**Create**: `apps/api/src/modules/leads/api/dto/create-lead-intake-channel.dto.ts`

```ts
export class CreateLeadIntakeChannelDto {
  @IsString({ message: 'O nome do canal é obrigatório.' })
  @MinLength(2, { message: 'O nome deve ter no mínimo 2 caracteres.' })
  @MaxLength(60)
  name: string;

  /** Responsável de todo lead deste canal. `null` = sem responsável. */
  @IsOptional() @IsUUID() assigneeId?: string | null;

  /** Fonte de lead do catálogo do owner. `null` = não classifica. */
  @IsOptional() @IsUUID() sourceId?: string | null;
}
```

**Create**: `apps/api/src/modules/leads/api/dto/update-lead-intake-channel.dto.ts` — os mesmos campos, todos opcionais.

**Create**: `apps/api/src/modules/leads/api/lead-intake-channels.controller.ts`

`@Controller('leads/canais')`, `@RequirePermission('integracao:gerenciar')` em todas as rotas: `GET /`, `POST /`, `PATCH /:id`, `DELETE /:id`.

#### Autenticação da ingestão

**Create**: `apps/api/src/modules/leads/api/intake-context.ts`

```ts
/**
 * O que a autenticação da ingestão descobriu. O `ownerId` sai daqui e de mais
 * nenhum lugar — em especial, nunca do corpo da requisição
 * (`PrismaService.executarComoOwner`, obrigação 1).
 */
export interface ContextoDeIntegracao {
  ownerId: string;
  /** `null` no caminho legado: token de ambiente não tem canal nem chave. */
  keyId: string | null;
}

export const INTAKE_CONTEXT = 'integracaoDaIngestao';

/** Publicado pelo guard, lido pelo controller. */
export const IntakeContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ContextoDeIntegracao => {
    const req = ctx.switchToHttp().getRequest<Request>();
    const contexto = req[INTAKE_CONTEXT] as ContextoDeIntegracao | undefined;
    if (!contexto) {
      // Só acontece se a rota perder o guard — e aí ela não pode gravar nada.
      throw new UnauthorizedException('Chave de integração inválida.');
    }
    return contexto;
  },
);
```

**Delete**: `apps/api/src/modules/leads/api/lead-intake-token.guard.ts` → **substituído** por:

**Create**: `apps/api/src/modules/leads/api/lead-intake-key.guard.ts`

```ts
/**
 * Autenticação da ingestão externa de lead. A rota é `@Public()` (quem chama é
 * um servidor, não uma sessão), então este guard é a única porta — e ele
 * publica no request o `ownerId` que a chave revelou, porque é ele, e nunca o
 * corpo, que decide em qual workspace a rota grava.
 *
 * DUAS credenciais são aceitas, por uma janela de transição:
 *  1. **Chave de integração** (`IntegrationKey` com escopo `lead:receber`) — o
 *     caminho novo, que traz canal, responsável e fonte de lead.
 *  2. **`LEAD_INTAKE_TOKEN` do ambiente** — o caminho LEGADO, que se comporta
 *     exatamente como antes desta fase: sem canal, sem roteamento, sem fonte.
 *     Ele existe porque o emissor (`site-v2`) vive em outro repositório: cortar
 *     sem coordenar os dois deploys perderia lead sem erro visível no site.
 *     Sai num PR próprio, junto das duas variáveis de ambiente.
 */
@Injectable()
export class LeadIntakeKeyGuard implements CanActivate {
  private readonly logger = new Logger(LeadIntakeKeyGuard.name);

  constructor(
    private readonly keys: IntegrationKeysService,
    private readonly legado: TokenLegadoService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const [tipo, valor] = req.headers.authorization?.split(' ') ?? [];
    if (tipo !== 'Bearer' || !valor) {
      // Nunca logar o valor recebido: a linha vive 30 dias num Grafana publicado.
      this.logger.warn({
        evento: 'lead.token_recusado',
        msg: 'Ingestão de lead recusada por credencial ausente.',
      });
      throw new UnauthorizedException('Chave de integração inválida.');
    }

    // O caminho legado primeiro, e só quando ele CASA: comparação em tempo
    // constante contra o segredo do ambiente, como antes desta fase. Não casou,
    // a credencial é tratada como chave de integração.
    if (this.legado.confere(valor)) {
      const ownerId = await this.legado.resolverOwner();
      this.logger.warn({
        evento: 'lead.token_legado_aceito',
        msg: 'Ingestão aceita pelo token de ambiente (legado): sem canal, responsável nem fonte.',
        ownerId,
      });
      req[INTAKE_CONTEXT] = { ownerId, keyId: null };
      return true;
    }

    // `autenticar` lança 401 (inexistente/revogada) ou 403 (sem o escopo).
    const { ownerId, keyId } = await this.keys.autenticar(
      valor,
      ESCOPO_RECEBER_LEAD,
    );
    req[INTAKE_CONTEXT] = { ownerId, keyId };
    return true;
  }
}
```

**Create**: `apps/api/src/modules/leads/application/token-legado.service.ts`

Recebe o que hoje é `LeadIntakeTokenGuard.confere` + `LeadsIntakeService.resolverOwner`, sem mudar nenhuma linha de comportamento nem nenhum nome de evento (`lead.ingestao_desconfigurada`, `lead.owner_nao_configurado`, `lead.owner_nao_encontrado` continuam idênticos — renomear quebraria a contagem histórica no Grafana). Arquivo isolado de propósito: remover o legado é apagar este arquivo e as três referências a ele.

```ts
/**
 * O caminho legado da ingestão: token compartilhado no ambiente e conta de
 * destino por e-mail. **Não evolua este arquivo** — ele existe para a captação
 * em produção não parar entre o deploy da API e o do site, e sai inteiro
 * quando o `site-v2` estiver emitindo com chave de integração.
 */
@Injectable()
export class TokenLegadoService {
  private readonly logger = new Logger(TokenLegadoService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * `true` só quando o valor apresentado É o token do ambiente. Sem
   * `LEAD_INTAKE_TOKEN` configurado devolve `false` — e aí a credencial segue
   * para a autenticação por chave, que é o caminho normal.
   *
   * Comparação sobre o SHA-256 dos dois lados: `timingSafeEqual` exige buffers
   * do mesmo tamanho (com tamanhos diferentes ele lança, e o próprio lançar
   * vaza o tamanho do segredo), e o digest normaliza isso em 32 bytes.
   */
  confere(valor: string): boolean {
    const esperado = this.config.get<string>('LEAD_INTAKE_TOKEN') ?? '';
    if (!esperado) return false;
    const digest = (v: string) => createHash('sha256').update(v, 'utf8').digest();
    return timingSafeEqual(digest(valor), digest(esperado));
  }

  /** A conta que recebe, pelo e-mail do owner no ambiente. `User` não tem RLS. */
  async resolverOwner(): Promise<string> {
    /* corpo idêntico ao `resolverOwner` de leads-intake.service.ts:167-195,
       com os MESMOS eventos e as MESMAS mensagens de 503 */
  }
}
```

**Modify**: `apps/api/src/modules/leads/api/leads-intake.controller.ts`

```ts
  @Public()
  @UseGuards(LeadIntakeKeyGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post('intake')
  @HttpCode(200)
  receber(
    @Body() dto: IntakeLeadDto,
    @IntakeContext() contexto: ContextoDeIntegracao,
  ) {
    return this.service.receber(dto, contexto);
  }
```

**Modify**: `apps/api/src/modules/leads/application/leads-intake.service.ts`

`resolverOwner()` (`:151-195`) e a dependência de `ConfigService` **saem** do service. `receber` passa a receber o contexto:

```ts
  async receber(
    dto: IntakeLeadDto,
    contexto: ContextoDeIntegracao,
  ): Promise<ResultadoDeIngestao> {
    const { ownerId } = contexto;

    const gravado = await this.prisma.executarComoOwner(ownerId, () =>
      this.gravar(ownerId, contexto, dto),
    );
    // … notificação pós-commit e log, como hoje (o destinatário muda na Fase 3)
  }
```

E o docblock da classe: a decisão 3 ("a conta que recebe vem do ambiente") passa a ser "a conta que recebe vem da chave apresentada, nunca do corpo".

**Modify**: `apps/api/src/modules/leads/leads.module.ts`

```ts
@Module({
  imports: [
    ClientsModule,
    ContactsModule,
    IntegracoesModule,
    CatalogosModule,
    WorkspaceModule,
  ],
  controllers: [LeadsIntakeController, LeadIntakeChannelsController],
  providers: [
    LeadsIntakeService,
    LeadIntakeChannelsService,
    TokenLegadoService,
    LeadIntakeKeyGuard,
    {
      provide: LEAD_INTAKE_CHANNEL_REPOSITORY,
      useClass: PrismaLeadIntakeChannelRepository,
    },
  ],
})
export class LeadsModule {}
```

E o docblock: o módulo **passa** a ser dono de tabela (`LeadIntakeChannel`), por isso ganha `domain/` e `infra/`.

#### Documentação

**Modify**: `apps/api/ENDPOINTS.md`

1. Reescrever o bloco `POST /leads/intake` (`:311-321`): **Auth** passa a descrever a chave (`Authorization: Bearer crm_…`, escopo `lead:receber`) e menciona o token de ambiente como legado; **Erros** ganha `403 Esta chave de integração não tem permissão para esta operação.` e mantém os dois `503` só no caminho legado.
2. Seção nova **Integrações** com `GET /integracoes/escopos`, `GET /integracoes/chaves`, `POST /integracoes/chaves/:id/rotacionar`, `DELETE /integracoes/chaves/:id` (formato fixo: Propósito / Auth / Body / Resposta / Erros / Handler).
3. Seção nova **Canais de captação de lead** com `GET|POST /leads/canais`, `PATCH|DELETE /leads/canais/:id`, deixando explícito que o `POST` é a **única** resposta que carrega o valor da chave.

#### Testes

**Modify**: `apps/api/test/rls.e2e-spec.ts` — âncora de 23 → **24** policies.

**Rewrite**: `apps/api/test/lead-intake.e2e-spec.ts`

O spec deixa de depender de `test/.env.test` para o caminho principal — ganho colateral real: hoje o token está repetido literalmente no spec porque `ConfigModule.forRoot()` roda no import do `AppModule`, antes de qualquer `beforeAll`. Com a chave no banco, a credencial é criada por fixture.

```ts
/** Cria owner + canal + chave, e devolve o valor bruto para o teste usar. */
async function criarCanal(opts: { assigneeId?: string; sourceId?: string } = {}) {
  const valor = `crm_${randomBytes(32).toString('hex')}`;
  const chave = await clientAdmin().integrationKey.create({
    data: {
      ownerId: owner.id,
      name: 'Site',
      keyHash: createHash('sha256').update(valor).digest('hex'),
      prefix: valor.slice(0, 12),
      scopes: ['lead:receber'],
    },
  });
  await clientAdmin().leadIntakeChannel.create({
    data: { ownerId: owner.id, name: 'Site', keyId: chave.id, ...opts },
  });
  return { valor, chaveId: chave.id };
}

it('recusa sem credencial e com credencial desconhecida, antes de tocar o banco', /* 401, count()===0 */);
it('grava o lead do OWNER DA CHAVE — passa pelo RLS', /* clientAdmin().client.findFirstOrThrow(), ownerId === owner.id */);
it('a chave de um owner não grava na workspace do outro', /* dois owners, duas chaves */);
it('chave revogada responde 401 e não grava', /* revokedAt preenchido */);
it('chave sem o escopo lead:receber responde 403 e não grava', /* scopes: [] */);
it('marca lastUsedAt na chave depois do commit', /* … */);
it('o mesmo WhatsApp não abre segundo cadastro: empilha a nota', /* mantido */);
it('emite LEAD_RECEIVED para o destino do owner que assinou o tipo', /* mantido */);
it('recusa campo fora do contrato e WhatsApp incompleto', /* mantido, 400 */);

describe('caminho legado (token de ambiente)', () => {
  // O token continua vindo de test/.env.test e repetido aqui, pelo mesmo
  // motivo de antes — e é a única parte do spec que depende disso.
  it('aceita o token do ambiente e grava na conta de LEAD_INTAKE_OWNER_EMAIL', /* … */);
  it('sem owner correspondente ao e-mail configurado responde 503', /* … */);
  it('não roteia nem classifica: assigneeId e sourceId ficam nulos', /* … */);
});
```

**Create**: `apps/api/test/lead-intake-channels.e2e-spec.ts`

```ts
it('cria canal com chave e devolve o valor UMA vez', /* body.chave presente */);
it('a listagem devolve a chave mascarada e nunca o valor', /* /crm_.{64}/ ausente */);
it('recusa responsável de outra workspace com 422', /* assertMember */);
it('recusa fonte de lead de outro owner com 404', /* assertUtilizavel */);
it('recusa nome repetido no mesmo owner com 409', /* @@unique([ownerId, name]) */);
it('apagar o canal apaga a chave: a credencial deixa de autenticar', /* POST /leads/intake → 401 */);
it('sem `integracao:gerenciar` responde 403', /* … */);
```

**Modify**: `apps/api/src/modules/leads/application/leads-intake.service.spec.ts`

Sai o mock de `ConfigService` e os dois casos de `resolverOwner` (`:170-191`) — a resolução do owner não é mais deste service; migram para o spec do `TokenLegadoService`. Entra o `contexto` em todas as chamadas de `receber`. A asserção de ordem (`ordem === ['commit', 'notificou']`, `:155`) **permanece**: é ela que prova que o aviso sai pós-commit.

**Create**: `apps/api/src/modules/leads/application/token-legado.service.spec.ts` — os dois casos que saíram do spec da ingestão, mais `confere()`: token ausente → `false`; token errado → `false`; token certo → `true`.

### Success Criteria

#### Automated Verification

- [x] `pnpm --filter api prisma migrate dev` — a migration aplica
- [x] `DATABASE_URL=postgresql://crm_user:crm_password@localhost:5435/crm_db apps/api/scripts/validar-migrations-com-dados.sh` — portão verde, com a invariante nova
- [x] `pnpm --filter api lint && pnpm --filter api build`
- [x] `pnpm --filter api test -- leads` — specs de regra da ingestão e do legado
- [x] `pnpm --filter api test:e2e -- lead-intake` — todos os casos, incluindo o `describe` do legado
- [x] `pnpm --filter api test:e2e -- lead-intake-channels`
- [x] `pnpm --filter api test:e2e -- rls` — âncora de 24 policies
- [x] `pnpm --filter api test:e2e` — a suíte inteira, para pegar regressão no `AppModule`

#### Manual Verification

- [ ] `POST /leads/canais` com sessão de owner devolve `chave` começando com `crm_`; `GET /leads/canais` devolve `crm_…••••••••` e nunca o valor
- [ ] `curl -X POST .../leads/intake -H "Authorization: Bearer <chave>" -d @lead.json` responde `200 { status: 'criado' }` e o cliente aparece em `/clientes` na conta certa
- [ ] A mesma chamada com a chave revogada responde `401`
- [ ] `curl` com o `LEAD_INTAKE_TOKEN` antigo continua respondendo `200` e grava na conta de `LEAD_INTAKE_OWNER_EMAIL`, com `lead.token_legado_aceito` no log
- [ ] `docker compose logs api | grep -c crm_` sobre a linha de ingestão: nenhum valor bruto de chave no log

**⏸ PAUSE**: Parar para confirmação humana antes da Fase 3.

---

## Phase 3: Roteamento do lead e fonte de lead do catálogo

### Goal

O lead que entra por um canal nasce com o responsável e a fonte de lead configurados nele, e o aviso vai para quem vai atender.

### Changes

#### Escrita silenciosa de atribuição

**Modify**: `apps/api/src/modules/clients/application/clients.service.ts`

`create` e `update` disparam `RECORD_ASSIGNED` por `notificar()`, que **exige `AccessContext` no CLS**. Na ingestão não há ator, então cada lead roteado geraria um `notificacao.sem_contexto` — que a documentação classifica como bug de instrumentação — e nenhum aviso. E o aviso certo já existe: `LEAD_RECEIVED`, que na Fase 3 passa a ir para o próprio responsável. Daí a opção explícita:

```ts
/** Opções de escrita de quem chama de fora do caminho de requisição humana. */
export interface OpcoesDeEscritaDeCliente {
  /**
   * `false` desliga o `RECORD_ASSIGNED` da atribuição. Só a ingestão externa
   * de lead usa: ela não tem `AccessContext` (a rota é `@Public()`), então
   * `notificar` cairia no early-return `notificacao.sem_contexto` a cada lead
   * — e o aviso de quem recebeu o lead é o `LEAD_RECEIVED`, que a própria
   * ingestão emite pelo caminho de sistema.
   */
  avisarResponsavel?: boolean;
}

  async create(
    ownerId: string,
    dto: CreateClientDto,
    opcoes: OpcoesDeEscritaDeCliente = {},
  ): Promise<ClientWithAssignee> {
    // …
    if (dto.assigneeId && opcoes.avisarResponsavel !== false) {
      await this.notifications.notificar({ /* … */ });
    }
    return criado;
  }

  async update(
    ownerId: string,
    id: string,
    dto: UpdateClientDto,
    opcoes: OpcoesDeEscritaDeCliente = {},
  ): Promise<ClientWithAssignee> {
    // …
    if (
      assigneeMudou(dto.assigneeId, existing.assigneeId) &&
      opcoes.avisarResponsavel !== false
    ) {
      await this.notifications.notificar({ /* … */ });
    }
```

Nenhum outro chamador muda: o default preserva o comportamento atual.

**Modify**: `apps/api/src/modules/workspace/application/workspace-members.service.ts`

`assertMember` lança `422`, o que na ingestão perderia o lead por uma configuração velha. É preciso a mesma checagem sem exceção:

```ts
  /**
   * O mesmo teste de `assertMember`, sem exceção. Existe para a ingestão
   * externa de lead: um responsável que saiu da workspace (ou foi desativado)
   * não pode fazer a captação responder erro — o lead entra sem responsável, e
   * o log diz que isso aconteceu.
   */
  ehMembro(ownerId: string, userId: string): Promise<boolean> {
    return this.repo.isMember(ownerId, userId);
  }
```

#### A ingestão

**Modify**: `apps/api/src/modules/leads/application/leads-intake.service.ts`

```ts
/** O que a gravação decidiu — inclui o que o aviso e o log precisam saber. */
interface Gravacao extends ResultadoDeIngestao {
  /** Quem ficou responsável, se alguém. É o destinatário do aviso. */
  responsavelId: string | null;
  canalId: string | null;
}

  /** Roda dentro da transação com `app.owner_id` setado. */
  private async gravar(
    ownerId: string,
    contexto: ContextoDeIntegracao,
    dto: IntakeLeadDto,
  ): Promise<Gravacao> {
    const canal = contexto.keyId
      ? await this.canais.findByKeyId(ownerId, contexto.keyId)
      : null;
    const responsavelId = await this.resolverResponsavel(ownerId, canal);

    const telefone = dto.telefone?.trim() || `+55${dto.whatsapp}`;
    const nota = montarNotaDeLead({ /* … como hoje … */ });

    const existente = await this.clients.findByPhoneDigits(ownerId, dto.whatsapp);
    if (existente) {
      /*
        Lead que volta NÃO muda de mão: quem já cuida do cadastro continua
        cuidando, mesmo que o canal aponte para outra pessoa. O responsável do
        canal só entra quando não há ninguém — que é o caso em que o
        roteamento tem algo a resolver. Origem, tags e fonte do cadastro
        existente também ficam como estão: elas contam de onde ele veio na
        PRIMEIRA vez, e reescrever isso apagaria histórico.
      */
      const assumir = responsavelId && !existente.assigneeId;
      await this.clients.update(
        ownerId,
        existente.id,
        {
          notes: empilharNota(existente.notes, nota),
          ...(assumir ? { assigneeId: responsavelId } : {}),
        },
        { avisarResponsavel: false },
      );
      return {
        status: 'atualizado',
        clientId: existente.id,
        responsavelId: existente.assigneeId ?? (assumir ? responsavelId : null),
        canalId: canal?.id ?? null,
      };
    }

    const criado = await this.clients.create(
      ownerId,
      {
        name: dto.empresa?.trim() || dto.nome,
        status: 'LEAD',
        /*
          A tag PERMANECE junto da fonte de lead, e não é redundância: `origem`
          é o rótulo cru de quem capturou ("site-institucional", "/agenda-cheia"
          na página) e distingue duas entregas do MESMO canal; `sourceId` é a
          classificação do owner, que alimenta relatório. Perder a tag apagaria
          a granularidade que a captação manda de graça.
        */
        tags: [dto.origem],
        ...(canal?.sourceId ? { sourceId: canal.sourceId } : {}),
        ...(responsavelId ? { assigneeId: responsavelId } : {}),
        notes: nota,
        phone: telefone,
        ...(dto.email ? { email: dto.email } : {}),
        ...(dto.cidade ? { city: dto.cidade } : {}),
      },
      { avisarResponsavel: false },
    );

    await this.contacts.create(ownerId, criado.id, { /* … como hoje … */ });

    if (contexto.keyId) {
      // Marca o uso DENTRO da transação: rollback não deve registrar uso.
      await this.keys.registrarUso(ownerId, contexto.keyId);
    }

    return {
      status: 'criado',
      clientId: criado.id,
      responsavelId,
      canalId: canal?.id ?? null,
    };
  }

  /**
   * O responsável do canal, se ele ainda for gente da workspace. Configuração
   * velha (a pessoa saiu, foi desativada) NÃO pode fazer a captação falhar: o
   * lead entra sem responsável — visível para todos, que é o estado seguro —
   * e o log registra o descarte para alguém corrigir o canal.
   */
  private async resolverResponsavel(
    ownerId: string,
    canal: LeadIntakeChannelRecord | null,
  ): Promise<string | null> {
    if (!canal?.assigneeId) return null;
    if (await this.members.ehMembro(ownerId, canal.assigneeId)) {
      return canal.assigneeId;
    }
    this.logger.warn({
      evento: 'lead.responsavel_ignorado',
      msg: 'Responsável do canal não é mais membro da workspace: lead entrou sem responsável.',
      canalId: canal.id,
    });
    return null;
  }
```

E o `receber`, na parte pós-commit:

```ts
    /*
      O destinatário é o RESPONSÁVEL roteado; sem roteamento, o owner — como
      antes desta fase. Quem configurou o canal escolheu quem atende, e é essa
      pessoa que precisa do aviso em minutos. Continua `notificarPeloSistema`
      (não `notificar`) porque não há ator humano nesta rota: `notificar`
      exigiria `AccessContext` no CLS e descartaria o aviso.
    */
    await this.notifications.notificarPeloSistema({
      ownerId,
      userId: gravado.responsavelId ?? ownerId,
      evento: { /* … igual a hoje … */ },
    });

    this.logger.log({
      evento: gravado.status === 'criado' ? 'lead.ingerido' : 'lead.reingerido',
      msg: 'Lead recebido por ingestão externa.',
      clienteId: gravado.clientId,
      origem: dto.origem,
      qualificado: Boolean(dto.cenario),
      canalId: gravado.canalId,
      roteado: Boolean(gravado.responsavelId),
    });
```

> **Consequência a assumir:** com um canal roteado, o owner deixa de receber `LEAD_RECEIVED` de todo lead — ele passa a chegar só para o responsável. É o efeito pretendido de configurar responsável no canal, e o owner que quiser tudo deixa o canal sem responsável. A alternativa (avisar os dois) dobraria a notificação de cada lead.

#### Testes

**Modify**: `apps/api/src/modules/leads/application/leads-intake.service.spec.ts`

```ts
it('grava o responsável e a fonte de lead do canal', /* create recebe assigneeId + sourceId */);
it('não avisa RECORD_ASSIGNED: passa avisarResponsavel: false ao ClientsService', /* … */);
it('canal sem responsável grava sem assigneeId e avisa o OWNER', /* userId === OWNER */);
it('canal com responsável avisa o RESPONSÁVEL, não o owner', /* userId === 'colab-1' */);
it('responsável que não é mais membro é descartado, e o lead entra', /* ehMembro → false */);
it('lead reincidente com responsável mantém quem já cuidava', /* update sem assigneeId */);
it('lead reincidente SEM responsável assume o do canal', /* update com assigneeId */);
it('lead reincidente não reescreve tags nem fonte', /* patch só tem notes/assigneeId */);
it('marca o uso da chave dentro da transação', /* ordem: registrarUso antes de 'commit' */);
it('o caminho legado (keyId nulo) não busca canal e não roteia', /* canais.findByKeyId não chamado */);
```

**Modify**: `apps/api/test/lead-intake.e2e-spec.ts`

```ts
it('o lead nasce com o responsável e a fonte do canal', async () => {
  const colab = await criarColaborador(/* … */);
  const fonte = await clientAdmin().leadSourceCatalog.create({ data: { ownerId: owner.id, name: 'Tráfego pago' } });
  const { valor } = await criarCanal({ assigneeId: colab.id, sourceId: fonte.id });

  await enviar(LEAD, valor).expect(200);

  const cliente = await clientAdmin().client.findFirstOrThrow();
  expect(cliente.assigneeId).toBe(colab.id);
  expect(cliente.sourceId).toBe(fonte.id);
  expect(cliente.tags).toEqual(['site-institucional']); // a tag permanece
});

it('LEAD_RECEIVED vai para o responsável quando o canal roteia', /* notification.userId === colab.id */);
```

**Modify**: `apps/api/src/modules/clients/application/clients.service.spec.ts` — dois casos: `avisarResponsavel: false` não chama `notificar` no `create` e no `update`; o default continua chamando.

### Success Criteria

#### Automated Verification

- [x] `pnpm --filter api lint && pnpm --filter api build`
- [x] `pnpm --filter api test -- leads` e `pnpm --filter api test -- clients`
- [x] `pnpm --filter api test:e2e -- lead-intake`
- [x] `pnpm --filter api test:e2e` — suíte inteira (a mudança em `ClientsService` alcança quatro módulos)
- [ ] `docker compose logs api | grep notificacao.sem_contexto` — nenhuma linha nova depois de uma ingestão roteada *(verificação manual: exige a API rodando; o spec de unidade cobre a causa — `avisarResponsavel: false` impede a chamada a `notificar`)*

#### Manual Verification

- [ ] Criar canal com responsável e fonte, enviar lead pela chave: o cliente aparece em `/clientes` com responsável e fonte preenchidos, e a tag da origem preservada
- [ ] O responsável recebe a notificação na central; o owner não recebe
- [ ] Enviar o **mesmo** WhatsApp de novo: nota empilhada, responsável intacto, um único cliente
- [ ] Desativar o colaborador responsável e enviar outro lead: o lead entra sem responsável e `lead.responsavel_ignorado` aparece no log

**⏸ PAUSE**: Parar para confirmação humana antes da Fase 4.

---

## Phase 4: Tela de Captação e catálogo de eventos

### Goal

O owner cria, configura, rotaciona e revoga canais de captação sem sair do CRM, e os eventos `lead.*` e `integracao.*` estão catalogados na observabilidade.

### Changes

#### Reuso do padrão de copiar segredo

**Create**: `apps/web/src/components/ui/copy-box.tsx`

Extrai do `LinkConviteBox` a caixa com valor em `font-mono` + botão de copiar + `toast` + fallback para navegador sem clipboard. Sobe para `components/ui` porque passa a ter dois consumidores (`apps/web/CLAUDE.md`: "reaproveitamento sobe para `components/ui` ou `lib/`").

```tsx
interface Props {
  value: string;
  /** Aviso sob a caixa — o texto é de quem usa, não do primitivo. */
  children?: ReactNode;
  /** Rótulo do toast de sucesso ("Link copiado.", "Chave copiada."). */
  copiedLabel?: string;
}

export function CopyBox({ value, children, copiedLabel = 'Copiado.' }: Props) { /* … */ }
```

**Modify**: `apps/web/src/features/organizacao/LinkConviteBox.tsx` — passa a compor `CopyBox`, mantendo o texto atual sobre validade e uso único. Comportamento visível inalterado.

#### Feature `integracoes`

**Create**: `apps/web/src/features/integracoes/api/types.ts`

```ts
export interface ChaveDeIntegracao {
  id: string;
  nome: string;
  mascarada: string;
  escopos: string[];
  criadaEm: string;
  ultimoUsoEm: string | null;
  revogadaEm: string | null;
}

export interface CanalDeCaptacao {
  id: string;
  name: string;
  assignee: { id: string; name: string } | null;
  source: { id: string; name: string; active: boolean } | null;
  chave: ChaveDeIntegracao | null;
  createdAt: string;
}

/** Resposta do POST: a ÚNICA que carrega o valor da chave. */
export interface CanalCriado {
  canal: CanalDeCaptacao;
  chave: string;
}
```

**Create**: `apps/web/src/features/integracoes/api/captacao.api.ts` e `hooks.ts` — `listCanais`, `createCanal`, `updateCanal`, `deleteCanal`, `rotacionarChave`, `revogarChave`. Invalidação cruzada: rotacionar e revogar invalidam `queryKeys.canaisDeCaptacao.all` (a chave é exibida dentro da linha do canal).

**Modify**: `apps/web/src/lib/query-keys.ts`

```ts
  canaisDeCaptacao: {
    all: ['canais-de-captacao'] as const,
  },
```

**Create**: `apps/web/src/features/integracoes/CaptacaoPage.tsx`

`SectionHeading` com título "Captação de leads" e a ação principal ("Novo canal") na mesma linha, mais uma `Table` no molde de `ColaboradoresPage`:

| Coluna | Conteúdo |
|---|---|
| Canal | `name` + `mascarada` em `font-mono text-xs` embaixo |
| Responsável | nome, ou "Sem responsável" em `text-muted-foreground` |
| Fonte de lead | nome, ou "Não classifica" |
| Último uso | `formatDate(ultimoUsoEm)`, ou "Nunca usada" |
| Ações | Editar · Rotacionar chave · Excluir |

- Estado de carregamento por `Skeleton` nas células, como `ColaboradoresPage:152-161`.
- `TableEmpty`: "Nenhum canal ainda. Crie um para o seu site entregar lead direto no CRM."
- Rotacionar e excluir passam por `ConfirmDialog` (`destructive`), com o texto dizendo o que quebra: *"A chave atual deixa de funcionar imediatamente. Quem estiver enviando lead com ela para de conseguir até você trocar o valor no sistema de origem."*
- A chave nova aparece num `Dialog` próprio (**nunca** empilhado sobre o de confirmação — a regra dos modais é absoluta), com `CopyBox` e o aviso: *"Copie agora. Esta é a única vez que a chave aparece — se perder, rotacione para gerar outra."*

**Create**: `apps/web/src/features/integracoes/CanalDialog.tsx`

`Dialog` + `react-hook-form` + `zod` com `zodResolver`, mensagens em pt-BR, `Field data-invalid` + `FieldLabel required` + `aria-invalid` + `FieldError`, `Button` com `Spinner` e `disabled={isSubmitting}`:

```tsx
const schema = z.object({
  name: z.string().trim().min(2, 'Mínimo 2 caracteres').max(60, 'Máximo 60 caracteres'),
  assigneeId: z.string().nullable(),
  sourceId: z.string().nullable(),
});
```

- `assigneeId` → `AssigneeSelect` via `Controller` (o controle já resolve "Sem responsável").
- `sourceId` → `CatalogSelect kind="fontes-de-lead"` via `Controller`, com `clearLabel="Não classificar"` — cadastrar uma fonte nova dali exige `catalogo:gerenciar`, e o componente já degrada sozinho para quem não tem.
- Texto de ajuda sob o campo do responsável: *"Todo lead deste canal nasce com essa pessoa. Sem responsável, o lead fica visível para toda a equipe."* — é a consequência de `record-scope.ts:10-11`, e ela precisa estar na tela.
- No modo criação, ao salvar, o diálogo fecha e a página abre o diálogo da chave. No modo edição não há chave nova.

#### Navegação

**Modify**: `apps/web/src/features/administracao/tabs.ts`

Entre "Importação" e "Auditoria":

```ts
  {
    label: 'Captação',
    to: '/administracao/captacao',
    permission: ['integracao:gerenciar'],
  },
```

`ADMIN_PERMISSIONS` e o item de sidebar de `app/nav.ts` derivam daqui — nada mais a fazer neles.

**Modify**: `apps/web/src/routes/router.tsx`

```tsx
                  {
                    element: (
                      <PermissionRoute permission={['integracao:gerenciar']} />
                    ),
                    children: [
                      { path: 'captacao', element: <CaptacaoPage /> },
                    ],
                  },
```

#### Observabilidade

**Modify**: `docs/observabilidade.md`

Na tabela "Eventos que a API emite", acrescentar as linhas que faltavam **desde antes desta fase** e as novas:

```md
| `lead.ingerido` / `lead.reingerido` | ingestão externa de lead: cadastro novo / telefone já conhecido (nota empilhada) | `info` |
| `lead.token_recusado` | ingestão recusada por credencial ausente ou inválida | `warn` |
| `lead.token_legado_aceito` | ingestão aceita pelo `LEAD_INTAKE_TOKEN` do ambiente — caminho de transição, sem canal nem roteamento | `warn` |
| `lead.ingestao_desconfigurada` / `lead.owner_nao_configurado` / `lead.owner_nao_encontrado` | caminho legado sem token ou sem owner correspondente no ambiente (a rota responde 503) | `warn` / `error` |
| `lead.responsavel_ignorado` | o responsável do canal não é mais membro da workspace: o lead entrou sem responsável | `warn` |
| `lead.canal_criado` / `lead.canal_atualizado` / `lead.canal_excluido` | manutenção dos canais de captação | `info` |
| `integracao.chave_emitida` / `integracao.chave_rotacionada` / `integracao.chave_revogada` | ciclo de vida da chave de integração — nunca carregam o valor, só `chaveId` e `prefixo` | `info` / `warn` / `warn` |
| `integracao.chave_recusada` / `integracao.escopo_insuficiente` | chave inexistente/revogada (401) ou sem o escopo da rota (403) | `warn` |
```

E, na seção "Como logar em código novo", uma nota curta:

```md
**Segredo em nome pt-BR escapa da rede automática.** `CHAVE_SENSIVEL`
(`shared/logging/log.ts:28`) casa `token`, `secret`, `api_key` — mas **não**
`chave`. Log de credencial carrega `chaveId` e `prefixo`, nunca o valor: a
garantia aqui é o campo escolhido, e ela é afirmada em
`integration-keys.service.spec.ts`.
```

### Success Criteria

#### Automated Verification

- [x] `pnpm --filter web lint && pnpm --filter web build`
- [x] `pnpm --filter api test:e2e` — suíte inteira verde
- [x] `grep -rn "chave" apps/api/src --include=*.ts | grep -i "logger" ` — nenhuma linha passando valor bruto ao logger (conferido também campo a campo em todos os payloads de log dos módulos novos: só id, booleano, `prefixo` e texto estático)

#### Manual Verification

- [ ] `/administracao` exibe a aba "Captação" para o owner; um colaborador com papel sem `integracao:gerenciar` não vê a aba nem alcança a rota por link direto
- [ ] Criar canal → a chave aparece uma vez, copia com um clique, e fechar o diálogo não deixa jeito de revê-la
- [ ] A listagem mostra a chave mascarada, "Nunca usada" antes do primeiro lead, e a data depois dele
- [ ] Rotacionar: confirmação avisa que a anterior morre; a chave antiga passa a responder `401` e a nova funciona
- [ ] Editar responsável e fonte do canal reflete no próximo lead recebido
- [ ] Excluir o canal: a chave para de autenticar
- [ ] Tema claro e escuro, e a tabela sem rolagem horizontal em viewport de 375px

**⏸ PAUSE**: Fim do escopo da fase — confirmação humana final.

---

## Testing Strategy

### Unit Tests

- `integration-keys.service.spec.ts` — geração (formato e entropia), hash determinístico, mascaramento, filtragem de escopo fora do catálogo, 401 igual para inexistente e revogada, 403 para escopo insuficiente, rotação na mesma linha, e as **duas asserções de não-vazamento** (nem no que vai ao repositório, nem no que vai ao logger).
- `leads-intake.service.spec.ts` — roteamento, fonte, tag preservada, regra do reincidente, descarte de responsável inválido, `avisarResponsavel: false`, destinatário do aviso, e a ordem commit → notificação (que já existia e continua sendo a asserção mais importante do arquivo).
- `token-legado.service.spec.ts` — `confere()` nos três casos e os dois 503 de `resolverOwner`.
- `lead-intake-channels.service.spec.ts` — chave emitida antes do canal, validação de responsável e fonte, exclusão que apaga a chave.
- `clients.service.spec.ts` — a opção nova não altera o comportamento default.

### Integration Tests

- `integracoes.e2e-spec.ts` — CRUD de chave pela API com sessão real, isolamento entre owners (404, não 403), gate de permissão.
- `lead-intake.e2e-spec.ts` (reescrito) — o caminho da chave e o caminho legado, cada um afirmando **que a linha está no banco** por `clientAdmin().findFirstOrThrow`: sem `app.owner_id` o RLS não estoura, grava zero linha e a rota responde sucesso. Mais: chave de A não escreve em B, chave revogada, escopo insuficiente, `lastUsedAt`.
- `lead-intake-channels.e2e-spec.ts` — canal + chave ponta a ponta, incluindo "apagar o canal mata a credencial".
- `rls.e2e-spec.ts` — o meta-teste pega tabela nova sem policy; a âncora sobe 22 → 23 → 24.

### Migration & Rollback

- Duas migrations aditivas, sem backfill e sem troca de constraint: `20260811100000_integration_key` e `20260812100000_lead_intake_channel`. Ambas passam pelo portão `validar-migrations-com-dados.sh`, que aplica o init, insere `banco-populado.sql` (dois owners com dados) e só então o resto.
- **Rollback de dado não é necessário:** nada existente é reescrito. Voltar a versão anterior da API com as tabelas no banco funciona — o código antigo simplesmente as ignora, e a captação continua pelo token de ambiente.
- O único ponto irreversível é o `ALTER TYPE … ADD VALUE` dos enums de auditoria: Postgres não remove valor de enum. Isso é aditivo e não quebra a versão anterior do código.
- Ordem obrigatória de deploy: migration antes do código (é o que o `entrypoint.sh` já faz com `migrate deploy`).

## Environment Considerations

- **CI/CD**: nenhum passo novo. O `validar-migrations-com-dados.sh` já roda a cada push que toca a API e passa a cobrir as duas tabelas novas.
- **Migrations**: duas, aditivas. Rodar o portão localmente antes do PR.
- **Config/Secrets**: **nenhuma variável de ambiente nova.** `LEAD_INTAKE_TOKEN` e `LEAD_INTAKE_OWNER_EMAIL` continuam opcionais e passam a ser caminho legado — `env.validation.ts:50-63` não muda nesta fase, e o comentário lá ganha uma linha dizendo que as duas estão em transição.
- **Multi-environment**: em dev não há `LEAD_INTAKE_TOKEN` configurado, então `TokenLegadoService.confere` devolve `false` e todo teste manual passa pela chave — que é o caminho que interessa exercitar.
- **Produção**: a captação continua funcionando sem nenhuma ação no `site-v2`. A migração de lá é: owner cria o canal, copia a chave, troca `CRM_LEADS_TOKEN` pelo valor novo no site, confirma um lead de teste, e só então as duas variáveis saem da API.

## Dependencies & Risks

- **Corte no `site-v2` (repositório separado).** O risco real é alguém remover as variáveis de ambiente antes do site migrar — a captação pararia e o site não alerta. Mitigação: `lead.token_legado_aceito` sai em `warn`, então uma consulta no Grafana (`{stack="crm"} | evento="lead.token_legado_aceito"`) diz exatamente quando o legado parou de ser usado e é seguro remover.
- **`ALTER TYPE … ADD VALUE` em transação.** Se o portão de migration reclamar no Postgres 16, separar os dois `ALTER TYPE` num arquivo de migration próprio, aplicado antes.
- **Mudança de assinatura em `ClientsService.create`/`update`.** Alcança quatro módulos por tabela compartilhada; o parâmetro é opcional e o default preserva tudo, mas a suíte e2e completa é obrigatória na Fase 3, não só o spec de `clients`.
- **Prefixo em claro.** `prefix` expõe 32 dos 256 bits de entropia. É o preço de a pessoa reconhecer qual chave é qual na tela, e é o desenho que gateways de pagamento usam; os 224 bits restantes seguem só no hash.
- **Owner deixa de receber `LEAD_RECEIVED`** quando o canal roteia. É intencional e está registrado na Fase 3 — se na prática incomodar, a correção é avisar os dois, o que dobra a notificação por lead.
- **A tela expõe uma armadilha de visibilidade.** Rotear um lead o **esconde** de quem só vê os próprios registros (`record-scope.ts:10-11`). O texto de ajuda do campo responsável existe por isso e não é decoração.

## References

- PRD: `specs/research/2026-07-28-fase-17a-entrada-de-lead.md`
- Molde de segredo-por-registro: `apps/api/src/modules/collaborators/application/invites.service.ts`, `apps/api/src/modules/collaborators/infra/prisma-invite.repository.ts`
- Escrita pública sob RLS: `apps/api/src/prisma/prisma.service.ts:57-94`
- Molde de RLS de tabela nova: `apps/api/prisma/migrations/20260805100000_lead_source_catalog/migration.sql:126-133`
- Meta-teste de RLS: `apps/api/test/rls.e2e-spec.ts:49-90`
- Fronteira 17-A × 19-B: `ROADMAP.md:576-604` — a máquina de segredo-por-registro **antecipa** para esta fase; a 19-B herda a máquina e acrescenta escopos novos, webhooks de saída e HMAC
- Regras de plataforma: `apps/api/CLAUDE.md` (Repository pattern, log estruturado, e2e de rota pública, migration com dado dentro), `apps/web/CLAUDE.md` (permissões na interface, formulários, modais)
