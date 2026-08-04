---
date: 2026-08-04T11:02:07-03:00
author: claude
source_prd: specs/research/2026-08-04-fase-19b-plataforma-aberta.md
git_commit: 928fdde0f1f202ea823b4803abb4588e5ce5b662
branch: main
status: implemented
tags: [spec, integracoes, public-api, webhooks, auth, mfa, lgpd, consent, retention]
---

# Spec: Fase 19-B — Plataforma aberta

## Overview

A 19-B abre o CRM em três direções que não compartilham código: **para dentro** (sistema externo escreve no pipeline por chave com escopos), **para fora** (evento de negócio sai assinado para n8n/Zapier) e **para o titular** (segundo fator no login, livro-razão de consentimento e política de retenção). O PRD recomendou quebrar em três specs; a decisão foi manter uma só, fortemente fasada — este plano tem 10 fases, cada uma verificável e implantável sozinha, com **parada dura** entre as três frentes.

A parte cara já está paga. A máquina de segredo-por-registro da 17-A ([`modules/integracoes/`](../../apps/api/src/modules/integracoes/)) é genérica: `autenticar(valor, escopoExigido)` já recebe o escopo como parâmetro, separa 401 de credencial inválida de 403 de escopo insuficiente, e o repositório mantém `keyHash` fora de todo `select`. Acrescentar escopo é acrescentar item a um array. O caminho de escrita externa sob RLS também existe, com as duas obrigações do `executarComoOwner` já documentadas. O outbox com backoff existe. O anti-SSRF existe. O que é campo verde é 2FA, consentimento e retenção.

A estratégia é: **reusar até o limite e só então construir**. A frente A reusa `IntegrationKeysService` inteiro, reusa os services de negócio (`ClientsService`, `DealsService`, `ActivitiesService`, `TasksService`) por trás de DTOs públicos próprios, e reusa `validarUrlDeWebhook` e o backoff — os dois promovidos a `shared/` na fase 4 para que a segunda outbox não os duplique. A frente B constrói do zero, mas fora do caminho de login até a fase 8. A frente C constrói do zero, e a única decisão nova de infraestrutura é uma tabela append-only com `REVOKE UPDATE, DELETE`, no molde exato do `AuditLog`.

## Current State

Resumo; o mapa completo está no PRD.

