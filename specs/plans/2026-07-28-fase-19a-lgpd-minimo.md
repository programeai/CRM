---
date: 2026-07-28T15:10:00-03:00
author: claude
source_prd: specs/research/2026-07-28-fase-19a-lgpd-minimo.md
git_commit: 4da2faa88d80ac95ac7c254c257c0708eff948ec
branch: main
status: implemented
tags: [spec, account, auth, billing, audit, prisma, legal, ops]
---

# Spec: Fase 19-A — LGPD mínimo

## Overview

Duas operações do titular, hoje inexistentes: **exportar a workspace inteira** num JSON legível por
máquina e **encerrar a própria conta** com efeito em cascata sobre as 12 tabelas que um
`DELETE FROM "User"` não alcança. Ambas restritas ao owner e isentas do gate de assinatura — quem
mais precisa sair é justamente quem está bloqueado.

O encerramento é **agendado com 30 dias de carência, cancelável**. Essa escolha não é só de produto:
ela resolve sozinha a tensão central do PRD. As três rotas novas rodam **sob RLS**, pelo `prisma.db`
normal, dentro da transação do request — inclusive o dump, que por isso não pode vazar linha de outra
workspace nem por bug de `where`. O trabalho pesado (apagar 12 tabelas, apagar `AuditLog`, cancelar no
Stripe) vive num **cron**, que é exatamente o uso que o docblock do `PrismaAdminService` autoriza
("crons cross-owner e seed"). Nenhuma exceção nova a declarar, e nenhum I/O de rede dentro da
transação de 5s.

A fase também fecha os dois desvios encontrados ao ler o contrato publicado: o registro de acesso
passa a ser persistido por **6 meses** (Marco Civil art. 15, hoje só 30 dias no Loki) e o backup ganha
**rotação e expiração implementadas**. Por fim, a Política de Privacidade e os Termos de Uso são
reescritos para descrever o que o sistema passa a fazer — hoje eles prometem encerramento por e-mail e
uma aritmética de prazos que não fecha.

**Correção à premissa do roadmap:** o `ExportService` da 14-A **não** é reaproveitado. Ele serializa
planilha (CSV/XLSX de aba única, teto de 5.000 linhas); o dump é um grafo relacional em JSON. O que se
reaproveita da 14-A é o padrão de trilha agregada do `ImportService` e a doutrina de que a consulta
mora no módulo dono.

## Current State

- **Nenhuma rota apaga `User`.** Colaborador é desativado, nunca apagado. Encerramento é processo
  manual por e-mail ([TermosPage.tsx:367-374](../../apps/web/src/features/legal/TermosPage.tsx#L367-L374)).
- **`DELETE FROM "User"` falha por FK.** As 16 cascatas atingem os catálogos; as 11 tabelas com
  `ownerId` sem FK sobrevivem e prendem os catálogos por `RESTRICT`. A ordem topológica das 10 tabelas
  de negócio já existe em [seed.ts:242-251](../../apps/api/prisma/seed.ts#L242-L251).
- **`AuditLog` é inapagável pela aplicação** (`REVOKE UPDATE, DELETE ... FROM crm_app`).
- **`StripeService` não tem cancelamento**; `BillingGuard` responde 402 em tudo sem
  `@AllowWithoutSubscription()`.
- **`AccessContext.isOwner` existe, mas nenhuma rota se restringe a ele** — padrão novo.
- **Nenhuma reconfirmação de senha em rota autenticada**; `passwordHash` é nullable (owner de OAuth).
- **`ConfirmDialog` não tem confirmação por digitação**; sem biblioteca de ZIP nas deps da API.
- **Registro de acesso só existe como linha de log** (`http.requisicao` → Loki, 30 dias).
- **Backup é `pg_dump` manual**, sem rotação nem expiração documentadas.

Detalhes completos, com o grafo de exclusão verificado no schema, no PRD.

## Desired End State

Um owner logado em `/configuracoes/conta`:

1. Clica **"Baixar meus dados"** e recebe `meus-dados-AAAA-MM-DD.json` com manifest (versão do
   esquema, data, contagem por coleção, lista do que **não** está incluído) e as coleções da
   workspace. Nenhum segredo no arquivo. Funciona com a assinatura expirada.
2. Clica **"Encerrar minha conta"**, lê a consequência, digita a senha (ou o e-mail da conta, se for
   owner de OAuth) e confirma. A conta fica marcada com `deletionScheduledFor = hoje + 30 dias`; um
   banner global passa a anunciar a data e a oferecer **"Cancelar o encerramento"**; um e-mail avisa o
   endereço da conta. O CRM segue funcionando normalmente durante a janela.
3. Se cancelar, os dois campos voltam a `NULL` e o banner some.
4. Passados os 30 dias, o cron diário: cancela a assinatura no Stripe → apaga, numa transação com
   timeout próprio, as 10 tabelas de negócio na ordem topológica, os canais de captação, as chaves de
   integração, os 5 catálogos, o `AuditLog` do owner e o `User` (que cascateia sessões, OAuth,
   assinatura, papéis, convites, notificações, destinos e os `User` colaboradores) → grava **uma**
   linha de auditoria sem PII registrando o expurgo. Na requisição seguinte, todas as sessões daquela
   workspace respondem `401` pelo `AccessGuard`, sem código novo.

E, no plano operacional: todo evento de autenticação grava uma linha em `AccessRecord`, expurgada aos
180 dias por cron próprio e **preservada** através do encerramento da conta; o backup roda por script
com retenção de 30 dias e ledger de expurgos; e as duas páginas legais descrevem exatamente isso.

## What We're NOT Doing

- **Consentimento, opt-out e política de retenção configurável** — Frente 19-B, por decisão de escopo
  do roadmap.
- **ZIP com CSVs por tabela.** Custaria `archiver`/`yazl` — precedente que a 14-A recusou — e planilha
  de aba única não carrega grafo relacional. O JSON já cumpre "formato legível por máquina".
- **Trilha de auditoria e notificações no dump.** São os dois blocos mais volumosos e os de menor
  valor de portabilidade. O manifest declara a ausência, o que é o que o WP29 pede ("useful
  metadata").
- **Geração assíncrona do dump** (modelo de pedido, armazenamento, tela de "pronto"). O dump roda no
  request, sem teto de linhas: um `422 refine os filtros` não faz sentido num pedido de
  portabilidade. O limite real — a transação de 5s — fica registrado como risco medido, com `ms` no
  log.
- **Transferir a titularidade da workspace** ou promover colaborador a owner. Segue fora de escopo
  (decisão da fase de colaboradores); o encerramento continua sendo a única forma de a workspace
  terminar.
- **Exclusão de conta de colaborador.** Colaborador não é titular da workspace; ele é desativado pelo
  owner e apagado junto no expurgo. Um direito de eliminação do colaborador sobre o *próprio* cadastro
  é caso da 19-B.
- **Atender titular-terceiro** (pessoa cadastrada como contato na workspace de outro). LGPD art. 18,
  § 4º, I: o caminho é indicar o controlador. É processo humano, já prometido na Política.
- **Registrar tentativas de login falhas** no `AccessRecord`. Marco Civil art. 15 fala de registro de
  *acesso*; guardar IP de tentativa frustrada é dado pessoal a mais sem obrigação que o exija.
- **Uma linha de `AccessRecord` por requisição HTTP.** Art. 5º, VIII define o registro como data/hora
  de uso a partir de um IP — o evento de autenticação. Uma linha por rota seriam dezenas de milhares
  por dia sem acrescentar nada ao que a lei pede.
- **Backup off-site / criptografado / testado por restore automático.** A fase implementa rotação,
  expiração e o ledger de expurgos. Endurecer a infraestrutura de backup é trabalho de ops próprio.

---

## Phase 1: Exportar meus dados

### Goal

`GET /account/export` devolve a workspace inteira do owner num JSON tipado, sob RLS, sem teto de
linhas e sem segredo — com a aba "Conta" em `/configuracoes` para acioná-lo.

### Changes

#### Vocabulário da trilha (uma migration para a fase inteira)

**Modify**: `apps/api/prisma/schema.prisma`

Três valores novos de enum. Entram numa migration só, aqui na Fase 1, para que as Fases 2 e 3 não
precisem de migration de enum: `ALTER TYPE ... ADD VALUE` é aditivo e nenhuma delas usa o valor no
mesmo arquivo.

```prisma
/// Registro afetado. Cresce conforme a trilha cobre mais domínio.
enum AuditEntity {
  // …existentes…
  INTEGRATION // ← Fase 17-A: emissão e rotação de chave de integração
  ACCOUNT     // ← Fase 19-A: a conta/workspace como um todo, não o colaborador (USER)
}

/// O que aconteceu. Verbo no infinitivo, no vocabulário do domínio.
enum AuditAction {
  // …existentes…
  ROTACIONAR // ← Fase 17-A: rotação de chave de integração
  EXPORTAR   // ← Fase 19-A: portabilidade dos dados do titular
  ENCERRAR   // ← Fase 19-A: pedido de encerramento da conta (o expurgo usa EXPURGAR)
}
```

**Create**: `apps/api/prisma/migrations/20260813100000_account_audit_vocabulary/migration.sql`

```sql
-- Fase 19-A: vocabulário da trilha para os eventos de conta.
--
-- `ACCOUNT` existe separado de `USER` porque são coisas diferentes na tela: `USER`
-- é o colaborador (convidar/ativar/desativar), `ACCOUNT` é a workspace inteira.
--
-- Aditivo e sem backfill: não há invariante nova a afirmar em `invariantes.sql`.
ALTER TYPE "AuditEntity" ADD VALUE IF NOT EXISTS 'ACCOUNT';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'EXPORTAR';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ENCERRAR';
```

#### O portão `isOwner`

**Create**: `apps/api/src/modules/access/owner-only.decorator.ts`

```ts
import { SetMetadata } from '@nestjs/common';

export const OWNER_ONLY_KEY = 'ownerOnly';

/**
 * Restringe a rota ao **dono da workspace** (`AccessContext.isOwner`). Aplicado
 * pelo `AccessGuard` (global), antes do `@RequirePermission()`.
 *
 * Não é uma permissão de propósito. Owner recebe todas as chaves do catálogo por
 * definição, mas uma chave nova também poderia ser atribuída a um papel de
 * colaborador — e colaborador não encerra nem exporta a conta de ninguém. Este é
 * o único portão do CRM que não é delegável.
 */
export const OwnerOnly = () => SetMetadata(OWNER_ONLY_KEY, true);
```

**Modify**: `apps/api/src/modules/access/access.guard.ts`

Entre a publicação de `req.access` e a aplicação do `@RequirePermission()` (ou seja, entre as linhas
62 e 64 atuais):

```ts
    // Também no CLS: é daqui que o AuditService descobre o autor, sem que
    // nenhum service da camada `application` precise receber o `userId`.
    this.cls.set(ACCESS_CONTEXT, access);

    // Portão indelegável: só o dono da workspace. Vem ANTES do
    // @RequirePermission() porque não é permissão — não existe chave que o
    // conceda a um colaborador.
    if (
      this.reflector.getAllAndOverride<boolean>(OWNER_ONLY_KEY, targets) &&
      !access.isOwner
    ) {
      throw new ForbiddenException(
        'Esta ação é exclusiva do dono da conta.',
      );
    }

    const required = this.reflector.getAllAndOverride<PermissionKey[]>(
```

E o import: `import { OWNER_ONLY_KEY } from './owner-only.decorator';`

#### O dump

**Create**: `apps/api/src/modules/account/domain/account-dump.ts`

```ts
/**
 * Versão do esquema do dump. Sobe quando uma coleção é adicionada, removida ou
 * troca de forma — é o que permite a quem recebeu um arquivo antigo saber o que
 * esperar dele. Vai no manifest, por exigência prática de portabilidade (WP29:
 * "along with useful metadata").
 */
export const VERSAO_DO_DUMP = 1;

/**
 * O que o dump NÃO carrega, declarado no próprio arquivo. Metade por segurança
 * (segredo não sai daqui nem para o titular: o hash de senha e o hash de chave de
 * integração não têm utilidade subsequente e vazam se o arquivo vazar), metade
 * por escopo (trilha e notificações ficaram para depois).
 */
export const NAO_INCLUIDO = [
  'Hash da senha e hashes de token (redefinição, convite, sessão).',
  'Hash e valor de chaves de integração — apenas o prefixo visível é incluído.',
  'Configuração dos destinos de notificação (a URL de um webhook É a credencial).',
  'Identificadores do cliente e da assinatura na Stripe.',
  'Trilha de auditoria e histórico de notificações.',
] as const;

export interface ManifestoDoDump {
  versaoDoEsquema: number;
  geradoEm: string;
  /** Domínio da instância que gerou o arquivo, para o titular saber a origem. */
  origem: string;
  /** Quantas linhas por coleção — confere o arquivo sem abri-lo inteiro. */
  contagem: Record<string, number>;
  naoIncluido: readonly string[];
}

export interface AccountDump {
  manifesto: ManifestoDoDump;
  conta: unknown;
  assinatura: unknown;
  colaboradores: unknown[];
  papeis: unknown[];
  funil: unknown[];
  catalogos: {
    fontesDeLead: unknown[];
    tiposDeServico: unknown[];
    tiposDeAtividade: unknown[];
    motivosDePerda: unknown[];
  };
  canaisDeCaptacao: unknown[];
  clientes: unknown[];
  contatos: unknown[];
  oportunidades: unknown[];
  propostas: unknown[];
  projetos: unknown[];
  demandas: unknown[];
  contratos: unknown[];
  cobrancas: unknown[];
  atividades: unknown[];
}
```

> Nota para o /code: os `unknown` acima são placeholders do contrato. Substitua cada um pelo tipo
> concreto do `select` correspondente do repositório (ex.: `ClienteExportado[]`), declarado neste
> mesmo arquivo. O que importa é que o **tipo venha do domínio**, não do `Prisma.ClientGetPayload`.

**Create**: `apps/api/src/modules/account/domain/account-dump.repository.ts`

```ts
export const ACCOUNT_DUMP_REPOSITORY = 'ACCOUNT_DUMP_REPOSITORY';

/** Coleções cruas da workspace, na forma em que vão para o JSON. */
export interface DadosDoDump {
  conta: ContaExportada;
  assinatura: AssinaturaExportada | null;
  colaboradores: ColaboradorExportado[];
  papeis: PapelExportado[];
  funil: EstagioExportado[];
  catalogos: CatalogosExportados;
  canaisDeCaptacao: CanalExportado[];
  clientes: ClienteExportado[];
  contatos: ContatoExportado[];
  oportunidades: OportunidadeExportada[];
  propostas: PropostaExportada[];
  projetos: ProjetoExportado[];
  demandas: DemandaExportada[];
  contratos: ContratoExportado[];
  cobrancas: CobrancaExportada[];
  atividades: AtividadeExportada[];
}

export interface AccountDumpRepository {
  /**
   * Carrega a workspace inteira. Roda DENTRO da transação do request, sob o
   * `app.owner_id` do interceptor: as 11 tabelas de negócio já vêm isoladas pelo
   * RLS. `User` está FORA do RLS, então as leituras de `User` filtram por
   * `ownerId`/`id` explicitamente — é a única parte deste repositório onde o
   * isolamento é responsabilidade do código.
   */
  carregar(ownerId: string): Promise<DadosDoDump>;
}
```

**Create**: `apps/api/src/modules/account/infra/prisma-account-dump.repository.ts`

Implementação com um `select` explícito por coleção — nunca `include` largo, nunca o registro cru do
Prisma. Rótulos de relação vêm resolvidos (nome do responsável, nome da fonte), no mesmo espírito de
`ExportColumn.value`: nada de identificador técnico onde um nome legível cabe.

```ts
@Injectable()
export class PrismaAccountDumpRepository implements AccountDumpRepository {
  constructor(private readonly prisma: PrismaService) {}

  async carregar(ownerId: string): Promise<DadosDoDump> {
    const db = this.prisma.db;

    // `User` está FORA do RLS: o filtro é explícito e é o que isola a leitura.
    // `{ OR: [{ id: ownerId }, { ownerId }] }` = o dono e os colaboradores dele.
    const pessoas = await db.user.findMany({
      where: { OR: [{ id: ownerId }, { ownerId }] },
      select: {
        id: true,
        name: true,
        email: true,
        active: true,
        acceptedAt: true,
        createdAt: true,
        ownerId: true,
        role: { select: { name: true } },
        oauthAccounts: { select: { provider: true, createdAt: true } },
        // `passwordHash` NUNCA entra no select — só o fato de existir.
        passwordHash: true,
      },
    });
    const dono = pessoas.find((p) => p.id === ownerId)!;

    // …demais coleções, cada uma com o próprio select…

    return {
      conta: {
        id: dono.id,
        nome: dono.name,
        email: dono.email,
        criadaEm: dono.createdAt,
        temSenha: dono.passwordHash !== null,
        loginSocial: dono.oauthAccounts.map((c) => ({
          provedor: c.provider,
          vinculadoEm: c.createdAt,
        })),
      },
      colaboradores: pessoas
        .filter((p) => p.id !== ownerId)
        .map((p) => ({
          nome: p.name,
          email: p.email,
          ativo: p.active,
          papel: p.role?.name ?? null,
          conviteAceitoEm: p.acceptedAt,
          criadoEm: p.createdAt,
        })),
      // …
    };
  }
}
```

> **Atenção do /code:** `temSenha: dono.passwordHash !== null` é o único uso de `passwordHash` neste
> arquivo, e o valor não sai do método. O spec de serialização (abaixo) afirma isso por asserção, não
> por convenção.

Coleções e o que cada uma leva (o `select` é o contrato — nada além disto):

| Coleção | Campos |
|---|---|
| `assinatura` | `status`, `trialEndsAt`, `currentPeriodEnd`, `cancelAtPeriodEnd`, `createdAt`. **Sem** ids da Stripe |
| `papeis` | `name`, `description`, `system`, `permissions[]`, `createdAt` |
| `funil` | `name`, `order` e demais colunas de `PipelineStage`, sem `id` de relação |
| `catalogos.*` | `name`, `active`, e `isFollowUp` nos tipos de atividade |
| `canaisDeCaptacao` | `name`, `source.name`, `assignee.name`, `key.prefix`, `createdAt`. **Sem** `keyHash` |
| `clientes` | os 19 campos de `COLUNAS_DE_CLIENTE` + `tags[]`, `source.name`, `assignee.name`, `archivedAt` |
| `contatos` | `client.name` como pai, demais colunas |
| `oportunidades` | `stage.name`, `serviceType.name`, `lostReason.name`, `client.name`, `assignee.name`, valores |
| `propostas` | colunas + `itens[]` aninhados + `parentId` traduzido em `versaoDe` (número da versão) |
| `projetos`, `demandas`, `contratos`, `cobrancas`, `atividades` | colunas + rótulos de relação |

**Create**: `apps/api/src/modules/account/application/account-export.service.ts`

```ts
@Injectable()
export class AccountExportService {
  private readonly logger = new Logger(AccountExportService.name);

  constructor(
    @Inject(ACCOUNT_DUMP_REPOSITORY)
    private readonly repo: AccountDumpRepository,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Monta o dump e devolve o arquivo pronto. `StreamableFile` sobre um Buffer já
   * serializado, pelo mesmo motivo do `ExportService`: quando o interceptor
   * commita a transação do request não há mais trabalho de banco pendente, e o
   * download não segura conexão do pool.
   *
   * Sem teto de linhas, de propósito. `assertCabeNaExportacao` existe para uma
   * listagem filtrável — um 422 "refine os filtros" num pedido de portabilidade,
   * que por definição é "tudo", seria negar o direito com uma mensagem sem
   * sentido. O limite real é a transação de 5s; por isso o `ms` no log.
   */
  async gerar(ownerId: string): Promise<StreamableFile> {
    const inicio = Date.now();
    const dados = await this.repo.carregar(ownerId);
    const dump = this.montar(dados);
    const buffer = Buffer.from(JSON.stringify(dump, null, 2), 'utf8');

    await this.audit.registrar({
      entity: 'ACCOUNT',
      entityId: ownerId,
      entityLabel: 'Meus dados',
      action: 'EXPORTAR',
      extra: {
        versaoDoEsquema: VERSAO_DO_DUMP,
        contagem: dump.manifesto.contagem,
        bytes: buffer.byteLength,
      },
    });
    this.logger.log({
      evento: 'conta.dados_exportados',
      msg: 'Dump de portabilidade gerado.',
      ownerId,
      bytes: buffer.byteLength,
      ms: Date.now() - inicio,
    });

    const dia = new Date().toISOString().slice(0, 10);
    return new StreamableFile(buffer, {
      type: 'application/json; charset=utf-8',
      disposition: `attachment; filename="meus-dados-${dia}.json"`,
      length: buffer.byteLength,
    });
  }

  private montar(dados: DadosDoDump): AccountDump { /* manifesto + coleções */ }
}
```

**Create**: `apps/api/src/modules/account/api/account.controller.ts`

```ts
@Controller('account')
export class AccountController {
  constructor(private readonly exportar: AccountExportService) {}

  /**
   * Portabilidade (LGPD art. 18, V e art. 19, § 3º). `@OwnerOnly()` porque o dump
   * é da workspace inteira; `@AllowWithoutSubscription()` porque a Política
   * promete o direito "a qualquer momento e sem custo" — sem isso, o BillingGuard
   * responderia 402 justamente a quem quer levar os dados e sair.
   *
   * Throttle apertado: é a rota mais cara da API por chamada.
   */
  @OwnerOnly()
  @AllowWithoutSubscription()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Get('export')
  export(@CurrentOwnerId() ownerId: string): Promise<StreamableFile> {
    return this.exportar.gerar(ownerId);
  }
}
```

**Create**: `apps/api/src/modules/account/account.module.ts`

```ts
/**
 * Os direitos do titular sobre a própria conta: portabilidade (19-A) e
 * encerramento. Não tem tabela própria — opera sobre `User` e sobre as tabelas
 * de negócio dos outros módulos, e é o único módulo autorizado a atravessar
 * essa fronteira, porque é o único cuja unidade de trabalho É a workspace.
 *
 * AuditModule é @Global() (ver app.module.ts) — AuditService chega sem import.
 */
@Module({
  controllers: [AccountController],
  providers: [
    AccountExportService,
    { provide: ACCOUNT_DUMP_REPOSITORY, useClass: PrismaAccountDumpRepository },
  ],
})
export class AccountModule {}
```

**Modify**: `apps/api/src/app.module.ts` — importa `AccountModule` (depois de `TrashModule`, antes de
`BillingModule`).

**Modify**: `apps/api/ENDPOINTS.md` — seção nova `## Conta (LGPD)`, antes de `## Billing`:

```markdown
## Conta (LGPD)

Os direitos do titular sobre a própria conta. **Todas as rotas desta seção exigem
ser o dono da workspace** (`@OwnerOnly()` — não existe permissão que conceda isto
a um colaborador) e são **isentas do gate de assinatura**: a Política de
Privacidade promete os direitos "a qualquer momento e sem custo", e um 402 aqui
negaria o direito a quem mais precisa dele.

### GET /account/export
- **Propósito:** Portabilidade (LGPD art. 18, V e art. 19, § 3º): baixar a workspace inteira do titular num JSON único. Traz manifest (versão do esquema, data, contagem por coleção e a lista do que **não** está incluído) e uma coleção por entidade. **Sem teto de linhas** — ao contrário das exportações de listagem, um pedido de portabilidade é "tudo".
- **Auth:** Bearer (access token). Exclusiva do dono da conta. Isenta do gate de assinatura. Limite de 3 chamadas por minuto.
- **Body:** —
- **Resposta:** `200` arquivo (`Content-Disposition: attachment; filename="meus-dados-AAAA-MM-DD.json"`, `application/json; charset=utf-8`).
- **Erros:** `403 Esta ação é exclusiva do dono da conta.`, `429`, `401`.
- **Handler:** `modules/account/api/account.controller.ts` → `AccountController.export`
```

#### Web

**Modify**: `apps/web/src/lib/api-error.ts` — extrai `mensagemDoBlobDeErro(erro): Promise<string>` de
`use-export.ts` (o corpo de erro de um download vem como `Blob`; agora dois hooks precisam dele).

**Modify**: `apps/web/src/hooks/use-export.ts` — passa a importar `mensagemDoBlobDeErro` de
`@/lib/api-error` em vez de declarar a função local. Comportamento idêntico.

**Create**: `apps/web/src/hooks/use-download.ts`

```ts
/**
 * Baixa um arquivo de uma rota GET da API, sem query de formato — o irmão do
 * `useExport`, que é específico de planilha (csv/xlsx + params de filtro). Mesma
 * mecânica de Blob e o mesmo desembrulho da mensagem pt-BR do corpo de erro.
 */
export function useDownload() {
  const [baixando, setBaixando] = useState(false);

  async function baixar(caminho: string, nomeArquivo: string) {
    setBaixando(true);
    try {
      const { data } = await api.get<Blob>(caminho, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = nomeArquivo;
      a.click();
      URL.revokeObjectURL(url);
    } catch (erro) {
      toast.error(await mensagemDoBlobDeErro(erro));
    } finally {
      setBaixando(false);
    }
  }

  return { baixar, baixando };
}
```

**Create**: `apps/web/src/features/conta/ContaTab.tsx`

Aba "Conta". Nesta fase só a seção de exportação; a Fase 2 acrescenta o encerramento abaixo dela.

```tsx
/**
 * Aba "Conta" de `/configuracoes`: os direitos do titular sobre a workspace.
 * Exclusiva do dono — a aba já é filtrada em `ConfiguracoesLayout`, e este
 * redirect é o que impede a URL direta de renderizar uma tela que a API recusa.
 */
export default function ContaTab() {
  const { isOwner, loading } = useCan();
  const { baixar, baixando } = useDownload();

  if (loading) return <Skeleton className="h-40 w-full max-w-lg" />;
  if (!isOwner) return <Navigate to="/configuracoes" replace />;

  const dia = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex max-w-2xl flex-col gap-10">
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-lg font-semibold">Meus dados</h2>
          <p className="text-sm text-muted-foreground">
            Baixe tudo que existe nesta conta num arquivo único: clientes,
            contatos, oportunidades, propostas, projetos, demandas, contratos,
            cobranças, atividades, catálogos e a equipe. O formato é JSON, legível
            por máquina, para você levar os dados para onde quiser.
          </p>
        </div>
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={baixando}
            onClick={() =>
              void baixar('/account/export', `meus-dados-${dia}.json`)
            }
          >
            {baixando ? <Spinner data-icon="inline-start" /> : <Download data-icon="inline-start" />}
            {baixando ? 'Preparando…' : 'Baixar meus dados'}
          </Button>
        </div>
      </section>
    </div>
  );
}
```

**Modify**: `apps/web/src/features/configuracoes/ConfiguracoesLayout.tsx`

```tsx
/**
 * Abas da própria conta. As três primeiras não declaram permissão: todo mundo —
 * owner ou colaborador — edita o próprio perfil, vê os próprios dispositivos e
 * escolhe onde ser avisado. "Conta" é a exceção e o primeiro gate por `isOwner`
 * da interface: exportar a workspace e encerrá-la não são "própria conta" no
 * sentido do colaborador. Assinatura fica de fora: é `/assinatura`.
 */
const TABS: SectionTabItem[] = [
  { label: 'Perfil', to: '/configuracoes', end: true },
  { label: 'Dispositivos', to: '/configuracoes/dispositivos' },
  { label: 'Notificações', to: '/configuracoes/notificacoes' },
];

const TAB_DA_CONTA: SectionTabItem = {
  label: 'Conta',
  to: '/configuracoes/conta',
};

export default function ConfiguracoesLayout() {
  const { isOwner } = useCan();
  const tabs = isOwner ? [...TABS, TAB_DA_CONTA] : TABS;
  // …resto igual, passando `tabs` ao SectionTabs…
}
```

**Modify**: `apps/web/src/routes/router.tsx` — `{ path: 'conta', element: <ContaTab /> }` nos filhos de
`/configuracoes`.

**Modify**: `apps/web/src/lib/labels.ts` — `ACCOUNT: 'Conta'` em `AUDIT_ENTITY_LABELS`;
`EXPORTAR: 'Exportou os dados'` e `ENCERRAR: 'Pediu o encerramento'` em `AUDIT_ACTION_LABELS`. Os
filtros da tela de auditoria derivam desses mapas por `Object.keys` — nada mais a mudar lá.

#### Testes

**Create**: `apps/api/src/modules/account/application/account-export.service.spec.ts`

- Monta o manifest: `versaoDoEsquema`, `contagem` por coleção coerente com os dados do mock,
  `naoIncluido` presente.
- **Asserção que mais importa:** serializa o dump e afirma que a string resultante não contém
  `passwordHash`, `keyHash`, `tokenHash`, `stripeCustomerId`, `stripeSubscriptionId` nem nenhum valor
  `$argon2`. É a garantia de que um `select` largo acidental reprova no CI.
- Registra a trilha com `entity: 'ACCOUNT'`, `action: 'EXPORTAR'`.

**Create**: `apps/api/test/account.e2e-spec.ts`

- Dois owners com dado de negócio (reaproveita os helpers de `rls.e2e-spec.ts`).
- Owner A chama `GET /account/export`: o JSON traz **só** clientes/deals/etc. de A; nenhum id, nome
  ou e-mail de B aparece no corpo.
- Colaborador de A recebe `403`.
- Owner com assinatura `CANCELED` recebe `200` (afirma o `@AllowWithoutSubscription()`).

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api build` — compila (tipos do dump e do repositório fecham).
- [x] `pnpm --filter api lint` — sem violação nos arquivos da fase (ver nota abaixo).
- [x] `pnpm --filter api test` — inclui `account-export.service.spec.ts` verde, com a asserção de
      ausência de segredos.
- [x] `pnpm --filter api test:e2e` — `account.e2e-spec.ts` verde: dump de A sem linha de B,
      colaborador `403`, assinatura cancelada `200`.
- [x] `DATABASE_URL=postgresql://crm_user:crm_password@localhost:5435/crm_db apps/api/scripts/validar-migrations-com-dados.sh`
      — a migration de enum aplica sobre a fixture populada.
- [x] `pnpm --filter web build` — compila (nova rota, novo hook, labels).
- [x] `pnpm --filter web lint` — sem violação.

> Nota: `pnpm --filter api lint` acusa 2 erros pré-existentes em `src/main.ts`
> (`no-unsafe-call`/`no-unsafe-member-access` em `getHttpAdapter().getInstance().set(...)`),
> sem relação com esta fase — `main.ts` não foi tocado. Fora esse arquivo, o lint está limpo.

#### Manual Verification
- [ ] Logado como owner, `/configuracoes` mostra 4 abas; a aba "Conta" baixa
      `meus-dados-AAAA-MM-DD.json`.
- [ ] Abrir o arquivo: manifest com contagem coerente, coleções preenchidas, nenhum hash e nenhum id
      da Stripe.
- [ ] Logado como colaborador, `/configuracoes` mostra 3 abas; digitar
      `/configuracoes/conta` na URL redireciona ao Perfil.
- [ ] `/administracao/auditoria` mostra a linha "Exportou os dados" em "Conta".

**⏸ PAUSE**: Após a verificação automatizada passar, pare para confirmação humana dos testes manuais
antes de seguir para a Fase 2.

---

## Phase 2: Pedir e cancelar o encerramento

### Goal

O owner agenda o encerramento com 30 dias de carência, reautenticando-se; pode cancelar a qualquer
momento na janela; e a interface anuncia o prazo de forma inescapável.

### Changes

#### Schema

**Modify**: `apps/api/prisma/schema.prisma` — no modelo `User`, após `acceptedAt`:

```prisma
  /// Encerramento agendado (Fase 19-A). Os dois campos andam juntos: nulos
  /// (conta normal) ou ambos preenchidos. Só um OWNER pode tê-los — colaborador
  /// não encerra workspace, ele é apagado junto no expurgo.
  ///
  /// A carência de 30 dias existe por duas razões que se somam: protege contra
  /// exclusão por sequestro de conta (é o padrão Atlassian/GitLab) e tira o
  /// trabalho pesado da transação de 5s do request, porque quem expurga é o
  /// `AccountPurgeJob`. O "irreversível" prometido continua verdadeiro: é
  /// irreversível DEPOIS da janela.
  ///
  /// Também são o tombstone que sobrevive a um restore de backup: um `User`
  /// restaurado com `deletionScheduledFor` no passado é expurgado de novo pelo
  /// cron seguinte, sem intervenção.
  deletionRequestedAt  DateTime?
  deletionScheduledFor DateTime?
```

E o índice, no fim do modelo: `@@index([deletionScheduledFor])`.

**Create**: `apps/api/prisma/migrations/20260814100000_account_deletion/migration.sql`

```sql
-- Fase 19-A: encerramento de conta agendado, com carência.
--
-- Colunas nulas e aditivas: nenhum backfill. O índice serve à varredura do
-- `AccountPurgeJob` (um `WHERE "deletionScheduledFor" <= now()` diário sobre
-- `User`), que sem ele seria seq scan.
ALTER TABLE "User" ADD COLUMN "deletionRequestedAt"  TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "deletionScheduledFor" TIMESTAMP(3);

CREATE INDEX "User_deletionScheduledFor_idx" ON "User"("deletionScheduledFor");
```

**Modify**: `apps/api/prisma/fixtures/invariantes.sql` — bloco novo no fim:

```sql
-- ---------------------------------------------------------------------------
-- Encerramento de conta (20260814100000_account_deletion)
-- ---------------------------------------------------------------------------
-- As colunas nascem nulas e a migration é aditiva, então não há backfill a
-- conferir. O que se afirma aqui é a REGRA do par, que nenhuma constraint do
-- banco expressa: os dois campos andam juntos, o agendamento é posterior ao
-- pedido, e só owner pode tê-los. Um par meio-preenchido faria o cron expurgar
-- uma conta que ninguém pediu para encerrar — o pior erro possível nesta fase.
DO $$
DECLARE
  meio_par     INT;
  fora_de_ordem INT;
  colaborador  INT;
BEGIN
  SELECT count(*) INTO meio_par FROM "User"
   WHERE ("deletionRequestedAt" IS NULL) <> ("deletionScheduledFor" IS NULL);
  IF meio_par > 0 THEN
    RAISE EXCEPTION 'Há % usuário(s) com encerramento meio-preenchido (um campo nulo e o outro não).', meio_par;
  END IF;

  SELECT count(*) INTO fora_de_ordem FROM "User"
   WHERE "deletionScheduledFor" IS NOT NULL
     AND "deletionScheduledFor" <= "deletionRequestedAt";
  IF fora_de_ordem > 0 THEN
    RAISE EXCEPTION 'Há % usuário(s) com encerramento agendado para antes do próprio pedido.', fora_de_ordem;
  END IF;

  SELECT count(*) INTO colaborador FROM "User"
   WHERE "deletionScheduledFor" IS NOT NULL AND "ownerId" IS NOT NULL;
  IF colaborador > 0 THEN
    RAISE EXCEPTION 'Há % COLABORADOR(es) com encerramento agendado — só owner encerra workspace.', colaborador;
  END IF;
END $$;
```

#### Billing: o cancelamento que não existia

**Modify**: `apps/api/src/modules/billing/application/stripe.service.ts` — dois métodos novos no
wrapper:

```ts
  /**
   * Marca a assinatura para NÃO renovar, preservando o acesso até o fim do ciclo
   * pago. É o que o encerramento agendado precisa: ninguém é cobrado por um ciclo
   * que não vai usar, e o `BillingGuard` continua liberando durante a carência.
   *
   * Idempotente: chamar de novo numa assinatura já marcada é no-op no Stripe.
   */
  async agendarCancelamento(stripeSubscriptionId: string): Promise<void> {
    await this.client.subscriptions.update(stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
  }

  /**
   * Cancela agora. Chamado no expurgo, quando a conta deixa de existir — sem
   * isto o objeto remoto continuaria cobrando um cliente que já foi apagado, e o
   * webhook viraria órfão (o `stripeCustomerId` some com o `User`).
   *
   * Assinatura já cancelada devolve `resource_missing`/estado final: tratado como
   * sucesso por quem chama, porque o efeito desejado já vale.
   */
  async cancelarAgora(stripeSubscriptionId: string): Promise<void> {
    await this.client.subscriptions.cancel(stripeSubscriptionId);
  }
```

**Modify**: `apps/api/src/modules/billing/domain/subscription.repository.ts` — dois getters:

```ts
  /** Id da assinatura no Stripe, sob RLS (caminho HTTP). `null` sem assinatura. */
  getStripeSubscriptionId(ownerId: string): Promise<string | null>;
  /** O mesmo, pelo client admin — para o cron, que roda sem `app.owner_id`. */
  getStripeSubscriptionIdForSystem(ownerId: string): Promise<string | null>;
```

**Modify**: `apps/api/src/modules/billing/infra/prisma-subscription.repository.ts` — implementa os
dois (`prisma.db.subscription.findUnique` e `admin.subscription.findUnique`, ambos
`select: { stripeSubscriptionId: true }`), no formato dos pares já existentes
(`findByOwnerId`/`findByOwnerIdForGate`).

**Modify**: `apps/api/src/modules/billing/application/billing.service.ts` — a fronteira pública que o
módulo `account` consome (o `AccountModule` **não** conhece `StripeService`):

```ts
  /**
   * Marca a assinatura do owner para não renovar, no contexto do encerramento da
   * conta. Tolerante por desenho: billing off (autohospedagem), owner sem
   * assinatura ou sem `stripeSubscriptionId` (trial que nunca virou checkout) são
   * no-op — o encerramento não pode depender de haver assinatura.
   *
   * **Quem chama é o cron, nunca o request.** A chamada é I/O de rede e o handler
   * autenticado roda dentro da `$transaction` do `OwnerContextInterceptor`
   * (`prisma.service.ts:69`: nada de I/O ali dentro). O `AccountPurgeJob` varre
   * diariamente quem pediu encerramento e ainda tem assinatura renovável.
   */
  async agendarCancelamentoPorEncerramento(ownerId: string): Promise<boolean> {
    if (!this.stripe.enabled) return false;
    const id = await this.repo.getStripeSubscriptionIdForSystem(ownerId);
    if (!id) return false;
    await this.stripe.agendarCancelamento(id);
    return true;
  }

  /** Cancela agora, no expurgo. Também no cron, também fora de transação. */
  async cancelarAgoraPorExpurgo(ownerId: string): Promise<boolean> {
    if (!this.stripe.enabled) return false;
    const id = await this.repo.getStripeSubscriptionIdForSystem(ownerId);
    if (!id) return false;
    await this.stripe.cancelarAgora(id);
    return true;
  }
```

**Modify**: `apps/api/src/modules/billing/billing.module.ts` — exporta `BillingService` (hoje só o
controller o usa), para o `AccountModule` importar.

> **Desvio deliberado do que foi decidido, e por quê.** A decisão foi "cancelar automático em duas
> etapas, e se o Stripe estiver fora do ar o pedido responde 503". A segunda metade não sobrevive à
> regra escrita em [prisma.service.ts:69](../../apps/api/src/prisma/prisma.service.ts#L69): o handler
> autenticado roda dentro da transação do request, e chamar o Stripe ali a manteria aberta durante o
> I/O. Então **as duas etapas migram para o cron**: `cancel_at_period_end` na primeira varredura
> depois do pedido (até 24h), `cancel` no expurgo. O que a decisão garantia continua garantido — a
> conta nunca é apagada com assinatura viva, porque o expurgo só prossegue se o cancelamento
> retornou. E o pedido de encerramento passa a nunca falhar por causa do Stripe, o que é melhor para
> o titular. O buraco de 24h só morde quem renova nesse intervalo; os Termos já cobrem o caso pelo
> canal de suporte e pelo direito de arrependimento.

#### O pedido e o cancelamento

**Create**: `apps/api/src/modules/account/domain/account-deletion.ts`

```ts
/**
 * Carência entre o pedido e o expurgo. 30 dias é o prazo que a Política de
 * Privacidade já publicou e o mesmo do GitLab SaaS. Exportado porque três lugares
 * precisam do MESMO número: o service que agenda, o e-mail que avisa e o texto
 * da Política.
 */
export const CARENCIA_DE_ENCERRAMENTO_DIAS = 30;

export interface EncerramentoAgendado {
  requestedAt: Date;
  scheduledFor: Date;
}
```

**Create**: `apps/api/src/modules/account/domain/account.repository.ts`

```ts
export const ACCOUNT_REPOSITORY = 'ACCOUNT_REPOSITORY';

/** O que o encerramento precisa saber do `User` — sem expor o registro cru. */
export interface ContaDoTitular {
  id: string;
  name: string;
  email: string;
  passwordHash: string | null;
  deletionRequestedAt: Date | null;
  deletionScheduledFor: Date | null;
}

export interface AccountRepository {
  /** Caminho HTTP. `User` está fora do RLS: o filtro por id é o isolamento. */
  findById(ownerId: string): Promise<ContaDoTitular | null>;
  agendarEncerramento(ownerId: string, agendamento: EncerramentoAgendado): Promise<void>;
  cancelarEncerramento(ownerId: string): Promise<void>;
}
```

**Create**: `apps/api/src/modules/account/infra/prisma-account.repository.ts` — implementação por
`prisma.db.user`, com `select` explícito.

**Create**: `apps/api/src/modules/account/application/account-deletion.service.ts`

```ts
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    @Inject(ACCOUNT_REPOSITORY) private readonly repo: AccountRepository,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Agenda o encerramento. Nada de Stripe aqui: é I/O de rede e este método roda
   * dentro da transação do request (ver `BillingService.agendarCancelamentoPorEncerramento`).
   * O e-mail sai inline seguindo o precedente do convite de colaborador
   * (`CollaboratorsService.invite`), e engole a própria falha — o aviso na
   * interface é o caminho que não depende de SMTP.
   */
  async solicitar(
    ownerId: string,
    confirmacao: { password?: string; email?: string },
  ): Promise<EncerramentoAgendado> {
    const conta = await this.exigirConta(ownerId);
    if (conta.deletionScheduledFor) {
      throw new ConflictException(
        'O encerramento desta conta já está agendado. Cancele antes de pedir de novo.',
      );
    }
    await this.assertReautenticado(conta, confirmacao);

    const requestedAt = new Date();
    const scheduledFor = new Date(
      requestedAt.getTime() +
        CARENCIA_DE_ENCERRAMENTO_DIAS * 24 * 60 * 60 * 1000,
    );
    await this.repo.agendarEncerramento(ownerId, { requestedAt, scheduledFor });

    await this.audit.registrar({
      entity: 'ACCOUNT',
      entityId: ownerId,
      // Nome, não e-mail: a linha morre no expurgo junto com a conta, mas não há
      // razão para duplicar o endereço na trilha.
      entityLabel: conta.name,
      action: 'ENCERRAR',
      extra: {
        agendadoPara: scheduledFor.toISOString(),
        carenciaDias: CARENCIA_DE_ENCERRAMENTO_DIAS,
      },
    });
    this.logger.warn({
      evento: 'conta.encerramento_solicitado',
      msg: 'Encerramento de conta agendado pelo titular.',
      ownerId,
      agendadoPara: scheduledFor.toISOString(),
      carenciaDias: CARENCIA_DE_ENCERRAMENTO_DIAS,
    });
    await this.mail.sendAccountDeletionScheduled({
      to: conta.email,
      name: conta.name,
      scheduledFor,
    });

    return { requestedAt, scheduledFor };
  }

  /** Desfaz o agendamento. Só é possível DENTRO da janela — depois não há conta. */
  async cancelar(ownerId: string): Promise<void> {
    const conta = await this.exigirConta(ownerId);
    if (!conta.deletionScheduledFor) {
      throw new ConflictException(
        'Esta conta não tem encerramento agendado.',
      );
    }
    await this.repo.cancelarEncerramento(ownerId);
    await this.audit.registrar({
      entity: 'ACCOUNT',
      entityId: ownerId,
      entityLabel: conta.name,
      action: 'CANCELAR',
      extra: { agendamentoDesfeitoDe: conta.deletionScheduledFor.toISOString() },
    });
    this.logger.log({
      evento: 'conta.encerramento_cancelado',
      msg: 'Encerramento de conta cancelado pelo titular.',
      ownerId,
    });
  }

  /**
   * Reautenticação (OWASP ASVS 3.7.1: transação sensível exige reconfirmação).
   * Dois caminhos porque `passwordHash` é nullable: owner criado por OAuth não
   * tem senha, e negar-lhe o direito de encerrar seria pior do que aceitar a
   * confirmação por digitação do e-mail — que é o que GitHub e Notion fazem. A
   * proteção real contra sequestro, nos dois casos, é a carência de 30 dias
   * somada ao e-mail de aviso.
   *
   * `ForbiddenException`, nunca `UnauthorizedException`: um 401 em rota
   * autenticada dispara o refresh/logout do cliente HTTP, e uma senha errada no
   * diálogo derrubaria a sessão em vez de mostrar a mensagem.
   */
  private async assertReautenticado(
    conta: ContaDoTitular,
    confirmacao: { password?: string; email?: string },
  ): Promise<void> {
    if (conta.passwordHash) {
      if (
        !confirmacao.password ||
        !(await argon2.verify(conta.passwordHash, confirmacao.password))
      ) {
        throw new ForbiddenException('Senha incorreta.');
      }
      return;
    }
    const informado = confirmacao.email?.trim().toLowerCase();
    if (!informado || informado !== conta.email.toLowerCase()) {
      throw new ForbiddenException(
        'O e-mail informado não confere com o da conta.',
      );
    }
  }

  private async exigirConta(ownerId: string): Promise<ContaDoTitular> {
    const conta = await this.repo.findById(ownerId);
    if (!conta) {
      throw new UnauthorizedException(
        'Sua sessão não é mais válida. Entre novamente.',
      );
    }
    return conta;
  }
}
```

**Create**: `apps/api/src/modules/account/api/dto/request-deletion.dto.ts`

```ts
/**
 * Confirmação do encerramento. Os dois campos são opcionais no DTO e
 * mutuamente exclusivos na regra: qual deles vale depende de a conta ter senha
 * (ver `AccountDeletionService.assertReautenticado`). Validar aqui qual é o
 * exigido vazaria, na mensagem de erro, se aquele e-mail tem senha ou é só-OAuth.
 */
export class RequestDeletionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'A senha informada é longa demais.' })
  password?: string;

  @IsOptional()
  @IsEmail({}, { message: 'E-mail inválido' })
  email?: string;
}
```

**Modify**: `apps/api/src/modules/account/api/account.controller.ts`

```ts
  /**
   * Pede o encerramento (LGPD art. 18, VI e Termos § "Suspensão e
   * encerramento"). Não apaga nada agora: agenda para
   * `CARENCIA_DE_ENCERRAMENTO_DIAS` dias e devolve a data.
   */
  @OwnerOnly()
  @AllowWithoutSubscription()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('deletion')
  solicitarEncerramento(
    @CurrentOwnerId() ownerId: string,
    @Body() dto: RequestDeletionDto,
  ) {
    return this.encerramento.solicitar(ownerId, dto);
  }

  /** Cancela o encerramento agendado, dentro da janela de carência. */
  @OwnerOnly()
  @AllowWithoutSubscription()
  @Delete('deletion')
  async cancelarEncerramento(@CurrentOwnerId() ownerId: string) {
    await this.encerramento.cancelar(ownerId);
    return { ok: true };
  }
```

#### `GET /auth/me` passa a contar duas coisas novas

**Modify**: `apps/api/src/modules/auth/auth.service.ts` — método `me()`:

```ts
  async me(userId: string, access: AccessContext) {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    // `ownerId`/`roleId` ficam de fora: são o mesmo dado que `isOwner`/`role`
    // expressam melhor. As colunas de encerramento também saem cruas: viram o
    // objeto `deletion`, que o banner global consome — e assim o front não
    // precisa saber que existem duas colunas que andam em par.
    const {
      passwordHash,
      ownerId,
      roleId,
      deletionRequestedAt,
      deletionScheduledFor,
      ...safe
    } = user;
    return {
      ...safe,
      isOwner: access.isOwner,
      role: access.roleId ? { id: access.roleId, name: access.roleName } : null,
      permissions: access.permissions,
      /**
       * `false` no owner criado por OAuth. O diálogo de encerramento usa isto
       * para pedir a senha ou o e-mail da conta — e é a única informação sobre
       * autenticação que o front recebe.
       */
      hasPassword: passwordHash !== null,
      /**
       * Encerramento agendado da WORKSPACE. Vem no `me` de todo mundo, owner ou
       * colaborador: o banner tem de avisar a equipe inteira, e só o owner vê o
       * botão de cancelar.
       */
      deletion: deletionScheduledFor
        ? {
            requestedAt: deletionRequestedAt,
            scheduledFor: deletionScheduledFor,
          }
        : null,
    };
  }
```

> **Cuidado do /code:** para o colaborador, `deletionScheduledFor` do **próprio** registro é sempre
> nulo (a invariante garante). O banner precisa do agendamento do **owner**. Então `me()` precisa ler
> o encerramento de `access.ownerId`, não de `userId`. Implementação: quando
> `access.ownerId !== userId`, buscar o agendamento pelo owner
> (`users.findDeletionSchedule(access.ownerId)`, novo método de `UsersService` com `select` de duas
> colunas). Sem isso o banner nunca aparece para colaborador.

**Modify**: `apps/api/src/modules/users/users.service.ts` — método novo:

```ts
  /** Só o agendamento de encerramento de um owner — para o `me` do colaborador. */
  findDeletionSchedule(ownerId: string) {
    return this.prisma.user.findUnique({
      where: { id: ownerId },
      select: { deletionRequestedAt: true, deletionScheduledFor: true },
    });
  }
```

#### E-mail

**Create**: `apps/api/src/mail/templates/account-deletion-scheduled.template.ts` — no formato de
`password-reset.template.ts` (`EmailContent` com `subject`/`text`/`html`). Assunto:
`Encerramento da sua conta no CRM ProgrameAi agendado`. Corpo: a data, a informação de que o CRM
segue funcionando até lá, o caminho para cancelar (`/configuracoes/conta`) e o aviso de que passada a
data a recuperação não é possível. **Sem link com token** — quem cancela é quem consegue entrar, e
inventar um token de cancelamento por e-mail criaria um segredo novo para quebrar na autohospedagem
sem SMTP.

**Modify**: `apps/api/src/mail/mail.service.ts` — `sendAccountDeletionScheduled(params)`, no contrato
de `sendPasswordReset`: engole a falha, e sem SMTP registra `email.smtp_desabilitado` (sem link, pois
não há token).

#### Web

**Create**: `apps/web/src/components/ui/confirm-typed-dialog.tsx`

```tsx
/**
 * Confirmação por digitação: o usuário reproduz um texto exato antes de o botão
 * destrutivo habilitar. É o "nonstandard action" que a NN/g reserva às operações
 * mais perigosas — e por isso mesmo o `ConfirmDialog` comum continua sendo o
 * padrão da casa: usar este em tudo o esvaziaria.
 *
 * Herda do `AlertDialog` do design system, então a pilha global de modais
 * (`modal-stack`) continua valendo — nada de diálogo com estado próprio.
 */
export function ConfirmTypedDialog({
  open,
  onOpenChange,
  title,
  description,
  /** O texto que precisa ser digitado (ex.: o e-mail da conta). */
  expected,
  expectedLabel,
  /** Campo extra pedido junto (a senha), quando houver. */
  secret,
  confirmLabel = 'Confirmar',
  pendingLabel = 'Processando…',
  pending = false,
  onConfirm,
}: ConfirmTypedDialogProps) { /* … */ }
```

Regras de comportamento: o botão só habilita quando `digitado.trim() === expected` (e, com `secret`,
quando o campo de senha não está vazio); usa `Input`/`PasswordInput` do design system, nunca nativo;
`FieldLabel required`; o estado é limpo ao fechar.

**Create**: `apps/web/src/features/conta/api/conta.api.ts` e `api/hooks.ts`

```ts
export const contaApi = {
  solicitarEncerramento: (body: { password?: string; email?: string }) =>
    api.post<{ requestedAt: string; scheduledFor: string }>('/account/deletion', body)
      .then((r) => r.data),
  cancelarEncerramento: () =>
    api.delete<{ ok: true }>('/account/deletion').then((r) => r.data),
};
```

Hooks `useSolicitarEncerramento` / `useCancelarEncerramento`, ambos invalidando `queryKeys.auth.me`
no `onSuccess` — é de lá que o banner e a seção leem o estado.

**Modify**: `apps/web/src/features/perfil/api/perfil.api.ts` — o tipo `Me` ganha:

```ts
  /** `false` na conta criada só por login social — não há senha a reconfirmar. */
  hasPassword: boolean;
  /** Encerramento agendado da workspace; `null` quando não há. */
  deletion: { requestedAt: string; scheduledFor: string } | null;
```

**Modify**: `apps/web/src/features/conta/ContaTab.tsx` — seção nova abaixo de "Meus dados":

- Sem agendamento: bloco "Encerrar minha conta" com borda `border-destructive/40`, o texto de
  consequência (o que é apagado, que a equipe perde o acesso, que a assinatura é cancelada, que
  passados os 30 dias não há recuperação), o convite a exportar antes, e um `Button variant="destructive"`
  que abre o `ConfirmTypedDialog` — `expected` = o e-mail da conta, mais o campo de senha quando
  `me.hasPassword`.
- Com agendamento: o mesmo bloco vira o estado "encerramento agendado para `formatDate(scheduledFor)`",
  com `Button` de **"Cancelar o encerramento"** (não destrutivo — cancelar é a direção segura) e um
  `ConfirmDialog` comum.
- Toasts: `'Encerramento agendado para DD/MM/AAAA.'` e `'Encerramento cancelado. Sua conta segue ativa.'`

**Modify**: `apps/web/src/app/AppLayout.tsx` — banner global, **acima** do banner de trial (o
encerramento é a informação mais importante da tela):

```tsx
        {me?.deletion && (
          <div className="flex w-full items-center justify-center gap-2 border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
            <TriangleAlert className="size-4 shrink-0" />
            <span>
              Esta conta será encerrada em {formatDate(me.deletion.scheduledFor)}
              . Todos os dados serão apagados e não será possível recuperá-los.
            </span>
            {isOwner && (
              <Button
                type="button"
                variant="link"
                className="h-auto p-0 text-destructive underline"
                onClick={() => navigate('/configuracoes/conta')}
              >
                Cancelar o encerramento
              </Button>
            )}
          </div>
        )}
```

> Colaborador vê o aviso e **não** vê o botão: ele não pode cancelar, e um botão que responderia 403
> seria pior do que nenhum.

**Modify**: `apps/api/ENDPOINTS.md` — dois endpoints na seção `## Conta (LGPD)`:

```markdown
### POST /account/deletion
- **Propósito:** Pedir o encerramento da conta e de toda a workspace. **Não apaga nada agora:** agenda o expurgo para 30 dias à frente (carência cancelável) e devolve a data. Durante a janela o CRM segue funcionando normalmente, com aviso permanente na interface. Exige reautenticação: a senha da conta, ou — quando a conta foi criada só por login social e não tem senha — o e-mail exato da conta.
- **Auth:** Bearer (access token). Exclusiva do dono da conta. Isenta do gate de assinatura. Limite de 3 chamadas por minuto.
- **Body:** `{ password?: string, email?: string }` — qual dos dois é exigido depende de `hasPassword` em `GET /auth/me`. Enviar o outro não substitui.
- **Resposta:** `200 { requestedAt: string, scheduledFor: string }`.
- **Erros:** `403 Senha incorreta.` / `403 O e-mail informado não confere com o da conta.` / `403 Esta ação é exclusiva do dono da conta.`, `409 O encerramento desta conta já está agendado. Cancele antes de pedir de novo.`, `429`, `401`.
- **Handler:** `modules/account/api/account.controller.ts` → `AccountController.solicitarEncerramento`

### DELETE /account/deletion
- **Propósito:** Cancelar o encerramento agendado, dentro da janela de carência. Depois do expurgo não há conta nem sessão, então esta rota só existe para a janela.
- **Auth:** Bearer (access token). Exclusiva do dono da conta. Isenta do gate de assinatura.
- **Body:** —
- **Resposta:** `200 { ok: true }`.
- **Erros:** `409 Esta conta não tem encerramento agendado.`, `403 Esta ação é exclusiva do dono da conta.`, `401`.
- **Handler:** `modules/account/api/account.controller.ts` → `AccountController.cancelarEncerramento`
```

E, em `GET /auth/me`, a resposta documentada ganha `hasPassword: boolean` e
`deletion: { requestedAt, scheduledFor } | null` (com a nota de que `deletion` é o agendamento da
**workspace**, visível também ao colaborador).

#### Testes

**Create**: `apps/api/src/modules/account/application/account-deletion.service.spec.ts`

- Conta com senha: senha certa agenda `hoje + 30`; senha errada lança `ForbiddenException` **e não
  grava nada** (afirma que o repositório não foi chamado).
- Conta sem senha: e-mail exato agenda; e-mail diferente (inclusive só por caixa/espaço → deve
  aceitar) comporta-se como esperado; e-mail errado lança `ForbiddenException`.
- Senha enviada numa conta sem senha **não** substitui o e-mail (e vice-versa).
- Segundo pedido com agendamento vigente → `ConflictException`.
- Cancelar sem agendamento → `ConflictException`.
- Trilha registrada com `ACCOUNT`/`ENCERRAR` e `ACCOUNT`/`CANCELAR`.
- Nenhuma chamada ao Stripe em nenhum caminho (o service não conhece billing).

**Modify**: `apps/api/src/modules/billing/application/stripe.service.spec.ts` — os dois métodos novos,
no padrão já usado no arquivo (instancia a classe de verdade, per `apps/api/CLAUDE.md`).

**Modify**: `apps/api/test/account.e2e-spec.ts` — cenários novos:

- `POST /account/deletion` com senha certa: `200`, e o `User` no banco tem os dois campos
  preenchidos, com `scheduledFor - requestedAt` ≈ 30 dias.
- Durante a janela, uma rota de negócio qualquer continua respondendo `200` (a carência **não**
  bloqueia).
- `GET /auth/me` do colaborador daquele owner traz `deletion` preenchido.
- `DELETE /account/deletion` zera os dois campos; `me` volta a `deletion: null`.
- Colaborador chamando `POST /account/deletion` → `403`, e nada muda no banco.

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api build` · `pnpm --filter api lint`
- [x] `pnpm --filter api test` — `account-deletion.service.spec.ts` e `stripe.service.spec.ts` verdes.
- [x] `pnpm --filter api test:e2e` — cenários de agendar/cancelar/`403`/`me` do colaborador verdes.
- [x] `DATABASE_URL=… apps/api/scripts/validar-migrations-com-dados.sh` — a migration aplica sobre a
      fixture **e** as três invariantes novas do par de colunas passam.
- [x] `pnpm --filter web build` · `pnpm --filter web lint`

#### Manual Verification
- [ ] Owner com senha: pedir o encerramento com a senha errada mostra "Senha incorreta." e **mantém a
      sessão** (não desloga).
- [ ] Com a senha certa: toast com a data, banner vermelho no topo de todas as telas, seção da aba
      "Conta" no estado agendado.
- [ ] O CRM continua utilizável durante a janela (abrir um cliente, criar uma tarefa).
- [ ] "Cancelar o encerramento" faz o banner desaparecer sem recarregar a página.
- [ ] Logado como colaborador: o banner aparece **sem** o botão de cancelar.
- [ ] Owner de OAuth (sem senha): o diálogo pede o e-mail da conta e nada mais.
- [ ] Com `SMTP_HOST` vazio, o pedido funciona igual e o log traz `email.smtp_desabilitado`.
- [ ] `/administracao/auditoria` mostra "Pediu o encerramento" e "Cancelou" em "Conta".

**⏸ PAUSE**: Pare para confirmação humana antes de seguir para a Fase 3.

---

## Phase 3: O expurgo

### Goal

Um cron diário cancela a assinatura no Stripe e apaga, na ordem topológica, tudo que pertence a um
owner cuja carência venceu — deixando exatamente uma linha de auditoria sem PII.

### Changes

#### O repositório do expurgo

**Create**: `apps/api/src/modules/account/domain/account-purge.repository.ts`

```ts
export const ACCOUNT_PURGE_REPOSITORY = 'ACCOUNT_PURGE_REPOSITORY';

/** Quantas linhas cada tabela perdeu — vira o `extra` da trilha do expurgo. */
export type LinhasApagadas = Record<string, number>;

export interface AccountPurgeRepository {
  /** Owners cuja carência venceu. Roda pelo client admin (cron, cross-owner). */
  vencidos(agora: Date): Promise<{ id: string; deletionRequestedAt: Date }[]>;
  /**
   * Owners que já pediram o encerramento e cuja assinatura ainda pode renovar —
   * a lista da varredura que marca `cancel_at_period_end` no Stripe.
   */
  pendentesDeCancelamento(): Promise<string[]>;
  /** Apaga a workspace inteira, numa transação com timeout próprio. */
  expurgar(ownerId: string): Promise<LinhasApagadas>;
}
```

**Create**: `apps/api/src/modules/account/infra/prisma-account-purge.repository.ts`

Este é o coração da fase.

```ts
/**
 * Expurgo da workspace. Único lugar do projeto que usa o `PrismaAdminService`
 * fora do `AccessGuard`/cadastro — e o uso previsto pelo docblock dele ("crons
 * cross-owner e seed"): roda sem `app.owner_id`, apaga `AuditLog` (que o
 * `crm_app` não pode apagar, por `REVOKE`) e vê `User`.
 *
 * **Exceção declarada à doutrina de `shared/purge.ts`.** Lá, filho pendurado é
 * `409` com instrução de expurgar de baixo para cima; é a regra certa para o
 * expurgo de UM registro pela lixeira. Encerrar conta não pode pedir que o
 * titular esvazie 12 tabelas à mão, então aqui a cascata é feita — explicitamente,
 * na ordem, por este método. A regra não foi relaxada: foi excetuada num único
 * ponto, para uma operação que o próprio titular pediu.
 */
@Injectable()
export class PrismaAccountPurgeRepository implements AccountPurgeRepository {
  constructor(private readonly admin: PrismaAdminService) {}

  async expurgar(ownerId: string): Promise<LinhasApagadas> {
    // Timeout explícito — a única `$transaction` do projeto com opções, e a razão
    // é literal: apagar 12 tabelas de uma workspace grande não cabe nos 5s
    // default que o `OwnerContextInterceptor` usa por request. Aqui não há
    // request esperando.
    return this.admin.$transaction(
      async (tx) => {
        const onde = { where: { ownerId } };
        const contagem: LinhasApagadas = {};
        const apagar = async (nome: string, fn: () => Promise<{ count: number }>) => {
          contagem[nome] = (await fn()).count;
        };

        // 1. Negócio, na ordem de `prisma/seed.ts:242-251` — a mesma que a
        //    limpeza idempotente do seed exercita a cada execução.
        await apagar('cobrancas', () => tx.payment.deleteMany(onde));
        await apagar('demandas', () => tx.task.deleteMany(onde));
        await apagar('atividades', () => tx.activity.deleteMany(onde));
        await apagar('itensDeProposta', () => tx.proposalItem.deleteMany(onde));
        await apagar('contratos', () => tx.contract.deleteMany(onde));
        await apagar('projetos', () => tx.project.deleteMany(onde));
        await apagar('propostas', () => tx.proposal.deleteMany(onde));
        await apagar('oportunidades', () => tx.deal.deleteMany(onde));
        await apagar('contatos', () => tx.contact.deleteMany(onde));
        await apagar('clientes', () => tx.client.deleteMany(onde));

        // 2. Configuração que PRENDE catálogo por RESTRICT.
        //    `LeadIntakeChannel.sourceId` é Restrict E o canal é alvo de cascata
        //    do mesmo `DELETE FROM "User"`; em Postgres RESTRICT é checado na
        //    hora (não é NO ACTION diferível), então esse par colidiria sozinho
        //    mesmo numa workspace sem nenhum dado de negócio. Apagar o canal
        //    aqui, explicitamente, é o que remove o problema.
        await apagar('canaisDeCaptacao', () => tx.leadIntakeChannel.deleteMany(onde));
        await apagar('chavesDeIntegracao', () => tx.integrationKey.deleteMany(onde));

        // 3. Catálogos — agora sem ninguém apontando.
        await apagar('tiposDeAtividade', () => tx.activityTypeCatalog.deleteMany(onde));
        await apagar('tiposDeServico', () => tx.serviceCatalog.deleteMany(onde));
        await apagar('motivosDePerda', () => tx.lostReasonCatalog.deleteMany(onde));
        await apagar('fontesDeLead', () => tx.leadSourceCatalog.deleteMany(onde));
        await apagar('estagiosDoFunil', () => tx.pipelineStage.deleteMany(onde));

        // 4. A trilha. Só `crm_user` alcança (a migration de AuditLog revoga
        //    DELETE de `crm_app`), e ela CARREGA dado pessoal de terceiro em
        //    `diff` — nome, e-mail e telefone de cliente podem entrar num diff de
        //    CLIENT. Retê-la depois de o controlador ter pedido a exclusão seria
        //    tratar fora das instruções (LGPD art. 42, § 1º, I). O registro do
        //    EVENTO é gravado depois do commit, sem PII (ver o job).
        await apagar('trilhaDeAuditoria', () => tx.auditLog.deleteMany(onde));

        // 5. A conta. Cascateia, num só statement: Session, OAuthAccount,
        //    PasswordResetToken, Subscription, Role, CollaboratorInvite,
        //    Notification (+ NotificationDelivery), UserNotificationTarget — e os
        //    `User` COLABORADORES, que cascateiam os próprios filhos.
        await tx.user.delete({ where: { id: ownerId } });
        contagem['conta'] = 1;

        return contagem;
      },
      { timeout: 120_000, maxWait: 15_000 },
    );
  }

  // …`vencidos` e `pendentesDeCancelamento` por `admin.user.findMany`…
}
```

#### O job

**Create**: `apps/api/src/modules/account/application/account-purge.job.ts`

```ts
/**
 * Duas varreduras diárias sobre `User`, ambas fora de qualquer request:
 *
 *  1. **Cancelamento pendente** — quem pediu o encerramento e ainda tem
 *     assinatura renovável recebe `cancel_at_period_end` no Stripe. Mora aqui, e
 *     não na rota, porque é I/O de rede e o handler autenticado roda dentro da
 *     `$transaction` do `OwnerContextInterceptor`.
 *  2. **Expurgo** — quem venceu a carência é apagado.
 *
 * O `AuditService.registrarPeloSistema` é o caminho certo: engole a própria
 * falha, porque uma trilha que falha não pode abortar o lote de N owners.
 */
@Injectable()
export class AccountPurgeJob {
  private readonly logger = new Logger(AccountPurgeJob.name);

  constructor(
    @Inject(ACCOUNT_PURGE_REPOSITORY)
    private readonly repo: AccountPurgeRepository,
    private readonly billing: BillingService,
    private readonly audit: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_5AM, { name: 'conta-expurgo' })
  async run(): Promise<void> {
    await this.marcarCancelamentos();
    await this.expurgarVencidos();
  }

  private async marcarCancelamentos(): Promise<void> {
    for (const ownerId of await this.repo.pendentesDeCancelamento()) {
      try {
        if (await this.billing.agendarCancelamentoPorEncerramento(ownerId)) {
          this.logger.log({
            evento: 'conta.assinatura_marcada_para_nao_renovar',
            msg: 'Assinatura marcada para não renovar por encerramento pedido.',
            ownerId,
          });
        }
      } catch (erro) {
        // Falha no Stripe não impede nada: a varredura de amanhã tenta de novo,
        // e o expurgo só prossegue com o cancelamento confirmado.
        this.logger.error(
          {
            evento: 'conta.cancelamento_de_assinatura_falhou',
            msg: 'Falha ao marcar a assinatura para não renovar.',
            ownerId,
          },
          erro instanceof Error ? erro.stack : undefined,
        );
      }
    }
  }

  private async expurgarVencidos(): Promise<void> {
    const vencidos = await this.repo.vencidos(new Date());
    for (const { id: ownerId, deletionRequestedAt } of vencidos) {
      const inicio = Date.now();
      try {
        // ANTES da transação, e é requisito: `onDelete: Cascade` apaga a linha
        // local `Subscription`, mas nada cancela o objeto remoto. Sem isto o
        // Stripe continuaria cobrando um cliente apagado, e todo evento futuro
        // daquele customer viraria webhook órfão (o `stripeCustomerId` some com o
        // `User`, e o repositório passa a devolver `null` em silêncio).
        //
        // Se falhar, este owner é PULADO — nunca apagado com assinatura viva.
        await this.billing.cancelarAgoraPorExpurgo(ownerId);
      } catch (erro) {
        this.logger.error(
          {
            evento: 'conta.expurgo_adiado',
            msg: 'Expurgo adiado: falha ao cancelar a assinatura no Stripe.',
            ownerId,
          },
          erro instanceof Error ? erro.stack : undefined,
        );
        continue;
      }

      const linhas = await this.repo.expurgar(ownerId);

      // DEPOIS do commit, de propósito: a transação acima apagou toda a trilha
      // deste owner, e esta linha é a única que sobrevive. Sem PII nenhuma — só
      // contagens e datas. É também o registro que o runbook de restore consulta
      // para reaplicar exclusões (ver docs/deploy.md).
      await this.audit.registrarPeloSistema({
        ownerId,
        actorType: 'CRON',
        actorName: 'Rotina diária',
        entity: 'ACCOUNT',
        entityId: ownerId,
        entityLabel: 'Conta encerrada',
        action: 'EXPURGAR',
        extra: {
          pedidoEm: deletionRequestedAt.toISOString(),
          linhasPorTabela: linhas,
        },
      });
      this.logger.warn({
        evento: 'conta.expurgada',
        msg: 'Conta e workspace apagadas em definitivo pela rotina diária.',
        ownerId,
        linhas: Object.values(linhas).reduce((a, b) => a + b, 0),
        ms: Date.now() - inicio,
      });
    }
  }
}
```

**Modify**: `apps/api/src/modules/account/account.module.ts` — importa `BillingModule`, registra
`AccountDeletionService`, `AccountPurgeJob`, `ACCOUNT_REPOSITORY` e `ACCOUNT_PURGE_REPOSITORY`.

#### Documentação de observabilidade

**Modify**: `docs/observabilidade.md` — os eventos novos no catálogo:
`conta.dados_exportados`, `conta.encerramento_solicitado`, `conta.encerramento_cancelado`,
`conta.assinatura_marcada_para_nao_renovar`, `conta.cancelamento_de_assinatura_falhou`,
`conta.expurgo_adiado`, `conta.expurgada`. Com uma nota: `conta.expurgada` sai em `warn` de propósito
— é irreversível, e um painel de `level="warn"` deve mostrá-la.

#### Testes

**Create**: `apps/api/src/modules/account/application/account-purge.job.spec.ts`

- Sem vencidos: não chama `expurgar` nem `registrarPeloSistema`.
- Com um vencido: chama `cancelarAgoraPorExpurgo` **antes** de `expurgar` (asserção de ordem) e
  `registrarPeloSistema` **depois**.
- Stripe lançando: `expurgar` **não** é chamado, o owner é pulado, o próximo da lista é processado.
- `extra.linhasPorTabela` reflete o retorno do repositório e não contém e-mail nem nome.

**Create**: `apps/api/test/account-purge.e2e-spec.ts`

Este é o e2e que a fase inteira depende. Segue o molde de `follow-up-cron.e2e-spec.ts` (cron acionado
à mão, com dado real no banco).

- Dois owners com workspace completa (clientes, contatos, deals, propostas + itens, projetos,
  tarefas, contratos, cobranças, atividades, catálogos, um canal de captação com chave, um
  colaborador, notificações e linhas de `AuditLog`).
- Owner A com `deletionScheduledFor` no passado. Aciona `AccountPurgeJob.run()`.
- **Afirma, pelo client admin:** zero linhas de A em cada uma das 12 tabelas de negócio, nos 5
  catálogos, em `LeadIntakeChannel`, `IntegrationKey`, `AuditLog` (exceto **exatamente uma**, a do
  expurgo), `Session`, `Subscription`, `Role`, `Notification`, `UserNotificationTarget` e `User`
  (inclusive o colaborador de A).
- **Afirma que o owner B está intacto** — contagem por tabela idêntica à de antes.
- A única linha de `AuditLog` de A tem `entity='ACCOUNT'`, `action='EXPURGAR'`, `actorType='CRON'` e
  o `diff` **não** contém `@` (nenhum e-mail) nem o nome do owner.
- Uma requisição com o access token de A responde `401` (o `AccessGuard` não acha o `User`).
- Owner com carência **não** vencida não é tocado.

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api build` · `pnpm --filter api lint`
- [x] `pnpm --filter api test` — `account-purge.job.spec.ts` verde, com a asserção de ordem
      Stripe → expurgo → trilha.
- [x] `pnpm --filter api test:e2e` — `account-purge.e2e-spec.ts` verde: workspace de A zerada, B
      intacto, uma linha de trilha sem PII, token de A respondendo `401`.
- [x] `pnpm --filter api test:e2e` — a suíte inteira continua verde (o `TRUNCATE ... CASCADE` do
      helper não conflita com a ordem nova).

#### Manual Verification
- [ ] Local, com o seed carregado: agendar o encerramento, adiantar `deletionScheduledFor` no banco
      para o passado, acionar o job e conferir no `psql` que só sobrou a linha de `AuditLog` do
      expurgo.
- [ ] Recarregar o navegador em seguida: a aplicação manda para o login.
- [ ] Com `BILLING_ENABLED=false`, o expurgo roda igual (o cancelamento é no-op).
- [ ] Log: `conta.expurgada` presente, em `warn`, com `linhas` e `ms`.

**⏸ PAUSE**: Pare para confirmação humana antes de seguir para a Fase 4.

---

## Phase 4: Registro de acesso com retenção de 6 meses

### Goal

Fechar o desvio #15: a Política promete 6 meses de registro de acesso (Marco Civil art. 15) e o
sistema guarda 30 dias de linha de log. Passa a existir uma tabela com retenção própria, preservada
através do encerramento da conta.

### Changes

#### Schema

**Modify**: `apps/api/prisma/schema.prisma`

```prisma
/// Natureza do acesso registrado. Só eventos BEM-SUCEDIDOS: art. 15 fala de
/// registro de *acesso*, e guardar o IP de uma tentativa frustrada seria dado
/// pessoal a mais sem obrigação que o exija.
enum AccessRecordKind {
  LOGIN
  LOGIN_OAUTH
  /// Aceite de convite de colaborador — o primeiro acesso daquela pessoa.
  ACEITE_DE_CONVITE
  LOGOUT
}

/// Registro de acesso à aplicação, na definição do Marco Civil (art. 5º, VIII):
/// data/hora de uso da aplicação a partir de um endereço IP. Guardado por
/// **6 meses**, por OBRIGAÇÃO legal (art. 15) — não é faculdade e não é
/// configurável.
///
/// Uma linha por evento de AUTENTICAÇÃO, não por requisição HTTP. A lei pede
/// data/hora + IP do uso, e uma linha por rota faria dezenas de milhares por dia
/// sem acrescentar nada ao que ela pede. O log `http.requisicao` (→ Loki, 30
/// dias) continua sendo a ferramenta de diagnóstico; esta tabela é a de
/// conformidade, e as duas respondem perguntas diferentes.
///
/// **Sobrevive ao encerramento da conta.** É o único dado que sobrevive, por
/// LGPD art. 16, I (cumprimento de obrigação legal), e a Política declara isso.
/// Por isso `userId` NÃO tem FK — apagar a conta não pode apagar o registro que a
/// lei manda guardar (mesma decisão de `AuditLog.actorId`).
///
/// FORA do RLS, no grupo de `User`/`Session`/`OAuthAccount`: a linha nasce no
/// login, que é rota `@Public()` e roda sem `app.owner_id` — uma policy aqui
/// fecharia a escrita (fail-closed grava zero linha e a rota responde sucesso).
///
/// Sem `ownerId`: quem responde a uma requisição judicial é o `userId`, e a
/// tabela nunca é exposta na interface. Uma denormalização que não serve a
/// nenhuma consulta é só mais um dado pessoal a guardar.
model AccessRecord {
  id        String           @id @default(uuid())
  /// Sem FK, de propósito (ver o docblock).
  userId    String
  kind      AccessRecordKind
  /// `req.ip`, já resolvido por trust proxy (ver main.ts) — o mesmo valor que o
  /// rate limit e a `Session` usam.
  ip        String?
  userAgent String?
  createdAt DateTime         @default(now())

  @@index([userId, createdAt])
  /// Serve à faxina por data de corte.
  @@index([createdAt])
}
```

**Create**: `apps/api/prisma/migrations/20260815100000_access_record/migration.sql`

CreateEnum + CreateTable + os dois índices. **Sem** `ENABLE ROW LEVEL SECURITY` — e com o comentário
explicando que a ausência é deliberada, para que a próxima leitura não a "conserte".

**Modify**: `apps/api/prisma/fixtures/invariantes.sql` — bloco novo:

```sql
-- ---------------------------------------------------------------------------
-- Registro de acesso (20260815100000_access_record)
-- ---------------------------------------------------------------------------
-- Invariante ao contrário das outras: aqui o que se afirma é a AUSÊNCIA de RLS.
-- A linha nasce no login, rota @Public() que roda sem `app.owner_id`; uma policy
-- nesta tabela não daria erro — ela gravaria zero linha e o login responderia
-- sucesso, e o CRM ficaria em descumprimento do Marco Civil em silêncio. Uma
-- migration futura que ligue RLS em bloco reprova aqui, que é o objetivo.
DO $$
DECLARE com_rls BOOL;
BEGIN
  SELECT c.relrowsecurity INTO com_rls
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'AccessRecord';
  IF com_rls IS NULL THEN
    RAISE EXCEPTION 'Tabela "AccessRecord" não existe — a migration de registro de acesso não aplicou.';
  END IF;
  IF com_rls THEN
    RAISE EXCEPTION 'Tabela "AccessRecord" está com RLS habilitado — o login roda sem app.owner_id e passaria a gravar zero linha em silêncio.';
  END IF;
END $$;
```

#### Gravação

**Create**: `apps/api/src/modules/auth/access-records.service.ts`

```ts
/**
 * Retenção do registro de acesso. **Seis meses é obrigação legal** (Marco Civil
 * art. 15), não escolha de produto: não torne isto configurável por env, e não
 * reduza. É o número que a Política de Privacidade publica.
 */
export const RETENCAO_REGISTRO_DE_ACESSO_DIAS = 180;

@Injectable()
export class AccessRecordsService {
  private readonly logger = new Logger(AccessRecordsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Grava o acesso. **Engole a própria falha:** um registro que não entrou é um
   * problema de conformidade a investigar no log, não uma razão para impedir
   * alguém de entrar no CRM. O `error` é o alarme.
   */
  async registrar(entrada: {
    userId: string;
    kind: AccessRecordKind;
    ip?: string;
    userAgent?: string;
  }): Promise<void> {
    try {
      await this.prisma.db.accessRecord.create({
        data: {
          userId: entrada.userId,
          kind: entrada.kind,
          ip: entrada.ip ?? null,
          userAgent: entrada.userAgent?.slice(0, 255) ?? null,
        },
      });
    } catch (erro) {
      this.logger.error(
        {
          evento: 'acesso.registro_falhou',
          msg: 'Falha ao gravar o registro de acesso (Marco Civil art. 15).',
          usuarioId: entrada.userId,
          tipo: entrada.kind,
        },
        erro instanceof Error ? erro.stack : undefined,
      );
    }
  }

  /** Faxina por data de corte. Devolve quantas linhas saíram. */
  async purgeBefore(cutoff: Date): Promise<number> {
    const { count } = await this.prisma.db.accessRecord.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return count;
  }
}
```

**Modify**: `apps/api/src/modules/auth/auth.service.ts`

`issueTokens` é o funil único de emissão de sessão (register, login, oauthLogin, issueSession) e já
recebe `device: DeviceInfo`, que carrega `ip` e `userAgent`. Ganha o `kind`:

```ts
  private async issueTokens(
    sub: string,
    device: DeviceInfo = {},
    kind: AccessRecordKind = 'LOGIN',
  ) {
    // …emissão dos tokens e criação da Session, igual…
    await this.sessions.create({ id: sid, userId: sub, tokenHash: …, device });
    // Registro de acesso (Marco Civil art. 15) — depois de a sessão existir, para
    // não registrar acesso de um login que falhou na última linha.
    await this.accessRecords.registrar({
      userId: sub,
      kind,
      ip: device.ip,
      userAgent: device.userAgent,
    });
    return { accessToken, refreshToken };
  }
```

Chamadas: `register()` e `login()` passam `'LOGIN'` (default); `oauthLogin()` passa `'LOGIN_OAUTH'`
nos três ramos; `issueSession()` passa `'ACEITE_DE_CONVITE'`. E `logout()` grava `'LOGOUT'` — para o
que precisa do `ip`/`userAgent`, o controller já os tem via `this.device(req, res)`; passe o
`DeviceInfo` ao `logout`.

> **Por que `refresh()` não grava.** É a mesma sessão continuando, não um acesso novo — registrar a
> cada renovação daria ~32 linhas/dia por pessoa ativa sem acrescentar nada ao que o art. 5º, VIII
> define. O uso continuado dentro da sessão está em `Session.lastUsedAt`/`Session.ip`.

**Modify**: `apps/api/src/modules/auth/auth.module.ts` — registra `AccessRecordsService` e
`AccessRecordsCleanupJob`.

**Create**: `apps/api/src/modules/auth/access-records-cleanup.job.ts`

Molde exato de `sessions-cleanup.job.ts`, em horário próprio (3h já é da faxina de sessões):

```ts
@Injectable()
export class AccessRecordsCleanupJob {
  private readonly logger = new Logger(AccessRecordsCleanupJob.name);

  constructor(private readonly registros: AccessRecordsService) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM, { name: 'acessos-faxina' })
  async run(): Promise<void> {
    const cutoff = new Date(
      Date.now() - RETENCAO_REGISTRO_DE_ACESSO_DIAS * 24 * 60 * 60 * 1000,
    );
    const quantidade = await this.registros.purgeBefore(cutoff);
    if (quantidade > 0) {
      this.logger.log({
        evento: 'acessos.expurgados',
        msg: 'Registros de acesso além da retenção legal removidos pela rotina diária.',
        quantidade,
        retencaoDias: RETENCAO_REGISTRO_DE_ACESSO_DIAS,
      });
    }
  }
}
```

**Modify**: `docs/observabilidade.md` — na seção que declara "a linha vive 30 dias", uma nota nova:
o registro de acesso do Marco Civil **não** é o log do Loki. Explica a divisão (conformidade × 
diagnóstico), o prazo de cada um e por que a tabela existe.

#### Testes

**Create**: `apps/api/src/modules/auth/access-records.service.spec.ts` — grava com truncagem do
`userAgent` em 255; falha do banco é engolida e logada em `error` (não propaga); `purgeBefore` usa
`lt` na data de corte.

**Modify**: `apps/api/test/auth.e2e-spec.ts` — cenários novos:

- `POST /auth/login` bem-sucedido grava **uma** linha em `AccessRecord`, com `kind='LOGIN'` e o `ip`
  preenchido.
- Login com senha errada grava **zero** linhas.
- `POST /auth/refresh` grava zero linhas (afirma a decisão de não registrar renovação).
- `POST /auth/logout` grava uma linha `kind='LOGOUT'`.

**Modify**: `apps/api/test/account-purge.e2e-spec.ts` — a afirmação que amarra as duas fases: depois
do expurgo, as linhas de `AccessRecord` do owner A **continuam no banco**, e são as únicas linhas
dele que sobrevivem além da trilha do expurgo.

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api build` · `pnpm --filter api lint`
- [x] `pnpm --filter api test` — `access-records.service.spec.ts` verde.
- [x] `pnpm --filter api test:e2e` — `auth.e2e-spec.ts` com os 4 cenários novos verde, e
      `account-purge.e2e-spec.ts` afirmando a sobrevivência do registro de acesso.
- [x] `DATABASE_URL=… apps/api/scripts/validar-migrations-com-dados.sh` — a migration aplica e a
      invariante de **ausência** de RLS em `AccessRecord` passa.

#### Manual Verification
- [ ] Entrar e sair no navegador; no `psql`, `SELECT kind, ip, "createdAt" FROM "AccessRecord"`
      mostra o par LOGIN/LOGOUT com o IP.
- [ ] Entrar com Google: a linha sai com `kind='LOGIN_OAUTH'`.
- [ ] Inserir uma linha com `createdAt` de 200 dias atrás, acionar o job e conferir que ela some e a
      recente fica.

**⏸ PAUSE**: Pare para confirmação humana antes de seguir para a Fase 5.

---

## Phase 5: Backup com rotação e ledger de expurgos

### Goal

Fechar o desvio #16: a Política afirma que "os backups em rotação também expiram" e não existe
rotação. Passa a existir, por script, com retenção declarada — e com o ledger que faz um restore não
ressuscitar uma conta encerrada.

### Changes

**Create**: `scripts/backup-postgres.sh`

```bash
#!/usr/bin/env bash
# Backup do Postgres do CRM, com rotação e expiração.
#
# Existe porque a Política de Privacidade afirma que "os backups em rotação também
# expiram" — e uma afirmação dessas precisa de um cronograma real por trás. É a
# doutrina "beyond use" do ICO: quando não se pode sobrescrever de imediato, o que
# se exige é não reutilizar o dado para outra finalidade e deixá-lo expirar por
# cronograma estabelecido. Este arquivo É o cronograma.
#
# Uso (na VPS, pelo cron do host — ver docs/deploy.md):
#   BACKUP_DIR=/var/backups/crm scripts/backup-postgres.sh
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-$(pwd)}"
BACKUP_DIR="${BACKUP_DIR:?defina BACKUP_DIR}"
RETENCAO_DIAS="${RETENCAO_DIAS:-30}"
COMPOSE="docker compose -f ${DEPLOY_DIR}/docker-compose.prod.yml"

mkdir -p "$BACKUP_DIR"
ARQUIVO="${BACKUP_DIR}/crm-$(date +%F-%H%M).dump"

$COMPOSE exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom > "$ARQUIVO"

# Portão antes de rotacionar: dump vazio ou truncado significa que o pg_dump
# falhou de um jeito que o `set -e` não pegou (pipe). Apagar os backups antigos
# nessa situação é como perder o backup duas vezes.
if [ ! -s "$ARQUIVO" ] || [ "$(stat -c%s "$ARQUIVO")" -lt 1024 ]; then
  echo "backup vazio ou truncado: $ARQUIVO — rotação abortada" >&2
  exit 1
fi

# Ledger de encerramentos, fora do dump e append-only. É o que permite reaplicar
# uma exclusão depois de restaurar um backup ANTERIOR ao pedido — o caso que o
# tombstone dentro do banco (as colunas de encerramento em `User`, que voltam com
# o restore e fazem o cron expurgar de novo) não cobre. Só ownerId e data: nenhum
# dado pessoal.
LEDGER="${BACKUP_DIR}/encerramentos.csv"
$COMPOSE exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F',' -c \
  "SELECT \"entityId\", \"createdAt\" FROM \"AuditLog\"
    WHERE entity = 'ACCOUNT' AND action = 'EXPURGAR'" \
  >> "$LEDGER"
sort -u -o "$LEDGER" "$LEDGER"

# Expiração. `-mtime +N` é o que dá sentido à frase da Política.
find "$BACKUP_DIR" -name 'crm-*.dump' -type f -mtime "+${RETENCAO_DIAS}" -delete

echo "backup ok: $ARQUIVO (retenção ${RETENCAO_DIAS} dias)"
```

**Modify**: `docs/deploy.md` — a seção "Backup do banco" é reescrita:

- O comando manual continua documentado, agora como "dump pontual".
- Rotina: a linha de cron do host (`0 2 * * * BACKUP_DIR=/var/backups/crm … scripts/backup-postgres.sh`),
  o valor de `RETENCAO_DIAS` (30) e a nota de que **esse número é o que a Política de Privacidade
  publica** — mudá-lo exige mudar a página.
- Seção nova **"Restauração e contas encerradas"**, com o passo obrigatório:

  > Restaurar um backup pode ressuscitar dados de uma conta já encerrada. Duas coisas cobrem isso, e
  > as duas precisam ser conferidas:
  >
  > 1. **Automático.** Um `User` restaurado com `deletionScheduledFor` no passado é expurgado pelo
  >    `AccountPurgeJob` na varredura seguinte (até 24h). Vale para todo backup tirado **depois** do
  >    pedido de encerramento — o caso comum.
  > 2. **Manual, obrigatório.** Para backup tirado **antes** do pedido, o agendamento não existe no
  >    dump. Confira `encerramentos.csv` no diretório de backup: cada `ownerId` listado com data
  >    posterior à do dump restaurado precisa ser reagendado à mão
  >    (`UPDATE "User" SET "deletionRequestedAt" = now(), "deletionScheduledFor" = now() - interval '1 day' WHERE id = '<ownerId>'`),
  >    e o job cuida do resto na próxima varredura.
  >
  > Sem este passo, a promessa de exclusão quebra no primeiro disaster recovery.

**Modify**: `README.md` — na seção de operação, uma linha apontando o script e a doc.

### Success Criteria

#### Automated Verification
- [x] `bash -n scripts/backup-postgres.sh` — sintaxe.
- [x] `shellcheck scripts/backup-postgres.sh` — sem aviso de severidade `error` ou `warning`
      (rodado via `docker run koalaman/shellcheck:stable`, já que o binário não está
      instalado localmente; sem achados).
- [x] `chmod +x scripts/backup-postgres.sh` aplicado.

#### Manual Verification
- [x] Local, com `docker compose up -d`: gera um `.dump` restaurável (confirmado com
      `pg_restore --list`, 329 TOC entries).
- [x] Rodar duas vezes com uma linha `EXPURGAR` de teste: `encerramentos.csv` não duplica linhas.
- [x] Simular falha (`POSTGRES_DB` inexistente): o script sai com código ≠ 0 e **não** apaga nenhum
      `.dump` anterior.
- [x] `touch -d '40 days ago'` num dump antigo: a execução seguinte o remove.

> Nota: os testes manuais rodaram com o `docker-compose.yml` de desenvolvimento
> (o `docker-compose.prod.yml` real exige as variáveis de produção — domínio,
> Traefik, imagens do Docker Hub — que não existem neste ambiente local). A
> lógica do script (dump, portão de vazio/truncado, ledger idempotente,
> expiração por `mtime`) é a mesma testada; o `-f docker-compose.prod.yml` em si
> é só o nome do arquivo passado ao `docker compose`, sem lógica própria.

**⏸ PAUSE**: Pare para confirmação humana antes de seguir para a Fase 6.

---

## Phase 6: O contrato publicado

### Goal

Política de Privacidade e Termos de Uso passam a descrever o que o sistema faz — hoje prometem
encerramento por e-mail, uma aritmética de prazos que não fecha e uma rotação de backup que não
existia.

### Changes

**Modify**: `apps/web/src/features/legal/PrivacidadePage.tsx`

Seção `retencao` — o item de encerramento vira dois, com as duas janelas declaradas separadamente:

```tsx
          <Item>
            <Forte>Ao pedir o encerramento da conta:</Forte> o pedido fica{' '}
            <Forte>30 dias</Forte> em carência, cancelável a qualquer momento por
            você na própria interface. Nesse período o CRM continua funcionando
            normalmente e nada é apagado.
          </Item>
          <Item>
            <Forte>Passada a carência:</Forte> a conta e todo o conteúdo do CRM
            são apagados em definitivo, junto com a trilha de auditoria e o
            histórico de notificações — ressalvado o que a lei obriga a manter
            (abaixo). A recuperação deixa de ser possível.
          </Item>
          <Item>
            <Forte>Backups:</Forte> mantemos backups do banco com rotação de{' '}
            <Forte>30 dias</Forte>. Um dado apagado pode continuar existindo num
            backup ainda não expirado por até esse prazo; ele não é usado para
            nenhuma outra finalidade, e a exclusão é reaplicada se um backup
            precisar ser restaurado.
          </Item>
          <Item>
            <Forte>Registros de acesso:</Forte> 6 meses, por determinação do Marco
            Civil da Internet (art. 15). São mantidos{' '}
            <Forte>mesmo após o encerramento da conta</Forte> — é obrigação legal,
            e a LGPD (art. 16, I) autoriza expressamente essa conservação. Guardam
            data, hora e endereço IP dos seus acessos, e nada do conteúdo do CRM.
          </Item>
```

Seção `direitos` — o parágrafo "Boa parte disso você resolve sozinho" passa a apontar o
autoatendimento real:

```tsx
        <P>
          Boa parte disso você resolve sozinho, sem precisar escrever para
          ninguém. Em <Interno to="/configuracoes/conta">Configurações → Conta</Interno>{' '}
          você <Forte>baixa todos os seus dados</Forte> num arquivo único, em
          formato legível por máquina (portabilidade), e{' '}
          <Forte>encerra a conta</Forte> em definitivo. Dados de perfil são
          editáveis, registros do CRM podem ser alterados ou excluídos e a
          assinatura é gerenciável na tela de assinatura.
        </P>
```

Seção `dados-coletados` — o item de registros de acesso ganha a menção de que são persistidos (hoje
diz apenas que a guarda "é determinada pelo Marco Civil", sem dizer onde ficam).

**Modify**: `apps/web/src/features/legal/TermosPage.tsx`

Seção `encerramento` — o primeiro parágrafo, que hoje manda escrever um e-mail:

```tsx
        <P>
          Você pode encerrar sua conta a qualquer momento, em{' '}
          <Interno to="/configuracoes/conta">Configurações → Conta</Interno>. O
          pedido exige confirmação de identidade e fica{' '}
          <Forte>30 dias em carência</Forte>, período em que o serviço continua
          funcionando e você pode desistir com um clique. Passado o prazo, a conta
          e todos os dados são apagados em definitivo, a assinatura é cancelada e
          a recuperação deixa de ser possível — os detalhes de prazo estão na{' '}
          <Interno to="/privacidade">Política de Privacidade</Interno>.
        </P>
```

Seção `cancelamento`, `Destaque` — o "exporte o que precisa" ganha o caminho:

```tsx
          <p>
            Antes de encerrar a conta em definitivo, exporte o que precisa: em{' '}
            <Interno to="/configuracoes/conta">Configurações → Conta</Interno> você
            baixa todos os seus dados num arquivo único. Após o encerramento os
            dados são excluídos nos prazos descritos na{' '}
            <Interno to="/privacidade">Política de Privacidade</Interno> e a
            recuperação deixa de ser possível.
          </p>
```

**Modify**: `apps/web/src/features/legal/company.ts` (ou onde a data de vigência mora) — sobe a data
de vigência dos dois documentos. Mudança de prazo de guarda é "mudança relevante" pelo próprio texto
da Política, que promete aviso com 15 dias de antecedência — anote isso no PR para que o aviso saia.

**Modify**: `ROADMAP.md` — marca as duas caixas da Frente A como concluídas e ajusta o parágrafo
"Por que sobe de P3 para o 1º lugar" para o passado, registrando que a fase também fechou os dois
desvios de conformidade encontrados no caminho (registro de acesso e rotação de backup).

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter web build` · `pnpm --filter web lint`
- [x] `grep -rn "solicitando por" apps/web/src/features/legal/` — nenhum resultado (a instrução de
      encerrar por e-mail não sobrou em nenhum lugar).

#### Manual Verification
- [ ] `/privacidade`: a seção de retenção lê as quatro janelas sem se contradizer, e os links internos
      para `/configuracoes/conta` funcionam.
- [ ] `/termos`: a seção de encerramento aponta a interface, não o e-mail.
- [ ] Data de vigência atualizada nos dois documentos.
- [ ] Ler as duas páginas de ponta a ponta procurando qualquer outra afirmação que o sistema não
      cumpra — é a última chance antes de a fase fechar.

**⏸ PAUSE**: Confirmação final.

---

## Testing Strategy

### Unit Tests

- `account-export.service.spec.ts` — manifest correto; **nenhum segredo na string serializada**
  (`passwordHash`, `keyHash`, `tokenHash`, ids da Stripe, `$argon2`); trilha registrada.
- `account-deletion.service.spec.ts` — os dois caminhos de reautenticação, incluindo o cruzado (senha
  numa conta OAuth e e-mail numa conta com senha não substituem um ao outro); recusa não grava;
  duplo pedido e cancelamento inexistente respondem `409`.
- `account-purge.job.spec.ts` — ordem Stripe → expurgo → trilha; falha do Stripe pula o owner sem
  apagar nada; `extra` sem PII.
- `access-records.service.spec.ts` — truncagem do `userAgent`; falha engolida e logada; corte por `lt`.
- `stripe.service.spec.ts` — os dois métodos novos, com a classe instanciada de verdade
  (`apps/api/CLAUDE.md`: adapter de infraestrutura não se testa por mock).

### Integration Tests

- `account.e2e-spec.ts` — o dump de um owner não contém nenhuma linha do outro (é a afirmação de
  isolamento que o RLS deveria garantir e que só um e2e prova); `403` para colaborador; `200` com
  assinatura cancelada; agendar/cancelar refletidos no banco e em `GET /auth/me`, inclusive no `me`
  do colaborador.
- `account-purge.e2e-spec.ts` — o cenário completo das 12 tabelas + catálogos + trilha + `User`,
  com o owner vizinho intacto, uma única linha de auditoria sem PII, `AccessRecord` preservado e o
  access token respondendo `401` depois.
- `auth.e2e-spec.ts` — `AccessRecord` gravado no login e no logout, ausente no login falho e no
  refresh.
- `validar-migrations-com-dados.sh` — as três migrations aplicam sobre a fixture de dois owners, e as
  invariantes novas (par de colunas de encerramento; ausência de RLS em `AccessRecord`) passam.

### Migration & Rollback

- **Ordem de deploy:** as três migrations são aditivas (dois valores de enum, duas colunas nulas com
  índice, uma tabela nova). Nenhuma reescreve dado. Podem ir num deploy só.
- **Compatibilidade para trás:** a API antiga tolera as colunas novas (ignora), então um rollback de
  imagem sem rollback de migration é seguro — o cron de expurgo simplesmente não roda, e nenhuma
  conta é apagada por engano. É o modo de falha desejado.
- **Rollback do dado:** não existe. Depois do expurgo não há o que reverter — é o ponto da operação.
  A reversão possível é *durante a carência*, e é a rota `DELETE /account/deletion`.
- **Interruptor de emergência:** se o cron precisar ser parado em produção sem deploy, o caminho é
  `UPDATE "User" SET "deletionScheduledFor" = now() + interval '30 days' WHERE "deletionScheduledFor" IS NOT NULL`
  — empurra todos os agendamentos para a frente sem perder o pedido. Documente isso em
  `docs/deploy.md`, junto do runbook de restore.
- **`prisma/fixtures/banco-populado.sql` não muda:** a fixture só usa colunas do `init`, e as três
  migrations desta fase são posteriores.

## Environment Considerations

- **CI/CD:** nenhum passo novo. O portão `validar-migrations-com-dados.sh` já roda a cada push que
  toca a API e passa a exercitar as invariantes novas. Se `shellcheck` for adicionado ao CI algum dia,
  `scripts/backup-postgres.sh` entra no escopo.
- **Migrations:** três, todas aditivas (ver acima).
- **Config/Secrets:** **nenhuma variável nova na aplicação.** A carência (30 dias) e a retenção do
  registro de acesso (180 dias) são constantes exportadas no código, de propósito: a primeira está
  publicada na Política e a segunda é obrigação legal — nem uma nem outra é decisão de instância. O
  script de backup usa `BACKUP_DIR`, `RETENCAO_DIAS` e `DEPLOY_DIR`, que são de ambiente de host,
  não da aplicação.
- **Multi-ambiente:** com `BILLING_ENABLED=false` (autohospedagem) todo o caminho de Stripe é no-op e
  o expurgo funciona igual. Sem `SMTP_HOST`, o pedido de encerramento funciona igual e o aviso só sai
  na interface — que é o caminho que sempre existe.
- **Crons:** três rotinas diárias, em horários distintos para não competir por conexão:
  3h sessões (existente), 4h registros de acesso (nova), 5h expurgo de conta (nova).

## Dependencies & Risks

- **O dump roda dentro da transação de 5s.** É o risco assumido pela decisão de não construir geração
  assíncrona. A mitigação é medir: `conta.dados_exportados` traz `bytes` e `ms`. Se aparecer
  `P2028`/timeout em produção, o caminho é a geração pelo cron (que a Fase 3 já deixa de pé, com job
  e admin client prontos) — não é retrabalho, é continuação.
- **O expurgo apaga `Payment` pago.** [SPEC.md:188](../SPEC.md#L188) diz que cobrança paga não pode
  ser excluída, apenas estornada. A regra vale para a operação do dia a dia; encerrar a conta
  necessariamente apaga tudo, e é instrução do controlador que o operador deve executar. **Escreva
  essa exceção no comentário do repositório de expurgo**, senão a próxima leitura do SPEC a trata como
  violação. O que a lei manda guardar do lado fiscal é a nossa nota contra o owner, que vive na
  Stripe e na contabilidade, não a cobrança que ele emitiu contra o cliente dele.
- **Janela de até 24h entre o pedido e o `cancel_at_period_end` no Stripe.** Consequência de mover o
  I/O para o cron (ver o desvio declarado na Fase 2). Quem renova nesse intervalo é atendido pelo
  suporte. Monitorar `conta.cancelamento_de_assinatura_falhou`: um erro recorrente ali significa
  contas que vão vencer a carência sem poder ser expurgadas.
- **`AuditEntity.ACCOUNT` e as duas ações novas mudam contagens no Grafana.** São valores novos, não
  renomeados, então nada histórico quebra — mas painéis que enumeram entidades à mão precisam do valor
  novo.
- **A Política passa a prometer 30 + 30 dias.** É mais do que os "30 dias" de hoje. O próprio texto da
  Política classifica prazo de guarda maior como mudança relevante, com aviso de 15 dias — o PR que
  fecha a Fase 6 precisa disparar esse aviso, e isso é trabalho fora do código.
- **`ConfirmTypedDialog` é um primitivo novo do design system.** O risco é de uso: a NN/g avisa que a
  confirmação por digitação perde força se aplicada com frequência. Use-o **só** no encerramento de
  conta; qualquer outra exclusão continua no `ConfirmDialog`.
- **Ordem de FK verificada, mas só provada pelo e2e.** A sequência de `deleteMany` reproduz a do
  `seed.ts`, que roda a cada seed — mas o seed não apaga catálogos, canais nem `User`. A parte nova é
  exatamente onde o PRD encontrou a colisão `LeadIntakeChannel.sourceId`. O
  `account-purge.e2e-spec.ts` com workspace completa é o que fecha esse risco; não o dispense.

## References

- PRD: [`specs/research/2026-07-28-fase-19a-lgpd-minimo.md`](../research/2026-07-28-fase-19a-lgpd-minimo.md)
- Specs relacionadas:
  [`2026-07-26-fase-8b-auditoria.md`](2026-07-26-fase-8b-auditoria.md) (o `REVOKE` e o que a trilha
  guarda) · [`2026-07-26-fase-8c-lixeira.md`](2026-07-26-fase-8c-lixeira.md) (a doutrina "nenhuma
  cascata" que esta fase exceta) ·
  [`2026-07-27-fase-14a-importacao-e-exportacao.md`](2026-07-27-fase-14a-importacao-e-exportacao.md)
  (`ExportService`, e por que a exportação não é genérica) ·
  [`2026-07-25-colaboradores-e-papeis.md`](2026-07-25-colaboradores-e-papeis.md) (owner imexível, sem
  transferência de titularidade)
- LGPD: [Lei 13.709/2018](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm) —
  art. 16, I (conservação por obrigação legal), art. 18 (direitos), art. 19 § 3º (cópia em formato que
  permita utilização subsequente), art. 42 § 1º I (operador equiparado ao controlador)
- [Marco Civil da Internet](https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2014/lei/l12965.htm) —
  art. 5º, VIII (definição de registro de acesso) e art. 15 (guarda de 6 meses)
- [Res. CD/ANPD nº 2/2022](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-2-de-27-de-janeiro-de-2022) —
  prazo em dobro para agente de pequeno porte
- [ICO — Right to erasure](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-erasure/) —
  doutrina "beyond use" para backups
- [WP29 — Guidelines on the right to data portability](https://www.bvdnet.de/wp-content/uploads/2022/03/Guidelines-on-the-right-to-data-portability.pdf) —
  formatos abertos + metadados
- [OWASP ASVS V3](https://github.com/OWASP/ASVS/blob/master/4.0/en/0x11-V3-Session-management.md) —
  3.7.1, reautenticação em transação sensível ·
  [NN/g — Confirmation dialogs](https://www.nngroup.com/articles/confirmation-dialog/)