- **Chave de integração:** `IntegrationKey` com RLS, `scopes String[]`, hash sha256 determinístico e `@unique`, exibição única, rotação na mesma linha. Um único escopo no catálogo (`lead:receber`). **Não há `POST /integracoes/chaves`** — chave nasce junto do canal de captação.
- **Escrita externa sob RLS:** só `POST /leads/intake`, via `PrismaService.executarComoOwner` + `LeadIntakeKeyGuard` + `IntakeContext`. Duas obrigações: `ownerId` vem de onde a rota autenticou, e nada de I/O de rede na transação (5s).
- **Webhook:** `WebhookChannel` é destino **do usuário**, sem assinatura (decisão D4 da Fase 9). Outbox em `NotificationDelivery` + cron de 1 min + `BACKOFF_MIN = [1, 5, 30, 120, 480]`. `webhook.channel.spec.ts:44` trava exatamente os quatro headers atuais.
- **Event bus:** não existe. 8 tipos de `NotificationType` emitidos de 12 pontos por chamada direta a `NotificationsService`.
- **2FA:** zero código. `issueTokens` ([auth.service.ts:434](../../apps/api/src/modules/auth/auth.service.ts#L434)) é o ponto de estrangulamento único, e no login não há **nada** entre `argon2.verify` e a emissão.
- **LGPD:** a 19-A entregou portabilidade (`GET /account/export`) e encerramento com carência de 30 dias. Consentimento, opt-out e retenção configurável: zero código. Sem retenção nenhuma em `AuditLog`, `Notification`/`NotificationDelivery` e na lixeira (`archivedAt`).
- **Ajuda in-app:** [`features/ajuda/`](../../apps/web/src/features/ajuda/) existe (não commitada em `928fdde`) com `AjudaLayout`, `DocPagina`, `TabelaDoc`, `CodeBlock` e as páginas `/ajuda/captacao` e `/ajuda/notificacoes`. É o padrão que a documentação desta fase estende.

**Correção ao PRD (verificada em código):** a `PrivacidadePage` **não** promete banner de consentimento de cookies. [PrivacidadePage.tsx:205-207](../../apps/web/src/features/legal/PrivacidadePage.tsx#L205-L207) diz o contrário — *"Não há cookies de publicidade nem de rastreamento entre sites, e por isso **não** exibimos banner de consentimento de cookies."* A Q8 do PRD já está satisfeita; não há texto a corrigir por esse motivo. O que sobra na página são as linhas 383-386 (lista de direitos do art. 18, redigida condicionalmente — *"revogar consentimento **quando for a base aplicável**"*), que continuam verdadeiras sob o recorte "o CRM registra, não comunica".

## Desired End State

Ao fim das 10 fases:

1. O owner emite chave de API avulsa em **Administração → API**, com escopos por entidade e ação, rotaciona e revoga. `GET /integracoes/escopos` e `GET /integracoes/chaves` passam a ter consumidor no front.
2. Um sistema externo escreve em `POST /api/v1/public/{clients,deals,activities,tasks}` com `Authorization: Bearer crm_…`, cada rota exigindo o escopo próprio, sob `executarComoOwner`, com rate limit **por chave**, trilha de auditoria com `actorType: 'INTEGRACAO'` e o nome da chave como ator.
3. O contrato de máquina é publicado em `GET /api/v1/public/openapi.json`, gerado dos DTOs públicos; há `docs/integracoes.md` com curl ponta a ponta e `/ajuda/api` in-app.
4. Todo webhook de **destino do usuário** que tenha segredo chega com `X-CRM-Signature: sha256=<hex>` sobre `<timestamp>.<body>`, com o corpo cru exatamente como enviado. Destino sem segredo continua funcionando (aditivo).
5. O owner cadastra webhooks **da workspace** em **Administração → Webhooks**, escolhe quais eventos de negócio recebe, e cada evento sai assinado por uma outbox própria com `FOR UPDATE SKIP LOCKED`.
6. `LEAD_INTAKE_TOKEN` e `LEAD_INTAKE_OWNER_EMAIL` não existem mais.
7. Owner e colaborador ativam TOTP em **Configurações → Segurança**, com 16 códigos de recuperação de uso único; o segredo está cifrado em AES-256-GCM com `keyVersion` gravado.
8. O login com 2FA ativo devolve um desafio e exige `POST /auth/login/2fa`. Código reusado é recusado (replay, RFC 6238 §5.2). Tentativa falha nunca entra em `AccessRecord` — vai para o Loki e para um contador com trava temporária.
9. Cada `Client`/`Contact` tem um livro-razão de consentimento **append-only**, uma linha por finalidade, com a versão do texto apresentado; revogação é linha nova. Entra no dump de portabilidade e sai no expurgo da conta.
10. Lixeira, `Notification`/`NotificationDelivery` e `AuditLog` têm prazo de retenção, aplicado por cron, com os prazos como **constantes exportadas** — não configuráveis, honrando o precedente da 19-A.

## What We're NOT Doing

- **Leitura na API pública.** Só escrita. Sem `GET`, sem paginação por cursor, sem `page_token` opaco. Quem precisa ler usa a interface ou a portabilidade.
- **Superfície de envio ao titular.** Nenhum e-mail ou WhatsApp sai para `Client`/`Contact`. Logo: **sem** `List-Unsubscribe` (RFC 8058), sem página pública de descadastro, sem DKIM cobrindo headers, sem as 48h do Gmail. O CRM é o livro-razão que o owner consulta antes de comunicar por fora — decisão explícita, não omissão.
- **Retenção configurável por owner ou por ambiente.** Prazo não é decisão de instância (precedente 19-A). Sem tabela de política, sem tela, sem variável de ambiente.
- **Banner de consentimento de cookies.** O CRM é app autenticado sem cookie de terceiro nem analytics, e a Política já declara isso.
- **2FA obrigatório.** Opcional para todos, por conta própria. O owner **não** pode exigir dos colaboradores — isso criaria um estado "logado mas obrigado a configurar" em toda rota e no cliente HTTP.
- **Event bus / `@nestjs/event-emitter`.** Chamada direta nos pontos de emissão, espelhando `NotificationsService`. O motor de regras continua reservado para a Fase 16.
- **Reuso de `NotificationDelivery` para o webhook do owner.** Tabela própria: a Fase 9 mandou não confundir destino-do-usuário com webhook-do-owner.
- **`enableVersioning` do Nest.** O prefixo `/api/v1` fixo em [main.ts:51](../../apps/api/src/main.ts#L51) continua como está; a política de versão é declarada no `docs/integracoes.md` (v1 estável, quebra só em `/api/v2`).
- **Swagger UI.** Só o JSON do OpenAPI. UI arrastaria briga com o CSP do helmet e duplicaria `/ajuda/api`.
- **Lock distribuído no outbox de notificações.** A outbox **nova** nasce com `FOR UPDATE SKIP LOCKED`; a de notificações fica como está. Corrigi-la é fora de escopo e está registrado em "Dependências e riscos".
- **Cifrar o segredo do webhook.** Fica em claro na coluna, consistente com `UserNotificationTarget.config`, que já carrega a URL do Slack — que É credencial. O TOTP é diferente e cifra, porque comprometê-lo é tomada de conta.

---

# FRENTE A — Plataforma de integração (fases 1 a 6)

## Phase 1: Credencial de API do owner

### Goal

O owner emite, rotaciona e revoga chave de API avulsa com escopos por entidade, numa aba própria de Administração — sem nenhuma rota pública nova.

### Changes

#### Catálogo de escopos

**Modify**: `apps/api/src/modules/integracoes/domain/integration-scope.ts`

Quatro itens novos, com rótulo e descrição em pt-BR (o front consome daqui). `ESCOPOS_DA_API_PUBLICA` existe para a rota de criação avulsa recusar `lead:receber`, que pertence ao canal de captação.

```ts
export const INTEGRATION_SCOPES = [
  {
    key: 'lead:receber',
    label: 'Receber lead',
    description:
      'Entregar lead capturado fora do CRM (site, landing page, automação)',
  },
  {
    key: 'cliente:escrever',
    label: 'Criar clientes',
    description: 'Abrir cadastro de cliente ou lead na base da workspace',
  },
  {
    key: 'negociacao:escrever',
    label: 'Criar oportunidades',
    description: 'Abrir oportunidade no funil de um cliente existente',
  },
  {
    key: 'atividade:escrever',
    label: 'Registrar atividades',
    description:
      'Lançar atividade no histórico de um cliente (contato feito, reunião, follow-up)',
  },
  {
    key: 'tarefa:escrever',
    label: 'Criar demandas',
    description: 'Abrir demanda no quadro de um projeto existente',
  },
] as const;

export type IntegrationScope = (typeof INTEGRATION_SCOPES)[number]['key'];

/** O escopo da ingestão de lead. Importado pelo módulo `leads`. */
export const ESCOPO_RECEBER_LEAD: IntegrationScope = 'lead:receber';

/**
 * Os escopos que uma chave AVULSA pode ter. `lead:receber` fica de fora de
 * propósito: chave com esse escopo e sem canal gravaria lead sem roteamento nem
 * fonte — o estado que a 17-A recusou, e a razão pela qual a criação avulsa não
 * existia. A restrição era do escopo de lead, não da máquina.
 */
export const ESCOPOS_DA_API_PUBLICA = INTEGRATION_SCOPES.filter(
  (e) => e.key !== ESCOPO_RECEBER_LEAD,
).map((e) => e.key) as Exclude<IntegrationScope, 'lead:receber'>[];

export function ehEscopoDaApiPublica(valor: string): boolean {
  return (ESCOPOS_DA_API_PUBLICA as string[]).includes(valor);
}
```

**Create**: `apps/api/src/modules/integracoes/api/dto/create-integration-key.dto.ts`

A validação é **estrita aqui**, ao contrário de `emitir`, que descarta escopo desconhecido em silêncio (decisão 17-A, `integration-keys.service.ts:79`). O motivo é o oposto do que parece contradição: `emitir` recebe uma lista montada por código (`[ESCOPO_RECEBER_LEAD]`), esta rota recebe entrada de formulário. Um typo silencioso criaria chave com zero escopos, que responde 403 em tudo e não explica por quê.

```ts
import {
  ArrayNotEmpty,
  IsArray,
  IsString,
  MaxLength,
  MinLength,
  Validate,
} from 'class-validator';
import { EscoposDaApiPublica } from './escopos-da-api-publica.validator';

export class CreateIntegrationKeyDto {
  @IsString({ message: 'O nome é obrigatório.' })
  @MinLength(2, { message: 'O nome deve ter no mínimo 2 caracteres.' })
  @MaxLength(80, { message: 'O nome deve ter no máximo 80 caracteres.' })
  nome: string;

  @IsArray({ message: 'Os escopos devem ser uma lista.' })
  @ArrayNotEmpty({ message: 'Escolha ao menos um escopo para a chave.' })
  @Validate(EscoposDaApiPublica)
  escopos: string[];
}
```

**Create**: `apps/api/src/modules/integracoes/api/dto/escopos-da-api-publica.validator.ts`

```ts
import {
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { ehEscopoDaApiPublica } from '../../domain/integration-scope';

/**
 * Escopo fora do catálogo — ou `lead:receber`, que pertence ao canal de captação
 * — recusa a requisição inteira. `emitir` descarta em silêncio porque lá a lista
 * vem de código; aqui vem de formulário.
 */
@ValidatorConstraint({ name: 'escoposDaApiPublica' })
export class EscoposDaApiPublica implements ValidatorConstraintInterface {
  validate(valor: unknown): boolean {
    return Array.isArray(valor) && valor.every((v) => typeof v === 'string' && ehEscopoDaApiPublica(v));
  }
  defaultMessage(): string {
    return 'Há escopo inválido na lista. Use os escopos de GET /integracoes/escopos, exceto o de captação de lead.';
  }
}
```

**Modify**: `apps/api/src/modules/integracoes/api/integracoes.controller.ts`

O docblock da classe (L8-13) explica hoje a **ausência** de POST avulso. Ele é substituído — a restrição era do escopo de lead, não da máquina — e a rota nova entra antes das paramétricas (convenção do projeto).

```ts
/**
 * Chaves de integração do owner.
 *
 * Duas portas de criação, e a distinção é de PROPÓSITO, não de mecânica:
 *  - **Canal de captação** (`POST /leads/canais`) emite chave com escopo
 *    `lead:receber`, porque lead sem canal não tem roteamento nem fonte;
 *  - **Chave de API** (`POST /integracoes/chaves`, aqui) emite chave para um
 *    sistema externo escrever no pipeline. Não tem registro-mãe, e não precisa:
 *    a restrição da 17-A era do escopo de lead, não da máquina de segredo.
 */
@Controller('integracoes')
export class IntegracoesController {
  // …

  /** Emite chave avulsa. Devolve o valor bruto — a única vez que ele existe. */
  @Post('chaves')
  @RequirePermission('integracao:gerenciar')
  criar(
    @CurrentOwnerId() ownerId: string,
    @Body() dto: CreateIntegrationKeyDto,
  ) {
    return this.keys.emitir({
      ownerId,
      name: dto.nome,
      scopes: dto.escopos,
    });
  }
```

Nada muda em `IntegrationKeysService`: `emitir` já é público, já audita (`INTEGRATION`/`CRIAR`), já loga `integracao.chave_emitida` e já devolve `{ chave, valor }`.

#### Front — aba "API" em Administração

**Modify**: `apps/web/src/features/administracao/tabs.ts`

Entra depois de "Captação", porque é a mesma família e Captação é a mais usada.

```ts
  {
    label: 'Captação',
    to: '/administracao/captacao',
    permission: ['integracao:gerenciar'],
  },
  {
    label: 'API',
    to: '/administracao/api',
    permission: ['integracao:gerenciar'],
  },
```

**Create**: `apps/web/src/features/integracoes/api/hooks.ts` (acréscimo ao arquivo existente)

`useEscopos()` (`GET /integracoes/escopos`), `useChavesDeApi()` (`GET /integracoes/chaves`, filtrado), `useCriarChave()`, `useRevogarChave()`. `useRotacionarChave()` já existe.

```ts
/**
 * As chaves de API do owner. A rota devolve TODAS as chaves, inclusive as dos
 * canais de captação — que são exibidas dentro da linha do canal, na aba
 * Captação. O recorte é pelo escopo, e não por um filtro no backend, porque
 * `GET /integracoes/chaves` é legitimamente "todas as chaves" e a distinção é da
 * TELA: quem olha esta aba quer as chaves que ele mesmo emitiu.
 */
export function useChavesDeApi() {
  return useQuery({
    queryKey: ['integracoes', 'chaves'],
    queryFn: async () => {
      const { data } = await api.get<ChaveDeIntegracao[]>('/integracoes/chaves');
      return data.filter((c) => !c.escopos.includes('lead:receber'));
    },
  });
}
```

**Create**: `apps/web/src/features/integracoes/ApiPage.tsx`

`SectionHeading` com título, descrição e dois botões (`Como integrar` → `/ajuda/api`, `Nova chave`), tabela (Nome / Escopos / Último uso / Estado / Ações) e três diálogos, no molde exato de `CaptacaoPage.tsx`:

- `ChaveDialog` — nome + `Checkbox` por escopo (rótulos de `useEscopos()`, **nunca** duplicados no front). Ao criar, fecha e abre o diálogo de exibição única.
- `ConfirmDialog` de rotação, com o mesmo texto de consequência da captação.
- `ConfirmDialog` de revogação — texto próprio: revogar **preserva a linha**, e a tabela continua mostrando a chave com o selo "Revogada".
- Diálogo de exibição única com `CopyBox` — **nunca** empilhado sobre o de confirmação (regra do `apps/web/CLAUDE.md`; o padrão do `CaptacaoPage` é fechar um e abrir o outro).

**Create**: `apps/web/src/features/integracoes/ChaveDialog.tsx`

**Modify**: `apps/web/src/routes/router.tsx` — rota-filha `api` sob `/administracao`, com `<PermissionRoute permission={['integracao:gerenciar']} />`, no molde de `captacao`.

**Modify**: `apps/web/src/lib/labels.ts` — nada. Escopo não é enum do Prisma e o rótulo vem de `GET /integracoes/escopos`.

#### Documentação

**Modify**: `apps/api/ENDPOINTS.md` — seção Integrações: `### POST /integracoes/chaves` no formato fixo de seis rótulos, e o parágrafo introdutório da seção deixa de dizer "Não há criação avulsa".

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api lint` — sem erro
- [x] `pnpm --filter api test` — a suíte unitária passa, incluindo um spec novo de `EscoposDaApiPublica` (aceita lista válida; recusa `lead:receber`; recusa escopo inexistente; recusa lista vazia)
- [x] `pnpm --filter web lint && pnpm --filter web build` — sem erro
- [~] `grep -c "POST /integracoes/chaves" apps/api/ENDPOINTS.md` — retorna 1. **Divergência encontrada:** o comando conta LINHAS que contêm a substring, e duas linhas pré-existentes já batiam a substring antes desta fase (a nota da rota de rotação em `PATCH /leads/canais/:id` e a própria heading `### POST /integracoes/chaves/:id/rotacionar`, que contém "POST /integracoes/chaves" como prefixo) — `git show HEAD:apps/api/ENDPOINTS.md | grep -c` já retornava 2 antes de qualquer mudança desta fase, nunca 0. Com a heading nova (`### POST /integracoes/chaves`) e a menção na introdução da seção, o total sobe para 4. Confirmado que a heading exata da rota nova existe **uma única vez**: `grep -n "^### POST /integracoes/chaves$"` retorna só a linha 382. O critério como escrito não é satisfazível sem reescrever conteúdo pré-existente fora do escopo desta fase.

#### Manual Verification
- [ ] Em **Administração → API**, criar chave com os quatro escopos: o valor bruto aparece uma vez, no `CopyBox`, com o aviso de exibição única
- [ ] Recarregar a página: a chave aparece mascarada (`crm_a1b2c3d4••••••••`), "Nunca usada", e o valor bruto não é recuperável em lugar nenhum
- [ ] Tentar criar chave sem escopo selecionado: o botão está desabilitado e, se a requisição for forçada, a API responde 400 em pt-BR
- [ ] Rotacionar: diálogo de confirmação → diálogo de valor novo. Nunca dois modais empilhados
- [ ] Revogar: a linha permanece na tabela com o selo "Revogada"
- [ ] A aba **Captação** continua exibindo só as chaves dos canais; a aba **API** não mostra nenhuma delas
- [ ] Um colaborador sem `integracao:gerenciar` não vê a aba e é redirecionado ao acessar `/administracao/api` direto

**⏸ PAUSE**: após a verificação automatizada, parar para confirmação humana dos testes manuais antes da Fase 2.

---

## Phase 2: API pública de escrita

### Goal

Um sistema externo cria cliente, oportunidade, atividade e demanda por chave de integração, sob o contexto de RLS do owner, com rate limit por chave e trilha de auditoria que nomeia a credencial.

### Changes

#### Migration — ator da trilha

**Create**: `apps/api/prisma/migrations/20260821100000_public_api/migration.sql`

```sql
-- ===========================================================================
-- Ator da trilha: escrita por chave de integração não é USER (não há pessoa),
-- não é CRON (não é rotina) e não é WEBHOOK (não é evento recebido). Sem valor
-- próprio, a trilha da API pública mentiria sobre quem agiu.
-- `ALTER TYPE … ADD VALUE` é IRREVERSÍVEL: migration antes do código, sempre.
-- ===========================================================================
ALTER TYPE "AuditActorType" ADD VALUE 'INTEGRACAO';
```

**Modify**: `apps/api/prisma/schema.prisma` — `enum AuditActorType` ganha `INTEGRACAO`, com o comentário `// ← Fase 19-B: escrita pela API pública, por chave de integração`.

Nenhuma invariante nova em `invariantes.sql`: `ADD VALUE` não faz backfill nem troca constraint, e não há dado que possa terminar errado. (A regra do `apps/api/CLAUDE.md` exige invariante para backfill e troca de constraint — este caso é nenhum dos dois.)

#### Auditoria — terceira superfície

**Modify**: `apps/api/src/modules/audit/audit.service.ts`

`registrar` exige `AccessContext` (não há); `registrarPeloSistema` usa o client **admin**, que abre conexão própria e **não entra na transação** do `executarComoOwner` — a trilha commitaria separada do dado. Daí a terceira superfície, que escreve por `prisma.db`.

```ts
/** Registro de escrita por credencial de máquina (API pública). */
export interface EntradaDeIntegracao extends EntradaDeAuditoria {
  ownerId: string;
  /** Nome da chave, como o owner a batizou ("ERP da produção"). */
  keyName: string;
  keyId: string;
}

  /**
   * Registra escrita feita por chave de integração. Roda por `prisma.db`, ou
   * seja **dentro da transação aberta por `executarComoOwner`**: a trilha
   * commita junto com a escrita, ou nenhuma das duas commita — mesma garantia de
   * `registrar`, sem depender do `AccessContext` que a rota pública não tem.
   *
   * `registrarPeloSistema` NÃO serve aqui: ele usa o client admin, que abre
   * conexão própria e ficaria fora da transação.
   *
   * `actorId` recebe o id da CHAVE, não de um usuário. É consistente com
   * `AuditLog.actorId` não ter FK, e é o que permite responder "o que esta
   * credencial escreveu?" na tela de auditoria.
   */
  async registrarComoIntegracao(entrada: EntradaDeIntegracao): Promise<void> {
    await this.prisma.db.auditLog.create({
      data: {
        ownerId: entrada.ownerId,
        actorType: 'INTEGRACAO',
        actorId: entrada.keyId,
        actorName: entrada.keyName,
        entity: entrada.entity,
        entityId: entrada.entityId,
        entityLabel: entrada.entityLabel,
        action: entrada.action,
        diff: this.montarDiff(entrada),
        requestId: this.cls.getId() || null,
      },
    });
  }
```

**Modify**: `apps/api/src/modules/integracoes/domain/integration-key.repository.ts` e `.../infra/prisma-integration-key.repository.ts` — `IntegrationKeyRecord` já traz `name`; `findByHashPeloSistema` já o seleciona (`CAMPOS`). Nada a mudar.

**Modify**: `apps/api/src/modules/integracoes/application/integration-keys.service.ts` — `autenticar` passa a devolver o nome, porque é ele que vira `actorName` na trilha:

```ts
  async autenticar(
    valor: string,
    escopo: string,
  ): Promise<{ ownerId: string; keyId: string; keyName: string }> {
    // … validações idênticas …
    return { ownerId: chave.ownerId, keyId: chave.id, keyName: chave.name };
  }
```

`LeadIntakeKeyGuard` desestrutura só `{ ownerId, keyId }` — continua compilando sem mudança.

#### Módulo novo

**Create**: `apps/api/src/modules/public-api/public-api.module.ts`

```ts
/**
 * A superfície de escrita para sistema de fora. Não tem tabela própria: é uma
 * FRONTEIRA — DTOs públicos, autenticação por chave e contexto de RLS na mão —
 * na frente dos services de negócio que já existem.
 *
 * Os DTOs são próprios de propósito, e não `CreateClientDto` reusado: o DTO
 * interno é contrato de UI e muda com a tela; este é contrato público, e mudá-lo
 * quebra integrador. Reusar faria de toda mudança interna uma breaking change
 * externa, e é essa separação que torna o OpenAPI da fase 3 seguro de publicar.
 */
@Module({
  imports: [
    IntegracoesModule,
    ClientsModule,
    PipelineModule,
    ActivitiesModule,
    ProjectsModule,
  ],
  controllers: [PublicApiController],
  providers: [PublicWriteService, PublicApiKeyGuard],
})
export class PublicApiModule {}
```

**Modify**: `apps/api/src/app.module.ts` — importa `PublicApiModule` depois de `LeadsModule`.

Conferir que `PipelineModule` exporta `DealsService`, `ActivitiesModule` exporta `ActivitiesService` e `ProjectsModule` exporta `TasksService`; se algum não exportar, acrescentar ao `exports` do módulo dono (nunca importar o interior).

#### Contexto e guard

**Create**: `apps/api/src/modules/public-api/api/api-context.ts`

Gêmeo de [`intake-context.ts`](../../apps/api/src/modules/leads/api/intake-context.ts), com o nome da chave a mais.

```ts
/**
 * O que a autenticação da API pública descobriu. O `ownerId` sai daqui e de mais
 * nenhum lugar — em especial, **nunca** do corpo da requisição
 * (`PrismaService.executarComoOwner`, obrigação 1).
 */
export interface ContextoDaApi {
  ownerId: string;
  keyId: string;
  /** Nome da chave. Vira `actorName` na trilha de auditoria. */
  keyName: string;
}

export const API_CONTEXT = 'integracaoDaApi';

export interface RequisicaoDaApi extends Request {
  [API_CONTEXT]?: ContextoDaApi;
}

/** Publicado pelo guard, lido pelo controller. Fail-closed se o guard sair. */
export const ApiContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ContextoDaApi => {
    const req = ctx.switchToHttp().getRequest<RequisicaoDaApi>();
    const contexto = req[API_CONTEXT];
    if (!contexto) {
      throw new UnauthorizedException('Chave de integração inválida.');
    }
    return contexto;
  },
);
```

**Create**: `apps/api/src/modules/public-api/api/escopo-exigido.decorator.ts`

```ts
export const ESCOPO_EXIGIDO = 'escopoExigido';

/** O escopo que a rota exige da chave. Lido pelo `PublicApiKeyGuard`. */
export const EscopoExigido = (escopo: IntegrationScope) =>
  SetMetadata(ESCOPO_EXIGIDO, escopo);
```

**Create**: `apps/api/src/modules/public-api/api/public-api-key.guard.ts`

```ts
/**
 * Autenticação da API pública. As rotas são `@Public()` (quem chama é um
 * servidor, não uma sessão), então este guard é a única porta — e ele publica no
 * request o `ownerId` que a chave revelou, porque é ele, e nunca o corpo, que
 * decide em qual workspace a rota grava.
 *
 * Diferente do `LeadIntakeKeyGuard`: **não há caminho legado** e o escopo não é
 * fixo — vem do `@EscopoExigido()` da rota. Sem o decorator o guard FECHA a
 * rota, em vez de aceitar qualquer chave: escopo esquecido é bug de rota nova, e
 * o estado seguro é recusar.
 */
@Injectable()
export class PublicApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(PublicApiKeyGuard.name);

  constructor(
    private readonly keys: IntegrationKeysService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const escopo = this.reflector.getAllAndOverride<IntegrationScope>(
      ESCOPO_EXIGIDO,
      [context.getHandler(), context.getClass()],
    );
    if (!escopo) {
      this.logger.error({
        evento: 'api_publica.rota_sem_escopo',
        msg: 'Rota da API pública sem @EscopoExigido: recusada por segurança.',
      });
      throw new UnauthorizedException('Chave de integração inválida.');
    }

    const req = context.switchToHttp().getRequest<RequisicaoDaApi>();
    const [tipo, valor] = req.headers.authorization?.split(' ') ?? [];
    if (tipo !== 'Bearer' || !valor) {
      // Nunca logar o valor recebido: a linha vive 30 dias num Grafana publicado.
      this.logger.warn({
        evento: 'api_publica.credencial_ausente',
        msg: 'Requisição à API pública sem credencial Bearer.',
      });
      throw new UnauthorizedException('Chave de integração inválida.');
    }

    // `autenticar` lança 401 (inexistente/revogada) ou 403 (sem o escopo), e
    // loga `integracao.chave_recusada` / `integracao.escopo_insuficiente`.
    req[API_CONTEXT] = await this.keys.autenticar(valor, escopo);
    return true;
  }
}
```

**Create**: `apps/api/src/modules/public-api/api/public-api-throttler.guard.ts`

```ts
/**
 * Rate limit **por chave**, e não por IP. O `getTracker` default do
 * `ThrottlerGuard` devolve `req.ip`, o que na API pública é o balde errado: dez
 * integrações atrás do mesmo NAT compartilhariam o teto, e uma chave abusiva
 * atrás de IP rotativo escaparia dele.
 *
 * Registrado **no nível da rota**, depois do `PublicApiKeyGuard` — guards de
 * rota rodam na ordem em que são declarados, e o contexto da chave só existe
 * depois do primeiro. O `ThrottlerGuard` global continua valendo por IP: os dois
 * baldes convivem porque o `generateKey` inclui o tracker.
 */
@Injectable()
export class PublicApiThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: RequisicaoDaApi): Promise<string> {
    const keyId = req[API_CONTEXT]?.keyId;
    // Sem contexto o guard anterior já recusou; o fallback existe para não
    // transformar uma falha de ordem de guards num balde global.
    return Promise.resolve(keyId ? `chave:${keyId}` : `ip:${req.ip ?? 'desconhecido'}`);
  }
}
```

> **Nota operacional:** o storage do `@nestjs/throttler` é em memória e o deploy é instância única por construção (`container_name: crm-api` fixo, sem `deploy.replicas`). Registrado em "Dependências e riscos".

#### DTOs públicos

**Create**: `apps/api/src/modules/public-api/api/dto/public-create-client.dto.ts`

Campos deliberadamente menores que o DTO interno: só o que a API se compromete a aceitar. Sem `assigneeId` (a integração não conhece os usuários da workspace), sem `sourceId`, sem endereço completo.

```ts
export class PublicCreateClientDto {
  @IsString({ message: 'O nome é obrigatório.' })
  @MinLength(2, { message: 'O nome deve ter no mínimo 2 caracteres.' })
  name: string;

  @IsOptional() @IsEmail({}, { message: 'E-mail inválido.' }) email?: string;
  @IsOptional() @IsString({ message: 'Telefone inválido.' }) phone?: string;
  @IsOptional() @IsString({ message: 'Documento inválido.' }) document?: string;

  @IsOptional()
  @IsEnum(ClientStatus, { message: 'Status inválido.' })
  status?: ClientStatus;

  @IsOptional()
  @IsArray({ message: 'As tags devem ser uma lista.' })
  @IsString({ each: true, message: 'Tag inválida.' })
  tags?: string[];

  @IsOptional()
  @IsString({ message: 'Observações inválidas.' })
  @MaxLength(5000, { message: 'As observações devem ter no máximo 5000 caracteres.' })
  notes?: string;
}
```

**Create**: `public-create-deal.dto.ts` (`clientId`, `title`, `serviceTypeId`, `stageId?`, `amount?`, `probability?`, `expectedClose?`), `public-create-activity.dto.ts` (`clientId`, `typeId`, `content`, `dealId?`, `scheduledFor?`), `public-create-task.dto.ts` (`projectId`, `title`, `description?`, `status?`, `priority?`, `dueDate?`, `tags?`) — todos com mensagens em pt-BR.

#### Controller

**Create**: `apps/api/src/modules/public-api/api/public-api.controller.ts`

```ts
/**
 * A API pública de escrita. Quatro rotas, um escopo cada.
 *
 * Três linhas andam SEMPRE juntas em cada rota, e remover qualquer uma publica
 * escrita sem credencial na internet:
 *   @Public()                     → desliga o JwtAuthGuard
 *   @UseGuards(PublicApiKeyGuard, PublicApiThrottlerGuard)
 *   @EscopoExigido('…')           → sem ele o guard fecha a rota
 *
 * `@HttpCode(201)` é o default do Nest no POST e está correto aqui: ao contrário
 * de `/leads/intake`, estas rotas sempre criam registro novo — não há dedupe.
 */
@Controller('public')
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class PublicApiController {
  constructor(private readonly service: PublicWriteService) {}

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

  // … deals / activities / tasks, idênticos em forma
}
```

#### Service

**Create**: `apps/api/src/modules/public-api/application/public-write.service.ts`

```ts
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

  criarCliente(dto: PublicCreateClientDto, ctx: ContextoDaApi) {
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

  // … criarOportunidade / criarAtividade / criarDemanda

  /**
   * A moldura comum: contexto de RLS, marca de uso da chave e log agregado.
   *
   * `registrarUso` vem PRIMEIRO e DENTRO da transação, como na ingestão:
   * rollback não deve registrar uso, e `lastUsedAt` responde "esta credencial
   * ainda está viva?", não "quantos registros ela criou?".
   */
  private async executar<T extends { id: string }>(
    ctx: ContextoDaApi,
    recurso: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const inicio = Date.now();
    const resultado = await this.prisma.executarComoOwner(ctx.ownerId, async () => {
      await this.keys.registrarUso(ctx.ownerId, ctx.keyId);
      return fn();
    });
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
```

#### Opção de escrita nos três services que não a têm

**Modify**: `apps/api/src/modules/pipeline/application/deals.service.ts`, `apps/api/src/modules/activities/application/activities.service.ts`, `apps/api/src/modules/projects/application/tasks.service.ts`

Mesma forma de `OpcoesDeEscritaDeCliente` ([clients.service.ts:42-52](../../apps/api/src/modules/clients/application/clients.service.ts#L42-L52)), promovida a tipo compartilhado para os quatro usarem o mesmo.

**Create**: `apps/api/src/shared/opcoes-de-escrita.ts`

```ts
/**
 * Opções de escrita de quem chama de fora do caminho de requisição humana.
 *
 * `avisarResponsavel: false` desliga o `RECORD_ASSIGNED`. Quem chama sem
 * `AccessContext` no CLS — ingestão de lead, API pública — precisa disso: sem a
 * opção, `NotificationsService.notificar` cai no early-return
 * `notificacao.sem_contexto` e põe um `warn` por requisição legítima.
 */
export interface OpcoesDeEscrita {
  avisarResponsavel?: boolean;
}
```

`ClientsService` passa a importar daqui, mantendo o alias `OpcoesDeEscritaDeCliente = OpcoesDeEscrita` se houver import externo. Nos três services novos, `create` recebe `opcoes: OpcoesDeEscrita = {}` e a condição de notificação ganha `&& opcoes.avisarResponsavel !== false`.

#### Testes

**Create**: `apps/api/test/public-api.e2e-spec.ts`

Banco real, no molde de `lead-intake.e2e-spec.ts`. Casos obrigatórios:

1. `POST /api/v1/public/clients` com chave válida → 201, **e a linha existe no banco** consultada pelo `clientAdmin()` com o `ownerId` certo. Sem esta afirmação o teste passa com RLS fechado.
2. Chave de **outro owner** grava na workspace **dela**, nunca na do corpo — o DTO não tem `ownerId`, e o teste confirma que não há como injetá-lo (`forbidNonWhitelisted` responde 400).
3. Chave sem o escopo da rota → **403** com a mensagem de escopo insuficiente.
4. Chave revogada → **401** com a mensagem de chave inválida.
5. Sem header `Authorization` → 401.
6. `AuditLog` da escrita existe, com `actorType: 'INTEGRACAO'` e `actorName` igual ao nome da chave.
7. `IntegrationKey.lastUsedAt` foi preenchido; e numa requisição que falha na validação de negócio (ex.: `clientId` de outro owner → 404) **não** foi preenchido, porque a transação rolou de volta.
8. `POST /public/deals` com `clientId` de outro owner → 404 (o `ClientsService.findOne` fecha), e nenhuma linha nova em `Deal`.

**Create**: `apps/api/src/modules/public-api/api/public-api-key.guard.spec.ts` — rota sem `@EscopoExigido` é recusada; Bearer ausente é recusado; contexto publicado tem os três campos.

#### Documentação

**Modify**: `apps/api/ENDPOINTS.md` — seção `## API pública` nova, com as quatro rotas no formato de seis rótulos e um parágrafo de abertura declarando: autenticação por `Authorization: Bearer crm_…`, escopo por rota, rate limit de 120/min **por chave**, e que o `ownerId` vem da chave e nunca do corpo.

### Success Criteria

#### Automated Verification
- [x] `DATABASE_URL=postgresql://crm_user:crm_password@localhost:5435/crm_db apps/api/scripts/validar-migrations-com-dados.sh` — o portão passa com a migration do enum
- [x] `pnpm --filter api lint` — sem erro
- [x] `pnpm --filter api test` — unitários passam (660), incluindo o spec do guard
- [x] `pnpm --filter api test:e2e` — **`public-api.e2e-spec.ts` inteiro passa** (11 casos), incluindo as afirmações de linha no banco
- [x] `grep -c "@Public()" apps/api/src/modules/public-api/api/public-api.controller.ts` — retorna 4, e `@EscopoExigido` e `@UseGuards` também retornam 4 (o docblock da classe foi redigido para não bater literalmente nos três greps)
- [x] `grep -c "^## API pública" apps/api/ENDPOINTS.md` — retorna 1

#### Manual Verification
- [ ] `curl -X POST $API/public/clients -H "Authorization: Bearer crm_…" -H 'Content-Type: application/json' -d '{"name":"Acme Teste"}'` → 201 com `{ id, status }`, e o cliente aparece na listagem da workspace da chave
- [ ] A mesma chave em `/public/deals` sem o escopo `negociacao:escrever` → 403 em pt-BR
- [ ] Em **Administração → Auditoria**, a criação aparece com o **nome da chave** como ator
- [ ] Na aba **API**, "Último uso" da chave passou a mostrar data
- [ ] Disparar 130 requisições em um minuto com a mesma chave: as excedentes respondem 429 com a mensagem em pt-BR
- [ ] Duas chaves de owners diferentes disparando ao mesmo tempo não interferem no teto uma da outra

**⏸ PAUSE**: parar para confirmação humana antes da Fase 3.

---

## Phase 3: Contrato de máquina e documentação

### Goal

A API pública ganha OpenAPI gerado dos DTOs, guia de integrador com curl ponta a ponta e página de ajuda in-app — para que ela não nasça sem contrato.

### Changes

#### Dependência

`pnpm --filter api add @nestjs/swagger`

#### Documento restrito à superfície pública

**Modify**: `apps/api/src/main.ts` — depois de `app.setGlobalPrefix('api/v1')` e antes do `listen`:

```ts
  /**
   * Contrato de máquina da API PÚBLICA — e só dela.
   *
   * `include: [PublicApiModule]` é a linha que importa: sem ela o documento
   * traria as 200+ rotas internas, publicando a superfície inteira do CRM a quem
   * só precisa criar um cliente. É uma decisão de segurança, não de estética.
   *
   * Só o JSON, sem Swagger UI (`swaggerUiEnabled: false`): a UI arrastaria briga
   * com o CSP do helmet e duplicaria `/ajuda/api`, que é onde a documentação
   * legível mora.
   */
  const openapi = new DocumentBuilder()
    .setTitle('API pública do CRM ProgrameAi')
    .setDescription(
      'Escrita servidor a servidor por chave de integração. Autenticação: ' +
        'cabeçalho Authorization: Bearer com a chave (crm_…). Cada rota exige um ' +
        'escopo próprio da chave.',
    )
    .setVersion('1')
    .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'chaveDeIntegracao')
    .build();
  SwaggerModule.setup('api/v1/public/docs', app, () =>
    SwaggerModule.createDocument(app, openapi, { include: [PublicApiModule] }),
    { swaggerUiEnabled: false, jsonDocumentUrl: 'api/v1/public/openapi.json' },
  );
```

**Modify**: os quatro DTOs públicos e o controller ganham `@ApiProperty`/`@ApiOperation`/`@ApiResponse` — **só** eles. Nenhum decorator de Swagger entra em DTO interno: é isso que mantém os dois contratos separados.

#### Guia de integrador

**Create**: `docs/integracoes.md`

Seções, na ordem: (1) o que a API faz e o que não faz (só escrita); (2) ciclo de vida da credencial — emitir, exibição única, rotacionar, revogar, e que **recuperar chave perdida não existe**; (3) **escopo × permissão**, a distinção que o `integration-scope.ts` documenta; (4) as quatro rotas com `curl` completo e resposta real; (5) erros e o que fazer com cada um (400 validação, 401 chave, 403 escopo, 404 registro de outro owner, 429 rate limit, 500); (6) rate limit de 120/min por chave; (7) política de versão — `v1` é estável, campo novo é aditivo e não quebra, quebra sai em `/api/v2`; (8) o link para `openapi.json`.

#### Ajuda in-app

**Create**: `apps/web/src/features/ajuda/ApiDocPage.tsx` — `DocPagina` com as mesmas seções, `CodeBlock` para os curls e `TabelaDoc` para os campos, no molde de `CaptacaoDocPage.tsx`. Reusa a função de endpoint absoluto daquele arquivo (promovida a `apps/web/src/features/ajuda/endpoint.ts`, porque agora tem dois consumidores).

**Modify**: `apps/web/src/features/ajuda/AjudaLayout.tsx` — aba `{ label: 'API pública', to: '/ajuda/api' }`.

**Modify**: `apps/web/src/routes/router.tsx` — rota `api` sob `/ajuda`.

**Modify**: `apps/web/src/features/integracoes/ApiPage.tsx` — o botão "Como integrar" aponta para `/ajuda/api`.

#### Documentação

**Modify**: `apps/api/ENDPOINTS.md` — `### GET /public/openapi.json` na seção da API pública.

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api build && pnpm --filter api lint` — sem erro
- [x] `pnpm --filter web lint && pnpm --filter web build` — sem erro
- [x] Com a API de pé: `curl -s $API/public/openapi.json | jq -r '.paths | keys[]'` lista **exatamente** as quatro rotas de `/public` e mais nada (conferido também pelo complemento: zero caminhos fora das quatro)
- [x] `curl -s $API/public/openapi.json | jq -e '.components.securitySchemes.chaveDeIntegracao'` — existe. **Ajuste sobre o spec:** `bearerFormat` passou a ser declarado à mão (`crm_<64 hex>`), porque o default do `DocumentBuilder` é `"JWT"` e a credencial não é um JWT — o documento mentiria sobre o que colar no cabeçalho.
- [x] `test -f docs/integracoes.md` e o arquivo cita as quatro rotas

#### Manual Verification
- [ ] Colar o `openapi.json` num cliente (Insomnia/Postman/Bruno): as quatro rotas importam com corpo e auth corretos
- [ ] Nenhuma rota interna (`/clients`, `/deals`, `/auth/*`) aparece no documento
- [ ] `/ajuda/api` renderiza com índice, âncoras e o endereço **da instância** (não um host de exemplo)
- [ ] Copiar o curl da página e executá-lo com uma chave real funciona sem edição além da chave

**⏸ PAUSE**: parar para confirmação humana antes da Fase 4.

---

## Phase 4: HMAC no webhook de destino do usuário (issue #26)

### Goal

O canal `WEBHOOK` da Fase 9 passa a assinar o corpo com HMAC-SHA256, de forma **aditiva** — destino sem segredo continua entregando exatamente como hoje. E os dois utilitários que a fase 5 vai reusar sobem para `shared/`.

### Changes

#### Utilitário de assinatura

**Create**: `apps/api/src/shared/webhook-signature.ts`

```ts
/**
 * Assinatura de webhook do CRM. O desenho foi prescrito na decisão D4 da Fase 9
 * e é o esquema do Stripe: `HMAC-SHA256` sobre `<timestamp>.<body>`, hex, em
 * `X-CRM-Signature: sha256=<hex>`.
 *
 * **`corpo` é a string já serializada, e quem chama tem de POSTAR ESSA MESMA
 * STRING.** Reserializar entre assinar e enviar é o bug clássico que invalida a
 * verificação do outro lado — `JSON.stringify` não garante ordem estável entre
 * duas chamadas com objetos construídos por caminhos diferentes.
 *
 * O timestamp é o insumo anti-replay: o receptor recusa o que estiver fora da
 * janela dele (o Stripe usa 5 minutos por default), e é ele que impede que um
 * corpo capturado hoje seja reenviado amanhã. Sem timestamp o esquema não tem
 * defesa de replay nenhuma — é a diferença entre este desenho e o do GitHub.
 */
export const CABECALHO_ASSINATURA = 'X-CRM-Signature';

export function assinarCorpo(
  segredo: string,
  timestamp: string,
  corpo: string,
): string {
  const mac = createHmac('sha256', segredo)
    .update(`${timestamp}.${corpo}`)
    .digest('hex');
  return `sha256=${mac}`;
}

/** 32 bytes: mesma entropia da chave de integração e do token de convite. */
export function gerarSegredoDeWebhook(): string {
  return `whsec_${randomBytes(32).toString('hex')}`;
}
```

**Create**: `apps/api/src/shared/webhook-signature.spec.ts` — vetor fixo (segredo, timestamp e corpo conhecidos → hex esperado, calculado à mão no spec); assinatura muda quando o timestamp muda; assinatura muda quando um byte do corpo muda.

#### Anti-SSRF promovido a `shared/`

**Create**: `apps/api/src/shared/webhook-url.ts` — conteúdo movido de [`modules/notifications/application/webhook-url.ts`](../../apps/api/src/modules/notifications/application/webhook-url.ts), sem mudança de lógica. O comentário do topo é atualizado: a assinatura **não** substitui esta trava (o risco da feature é exfiltração para fora, não corpo forjado), e agora há dois consumidores — `notifications` e `webhooks`.

**Delete**: `apps/api/src/modules/notifications/application/webhook-url.ts` (e mover o `.spec.ts` correspondente).

**Modify**: `apps/api/src/modules/notifications/application/notification-targets.service.ts` — import de `../../../shared/webhook-url`.

> Um módulo não acessa o interior de outro (`apps/api/CLAUDE.md`). Sem a promoção, o módulo `webhooks` da fase 5 teria de importar `modules/notifications/application/…` ou duplicar 90 linhas de defesa contra SSRF. Mover é a única opção conforme.

#### Backoff promovido a `shared/`

**Create**: `apps/api/src/shared/backoff.ts`

```ts
/**
 * Espera entre tentativas de entrega, em minutos. O tamanho do array é o MÁXIMO
 * de tentativas: 6 tentativas, esgotando em ~10,6h.
 *
 * Compartilhado pelas duas outboxes (notificação do usuário e webhook do owner)
 * porque o número é o mesmo julgamento — quanto tempo vale insistir num destino
 * fora do ar antes de desistir — e divergir os dois criaria duas respostas para
 * a mesma pergunta.
 */
export const BACKOFF_MIN = [1, 5, 30, 120, 480];

/** `null` = esgotou; quem chama grava `nextAttemptAt: null` e status definitivo. */
export function proximaTentativa(attempts: number, agora: Date): Date | null {
  const espera = BACKOFF_MIN[attempts - 1];
  return espera == null ? null : new Date(agora.getTime() + espera * 60_000);
}
```

**Modify**: `apps/api/src/modules/notifications/application/notifications-dispatcher.service.ts` — usa `proximaTentativa`, removendo a constante local.

#### Segredo por destino

**Modify**: `apps/api/src/modules/notifications/application/notification-targets.service.ts`

`config` já é documentada como portadora de segredo e nunca sai crua (`configResumo`). O segredo entra na mesma `config`, sem migration.

```ts
/** Criação de integração: a única resposta que carrega o segredo bruto. */
export interface IntegracaoCriada {
  destino: DestinoNaApi;
  /**
   * Existe uma vez. `null` nos kinds que não verificam assinatura.
   */
  segredo: string | null;
}

  async criarIntegracao(
    ownerId: string,
    userId: string,
    dto: CreateWebhookTargetDto,
  ): Promise<IntegracaoCriada> {
    await validarUrlDeWebhook(dto.url);
    /*
      Segredo só no kind WEBHOOK. Slack, Discord, Google Chat e Telegram **não
      verificam assinatura nenhuma** (é o motivo 2 da decisão D4 da Fase 9):
      gerar segredo para eles seria teatro, e um campo a mais na tela que ninguém
      usa. Quem consome com n8n/Zapier é quem tem onde verificar.
    */
    const segredo = dto.kind === 'WEBHOOK' ? gerarSegredoDeWebhook() : null;
    const criado = await this.repo.criar({
      ownerId,
      userId,
      kind: dto.kind,
      label: dto.label,
      config: { url: dto.url, ...(segredo ? { secret: segredo } : {}) },
      types: dto.types ?? TIPOS_PADRAO,
      verified: false,
      active: false,
    });
    return { destino: paraApi(criado), segredo };
  }

  /**
   * Troca o segredo do destino e devolve o novo, uma vez. A assinatura anterior
   * deixa de casar IMEDIATAMENTE — mesma decisão da chave de integração: não há
   * janela de convivência, porque manter duas assinaturas válidas exigiria
   * enviar as duas no header e o receptor aceitar qualquer uma, o que enfraquece
   * a rotação em vez de facilitá-la.
   */
  async rotacionarSegredo(
    ownerId: string,
    userId: string,
    id: string,
  ): Promise<{ segredo: string }> { /* … */ }
```

`paraApi` e `resumirConfig` **não** mudam: `config` inteira continua fora da resposta, e agora com mais razão.

**Modify**: `apps/api/src/modules/notifications/api/notifications.controller.ts` — `POST /notifications/targets/:id/rotate-secret`, com `@RequirePermission('notificacao:integrar')`, no molde de `verifyTarget`. Só faz sentido em `kind: 'WEBHOOK'`; nos outros responde 422 em pt-BR.

**Modify**: `apps/api/src/shared/audit-diff.ts` — `CAMPOS_OMITIDOS` ganha `'secret'` e `'config'`:

```ts
  'secret', // segredo HMAC do destino de webhook (Fase 19-B)
  'config', // Json do destino de notificação: carrega URL-credencial e segredo
```

> `CHAVE_SENSIVEL` de [`shared/logging/log.ts:28`](../../apps/api/src/shared/logging/log.ts#L28) já casa `secret` — o log redige sozinho. O diff da auditoria é JSONB persistido e a omissão ali é **explícita por nome**, então precisa das duas linhas acima.

#### Canal assinando

**Modify**: `apps/api/src/modules/notifications/infra/webhook.channel.ts`

A mudança estrutural: `JSON.stringify(corpo)` sai de dentro da chamada do `fetch` e passa a ser variável, porque é essa string que é assinada **e** postada.

```ts
export async function postar(
  url: string,
  corpo: unknown,
  deliveryId: string,
  segredo?: string | null,
): Promise<void> {
  await enviar(url, corpo, deliveryId, segredo);
}

async function enviar(
  url: string,
  corpo: unknown,
  deliveryId: string,
  segredo?: string | null,
): Promise<Response> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  // Serializa UMA vez: é esta string que é assinada e é esta que é postada.
  // Reserializar entre as duas coisas invalida a verificação do outro lado.
  const body = JSON.stringify(corpo);
  const resposta = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CRM-Delivery': deliveryId,
      'X-CRM-Timestamp': timestamp,
      'User-Agent': 'CRM-ProgrameAi/1.0',
      // Aditivo: destino sem segredo (Slack, Discord, Telegram, e todo webhook
      // cadastrado antes desta fase) continua entregando sem o cabeçalho.
      ...(segredo
        ? { [CABECALHO_ASSINATURA]: assinarCorpo(segredo, timestamp, body) }
        : {}),
    },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resposta.ok) {
    throw new Error(`O destino respondeu ${resposta.status}.`);
  }
  return resposta;
}
```

E `WebhookChannel.entregar` extrai `secret` da `config` ao lado da `url`. `SlackChannel`, `DiscordChannel` e `TelegramChannel` chamam `postar`/`postarLendoResposta` sem o quarto argumento e seguem idênticos.

**Modify**: `apps/api/src/modules/notifications/infra/webhook.channel.spec.ts`

O teste "manda os quatro cabeçalhos do CRM" (L44) é o que trava o contrato — ele passa a afirmar cinco no caminho com segredo, e continua afirmando quatro (sem `X-CRM-Signature`) no caminho sem. Casos novos:

1. Destino **sem** `secret` → nenhum `X-CRM-Signature`, e os quatro headers de hoje intactos.
2. Destino **com** `secret` → `X-CRM-Signature: sha256=<64 hex>`.
3. A assinatura casa com o HMAC recalculado sobre `` `${headers['X-CRM-Timestamp']}.${init.body}` `` — é o teste que pega reserialização.
4. `lastError` de uma falha 503 não contém o segredo nem a URL.

#### Front

**Modify**: `apps/web/src/features/notificacoes/IntegracaoDialog.tsx` — ao criar destino `WEBHOOK`, exibe o segredo uma vez no `CopyBox`, com o aviso de exibição única e uma linha explicando que ele serve para verificar `X-CRM-Signature`.

**Modify**: `apps/web/src/features/notificacoes/PreferenciasDeNotificacao.tsx` — na linha de um destino `WEBHOOK`, ação "Rotacionar segredo", com `ConfirmDialog` (a assinatura anterior para de casar na hora) → diálogo próprio de exibição única.

**Modify**: `apps/web/src/features/ajuda/NotificacoesDocPage.tsx` — seção "Verificar a assinatura", com o algoritmo em texto e um `CodeBlock` em Node (`crypto.timingSafeEqual` sobre os dois hex, e a recomendação de recusar timestamp com mais de 5 minutos).

#### Documentação

**Modify**: `apps/api/ENDPOINTS.md` — `POST /notifications/targets/integrations` passa a devolver `{ destino, segredo }`; entra `POST /notifications/targets/:id/rotate-secret`.

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api test` — passa (672), incluindo `webhook-signature.spec.ts` e o `webhook.channel.spec.ts` atualizado
- [x] `pnpm --filter api lint && pnpm --filter api build` — sem erro
- [x] `pnpm --filter web lint && pnpm --filter web build` — sem erro
- [x] `grep -rn "modules/notifications/application/webhook-url" apps/api/src` — **zero** resultados (o arquivo foi movido com `git mv`, não copiado)
- [x] `grep -n "'secret'" apps/api/src/shared/audit-diff.ts` — presente (e `'config'` também)
- [x] `grep -rn "BACKOFF_MIN" apps/api/src` — só em `shared/backoff.ts` (o dispatcher de notificações passou a usar `proximaTentativa`); a única outra menção é um comentário de spec citando o valor

#### Manual Verification
- [ ] Cadastrar destino `WEBHOOK` apontando para um receptor de teste: o segredo aparece uma vez; verificar a assinatura do lado do receptor **casa**
- [ ] Alterar um byte do corpo no receptor antes de verificar: a assinatura **não** casa
- [ ] Um destino Slack cadastrado antes desta fase continua entregando, sem `X-CRM-Signature`
- [ ] Rotacionar o segredo: a assinatura antiga para de casar imediatamente; a nova casa
- [ ] `GET /notifications/targets` não devolve `secret` nem a URL completa em nenhum campo
- [ ] Forçar falha no receptor (503) e conferir no banco que `NotificationDelivery.lastError` não contém o segredo

**⏸ PAUSE**: parar para confirmação humana antes da Fase 5.

---

## Phase 5: Webhook de saída do owner

### Goal

O owner cadastra webhooks da workspace, escolhe quais eventos de negócio recebe, e cada evento sai assinado por uma outbox própria com retry — sem event bus e sem misturar com o destino do usuário.

### Changes

#### Migration

**Create**: `apps/api/prisma/migrations/20260822100000_owner_webhook/migration.sql`

```sql
-- ===========================================================================
-- 1. Enum de status da entrega. Próprio, e não `NotificationDeliveryStatus`:
--    reusar acoplaria duas features que o roadmap manda não confundir, e
--    `SKIPPED` (canal desligado por configuração) não existe aqui.
-- ===========================================================================
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- ===========================================================================
-- 2. Webhooks do owner
-- ===========================================================================
CREATE TABLE "OwnerWebhook" (
  "id"         TEXT NOT NULL,
  "ownerId"    TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "url"        TEXT NOT NULL,
  "secret"     TEXT NOT NULL,
  "events"     TEXT[] DEFAULT ARRAY[]::TEXT[],
  "active"     BOOLEAN NOT NULL DEFAULT false,
  "verifiedAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OwnerWebhook_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OwnerWebhook_ownerId_name_key" ON "OwnerWebhook"("ownerId", "name");
CREATE INDEX "OwnerWebhook_ownerId_idx" ON "OwnerWebhook"("ownerId");
ALTER TABLE "OwnerWebhook" ADD CONSTRAINT "OwnerWebhook_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- 3. Outbox
-- ===========================================================================
CREATE TABLE "OwnerWebhookDelivery" (
  "id"            TEXT NOT NULL,
  "ownerId"       TEXT NOT NULL,
  "webhookId"     TEXT NOT NULL,
  "event"         TEXT NOT NULL,
  "payload"       JSONB NOT NULL,
  "status"        "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts"      INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError"     TEXT,
  "sentAt"        TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OwnerWebhookDelivery_pkey" PRIMARY KEY ("id")
);
-- Mesmo índice do outbox de notificações: é o que a varredura filtra.
CREATE INDEX "OwnerWebhookDelivery_status_nextAttemptAt_idx"
  ON "OwnerWebhookDelivery"("status", "nextAttemptAt");
CREATE INDEX "OwnerWebhookDelivery_ownerId_createdAt_idx"
  ON "OwnerWebhookDelivery"("ownerId", "createdAt");
ALTER TABLE "OwnerWebhookDelivery" ADD CONSTRAINT "OwnerWebhookDelivery_webhookId_fkey"
  FOREIGN KEY ("webhookId") REFERENCES "OwnerWebhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OwnerWebhookDelivery" ADD CONSTRAINT "OwnerWebhookDelivery_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- 4. RLS por ownerId nas DUAS tabelas (molde de 20260811100000_integration_key)
-- ===========================================================================
ALTER TABLE "OwnerWebhook" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OwnerWebhook" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "OwnerWebhook"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "OwnerWebhook" TO crm_app;

ALTER TABLE "OwnerWebhookDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OwnerWebhookDelivery" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "OwnerWebhookDelivery"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "OwnerWebhookDelivery" TO crm_app;

-- ===========================================================================
-- 5. Auditoria: cadastro, rotação e exclusão de webhook entram na trilha
-- ===========================================================================
ALTER TYPE "AuditEntity" ADD VALUE 'WEBHOOK';
```

**Modify**: `apps/api/prisma/schema.prisma` — os dois modelos, o enum e o `enum AuditEntity` ganhando `WEBHOOK`, com docblocks que registrem: (a) `secret` fica em claro porque HMAC é simétrico e o verificador precisa dele — consistente com `UserNotificationTarget.config`, que já guarda a URL do Slack, que É credencial; (b) `events String[]` no próprio registro, mesmo desenho de `Role.permissions` e `UserNotificationTarget.types`; (c) `nasce active: false` e só entrega depois do ping de verificação, como o destino de integração da Fase 9.

**Modify**: `apps/api/prisma/fixtures/invariantes.sql` — a lista de tabelas do bloco "RLS de pé nas tabelas novas" ganha `'OwnerWebhook', 'OwnerWebhookDelivery'`. E uma invariante nova:

```sql
-- ---------------------------------------------------------------------------
-- Webhook de saída do owner (20260822100000_owner_webhook)
-- ---------------------------------------------------------------------------
-- Entrega não pode pertencer a owner diferente do webhook que a originou: as
-- duas tabelas denormalizam `ownerId` para o RLS, e um `ownerId` divergente
-- entregaria evento de um owner no endpoint de outro.
DO $$
DECLARE cruzadas INT;
BEGIN
  SELECT count(*) INTO cruzadas
    FROM "OwnerWebhookDelivery" d
    JOIN "OwnerWebhook" w ON w."id" = d."webhookId"
   WHERE w."ownerId" <> d."ownerId";
  IF cruzadas > 0 THEN
    RAISE EXCEPTION 'Há % entrega(s) de webhook com ownerId divergente do webhook — isolamento por ownerId quebrado.', cruzadas;
  END IF;
END $$;
```

#### Catálogo de eventos

**Create**: `apps/api/src/modules/webhooks/domain/owner-webhook-event.ts`

```ts
/**
 * Eventos de negócio que saem da workspace. **É contrato público**, e por isso é
 * um namespace PRÓPRIO, e não `NotificationType` reaproveitado: o enum de
 * notificação é vocabulário interno de "o que avisar a uma pessoa" e pode ser
 * renomeado; renomear um evento daqui quebra a integração de quem consome.
 *
 * Formato `substantivo.acao_no_passado`, em pt-BR, igual ao `evento` do log
 * estruturado — pela mesma razão: nome estável é o que permite contar histórico.
 * Renomear um item existente quebra integração de terceiro. Só acrescente.
 */
export const OWNER_WEBHOOK_EVENTS = [
  { key: 'lead.recebido', label: 'Lead recebido', description: 'Lead entrou por um canal de captação' },
  { key: 'registro.atribuido', label: 'Registro atribuído', description: 'Cliente, oportunidade, demanda ou atividade ganhou responsável' },
  { key: 'negociacao.parada', label: 'Oportunidade parada', description: 'Oportunidade sem movimento no funil há tempo demais' },
  { key: 'proposta.a_vencer', label: 'Proposta a vencer', description: 'Proposta enviada perto do fim da validade' },
  { key: 'cobranca.a_vencer', label: 'Cobrança a vencer', description: 'Recebimento com vencimento próximo' },
  { key: 'cobranca.vencida', label: 'Cobrança vencida', description: 'Recebimento que passou do vencimento' },
  { key: 'demanda.atrasada', label: 'Demanda atrasada', description: 'Demanda com prazo estourado' },
  { key: 'atividade.a_fazer', label: 'Follow-up a fazer', description: 'Follow-up agendado chegou na hora' },
] as const;

export type OwnerWebhookEvent = (typeof OWNER_WEBHOOK_EVENTS)[number]['key'];

/**
 * O tipo de notificação que origina cada evento. Existe para os 12 pontos de
 * emissão continuarem falando o vocabulário deles (`NotificationType`) e a
 * tradução para o contrato público morar num lugar só.
 */
export const EVENTO_POR_TIPO: Record<NotificationType, OwnerWebhookEvent> = {
  LEAD_RECEIVED: 'lead.recebido',
  RECORD_ASSIGNED: 'registro.atribuido',
  DEAL_STALE: 'negociacao.parada',
  PROPOSAL_EXPIRING: 'proposta.a_vencer',
  PAYMENT_DUE: 'cobranca.a_vencer',
  PAYMENT_OVERDUE: 'cobranca.vencida',
  TASK_OVERDUE: 'demanda.atrasada',
  FOLLOW_UP_DUE: 'atividade.a_fazer',
};
```

#### Repositório e services

**Create**: `apps/api/src/modules/webhooks/domain/owner-webhook.repository.ts` — interface + token DI. Métodos: `findManyByOwner`, `findById`, `create`, `update`, `replaceSecret`, `delete`, `touch`, `findAtivosPorEvento(ownerId, evento)`, e a superfície de outbox: `enfileirar`, `enfileirarPeloSistema`, `reservarPendentes(now, take)`, `marcarEnviada`, `marcarFalha`.

**Create**: `apps/api/src/modules/webhooks/infra/prisma-owner-webhook.repository.ts`

O ponto que importa é a reserva do lote:

```ts
  /**
   * Reserva um lote de entregas pendentes, **atomicamente**.
   *
   * `FOR UPDATE SKIP LOCKED` e não um `findMany` simples (que é o que o outbox de
   * notificações faz): o deploy é instância única hoje por `container_name` fixo,
   * mas ligar `deploy.replicas` faria dois processos pegarem o MESMO lote e
   * entregarem o mesmo evento duas vezes. Numa outbox nova o custo de nascer
   * correta é uma cláusula; corrigir depois é migração de comportamento.
   *
   * Client admin: o cron roda cross-owner, sem `app.owner_id`.
   */
  async reservarPendentes(now: Date, take: number) {
    return this.admin.$queryRaw<PendingWebhookDelivery[]>`
      WITH reservadas AS (
        SELECT d."id"
          FROM "OwnerWebhookDelivery" d
         WHERE d."status" = 'PENDING' AND d."nextAttemptAt" <= ${now}
         ORDER BY d."nextAttemptAt"
         FOR UPDATE SKIP LOCKED
         LIMIT ${take}
      )
      UPDATE "OwnerWebhookDelivery" d
         SET "status" = 'PENDING', "nextAttemptAt" = ${now}
        FROM reservadas r, "OwnerWebhook" w
       WHERE d."id" = r."id" AND w."id" = d."webhookId"
      RETURNING d."id", d."event", d."payload", d."attempts",
                w."url" AS "url", w."secret" AS "secret", w."active" AS "active";
    `;
  }
```

**Create**: `apps/api/src/modules/webhooks/application/owner-webhooks.service.ts` — CRUD do webhook (validando a URL com `validarUrlDeWebhook`, gerando o segredo com `gerarSegredoDeWebhook`, exibição única, rotação, ping de verificação no molde de `NotificationTargetsService.verificar`), audita em `WEBHOOK` e loga `webhook.cadastrado` / `webhook.rotacionado` / `webhook.verificado` / `webhook.excluido`. A resposta **nunca** traz `secret`, e traz da URL **só o host** (mesma regra de `resumirConfig`).

**Create**: `apps/api/src/modules/webhooks/application/owner-webhooks-emitter.service.ts`

```ts
/**
 * Emissão de evento de negócio para os webhooks do owner.
 *
 * Chamada DIRETA nos pontos de emissão, espelhando `NotificationsService` — sem
 * event bus. Não há bus no projeto e o motor de regras é a Fase 16; introduzir
 * `@nestjs/event-emitter` aqui antecipa uma decisão de outra fase para servir a
 * um único produtor.
 *
 * Duas superfícies, pela mesma razão do `NotificationsService`:
 *  - `emitir`      → dentro da transação do request (`prisma.db`);
 *  - `emitirPeloSistema` → cron cross-owner, sem `app.owner_id` (client admin).
 *
 * **Engole a própria exceção nas duas.** Um webhook que não pôde ser enfileirado
 * não pode derrubar a operação de negócio que o disparou — mesma divergência
 * deliberada em relação ao `AuditService` que o `NotificationsService` documenta.
 *
 * O que roda dentro da transação é SÓ banco: um SELECT nos webhooks do owner
 * (tabela de unidades de linha, indexada por `ownerId`) e N inserts na outbox.
 * **Zero I/O de rede** — a entrega acontece depois do commit, varrida pelo cron.
 */
@Injectable()
export class OwnerWebhooksEmitterService {
  async emitir(entrada: {
    evento: OwnerWebhookEvent;
    entityId: string;
    dados: Record<string, unknown>;
  }): Promise<void> { /* ownerId vem do AccessContext no CLS */ }

  async emitirPeloSistema(entrada: {
    ownerId: string;
    evento: OwnerWebhookEvent;
    entityId: string;
    dados: Record<string, unknown>;
  }): Promise<void> { /* … */ }
}
```

**Create**: `apps/api/src/modules/webhooks/application/owner-webhooks-dispatcher.service.ts` — `despacharLote` com `Promise.allSettled`, `postar(url, corpo, deliveryId, secret)` do canal de webhook (a função já é exportada) e `proximaTentativa` do `shared/backoff`. `lastError` truncado em 500 e **sem** URL nem segredo.

**Create**: `apps/api/src/modules/webhooks/application/owner-webhooks-dispatch.job.ts` — `@Cron('* * * * *', { name: 'webhooks-owner-dispatch' })`, lote de 200, log agregado por lote com guard `> 0`.

**Create**: `apps/api/src/modules/webhooks/api/owner-webhooks.controller.ts` — `@Controller('webhooks')`: `GET /webhooks/eventos` (catálogo), `GET /webhooks`, `POST /webhooks`, `PATCH /webhooks/:id`, `POST /webhooks/:id/verify`, `POST /webhooks/:id/rotate-secret`, `DELETE /webhooks/:id`. Todas com `@RequirePermission('webhook:gerenciar')`.

**Create**: `apps/api/src/modules/webhooks/webhooks.module.ts` — exporta `OwnerWebhooksEmitterService`, e é `@Global()` pelo mesmo motivo do `NotificationsModule`: a emissão é transversal e cruza módulos que não devem depender entre si.

**Modify**: `apps/api/src/app.module.ts` — importa `WebhooksModule` logo depois de `NotificationsModule`, com o comentário explicando o `@Global()`.

#### Permissão

**Modify**: `apps/api/src/shared/permissions.ts` — chave nova na categoria Organização, com o risco nomeado, no tom de `notificacao:integrar`:

```ts
  {
    key: 'webhook:gerenciar',
    label: 'Gerenciar webhooks',
    description:
      'Cadastrar endereços que recebem os eventos de negócio da workspace. O conteúdo enviado carrega nome de cliente e valor de cobrança',
    category: 'Organização',
  },
```

#### Pontos de emissão

**Modify**: os 12 pontos que hoje chamam `NotificationsService`, cada um ganhando a chamada gêmea ao lado:

| Arquivo | Linhas |
|---|---|
| `modules/clients/application/clients.service.ts` | 95, 186 |
| `modules/pipeline/application/deals.service.ts` | 131, 177 |
| `modules/projects/application/tasks.service.ts` | 101, 137 |
| `modules/activities/application/activities.service.ts` | 52, 131 |
| `modules/finance/application/finance-billing.job.ts` | 71 |
| `modules/proposals/application/proposals-expiration.job.ts` | 51 |
| `modules/notifications/application/notifications-reminders.job.ts` | 161 |
| `modules/leads/application/leads-intake.service.ts` | 91 |

Padrão nos pontos de request:

```ts
      await this.notifications.notificar({ /* … como hoje … */ });
      // Gêmeo do aviso interno, para fora da workspace. Mesma transação, mesmo
      // "engole a própria falha": webhook não pode derrubar a operação.
      await this.webhooks.emitir({
        evento: EVENTO_POR_TIPO.RECORD_ASSIGNED,
        entityId: criado.id,
        dados: { entidade: 'DEAL', titulo: criado.title, responsavelId: dto.assigneeId },
      });
```

Nos crons e na ingestão de lead, `emitirPeloSistema` com `ownerId` explícito, **depois do commit** onde a notificação também sai depois (é o caso de `LeadsIntakeService`).

> `dados` carrega o mínimo que serve a uma automação e **nada de dado sensível a mais** do que a notificação já carrega — o payload sai da workspace e vai para um servidor de terceiro. O `link` é caminho relativo, como no conteúdo neutro da Fase 9.

#### Front

**Modify**: `apps/web/src/features/administracao/tabs.ts` — aba `{ label: 'Webhooks', to: '/administracao/webhooks', permission: ['webhook:gerenciar'] }`.

**Create**: `apps/web/src/features/webhooks/WebhooksPage.tsx`, `WebhookDialog.tsx` e `api/{hooks,types}.ts` — tabela (Nome / Host / Eventos / Estado / Último uso / Ações), diálogo com nome, URL, `Checkbox` por evento (rótulos de `GET /webhooks/eventos`), botão "Verificar" para os não verificados, "Rotacionar segredo" e "Excluir". Diálogo de exibição única do segredo com `CopyBox`, nunca empilhado.

**Create**: `apps/web/src/features/ajuda/WebhooksDocPage.tsx` — `DocPagina` com: o que é (evento da workspace saindo, distinto das notificações pessoais), o catálogo de eventos em `TabelaDoc`, o formato do payload, os cinco headers, **como verificar a assinatura** (o mesmo `CodeBlock` da fase 4), retry e backoff (6 tentativas, ~10,6h), e o requisito de responder 2xx rápido.

**Modify**: `AjudaLayout.tsx` (aba "Webhooks") e `router.tsx` (rotas `/administracao/webhooks` e `/ajuda/webhooks`).

#### Documentação

**Modify**: `apps/api/ENDPOINTS.md` — seção `## Webhooks` com as sete rotas.

**Modify**: `docs/integracoes.md` — seção de saída, com o catálogo de eventos e a verificação da assinatura.

**Modify**: `docs/observabilidade.md` — os eventos novos (`webhook.cadastrado`, `webhook.rotacionado`, `webhook.verificado`, `webhook.excluido`, `webhook.entrega_falhou`, `webhook.lote_entregue`) e uma consulta pronta.

### Success Criteria

#### Automated Verification
- [x] `DATABASE_URL=postgresql://crm_user:crm_password@localhost:5435/crm_db apps/api/scripts/validar-migrations-com-dados.sh` — passa, com as invariantes novas
- [x] `pnpm --filter api test` — passa (687), incluindo spec do dispatcher (backoff, esgotamento, `lastError` sem segredo, webhook desativado no meio) e spec do emitter (engole exceção nas duas superfícies; não enfileira sem webhook elegível; sem `AccessContext` avisa e não emite)
- [x] `pnpm --filter api test:e2e` — o meta-teste de RLS continua verde com as duas tabelas novas. **A contagem-âncora subiu de 24 para 26 policies**, como o próprio comentário do teste manda fazer junto da migration
- [x] `pnpm --filter api lint && pnpm --filter web lint && pnpm --filter web build`
- [x] `grep -rn "BACKOFF_MIN" apps/api/src` — só em `shared/backoff.ts` (fora de specs)

**Desvio de arquitetura corrigido em relação ao spec:** o plano mandava o
`OwnerWebhooksService` importar `postar` de
`modules/notifications/infra/webhook.channel.ts`, o que violaria "um módulo não
acessa o interior de outro" (`apps/api/CLAUDE.md`) — a mesma regra que o próprio
plano invoca para promover `webhook-url.ts` e `backoff.ts`. O transporte subiu
para `shared/webhook-post.ts`, com o canal de notificação reexportando de lá para
os outros canais e specs não mudarem de import.

#### Manual Verification
- [ ] Cadastrar webhook para um receptor de teste, marcar "Lead recebido", verificar → fica ativo
- [ ] Entregar um lead por `POST /leads/intake`: o evento chega em até ~1 minuto, com `X-CRM-Signature` que **casa**
- [ ] Derrubar o receptor: a entrega falha, reagenda, e o painel do webhook mostra o estado. Voltar o receptor: a próxima rodada entrega
- [ ] Atribuir uma oportunidade a alguém: chega `registro.atribuido`, e a notificação interna continua chegando também
- [ ] `GET /webhooks` não devolve `secret` nem a URL completa
- [ ] Um colaborador sem `webhook:gerenciar` não vê a aba
- [ ] No banco, uma entrega de owner A nunca tem `webhookId` de owner B; a invariante confirma

**⏸ PAUSE**: parar para confirmação humana antes da Fase 6.

---

## Phase 6: Corte do `LEAD_INTAKE_TOKEN`

### Goal

Remover o caminho legado da ingestão de lead, agora que a chave de integração é a única credencial.

> **Pré-condição operacional, não automatizável:** a consulta `{stack="crm"} | evento="lead.token_legado_aceito"` no Grafana precisa retornar **zero** nos últimos 30 dias, o que só acontece depois de o `site-v2` migrar para chave de integração. Se retornar qualquer linha, **esta fase não entra** — cortar antes perde lead sem erro visível no site. Registrar o resultado da consulta no PR.

### Changes

**Delete**: `apps/api/src/modules/leads/application/token-legado.service.ts` (e o `.spec.ts` correspondente, se existir).

**Modify**: `apps/api/src/modules/leads/api/lead-intake-key.guard.ts` — remove a dependência, o ramo legado (L49-61) e o item 2 do docblock. O guard fica com um caminho só.

**Modify**: `apps/api/src/modules/leads/leads.module.ts` — remove `TokenLegadoService` de `providers`.

**Modify**: `apps/api/src/modules/leads/application/leads-intake.service.ts` — `ContextoDeIntegracao.keyId` deixa de ser anulável; os dois `if (contexto.keyId)` e o comentário do caminho legado (L134-138) saem. `apps/api/src/modules/leads/api/intake-context.ts` reflete o tipo.

**Modify**: `apps/api/src/config/env.validation.ts` — remove `LEAD_INTAKE_TOKEN` e `LEAD_INTAKE_OWNER_EMAIL` e o bloco de comentário delas.

**Modify**: `.env.example`, `docker-compose.prod.yml`, `docs/deploy.md` e `docs/autohospedagem.md` — remover as duas variáveis onde aparecerem (`grep -rn "LEAD_INTAKE" --exclude-dir=node_modules .` para não deixar sobra).

**Modify**: `apps/api/test/lead-intake.e2e-spec.ts` — remove os casos do caminho legado; os casos por chave permanecem.

**Modify**: `apps/api/ENDPOINTS.md` — `POST /leads/intake` deixa de citar o token de ambiente.

**Modify**: `docs/observabilidade.md` — `lead.token_legado_aceito` é marcado como **aposentado** (o evento não é renomeado, e nenhuma consulta histórica muda de significado — mesma doutrina do `lead.ingestao_desconfigurada`).

### Success Criteria

#### Automated Verification
- [~] `grep -rn "LEAD_INTAKE" …` — zero resultados. **Não é satisfazível como escrito, e não por defeito:** (a) o token DI `LEAD_INTAKE_CHANNEL_REPOSITORY` casa a substring e é do caminho novo, não do legado; (b) `specs/` e o `ROADMAP.md` registram história, e apagar a menção apagaria o registro da decisão; (c) `.env.example`, `.env.selfhost.example`, `ENDPOINTS.md`, `docs/observabilidade.md` e o docblock do guard mantêm **uma linha cada** dizendo que as variáveis saíram — quem tinha as duas no `.env` precisa ler isso em algum lugar. O que importa foi verificado: **zero uso funcional** — nada em `env.validation.ts`, nos dois compose, no workflow de deploy nem em `test/.env.test`.
- [x] `grep -rn "TokenLegado" apps/api/src apps/api/test` — zero resultados (arquivo e spec removidos com `git rm`)
- [x] `pnpm --filter api lint && pnpm --filter api build`
- [x] `pnpm --filter api test` — 679 (saíram os 2 casos unitários do caminho legado)
- [x] `pnpm --filter api test:e2e` — 91, `lead-intake.e2e-spec.ts` passa sem os 3 casos legados
- [x] A API sobe **sem as duas variáveis no ambiente**: `env -u LEAD_INTAKE_TOKEN -u LEAD_INTAKE_OWNER_EMAIL node dist/src/main.js` → `app.iniciada`, `GET /api/v1/health` 200, zero linha de `level: error`

> **⚠ PRÉ-CONDIÇÃO OPERACIONAL NÃO VERIFICADA — bloqueia o deploy desta fase.**
> A consulta `{stack="crm"} | evento="lead.token_legado_aceito"` precisa retornar
> **zero nos últimos 30 dias** antes de este corte subir, e **eu não tenho acesso
> ao Grafana**. Se ela trouxer qualquer linha, o `site-v2` ainda não migrou para
> chave de integração e o corte **perde lead sem erro visível no site**. Também
> falta apagar os dois secrets (`LEAD_INTAKE_TOKEN`,
> `LEAD_INTAKE_OWNER_EMAIL`) no repositório de deploy — o workflow não os passa
> mais, mas eles continuam guardados lá.

#### Manual Verification
- [ ] Consulta do Grafana registrada no PR, com zero linhas em 30 dias
- [ ] Entregar lead com chave de canal: continua funcionando, com roteamento e fonte
- [ ] Entregar lead com o token antigo: 401 em pt-BR

**⏸ PAUSE — FIM DA FRENTE A.** Confirmação humana antes de começar a frente B. É seguro parar aqui em definitivo: as fases 1-6 são uma entrega completa.

---

# FRENTE B — 2FA/TOTP (fases 7 e 8)

## Phase 7: Base do TOTP

### Goal

Ativar, confirmar e desativar segundo fator, com códigos de recuperação e o segredo cifrado em repouso — **sem tocar no login**.

### Changes

#### Dependências

`pnpm --filter api add otplib@^13.4.1 @otplib/plugin-crypto-node qrcode`
`pnpm --filter api add -D @types/qrcode`

> `otplib` v13 é async-first (`await verify()`), com crypto por plugin, e dual-publish com condição `require` — funciona no build CJS do NestJS 11. `speakeasy` está sem publicação desde 2016 e não entra. `qrcode` arrasta `yargs` como dependência de runtime que o uso programático não toca: custo aceito para não empurrar geração de QR para o front, que não tem encoder.
>
> **Nenhuma biblioteca resolve replay nem rate limit** — a doc do `otplib` é explícita. Os dois são responsabilidade desta fase (`lastUsedStep` e o contador de falhas).

#### Cifra

**Modify**: `apps/api/src/config/env.validation.ts`

```ts
  // Chave de cifra do segredo TOTP — 32 bytes em hex (64 caracteres). Gerar com
  // `openssl rand -hex 32`.
  //
  // TOTP é HMAC simétrico: o verificador precisa do segredo EM CLARO no momento
  // da verificação, então hash é impossível por construção e a escolha real é
  // cifrado vs texto puro. Cifrado protege contra dump de banco (backup vazado,
  // réplica exposta); não protege contra comprometimento do processo, porque a
  // chave está na memória.
  //
  // **Em branco DESLIGA o 2FA na instância**, como SMTP_HOST desliga o e-mail e
  // TURNSTILE_SECRET_KEY desliga o captcha: é o contrato de "serviço opcional" do
  // projeto, e é o que mantém a autohospedagem funcionando sem variável nova
  // obrigatória. Ligar depois é aditivo; **perder a chave depois de ligar
  // inutiliza o segundo fator de toda a base ao mesmo tempo** — por isso ela
  // entra no runbook de backup de segredo (docs/deploy.md).
  TOTP_ENCRYPTION_KEY: Joi.string().hex().length(64).allow('').default(''),
```

**Create**: `apps/api/src/shared/crypto/segredo-cifrado.ts`

```ts
/**
 * Cifra simétrica autenticada para segredo que precisa ser RECUPERADO em claro
 * (hoje: o segredo TOTP). AES-256-GCM porque a OWASP Cryptographic Storage põe
 * GCM/CCM como primeira preferência para dado recuperável, e porque o modo
 * autenticado detecta adulteração — sem ele, um byte trocado no banco viraria um
 * segredo diferente e silenciosamente errado.
 *
 * `keyVersion` viaja com o dado, e não é enfeite: *"It is important that the code
 * and processes required to rotate a key are in place before they are required."*
 * Com a versão gravada, rotacionar é acrescentar a chave nova, decifrar pela
 * versão de cada linha e recifrar em background — sem ela, rotacionar significa
 * invalidar o 2FA de todo mundo de uma vez.
 */
export interface SegredoCifrado {
  ciphertext: string; // hex
  iv: string;         // hex, 12 bytes (recomendado para GCM)
  tag: string;        // hex, 16 bytes
  keyVersion: number;
}

export const VERSAO_DA_CHAVE_ATUAL = 1;

export function cifrarSegredo(claro: string, chaveHex: string): SegredoCifrado;
export function decifrarSegredo(guardado: SegredoCifrado, chaveHex: string): string;
```

**Create**: `apps/api/src/shared/crypto/segredo-cifrado.spec.ts` — ida e volta preserva o valor; dois `cifrar` do mesmo claro produzem ciphertexts diferentes (IV aleatório); `tag` adulterada faz `decifrar` lançar; chave errada faz `decifrar` lançar; `keyVersion` desconhecida lança com mensagem clara.

#### Migration

**Create**: `apps/api/prisma/migrations/20260823100000_user_totp/migration.sql`

```sql
-- ===========================================================================
-- Segundo fator TOTP. FORA do RLS, no grupo de User/Session/PasswordResetToken:
-- a verificação acontece no login, que é rota @Public() e roda sem
-- `app.owner_id` — uma policy aqui fecharia a escrita (fail-closed grava zero
-- linha e a rota responde sucesso). O isolamento é por filtro de `userId`.
-- ===========================================================================
CREATE TABLE "UserTotp" (
  "userId"        TEXT NOT NULL,
  "ciphertext"    TEXT NOT NULL,
  "iv"            TEXT NOT NULL,
  "tag"           TEXT NOT NULL,
  "keyVersion"    INTEGER NOT NULL DEFAULT 1,
  -- Momento em que o titular provou que o autenticador está sincronizado.
  -- NULL = cadastro iniciado e nunca concluído: NÃO exige segundo fator.
  "confirmedAt"   TIMESTAMP(3),
  -- Último passo de 30s ACEITO. É a defesa de replay exigida pela RFC 6238 §5.2
  -- ("MUST NOT accept the second attempt of the OTP after the successful
  -- validation") e pela NIST SP 800-63B §5.1.4.2. Nenhuma biblioteca resolve.
  "lastUsedStep"  BIGINT,
  -- Falhas consecutivas e trava temporária: NIST SP 800-63B §5.2.2 limita a 100
  -- tentativas falhas consecutivas por conta. O throttler protege por IP; isto
  -- protege a CONTA.
  "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil"   TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserTotp_pkey" PRIMARY KEY ("userId")
);
ALTER TABLE "UserTotp" ADD CONSTRAINT "UserTotp_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- Códigos de recuperação. sha256 (não argon2) pela mesma razão do
-- PasswordResetToken: 32 bytes de entropia bastam, e a busca tem de ser um
-- findUnique indexado — o código chega SOZINHO, sem identificador ao lado.
-- ===========================================================================
CREATE TABLE "UserTotpRecoveryCode" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "codeHash"  TEXT NOT NULL,
  "usedAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserTotpRecoveryCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserTotpRecoveryCode_codeHash_key" ON "UserTotpRecoveryCode"("codeHash");
CREATE INDEX "UserTotpRecoveryCode_userId_idx" ON "UserTotpRecoveryCode"("userId");
ALTER TABLE "UserTotpRecoveryCode" ADD CONSTRAINT "UserTotpRecoveryCode_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- Registro de acesso: login com segundo fator é um acesso bem-sucedido de
-- natureza distinta, e a tabela só registra sucesso (ver o docblock do modelo).
-- Tentativa FALHA de 2FA continua fora daqui, de propósito.
-- ===========================================================================
ALTER TYPE "AccessRecordKind" ADD VALUE 'LOGIN_2FA';
```

**Modify**: `apps/api/prisma/schema.prisma` — os dois modelos e o enum, com os docblocks acima. `User` ganha `totp UserTotp?` e `totpRecoveryCodes UserTotpRecoveryCode[]`.

Nenhuma invariante nova: as tabelas nascem vazias e não há backfill nem troca de constraint. (O `ADD VALUE` do enum idem.)

#### Domínio e service

**Create**: `apps/api/src/modules/auth/totp/totp.constants.ts`

```ts
/** Passo de 30s: o default e o recomendado pela RFC 6238 §4.2/§5.2. */
export const PASSO_SEGUNDOS = 30;
/**
 * Tolerância de UM passo, e não mais: *"We RECOMMEND that at most one time step
 * is allowed as the network delay"* (RFC 6238 §5.2). A doc do otplib marca janela
 * grande como "UNSAFE: Large verification windows allow replay attacks".
 */
export const JANELA_DE_PASSOS = 1;
/** 16 códigos, uso único — o comportamento verificável do GitHub. */
export const QUANTIDADE_DE_CODIGOS = 16;
/** Falhas consecutivas antes da trava. NIST SP 800-63B §5.2.2 teto de 100. */
export const MAX_FALHAS = 10;
export const TRAVA_MINUTOS = 15;
export const EMISSOR = 'ProgrameAi CRM';
```

**Create**: `apps/api/src/modules/auth/totp/totp.service.ts`

```ts
/**
 * Segundo fator TOTP. Cinco responsabilidades, e três delas NÃO vêm de
 * biblioteca nenhuma:
 *
 *  1. **Segredo cifrado em repouso** — AES-256-GCM com `keyVersion`. TOTP é HMAC
 *     simétrico: hash é impossível por construção.
 *  2. **Replay** — código aceito grava `lastUsedStep`, e passo menor ou igual é
 *     recusado. Normativo (RFC 6238 §5.2; NIST SP 800-63B §5.1.4.2), e a própria
 *     doc do otplib diz que a biblioteca não faz isso.
 *  3. **Limite por conta** — `failedAttempts`/`lockedUntil`. O throttler limita
 *     por IP; isto limita a conta.
 *  4. **Códigos de recuperação** — consumo por *compare-and-swap*
 *     (`updateMany where { id, usedAt: null }`), como
 *     `prisma-invite.repository.ts:67-78`, e NÃO o *check-then-act* do
 *     `PasswordResetToken`: dois usos simultâneos do mesmo código passariam.
 *  5. **Serviço opcional** — sem `TOTP_ENCRYPTION_KEY` o 2FA está desligado na
 *     instância, e `isEnabled()` responde por isso (contrato de
 *     MailService/CaptchaService).
 *
 * O `otpauth://` URI e o segredo em base32 **nunca** entram em log: são o
 * segredo inteiro em texto (aviso explícito da doc do otplib).
 */
@Injectable()
export class TotpService {
  isEnabled(): boolean;
  /** Status para a tela: se está ligado na instância, se o usuário tem, quantos códigos restam. */
  status(userId: string): Promise<{ disponivel: boolean; ativo: boolean; codigosRestantes: number }>;
  /** Gera segredo, grava CIFRADO com `confirmedAt: null` e devolve QR + URI + base32. */
  iniciar(userId: string, email: string): Promise<{ qrDataUrl: string; uri: string; segredoBase32: string }>;
  /** Confirma com um código válido → `confirmedAt` + 16 códigos de recuperação, uma vez. */
  confirmar(userId: string, codigo: string): Promise<{ codigosDeRecuperacao: string[] }>;
  /** Verifica um código TOTP. Aplica janela, replay e limite por conta. */
  verificar(userId: string, codigo: string): Promise<boolean>;
  /** Consome um código de recuperação (compare-and-swap). */
  consumirCodigoDeRecuperacao(userId: string, codigo: string): Promise<boolean>;
  /** Regenera os 16 códigos, invalidando os antigos. */
  regenerarCodigos(userId: string): Promise<{ codigosDeRecuperacao: string[] }>;
  /** Desliga: apaga `UserTotp` e todos os códigos. */
  desativar(userId: string): Promise<void>;
  /** `true` se o usuário exige segundo fator no login (usado na fase 8). */
  exigeSegundoFator(userId: string): Promise<boolean>;
}
```

**Create**: `apps/api/src/modules/auth/totp/prisma-totp.repository.ts` + a interface em `totp.repository.ts` (token DI), no padrão do módulo. Usa `PrismaService.db` — `UserTotp` está fora do RLS, então funciona tanto em rota autenticada quanto em rota `@Public()` (mesma propriedade de `Session`).

#### Rotas

**Modify**: `apps/api/src/modules/auth/auth.controller.ts`

```ts
  // --- segundo fator (TOTP) ---

  /** Estado do 2FA para a tela de Segurança. */
  @Get('2fa')
  status2fa(@CurrentUserId() userId: string) {
    return this.totp.status(userId);
  }

  /**
   * Inicia o cadastro: gera o segredo e devolve o QR. **Não liga o 2FA** — só
   * `POST /auth/2fa/confirm` liga, e só com um código válido. Sem essa separação,
   * um QR que a pessoa não conseguiu ler trancaria a conta dela.
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('2fa/setup')
  setup2fa(@CurrentUserId() userId: string) { /* … */ }

  /** Confirma e liga. Devolve os 16 códigos de recuperação, uma única vez. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('2fa/confirm')
  @HttpCode(200)
  confirm2fa(@CurrentUserId() userId: string, @Body() dto: Confirm2faDto) { /* … */ }

  /** Regenera os códigos. Invalida os antigos. Exige reautenticação. */
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('2fa/recovery-codes')
  @HttpCode(200)
  regenerar(@CurrentUserId() userId: string, @Body() dto: Reautenticar2faDto) { /* … */ }

  /**
   * Desliga o 2FA. Exige reautenticação (OWASP ASVS 3.7.1) por senha OU por um
   * código válido — e responde **`ForbiddenException`, nunca 401**: um 401 em
   * rota autenticada dispara o refresh/logout do cliente HTTP, e uma senha errada
   * no diálogo derrubaria a sessão em vez de mostrar a mensagem. Mesmo precedente
   * de `AccountDeletionService.assertReautenticado`.
   */
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Delete('2fa')
  desativar2fa(@CurrentUserId() userId: string, @Body() dto: Reautenticar2faDto) { /* … */ }
```

**Create**: `apps/api/src/modules/auth/dto/confirm-2fa.dto.ts` (código de 6 dígitos, `@Matches(/^\d{6}$/)`, mensagem em pt-BR) e `reautenticar-2fa.dto.ts` (`password?` ou `codigo?`, ao menos um).

**Modify**: `apps/api/src/modules/auth/auth.module.ts` — `TotpService` + o provider do repositório; exporta `TotpService` (a fase 8 o consome de dentro do mesmo módulo, e nada fora dele precisa).

#### Testes

**Create**: `apps/api/src/modules/auth/totp/totp.service.spec.ts` — Prisma mockado, relógio fixo (`jest.useFakeTimers`):

1. `iniciar` grava cifrado (o claro não aparece em nenhum campo) e `confirmedAt: null`.
2. `verificar` aceita o código do passo atual, do anterior e do seguinte; **recusa** dois passos de distância.
3. **Replay:** o mesmo código aceito duas vezes seguidas → segunda recusada.
4. `failedAttempts` chega a `MAX_FALHAS` → `lockedUntil` preenchido, e a verificação seguinte é recusada **mesmo com código correto**.
5. Sucesso zera `failedAttempts`.
6. `confirmar` devolve 16 códigos distintos e grava 16 hashes.
7. Código de recuperação usado duas vezes: só o primeiro passa (compare-and-swap).
8. `regenerarCodigos` invalida os antigos.
9. Sem `TOTP_ENCRYPTION_KEY`: `isEnabled()` é `false` e `iniciar` lança 422 em pt-BR.
10. Nenhum log emitido pelo service contém o segredo base32 ou o `otpauth://` (espionar o `Logger`).

**Modify**: `apps/api/test/auth.e2e-spec.ts` — ciclo completo por HTTP: `setup` → `confirm` com código gerado no teste pelo mesmo `otplib` → `GET /auth/2fa` mostra ativo → `DELETE /auth/2fa` com senha → volta a inativo. E: `confirm` com código errado responde 400/422 em pt-BR e **não** liga o 2FA.

#### Documentação

**Modify**: `apps/api/ENDPOINTS.md` — as cinco rotas.
**Modify**: `docs/autohospedagem.md` e `docs/deploy.md` — `TOTP_ENCRYPTION_KEY`: como gerar, que em branco desliga o 2FA, e que **perdê-la depois de ligada inutiliza o segundo fator de toda a base** (entra no backup de segredo).
**Modify**: `.env.example`.

### Success Criteria

#### Automated Verification
- [x] `DATABASE_URL=… apps/api/scripts/validar-migrations-com-dados.sh` — passa
- [x] `pnpm --filter api test` — 720. O `totp.service.spec.ts` tem **31** casos (os 10 pedidos, mais os desdobramentos de janela de drift, normalização de código e "sem chave na instância") e o `segredo-cifrado.spec.ts` tem 10
- [x] `pnpm --filter api test:e2e` — 100. O ciclo de 2FA em `auth.e2e-spec.ts` são 9 casos
- [x] `pnpm --filter api lint && pnpm --filter api build`
- [x] O `ciphertext` **não** é base32 legível — conferido no e2e (`não contém o segredo do QR`, IV de 12 bytes e tag de 16 em hex) e por execução direta do `cifrarSegredo`
- [x] A API sobe **sem** `TOTP_ENCRYPTION_KEY` (`app.iniciada`, health 200, zero `level: error`), e sem ela o `status` responde `disponivel: false` (caso do spec unitário)

**Três achados desta fase, e o que foi feito:**

1. **Defeito real, pego pelo e2e:** desligar o 2FA deixava os 16 códigos de
   recuperação no banco. `UserTotpRecoveryCode.userId` referencia `User`, não
   `UserTotp` — não há cascata entre os dois. `apagar` passou a apagar os dois, e o
   caso de e2e trava isso. (O docblock que eu havia escrito dizia "FK em cascata";
   estava errado e foi corrigido.)
2. **O risco do PRD sobre o `otplib` v13 materializou-se no Jest**, não no
   runtime: o bundle CJS faz `require('@scure/base')`, que é ESM-only. Resolvido
   com `transformIgnorePatterns` em `package.json` e `test/jest-e2e.json`
   (documentado no docblock do `TotpService`). Runtime nunca foi afetado — Node 24
   tem `require(esm)`.
3. **`epochTolerance` é em SEGUNDOS e o default é zero** (o PRD avisou). A
   constante virou `TOLERANCIA_SEGUNDOS = 30` para dar o ±1 passo da RFC 6238; sem
   ela, código de 29 segundos atrás seria recusado.

#### Manual Verification
- [ ] `POST /auth/2fa/setup`, ler o QR no Google Authenticator / 1Password, confirmar com o código: liga
- [ ] Os 16 códigos aparecem uma vez; recarregar a tela não os mostra de novo
- [ ] Reusar um código TOTP imediatamente: recusado em pt-BR
- [ ] Errar 10 vezes: a conta trava por 15 minutos, e a mensagem diz isso
- [ ] Desligar com senha errada: **403**, não 401 — a sessão **não** cai
- [ ] Nenhuma linha do Grafana contém o segredo base32 ou `otpauth://`
- [ ] **O login continua funcionando exatamente como antes** — esta fase não o toca

**⏸ PAUSE**: parar para confirmação humana antes da Fase 8.

---

## Phase 8: Login em dois passos

### Goal

Quem tem 2FA ativo passa a provar o segundo fator antes de receber sessão, sem que um 401 novo apareça no caminho do cliente HTTP.

### Changes

#### Desafio

**Create**: `apps/api/src/modules/auth/totp/desafio-de-2fa.ts`

```ts
/**
 * O desafio entre a senha e a sessão.
 *
 * É um JWT curto (5 min) com `{ sub, tipo: 'mfa' }`, assinado com
 * `JWT_ACCESS_SECRET` — e não uma tabela nova, de propósito: ele não precisa ser
 * revogável (expira em 5 minutos), não precisa ser listado e não sobrevive ao
 * fluxo. Uma tabela pediria migration, faxina e um segundo lugar onde revogar.
 *
 * `tipo: 'mfa'` é obrigatório na verificação: sem ele, um **access token** válido
 * seria aceito como desafio e o segundo fator viraria decoração.
 *
 * Consequência assumida: o desafio pode ser reapresentado dentro dos 5 minutos.
 * Isso não dá acesso a nada — leva ao mesmo prompt de código, que continua
 * exigindo o segundo fator e continua sujeito ao limite por conta.
 */
export const TTL_DO_DESAFIO = '5m';
export const TIPO_DO_DESAFIO = 'mfa';
```

#### Login

**Modify**: `apps/api/src/modules/auth/auth.service.ts`

O único ponto onde algo passa a existir entre `argon2.verify` e `issueTokens`:

```ts
  /**
   * Resultado do login: sessão OU desafio de segundo fator. Nunca os dois.
   */
  export type ResultadoDeLogin =
    | { accessToken: string; refreshToken: string }
    | { twoFactorRequired: true; desafio: string };

  async login(email: string, password: string, device: DeviceInfo = {}): Promise<ResultadoDeLogin> {
    const user = await this.users.findByEmail(email);
    if (!user || !user.passwordHash || !(await argon2.verify(user.passwordHash, password))) {
      throw new UnauthorizedException('Credenciais inválidas');
    }
    this.assertActive(user.active);
    /*
      O segundo fator entra AQUI, e este é o único ponto do arquivo entre a
      validação da senha e a emissão. Nada de `AccessRecord` neste ramo: a lei
      fala de registro de ACESSO, e uma senha correta sem o segundo fator não é
      acesso — ele é registrado em `concluirLoginCom2fa`, com kind `LOGIN_2FA`.
    */
    if (await this.totp.exigeSegundoFator(user.id)) {
      return {
        twoFactorRequired: true,
        desafio: await this.emitirDesafio(user.id),
      };
    }
    return this.issueTokens(user.id, device);
  }

  /**
   * Segundo passo: valida o desafio e o código (TOTP ou de recuperação) e emite a
   * sessão. `kind: 'LOGIN_2FA'` distingue o acesso com segundo fator do comum —
   * os dois são acessos bem-sucedidos, que é o que a tabela registra.
   */
  async concluirLoginCom2fa(
    desafio: string,
    codigo: string,
    device: DeviceInfo = {},
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const userId = await this.verificarDesafio(desafio);
    const ok =
      (await this.totp.verificar(userId, codigo)) ||
      (await this.totp.consumirCodigoDeRecuperacao(userId, codigo));
    if (!ok) {
      // Sem o código no log, e sem e-mail: a linha vive 30 dias num Grafana
      // publicado. É esta linha — não `AccessRecord` — que registra a falha.
      this.logger.warn({
        evento: 'mfa.codigo_recusado',
        msg: 'Segundo fator recusado no login.',
        usuarioId: userId,
      });
      throw new UnauthorizedException('Código inválido ou expirado.');
    }
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    this.assertActive(user.active);
    return this.issueTokens(userId, device, 'LOGIN_2FA');
  }
```

> **`AccessRecordKind` não ganha valor de falha.** O docblock do modelo declara: *"Só eventos BEM-SUCEDIDOS: art. 15 fala de registro de acesso, e guardar o IP de uma tentativa frustrada seria dado pessoal a mais sem obrigação que o exija."* Registrar falha ali contradiria uma decisão documentada da 19-A. O limite de tentativas que a NIST pede é servido por `failedAttempts`/`lockedUntil` (fase 7) mais o `@Throttle`, e a falha é observável em `mfa.codigo_recusado` no Loki.

Os outros seis chamadores de `issueTokens` **não** ganham segundo fator nesta fase, e cada um por uma razão registrada em comentário: `register` acabou de criar a conta (não há segredo a provar), o aceite de convite idem, e os três ramos de OAuth delegam o fator ao provedor — pedir TOTP depois do Google seria um segundo fator sobre um segundo fator que o CRM não sabe se existiu. `refresh` não passa por `issueTokens` e continua como está: ele renova uma sessão que **já** provou o fator.

#### Controller

**Modify**: `apps/api/src/modules/auth/auth.controller.ts`

```ts
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.login(dto.email, dto.password, this.device(req, res));
    /*
      200 com `twoFactorRequired`, e NÃO 401: o interceptor de `lib/api.ts`
      dispara o fluxo de refresh em todo 401 e, falhando, manda para /login — um
      401 aqui poria a tela em laço. O front decide o segundo passo pelo corpo.
      Nenhum cookie é emitido neste ramo: não há sessão ainda.
    */
    if ('twoFactorRequired' in r) return r;
    this.setRefreshCookie(res, r.refreshToken);
    return { accessToken: r.accessToken };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login/2fa')
  async login2fa(@Body() dto: Login2faDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refreshToken } = await this.auth.concluirLoginCom2fa(
      dto.desafio,
      dto.codigo,
      this.device(req, res),
    );
    this.setRefreshCookie(res, refreshToken);
    return { accessToken };
  }
```

**Create**: `apps/api/src/modules/auth/dto/login-2fa.dto.ts` — `desafio: string` (JWT) e `codigo: string` (6 dígitos **ou** um código de recuperação; validação de tamanho frouxa o bastante para os dois, com mensagem em pt-BR).

#### Front

**Modify**: `apps/web/src/features/auth/LoginPage.tsx` — se a resposta traz `twoFactorRequired`, troca o formulário pelo passo do código: um `Input` de 6 dígitos, o link "Usar um código de recuperação" e a contagem do desafio. `POST /auth/login/2fa` com `{ desafio, codigo }`. Desafio expirado → volta ao passo 1 com aviso em pt-BR.

**Modify**: `apps/web/src/lib/api.ts` — **nenhuma mudança**, e isso é a propriedade que a escolha de 200 preserva. Registrar em comentário na `LoginPage` por quê.

**Modify**: `apps/web/src/features/configuracoes/ConfiguracoesLayout.tsx` — aba "Segurança" depois de "Dispositivos". Sem gate por `isOwner`: o próprio 2FA é da própria conta, como perfil e dispositivos.

**Create**: `apps/web/src/features/seguranca/SegurancaPage.tsx`, `AtivarTotpDialog.tsx`, `CodigosDeRecuperacaoDialog.tsx`, `api/{hooks,types}.ts`:

- Estado do 2FA por `GET /auth/2fa`. Se `disponivel: false`, o cartão explica que a instância não tem 2FA configurado (paridade com o tratamento de SMTP e captcha), sem botão.
- Ativar: diálogo com `<img>` do QR, o segredo em `CopyBox` para quem digita à mão, e o campo de confirmação. Ao confirmar, os 16 códigos num `CopyBox` com botão de baixar `.txt`.
- Desativar: `ConfirmTypedDialog` (`expected`/`secret`) pedindo a senha — o primitivo de confirmação por segredo já existe.
- Regenerar códigos: `ConfirmDialog` avisando que os antigos param de valer → diálogo de exibição única.
- Nunca dois modais empilhados: fecha um, abre o outro (padrão do `CaptacaoPage`).

**Modify**: `apps/web/src/routes/router.tsx` — rota-filha `seguranca` sob `/configuracoes`.

#### Testes

**Modify**: `apps/api/test/auth.e2e-spec.ts`:

1. Login sem 2FA → 200 com `accessToken` e cookie de refresh (**o comportamento de hoje, intacto**).
2. Login com 2FA → 200 com `{ twoFactorRequired: true, desafio }`, **sem** `accessToken` e **sem** cookie de refresh.
3. `POST /auth/login/2fa` com código correto → 200 + cookie, e uma linha em `AccessRecord` com `kind: 'LOGIN_2FA'`.
4. Código errado → 401 e **nenhuma** linha em `AccessRecord`.
5. Desafio de outro usuário / access token usado como desafio → 401 (o `tipo: 'mfa'` fecha).
6. Desafio expirado → 401 com mensagem em pt-BR.
7. Código de recuperação funciona **uma** vez; a segunda tentativa com o mesmo código → 401.
8. `GET /auth/me` só responde depois do segundo passo.

#### Documentação

**Modify**: `apps/api/ENDPOINTS.md` — `POST /auth/login` ganha a resposta alternativa; entra `POST /auth/login/2fa`.
**Modify**: `docs/uso/primeiros-passos.md` — como ligar o 2FA e guardar os códigos.
**Modify**: `apps/web/src/features/legal/PrivacidadePage.tsx` — a seção de segurança menciona o segundo fator disponível.
**Modify**: `docs/observabilidade.md` — `mfa.ativado`, `mfa.desativado`, `mfa.codigo_recusado`, `mfa.conta_travada`.

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api test && pnpm --filter api test:e2e` — 720 + 110. Os 8 casos pedidos, mais dois: "desafio malformado" e "desligar o 2FA devolve o login a um passo"
- [x] `pnpm --filter api lint && pnpm --filter api build`
- [x] `pnpm --filter web lint && pnpm --filter web build`
- [x] `git diff --stat apps/web/src/lib/api.ts` — **vazio**. O cliente HTTP não mudou, e é a escolha de 200 (não 401) no ramo do 2FA que preserva isso
- [x] `grep -n "LOGIN_2FA_RECUSADO\|FALHA" apps/api/prisma/schema.prisma` — zero: nenhum kind de falha entrou em `AccessRecord`

**⚠ Furo de segurança do desenho do spec, encontrado por um e2e e corrigido.**
O plano manda assinar o desafio com `JWT_ACCESS_SECRET` e cuidou de **um** dos
dois sentidos (*"sem `tipo: 'mfa'`, um access token válido seria aceito como
desafio"*). O sentido inverso — e muito pior — ficou aberto: o **desafio era
aceito como access token** pelo `JwtAuthGuard`, que só conferia a assinatura.
Bastaria acertar a senha e usar o desafio como `Bearer` para abrir toda a API sem
o segundo fator.

Corrigido no `JwtAuthGuard`: token com `tipo` é recusado, e `sid` passou a ser
obrigatório (todo access token nasce amarrado a uma sessão em `issueTokens`).
Cada uma das duas condições fecharia o caso sozinha. O e2e "9) `GET /auth/me` só
responde DEPOIS do segundo passo" trava isso.

**Segundo defeito, também pego por e2e:** `TotpService.verificar` deixava o
`otplib` lançar `TokenLengthError` em token fora de 6 dígitos — e
`concluirLoginCom2fa` chama `verificar(codigo) || consumirCodigoDeRecuperacao(codigo)`
com o mesmo valor, então **todo login por código de recuperação respondia 500**.
Agora `verificar` recusa o formato antes de chamar a lib, e sem contar falha (quem
manda um código de recuperação não errou o autenticador).

**Adaptação de UI:** o spec pedia `ConfirmDialog` para regenerar códigos, mas a
rota exige reautenticação — o diálogo simples sempre responderia 403. Entrou um
`ReautenticarDialog` (senha, ou código do autenticador na conta de login social
sem senha), usado na regeneração e na desativação de conta sem senha. A
desativação com senha continua no `ConfirmTypedDialog`, como o spec pediu.

#### Manual Verification
- [ ] Login de conta **sem** 2FA: idêntico a hoje, em um passo
- [ ] Login de conta **com** 2FA: pede o código, entra com o código do app
- [ ] Entrar com um código de recuperação: funciona, e o contador de códigos restantes cai
- [ ] Esperar 6 minutos no passo 2: volta ao passo 1 com aviso claro
- [ ] Errar o código 10 vezes: a conta trava e a mensagem diz por quanto tempo
- [ ] Login social (Google/GitHub) **não** pede TOTP
- [ ] Sessão já aberta em outro dispositivo continua renovando por `refresh` sem pedir código
- [ ] Em **Configurações → Segurança**, desativar o 2FA e entrar de novo em um passo

**⏸ PAUSE — FIM DA FRENTE B.** Confirmação humana antes da frente C.

---

# FRENTE C — Consentimento e retenção (fases 9 e 10)

## Phase 9: Livro-razão de consentimento

### Goal

Registrar consentimento e revogação de `Client`/`Contact`, uma linha por finalidade, com a versão do texto apresentado, de forma **append-only** — o livro-razão que o owner consulta antes de comunicar por fora.

### Changes

#### Migration

**Create**: `apps/api/prisma/migrations/20260824100000_consent_record/migration.sql`

```sql
CREATE TYPE "ConsentSubjectType" AS ENUM ('CLIENT', 'CONTACT');

-- ===========================================================================
-- Livro-razão de consentimento. APPEND-ONLY, e isso é exigência da lei, não
-- preferência de modelagem: o art. 8º § 5º manda que a revogação preserve
-- "ratificados os tratamentos realizados sob amparo do consentimento
-- anteriormente manifestado" — sobrescrever a linha apagaria a prova de que o
-- consentimento existiu, e o § 2º põe o ônus dessa prova no controlador.
--
-- Uma linha POR FINALIDADE (art. 8º § 4º: "as autorizações genéricas … serão
-- nulas"). Nunca um booleano agregado de "aceitou tudo".
-- ===========================================================================
CREATE TABLE "ConsentRecord" (
  "id"                TEXT NOT NULL,
  "ownerId"           TEXT NOT NULL,
  "subjectType"       "ConsentSubjectType" NOT NULL,
  "subjectId"         TEXT NOT NULL,
  -- Chave do catálogo de finalidades (`domain/consent-purpose.ts`).
  "purpose"           TEXT NOT NULL,
  -- `true` = consentiu; `false` = revogou. A revogação é LINHA NOVA.
  "granted"           BOOLEAN NOT NULL,
  -- Versão do texto apresentado ao titular (art. 9º § 1º e art. 8º § 6º:
  -- alteração das informações obriga a re-informar). Sem isto não há como dizer
  -- A QUE o titular consentiu.
  "textVersion"       TEXT NOT NULL,
  -- Como se manifestou ("formulario-site", "whatsapp", "telefone", "presencial").
  -- Art. 8º caput + guia de cookies da ANPD: a evidência do COMO faz parte da
  -- comprovação.
  "channel"           TEXT NOT NULL,
  -- Evidência livre: id do envio do formulário, print, número do protocolo.
  "evidence"          TEXT,
  -- Prazo de retenção INFORMADO ao titular. A ausência dessa informação "viola a
  -- exigência legal de que o consentimento deve ser informado" (guia da ANPD).
  "informedRetention" TEXT,
  -- Quem registrou (colaborador do owner). Sem FK: apagar o usuário não pode
  -- apagar a prova — mesma decisão de `AuditLog.actorId`.
  "recordedByUserId"  TEXT,
  "recordedByName"    TEXT NOT NULL,
  -- Quando o titular se manifestou, que pode ser ANTES de alguém digitar.
  "occurredAt"        TIMESTAMP(3) NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ConsentRecord_ownerId_subjectType_subjectId_purpose_idx"
  ON "ConsentRecord"("ownerId", "subjectType", "subjectId", "purpose", "occurredAt");
CREATE INDEX "ConsentRecord_ownerId_createdAt_idx" ON "ConsentRecord"("ownerId", "createdAt");
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConsentRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConsentRecord" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "ConsentRecord"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));

-- Append-only NO BANCO, não por disciplina de código: molde exato do `AuditLog`.
-- Um livro-razão que a própria aplicação pode reescrever não é prova de nada.
GRANT SELECT, INSERT ON "ConsentRecord" TO crm_app;
REVOKE UPDATE, DELETE ON "ConsentRecord" FROM crm_app;
```

**Modify**: `apps/api/prisma/schema.prisma` — o modelo e o enum, com os docblocks acima.

**Modify**: `apps/api/prisma/fixtures/invariantes.sql`:

```sql
-- ---------------------------------------------------------------------------
-- Livro-razão de consentimento (20260824100000_consent_record)
-- ---------------------------------------------------------------------------
-- O append-only tem de estar valendo NO BANCO: se `crm_app` recuperar UPDATE ou
-- DELETE, a prova exigida pelo art. 8º § 2º passa a ser reescrevível pela
-- aplicação, e o portão não pode deixar isso passar em silêncio.
DO $$
DECLARE indevidos TEXT;
BEGIN
  SELECT string_agg(privilege_type, ', ') INTO indevidos
    FROM information_schema.table_privileges
   WHERE table_schema = 'public'
     AND table_name = 'ConsentRecord'
     AND grantee = 'crm_app'
     AND privilege_type IN ('UPDATE', 'DELETE');
  IF indevidos IS NOT NULL THEN
    RAISE EXCEPTION 'crm_app tem % em "ConsentRecord" — o livro-razão de consentimento deixou de ser append-only.', indevidos;
  END IF;
END $$;

-- Consentimento não pode apontar para titular de OUTRO owner.
DO $$
DECLARE cruzados INT;
BEGIN
  SELECT count(*) INTO cruzados FROM (
    SELECT 1 FROM "ConsentRecord" c JOIN "Client"  s ON s."id" = c."subjectId"
      WHERE c."subjectType" = 'CLIENT'  AND s."ownerId" <> c."ownerId"
    UNION ALL
    SELECT 1 FROM "ConsentRecord" c JOIN "Contact" s ON s."id" = c."subjectId"
      WHERE c."subjectType" = 'CONTACT' AND s."ownerId" <> c."ownerId"
  ) t;
  IF cruzados > 0 THEN
    RAISE EXCEPTION 'Há % registro(s) de consentimento apontando para titular de OUTRO owner — isolamento por ownerId quebrado.', cruzados;
  END IF;
END $$;
```

#### Catálogo de finalidades e textos

**Create**: `apps/api/src/modules/consent/domain/consent-purpose.ts`

```ts
/**
 * Finalidades de tratamento com base em consentimento. **Uma linha de
 * `ConsentRecord` por finalidade** — art. 8º § 4º: *"O consentimento deverá
 * referir-se a finalidades determinadas, e as autorizações genéricas para o
 * tratamento de dados pessoais serão nulas."* Um "aceito tudo" agregado seria
 * nulo por lei, e é por isso que não existe um booleano só.
 *
 * O que NÃO entra aqui: a execução do contrato e os procedimentos preliminares a
 * pedido do titular (art. 7º, V). Cobrança, aviso de vencimento e resposta a um
 * pedido de proposta **não dependem de consentimento**, e pedir consentimento
 * para eles ensinaria errado a quem usa. Art. 7º § 6º fecha o outro lado: a
 * dispensa do consentimento não dispensa as demais obrigações.
 */
export const CONSENT_PURPOSES = [
  {
    key: 'comunicacao_marketing',
    label: 'Comunicação de marketing',
    description: 'Enviar oferta, novidade e conteúdo promocional que o titular não pediu',
  },
  {
    key: 'comunicacao_whatsapp',
    label: 'Contato por WhatsApp',
    description: 'Falar com o titular por WhatsApp fora do atendimento que ele iniciou',
  },
  {
    key: 'compartilhamento_terceiro',
    label: 'Compartilhamento com terceiro',
    description:
      'Repassar os dados a parceiro ou fornecedor. Art. 7º § 5º exige consentimento ESPECÍFICO e separado',
  },
  {
    key: 'retencao_pos_contrato',
    label: 'Retenção após o fim do contrato',
    description: 'Guardar o histórico depois de encerrada a relação, para retomada futura',
  },
] as const;

export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number]['key'];
```

**Create**: `apps/api/src/modules/consent/domain/consent-text.ts`

```ts
/**
 * O texto apresentado ao titular, versionado. `textVersion` da linha aponta para
 * uma entrada daqui, e é o que responde "a QUE ele consentiu".
 *
 * **Nunca edite um texto no lugar.** Art. 8º § 6º e art. 9º § 1º: alterar a
 * informação obriga a re-informar com destaque e faculta ao titular revogar.
 * Texto mudou = versão nova, e as linhas antigas continuam apontando para a
 * versão antiga — que é exatamente a prova que o § 2º cobra.
 *
 * Cada texto cobre o que o art. 9º manda ter sido informado: I finalidade
 * específica, II forma e duração, III controlador, IV contato, V uso
 * compartilhado, VI responsabilidades, VII direitos do art. 18.
 */
export const CONSENT_TEXTS = [
  { purpose: 'comunicacao_marketing', version: '2026-08-1', text: '…' },
  // …
] as const;

export function textoVigente(purpose: ConsentPurpose): { version: string; text: string };
```

#### Service, repositório e rotas

**Create**: `apps/api/src/modules/consent/domain/consent.repository.ts` — interface + token. `findHistorico(ownerId, subjectType, subjectId)`, `criar(...)`, `findPorTitulares(ownerId, subjectType, ids)` (para a listagem mostrar selo), `carregarParaDump(ownerId)`.

**Create**: `apps/api/src/modules/consent/infra/prisma-consent.repository.ts` — só `findMany` e `create`. **Não** há `update` nem `delete` na interface: o banco recusaria, e a interface não deve prometer o que o banco proíbe.

**Create**: `apps/api/src/modules/consent/application/consent.service.ts`

```ts
/**
 * Livro-razão de consentimento dos titulares (Client/Contact).
 *
 * O que este service **não** faz, e é decisão de escopo explícita: não envia nada
 * a ninguém. Nenhum e-mail ou WhatsApp sai do CRM para `Client`/`Contact` — todo
 * destinatário do `MailService` é `User`. O CRM é o livro-razão que o owner
 * consulta ANTES de comunicar por fora; a superfície de envio (com
 * `List-Unsubscribe` da RFC 8058, DKIM cobrindo os headers e as 48h do Gmail) é
 * outra fase, e prometê-la aqui seria pior do que não tê-la.
 *
 * Não há trilha de auditoria destes registros, e não é esquecimento: a tabela
 * **é** a trilha — append-only no banco, com `REVOKE UPDATE, DELETE`. Duplicá-la
 * no `AuditLog` guardaria a mesma PII duas vezes.
 */
@Injectable()
export class ConsentService {
  /** Histórico completo + a situação vigente por finalidade (última linha vence). */
  historico(ownerId: string, subjectType: ConsentSubjectType, subjectId: string): Promise<{
    situacao: { purpose: ConsentPurpose; granted: boolean; occurredAt: Date; textVersion: string }[];
    historico: ConsentRecordNaApi[];
  }>;

  /**
   * Registra manifestação. `granted: false` é a **revogação**, e ela é linha
   * nova — nunca `UPDATE` da anterior (art. 8º § 5º, "ratificados os
   * tratamentos realizados").
   *
   * A versão do texto NÃO vem do corpo: vem de `textoVigente(purpose)`. Aceitar
   * versão pelo corpo deixaria registrar consentimento a um texto que nunca foi
   * exibido, o que é o oposto de comprovar.
   */
  registrar(ownerId: string, dto: CreateConsentDto, autor: { userId: string; nome: string }): Promise<ConsentRecordNaApi>;
}
```

**Create**: `apps/api/src/modules/consent/api/consent.controller.ts`

```ts
/**
 * `@Controller('consentimentos')`, e não uma sub-rota de `/clients/:id`: o
 * titular pode ser `Client` **ou** `Contact`, e duplicar as rotas nos dois
 * controllers duplicaria a regra. O recorte vem da query.
 *
 * Permissões: reusa `cliente:ver` e `cliente:gerenciar`. Consentimento é parte do
 * cadastro do titular — quem gerencia o cliente registra o consentimento dele.
 * Uma chave nova significaria "papel que só mexe em consentimento", que não é um
 * conceito do produto.
 */
@Controller('consentimentos')
export class ConsentController {
  @Get('finalidades')
  @RequirePermission('cliente:ver', 'cliente:gerenciar')
  finalidades() { return CONSENT_PURPOSES; }

  /** Texto vigente de uma finalidade — a tela exibe antes de registrar. */
  @Get('texto')
  @RequirePermission('cliente:ver', 'cliente:gerenciar')
  texto(@Query() query: TextoDeConsentimentoQueryDto) { /* … */ }

  @Get()
  @RequirePermission('cliente:ver', 'cliente:gerenciar')
  historico(@CurrentOwnerId() ownerId: string, @Query() query: ListConsentQueryDto) { /* … */ }

  @Post()
  @RequirePermission('cliente:gerenciar')
  registrar(
    @CurrentOwnerId() ownerId: string,
    @CurrentAccess() access: AccessContext,
    @Body() dto: CreateConsentDto,
  ) { /* … */ }
}
```

**Create**: DTOs em `api/dto/` — `CreateConsentDto` (`subjectType`, `subjectId`, `purpose`, `granted`, `channel`, `evidence?`, `occurredAt?`), com validação contra os catálogos e mensagens em pt-BR. `textVersion` **não** entra no DTO.

**Create**: `apps/api/src/modules/consent/consent.module.ts`; **Modify**: `app.module.ts`.

#### Portabilidade e expurgo (19-A)

**Modify**: `apps/api/src/modules/account/domain/account-dump.ts` — `AccountDump` ganha `consentimentos`, e `VERSAO_DO_DUMP` sobe.

**Modify**: `apps/api/src/modules/account/infra/prisma-account-dump.repository.ts` e `application/account-export.service.ts` — carregar e contar `consentimentos` no manifesto.

**Modify**: `apps/api/src/modules/account/infra/prisma-account-purge.repository.ts` — `ConsentRecord` entra na cascata topológica, **antes** de `Client`/`Contact`. O expurgo roda por `PrismaAdminService`, que é `crm_user` e não está sujeito ao `REVOKE` — mesma propriedade que já permite apagar `AuditLog` no expurgo.

> O `REVOKE DELETE` vale para `crm_app`, e é o que impede a aplicação de reescrever a prova. O expurgo da conta é `crm_user` e apaga, como já faz com o `AuditLog` — e pela mesma razão da 19-A: o registro carrega PII de terceiro, e retê-la depois do encerramento seria tratar fora das instruções (LGPD art. 42, § 1º, I).

#### Front

**Create**: `apps/web/src/features/clientes/ConsentimentosTab.tsx` — aba na ficha do cliente: cartões de situação por finalidade (Consentido / Revogado / Sem registro, com data e versão do texto), linha do tempo completa e botão "Registrar manifestação". A aba entra na lista filtrada por `canAny` de quem monta as abas do cliente.

**Create**: `apps/web/src/features/clientes/RegistrarConsentimentoDialog.tsx` — finalidade (`Select`, rótulos de `GET /consentimentos/finalidades`), consentiu/revogou, canal, data da manifestação, evidência. **Exibe o texto vigente** antes de confirmar, com o aviso de que é ele que fica registrado.

**Create**: `apps/web/src/features/contatos/ConsentimentosDoContato.tsx` — mesma coisa, reusando os dois componentes acima (promovidos a `features/consentimento/` se a duplicação aparecer).

**Modify**: `apps/web/src/lib/labels.ts` — `translateConsentSubjectType`. As finalidades **não** entram: vêm da API.

#### Documentação

**Modify**: `apps/api/ENDPOINTS.md` — seção `## Consentimento` com as quatro rotas.
**Modify**: `apps/web/src/features/legal/PrivacidadePage.tsx` — parágrafo declarando que o CRM registra consentimento de titulares em nome do owner, que o owner é o controlador desses dados e a ProgrameAi a operadora, e que o registro entra no dump de portabilidade.
**Modify**: `docs/uso/primeiros-passos.md` — como registrar consentimento.

### Success Criteria

#### Automated Verification
- [x] `DATABASE_URL=… apps/api/scripts/validar-migrations-com-dados.sh` — passa, com as duas invariantes novas (append-only e titular cruzado)
- [x] `pnpm --filter api test` — 733. O spec do `ConsentService` tem 13 casos: revogação é linha nova; `textVersion` vem do catálogo e ignora o corpo; `situacao` resolve pela última linha por finalidade e o histórico preserva tudo; titular de outro owner não entra; o texto cobre os incisos do art. 9º. Finalidade fora do catálogo é 400 pelo validador do DTO
- [x] `pnpm --filter api test:e2e` — 113. O meta-teste de RLS subiu para **27** policies, e três casos novos confirmam que `crm_app` **não** consegue `UPDATE` nem `DELETE` em `ConsentRecord` (a query estoura com "permission denied") e **consegue** `INSERT`/`SELECT` — append-only não é read-only
- [x] `pnpm --filter api lint && pnpm --filter web lint && pnpm --filter web build`
- [x] `GET /account/export` traz `consentimentos` e a contagem no manifesto; `VERSAO_DO_DUMP` subiu para **2** e o spec do export trava isso

**Adaptações:** (a) o painel de consentimento vive em `features/consentimento/` e é
reusado pela aba do cliente e por um diálogo na lista de contatos — contato não tem
tela de detalhe no CRM, e inventar uma navegação nova só para isso não se paga;
(b) `ContactsService` ganhou um `findOne` público (a validação de posse do titular
precisava dele, e o módulo só tinha o `loadOwned` privado); (c) `ConsentModule`
importa `UsersModule` para preencher o controlador do texto com o nome e o e-mail
do **owner** — codificar "ProgrameAi" ali faria o texto mentir, porque nesses dados
o controlador é o owner e a ProgrameAi é operadora.

#### Manual Verification
- [ ] Registrar consentimento de marketing num cliente: aparece na situação e na linha do tempo, com a versão do texto
- [ ] Revogar a mesma finalidade: **a linha anterior continua visível** na linha do tempo, e a situação passa a "Revogado"
- [ ] Registrar duas finalidades diferentes: são independentes
- [ ] Baixar o dump de portabilidade: os consentimentos estão lá
- [ ] Um colaborador com `cliente:ver` mas sem `cliente:gerenciar` vê a aba e **não** vê o botão de registrar
- [ ] Consentimento de um owner não aparece na workspace de outro

**⏸ PAUSE**: parar para confirmação humana antes da Fase 10.

---

## Phase 10: Política de retenção

### Goal

Dar prazo ao que hoje cresce sem teto — lixeira, notificações e trilha de auditoria — com os prazos como constantes exportadas, não configuráveis.

> **A tensão que o PRD apontou está resolvida assim:** o roadmap diz "política de retenção" e a 19-A decidiu que *"prazo não é decisão de instância"*. As duas valem juntas se "política" for entendida como **a política existir e ser pública**, não como ser editável. A entrega é o expurgo funcionando e o prazo declarado na Política de Privacidade — sem tabela de configuração, sem tela e sem variável de ambiente.

### Changes

#### Migration — índices da varredura

**Create**: `apps/api/prisma/migrations/20260825100000_retention_indexes/migration.sql`

```sql
-- ===========================================================================
-- Índices para a varredura de retenção, que é CROSS-OWNER e filtra só por data.
-- Os índices existentes têm `ownerId` como coluna LÍDER
-- (`AuditLog_ownerId_createdAt_idx`, `Notification_ownerId_userId_createdAt_idx`),
-- e prefixo à esquerda não serve a um filtro que não tem `ownerId`: sem estes
-- dois a faxina diária vira seq scan nas duas maiores tabelas do banco.
-- Mesmo raciocínio de `AccessRecord_createdAt_idx`, criado para a mesma coisa.
-- ===========================================================================
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");
```

**Modify**: `apps/api/prisma/schema.prisma` — `@@index([createdAt])` nos dois modelos, com o comentário `/// Serve à faxina por data de corte (Fase 19-B).`

**Modify**: `apps/api/prisma/fixtures/invariantes.sql` — invariante afirmando que os dois índices existem, no molde do bloco de `Proposal("number","version")`. Sem ela, uma migration futura que os derrube passa verde e a faxina degrada em silêncio.

#### Prazos

**Create**: `apps/api/src/modules/retention/domain/retencao.ts`

```ts
/**
 * Prazos de retenção. **Constantes exportadas, e não configuração** — mesma
 * decisão de `RETENCAO_SESSAO_VENCIDA_DIAS` (30) e
 * `RETENCAO_REGISTRO_DE_ACESSO_DIAS` (180): nenhuma delas é decisão de
 * instância, e cada uma é um número que a Política de Privacidade publica.
 * Tornar isto configurável criaria um prazo por instalação que a Política não
 * poderia mais declarar.
 *
 * A LGPD **não fixa prazo em dias** para nada disto (o art. 19, II fala de 15
 * dias, e é para confirmação/acesso, não para eliminação). O art. 16 manda
 * eliminar após o término do tratamento, ressalvando o cumprimento de obrigação
 * legal (I) e o uso exclusivo do controlador com dados anonimizados (IV). Os
 * números abaixo são, portanto, decisão de produto ancorada — cada um com o
 * porquê ao lado.
 */

/**
 * Lixeira: 180 dias. É o prazo em que um arquivamento por engano ainda é
 * lembrado por alguém; passado isso, "arquivado" é "excluído com passos extras".
 * Vale para os cinco modelos com `archivedAt` (Client, Contact, Deal, Project,
 * Task).
 */
export const RETENCAO_LIXEIRA_DIAS = 180;

/**
 * Notificação e entrega: 90 dias. A central é operacional, não histórico — uma
 * notificação de três meses atrás não muda decisão nenhuma, e o `AuditLog`
 * guarda o fato que a originou.
 */
export const RETENCAO_NOTIFICACAO_DIAS = 90;

/**
 * Trilha de auditoria: 5 anos. É o prazo geral de prescrição das pretensões
 * comerciais mais comuns (e o do CDC), e a trilha existe justamente para
 * responder "quem alterou isso" quando alguém questiona. Menos que isso
 * esvaziaria o art. 37 (obrigação de manter registro das operações); mais seria
 * guardar PII de terceiro sem finalidade.
 */
export const RETENCAO_AUDITORIA_DIAS = 5 * 365;
```

#### Repositório e job

**Create**: `apps/api/src/modules/retention/domain/retention.repository.ts` — interface + token: `expurgarLixeira(cutoff)`, `expurgarNotificacoes(cutoff)`, `expurgarAuditoria(cutoff)`, cada um devolvendo `Record<string, number>` de linhas por tabela.

**Create**: `apps/api/src/modules/retention/infra/prisma-retention.repository.ts`

```ts
/**
 * Expurgo por data de corte, cross-owner. `PrismaAdminService` por duas razões
 * independentes, e cada uma bastaria: o cron roda sem `app.owner_id` (o RLS
 * casaria zero linhas), e `AuditLog` tem `REVOKE UPDATE, DELETE … FROM crm_app`
 * — a aplicação **não consegue** apagar a trilha nem se quisesse. Mesma
 * mecânica do `AccountPurgeJob`.
 */
@Injectable()
export class PrismaRetentionRepository implements RetentionRepository {
  /**
   * Lixeira, em ordem topológica e **sem cascata** — a doutrina de
   * `shared/purge.ts`: as FKs de negócio são RESTRICT, e as remoções em cascata
   * do projeto são feitas à mão. Um `deleteMany` na ordem errada responde erro de
   * FK e aborta o lote inteiro.
   *
   * Filho arquivado há mais tempo que o pai sai primeiro; pai com filho **não
   * arquivado** NÃO sai, e o log registra quantos foram pulados — senão o
   * silêncio de "0 linhas" seria lido como "nada a fazer".
   *
   * Ordem: Task → Activity → Contact → Deal → Project → Client.
   */
  async expurgarLixeira(cutoff: Date): Promise<Record<string, number>> { /* … */ }
}
```

**Create**: `apps/api/src/modules/retention/application/retention.job.ts`

```ts
/**
 * Faxina de retenção. Três varreduras por data de corte, uma vez por dia.
 *
 * `timeZone` explícito (o container roda em UTC), como nos quatro crons diários
 * que já existem, e às 2h para não competir com a faxina de sessão (3h), a de
 * registro de acesso (4h) e o expurgo de conta (5h) — que também tocam tabelas
 * grandes.
 *
 * Log agregado por varredura, com guard `> 0`: é o padrão dos jobs existentes e
 * é o que mantém a linha diária silenciosa quando não há nada a apagar.
 */
@Injectable()
export class RetentionJob {
  @Cron(CronExpression.EVERY_DAY_AT_2AM, {
    name: 'retencao-faxina',
    timeZone: 'America/Sao_Paulo',
  })
  async run(): Promise<void> { /* … */ }
}
```

**Create**: `apps/api/src/modules/retention/retention.module.ts`; **Modify**: `app.module.ts`.

**Create**: `apps/api/src/modules/retention/application/retention.job.spec.ts` — a data de corte é `agora − prazo` para cada varredura; erro em uma varredura **não** impede as outras (`try/catch` por varredura, como o `AccountPurgeJob` faz por owner); log só com quantidade `> 0`.

#### Política publicada

**Modify**: `apps/web/src/features/legal/PrivacidadePage.tsx` — na seção de retenção, uma tabela com todos os prazos que a instância pratica: registro de acesso 180 dias (obrigação legal, Marco Civil art. 15), sessão vencida 30 dias, carência de encerramento 30 dias, backup 30 dias, **lixeira 180 dias, notificações 90 dias, trilha de auditoria 5 anos**, e a base de cada um.

> **Pendência nomeada, não bloqueante:** o texto consolidado do Planalto mostra o art. 5º da LGPD alterado pela MP nº 1.317/2025 e pela Lei nº 15.352/2026, que renomeiam a autoridade para "**Agência** Nacional de Proteção de Dados". O alcance não foi investigado. **Antes de publicar esta revisão da Política**, conferir se a página cita "Autoridade Nacional" e se o nome mudou — a checagem é de leitura do texto legal, não de código, e o dono é quem aprova o texto jurídico.

#### Documentação

**Modify**: `docs/observabilidade.md` — `retencao.lixeira_expurgada`, `retencao.notificacoes_expurgadas`, `retencao.auditoria_expurgada`, `retencao.registro_pulado`, com uma consulta pronta.
**Modify**: `docs/deploy.md` — a lista de crons ganha `retencao-faxina` às 2h BRT.

### Success Criteria

#### Automated Verification
- [x] `DATABASE_URL=… apps/api/scripts/validar-migrations-com-dados.sh` — passa, com a invariante dos índices
- [x] `pnpm --filter api test` — 742. `retention.job.spec.ts` tem 9 casos (datas de corte, log silencioso sem trabalho, registros pulados, isolamento de falha entre as três varreduras, e os prazos travados por valor)
- [x] `pnpm --filter api lint && pnpm --filter api build`
- [x] `pnpm --filter web lint && pnpm --filter web build`
- [x] `\d "AuditLog"` e `\d "Notification"` mostram `AuditLog_createdAt_idx` e `Notification_createdAt_idx`
- [x] `EXPLAIN` do `DELETE … WHERE "createdAt" < …` usa **Bitmap Index Scan** nos dois índices novos. (Com `enable_seqscan = off`: nas ~90 linhas da fixture o planejador escolheria seq scan por custo de qualquer jeito — o que o teste prova é que o índice é *utilizável* para este predicado, que é o que faltava.)
- [x] `grep -rn "RETENCAO_" apps/api/src | grep -c "process.env\|config.get"` — **zero**

**Adaptação:** o spec mandava acrescentar `retencao-faxina` à "lista de crons" de
`docs/deploy.md` — **essa lista não existia**. Criei a seção "Rotinas agendadas
(crons)" com os **dez** jobs, e conferi cada nome contra o `name:` do `@Cron` no
código (um estava divergente na minha primeira versão: é `acessos-faxina`, não
`registros-de-acesso-faxina`). A seção também traz as duas consultas de volume que
o próprio spec pede em "Migração de dados existentes".

**Pendência da ANPD — conferida, e não há o que mudar.** O spec pedia checar se a
`PrivacidadePage` cita "Autoridade Nacional" antes de publicar a revisão, por causa
da renomeação para "**Agência** Nacional de Proteção de Dados" (MP 1.317/2025 e Lei
15.352/2026). A página usa **só a sigla ANPD**, nunca o nome escrito — e a sigla não
muda com a renomeação. Nada a corrigir por esse motivo.

**Regressão de suíte encontrada e corrigida (fora do escopo declarado do spec).**
Depois da fase 5 a suíte e2e passou a falhar **em arquivos diferentes a cada
execução**, com `deadlock detected (40P01)` — 3 execuções seguidas acusaram
`{public-api, data, integracoes, account-purge}`, depois `{auth, lead-intake,
follow-up-cron}`, depois `{account-purge, auth}`. Nenhuma tinha relação com o que
mudou.

Causa: `criarAppDeTeste` sobe o `AppModule` real, **com o agendador armado**.
`limparBanco` faz `TRUNCATE … CASCADE` entre os testes (precisa de
`AccessExclusiveLock`), e os dois crons de **1 minuto** varrem os outbox no meio
disso — o novo `webhooks-owner-dispatch` com `FOR UPDATE SKIP LOCKED`, que toma
lock de linha onde o antigo só fazia `findMany`. Foi a segunda outbox que tornou a
corrida frequente o bastante para aparecer.

Corrigido em `test/helpers/app.ts`: os `@Cron` são parados pelo `SchedulerRegistry`
depois do `init()`. É seguro porque **nenhum spec depende do cron disparar sozinho**
— quem testa um job o chama à mão (`app.get(AccountPurgeJob).run()`). Com o
agendador ligado, ele não testava nada; só disputava lock com a limpeza.

#### Manual Verification
- [ ] Com dado semeado além do corte, rodar o job à mão: as três varreduras apagam a quantidade esperada e o log traz as contagens
- [ ] Cliente arquivado há 200 dias **com** um contato não arquivado: **não** é apagado, e o log registra o pulo com o motivo
- [ ] Cliente arquivado há 200 dias sem filho: apagado
- [ ] Notificação de 30 dias e trilha de 1 ano: **não** apagadas
- [ ] A Política de Privacidade mostra a tabela de prazos, e cada número bate com a constante
- [ ] A pendência da renomeação da ANPD foi conferida e registrada no PR

**⏸ PAUSE — FIM DA FASE 19-B.**

---

## Testing Strategy

### Unit Tests

Mockar o Prisma nos specs de regra é o certo, mas **classe que fala com infraestrutura direto tem spec que a instancia de verdade** (`apps/api/CLAUDE.md`).

- `shared/webhook-signature.spec.ts` — vetor fixo, e o caso que pega reserialização (assinatura recalculada sobre o `body` que foi realmente postado).
- `shared/crypto/segredo-cifrado.spec.ts` — instancia de verdade (é `node:crypto`): ida e volta, IV aleatório, tag adulterada, chave errada, `keyVersion` desconhecida.
- `modules/auth/totp/totp.service.spec.ts` — relógio fixo. Os casos que **não** vêm de biblioteca: janela de ±1 passo, replay, limite por conta, compare-and-swap dos códigos.
- `modules/public-api/api/public-api-key.guard.spec.ts` — rota sem `@EscopoExigido` é recusada (fail-closed).
- `modules/webhooks/application/*.spec.ts` — emitter engole exceção; não emite para webhook inativo/não verificado/sem o evento; dispatcher aplica backoff, esgota em 6 tentativas e nunca põe segredo em `lastError`.
- `modules/consent/application/consent.service.spec.ts` — revogação é linha nova; `textVersion` vem do catálogo.
- `modules/retention/application/retention.job.spec.ts` — datas de corte; isolamento de falha entre varreduras.
- `modules/notifications/infra/webhook.channel.spec.ts` — **atualizado**: quatro headers sem segredo, cinco com, e a assinatura casando com o corpo postado.

### Integration Tests

`pnpm --filter api test:e2e`, banco real. Rota `@Public()` nova entra em e2e **no mesmo PR**.

- `test/public-api.e2e-spec.ts` (novo, spec próprio — precedente `lead-intake.e2e-spec.ts`): os 8 casos da fase 2. O que não pode faltar é **afirmar a linha no banco pelo `clientAdmin()`** — sem `app.owner_id` o RLS grava zero linha e a rota responde sucesso, e é esse o caminho que já quebrou uma vez com a suíte inteira verde.
- `test/auth.e2e-spec.ts` (estendido — é rota de sessão): o ciclo de 2FA da fase 7 e os 8 casos de login em dois passos da fase 8.
- `test/rls.e2e-spec.ts`: o meta-teste de `ownerId` cobre `OwnerWebhook`, `OwnerWebhookDelivery` e `ConsentRecord` **automaticamente** — se a policy faltar, quebra ali. Acrescentar um caso explícito de que `crm_app` não consegue `UPDATE`/`DELETE` em `ConsentRecord`.
- `test/lead-intake.e2e-spec.ts`: reduzido na fase 6 (casos legados removidos).

### Migration & Rollback

Seis migrations, sempre **migration antes do código**, e três delas contêm `ALTER TYPE … ADD VALUE`, que é **irreversível**:

| Migration | Reversível? | Rollback |
|---|---|---|
| `20260821100000_public_api` | Não (`ADD VALUE`) | Nenhum. O valor sobra no enum sem uso; inócuo |
| `20260822100000_owner_webhook` | Parcial | `DROP TABLE` nas duas + `DROP TYPE`; o `ADD VALUE` de `AuditEntity` fica |
| `20260823100000_user_totp` | Parcial | `DROP TABLE` nas duas; o `ADD VALUE` de `AccessRecordKind` fica |
| `20260824100000_consent_record` | Sim | `DROP TABLE` + `DROP TYPE`. **Perde a prova de consentimento** — só em ambiente de teste |
| `20260825100000_retention_indexes` | Sim | `DROP INDEX` nos dois |

Todas passam pelo portão `scripts/validar-migrations-com-dados.sh`, que aplica o init, insere `banco-populado.sql` e só então as migrations, terminando nas invariantes. Nenhuma faz backfill; três acrescentam invariante nova (webhook cruzado, consentimento cruzado + append-only, índices de retenção).

**Ordem de deploy dentro de cada fase:** migration → API → front. As fases 2, 5, 7, 9 e 10 não têm janela de incompatibilidade (tudo aditivo). A fase 8 tem uma: o front antigo com a API nova receberia `{ twoFactorRequired: true }` no login e não saberia o que fazer — **mas só para quem já tiver 2FA ativo**, e ninguém tem antes da fase 7 ser usada. Se o deploy for atômico (é: um `docker compose up` sobe os dois), não há janela.

**A fase 6 é a única sem rollback de dado**: remover `LEAD_INTAKE_TOKEN` de produção e reverter o código não devolve a variável ao ambiente. É por isso que a pré-condição do Grafana é obrigatória.

### Migração de dados existentes

Nenhuma. Nada de backfill em nenhuma das seis migrations:

- Chave de integração existente continua com `scopes: ['lead:receber']` e continua funcionando.
- Destino de webhook cadastrado antes da fase 4 fica **sem** `config.secret` e continua entregando sem assinatura — é a propriedade "aditivo" da issue #26, e é o que evita quebrar quem já usa.
- `UserTotp` nasce vazia: ninguém tem 2FA, e o login de todos continua em um passo.
- `ConsentRecord` nasce vazia: ausência de linha é "sem registro", não "revogado".
- A retenção da fase 10 apaga, na primeira execução, tudo que já passou do corte. **Avisar antes de subir** — pode ser um volume grande de uma vez em instância antiga. Se for o caso, rodar à mão em lotes na primeira vez.

## Environment Considerations

- **CI/CD:** nenhum passo novo. O portão de PR (`.github/workflows`) já roda lint, testes, e2e e `validar-migrations-com-dados.sh` a cada push que toca a API; as seis migrations e os specs novos entram nele automaticamente.
- **Config/Secrets:**
  - `TOTP_ENCRYPTION_KEY` (fase 7) — 64 hex. **Em branco desliga o 2FA**, então não é obrigatória e a autohospedagem continua subindo sem ela. Entra no runbook de backup de segredo: perdê-la depois de ligada inutiliza o segundo fator de toda a base.
  - `LEAD_INTAKE_TOKEN` e `LEAD_INTAKE_OWNER_EMAIL` **saem** na fase 6.
  - Nenhuma variável nova de retenção, consentimento, webhook ou API pública — por decisão.
- **Migrations:** seis, detalhadas acima.
- **Crons:** dois novos. `webhooks-owner-dispatch` (`* * * * *`, fase 5) e `retencao-faxina` (2h BRT, fase 10). Passam a ser dez no total; documentar em `docs/deploy.md`.
- **Superfície pública:** as rotas `@Public()` passam de 14 para **19** (as quatro de `/public` + `POST /auth/login/2fa`). O `openapi.json` é servido por rota do Express fora dos guards, de propósito.
- **Dependências novas:** `@nestjs/swagger` (fase 3), `otplib@^13.4.1` + `@otplib/plugin-crypto-node` + `qrcode` + `@types/qrcode` (fase 7). Nenhuma no front.
- **Multi-ambiente:** sem diferença entre dev/prod, exceto que `TOTP_ENCRYPTION_KEY` ausente em dev deixa a aba Segurança em "indisponível nesta instância" — o mesmo tratamento que SMTP e captcha já recebem.

## Dependencies & Risks

**Trabalho não commitado é pré-requisito de fato.** A feature [`features/ajuda/`](../../apps/web/src/features/ajuda/) (com `DocPagina`, `TabelaDoc`, `CodeBlock` e `components/ui/prose.tsx` movido de `features/legal/`) não está em `928fdde`. As fases 3, 4 e 5 **estendem** esses arquivos. Se esse trabalho não entrar antes, as três criam páginas sobre um shell inexistente. Confirmar o merge antes de começar a fase 3.

**Rate limit por chave é em memória, e o deploy é instância única por construção.** `container_name: crm-api` fixo em `docker-compose.prod.yml` impede scale-out, então o balde único funciona. Ligar `deploy.replicas` sem trocar o storage por Redis multiplica o teto pelo número de réplicas, em silêncio. O projeto não tem Redis; a doc oficial aponta `@nest-lab/throttler-storage-redis`.

**O outbox de notificações continua sem lock distribuído.** `findPendentes` é um `findMany` simples. A outbox **nova** nasce com `FOR UPDATE SKIP LOCKED`, mas a antiga não foi corrigida — está fora de escopo, e é a mesma condição do parágrafo acima: hoje é seguro por instância única. Se o deploy escalar, notificação é entregue duas vezes. Registrado como dívida conhecida, não resolvida por esta fase.

**Perder `TOTP_ENCRYPTION_KEY` inutiliza o 2FA de toda a base ao mesmo tempo.** Mitigação: `keyVersion` na coluna desde o dia 1 (rotação possível antes de ser necessária) e a chave no runbook de backup de segredo. O risco não é eliminável — é estrutural em cifra simétrica de dado recuperável.

**O `otplib` v13 é reescrita recente.** `12.0.1` em 2020-01-24, silêncio de seis anos, `13.0.0` em 2026-01-10, `13.4.1` em 2026-05-30. É mantido e é a melhor opção (a alternativa mantida é `otpauth@9.5.1`; `speakeasy` está sem publicação desde 2016). O risco de superfície nova é contido pelo fato de o projeto usar só `generate`/`verify` e implementar replay e rate limit por conta — trocar de biblioteca depois toca dois métodos.

**Ordem interna das frentes tem uma única amarra.** A fase 5 depende da 4 (assinatura e anti-SSRF promovidos a `shared/`). A fase 3 depende da 2 (não há o que documentar antes). A 6 depende de uma condição **externa** (deploy do `site-v2`) e pode ficar para depois sem travar nada. As frentes B e C não dependem de A nem entre si — a ordem 7→8 e 9→10 é interna a cada uma.

**A fase 10 apaga muito de uma vez na primeira execução.** Instância antiga pode ter anos de `Notification` acumulada. Conferir o volume antes (`SELECT count(*) FROM "Notification" WHERE "createdAt" < now() - interval '90 days'`) e, se for grande, rodar em lotes à mão antes de deixar o cron assumir.

**O payload do webhook de saída atravessa a fronteira da workspace.** Ele carrega nome de cliente e valor de cobrança — o mesmo conteúdo que a decisão D4 da Fase 9 identificou como o risco real da feature (exfiltração, não corpo forjado). Contra isso agem a permissão `webhook:gerenciar` nova, HTTPS obrigatório, o bloqueio de IP interno com defesa contra DNS rebinding e o ping de verificação. A assinatura **não** ajuda nisso, e não é por isso que ela existe.

## References

- **PRD:** [`specs/research/2026-08-04-fase-19b-plataforma-aberta.md`](../research/2026-08-04-fase-19b-plataforma-aberta.md)
- **Fase 17-A** (a máquina de chave): [research](../research/2026-07-28-fase-17a-entrada-de-lead.md) · [plan](2026-07-28-fase-17a-entrada-de-lead.md)
- **Fase 9** (decisão D4, o desenho do HMAC): [research](../research/2026-07-27-fase-9-notificacoes-e-lembretes.md) · [plan](2026-07-27-fase-9-notificacoes-e-lembretes.md)
- **Fase 19-A** (LGPD mínimo, os precedentes de prazo e de `@OwnerOnly`): [research](../research/2026-07-28-fase-19a-lgpd-minimo.md) · [plan](2026-07-28-fase-19a-lgpd-minimo.md)
- **Documentação para terceiros** (Lacunas 4 e 5): [research](../research/2026-07-29-documentacao-para-terceiros.md)
- **Regras:** [`apps/api/CLAUDE.md`](../../apps/api/CLAUDE.md) · [`apps/web/CLAUDE.md`](../../apps/web/CLAUDE.md) · [`apps/api/ENDPOINTS.md`](../../apps/api/ENDPOINTS.md) · [`docs/observabilidade.md`](../../docs/observabilidade.md)
- **Issues:** [#26](https://github.com/programeai/CRM/issues/26) (HMAC do canal WEBHOOK — absorvida pela fase 4) · [#27](https://github.com/programeai/CRM/issues/27) (formulário público de captação — fora de escopo)
- **Externas:** [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238.txt) · [NIST SP 800-63B](https://pages.nist.gov/800-63-3/sp800-63b.html) · [OWASP Cryptographic Storage](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html) · [OWASP MFA](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html) · [OWASP SSRF](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) · [Stripe webhooks](https://docs.stripe.com/webhooks) · [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md) · [Key Uri Format](https://github.com/google/google-authenticator/wiki/Key-Uri-Format) · [LGPD](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm) · [Guia de Cookies da ANPD](https://www.gov.br/anpd/pt-br)
