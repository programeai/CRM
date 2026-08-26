---
date: 2026-08-05T23:42:48-03:00
author: claude
source_prd: specs/research/2026-08-05-atribuicao-de-anuncio-na-captacao.md
git_commit: 6aa49438266e2e50d044ae8b56e37cd3204a57c7
branch: main
status: implemented
tags: [spec, leads, clients, prisma, account-export, lgpd, meta-ads, google-ads]
---

# Spec: Captura de atribuição de anúncio na ingestão de lead

## Overview

`POST /leads/intake` passa a aceitar nove campos novos e opcionais de atribuição de anúncio, e o `Client` ganha dez colunas nullable para guardá-los. Só isso: captura e persistência. Não há envio de conversão, não há gatilho de "ganhou", não há evento novo de webhook.

A razão de fazer isso agora, e não junto do envio, é um único dado irrecuperável: o `fbc` da Conversions API tem o formato `fb.1.<ms>.<fbclid>`, e o `<ms>` é *"o instante em que você primeiro observou este `fbclid`"*. Esse instante não se reconstrói depois. Todo lead que entra sem ele entra sem chance de atribuição para sempre, qualquer que seja a decisão futura sobre envio.

**O enquadramento do pedido original não se sustenta, e o spec não finge que sustenta.** A pesquisa (PRD, seção *External Research*) mediu três limites da Meta: `event_time` acima de 7 dias reprova o request **inteiro**; a janela máxima de atribuição a clique no Ads Manager é 7 dias; Conversion Leads exige conversão em ≤28 dias da geração do lead. "Fechou meses depois" não tem caminho documentado de atribuição na Meta — os 90 dias que circulam são a expiração recomendada do *cookie* `_fbc`, não janela de atribuição. Por decisão tomada no planejamento, a captura acontece de todo modo (o dado é irrecuperável e serve a relatório interno do owner, ao Google Ads — que aceita conversão offline até 90 dias pelo `gclid` — e a envio precoce de estágio intermediário do funil), mas **a documentação do CRM não promete atribuição na Meta a partir de um fechamento tardio**. A Fase 5 deste spec escreve isso explicitamente na página de ajuda.

## Current State

`model Client` (`apps/api/prisma/schema.prisma:292-335`) tem 20 colunas e nenhuma de campanha ou click id. `IntakeLeadDto` (`apps/api/src/modules/leads/api/dto/intake-lead.dto.ts:31-111`) tem 13 campos, e como o `ValidationPipe` global roda com `forbidNonWhitelisted`, um `utm_source` enviado hoje responde **400** — o lead é perdido, não ignorado. O mais próximo de atribuição que existe é semântico: `origem` vira `Client.tags[0]` e `pagina` sobrevive como linha de texto dentro de `Client.notes`. `qualificacao` é aceito e descartado.

Detalhe completo no PRD.

## Desired End State

- `Client` tem dez colunas nullable: `fbclid`, `fbclidAt`, `fbp`, `gclid`, `utmSource`, `utmMedium`, `utmCampaign`, `utmContent`, `utmTerm`, `landingUrl`. Nenhum índice.
- `IntakeLeadDto` tem 22 campos. Os nove novos são opcionais, aceitam `null`, e nenhum campo existente mudou de nome, tipo ou obrigatoriedade.
- A ingestão grava atribuição por uma fronteira pública nova, `ClientsService.registrarAtribuicao`, que **só preenche coluna vazia** — nos dois caminhos (cadastro novo e lead reincidente) — e não escreve nada quando não há lacuna.
- Enquanto o `site-v2` não enviar nada, a ingestão faz **zero** escritas a mais por lead: `temAtribuicao` é o portão.
- Os campos são **somente leitura**: não estão em `CreateClientDto`, `UpdateClientDto`, `PublicCreateClientDto`, nos catálogos de import nem no `ClientFormDialog`. A única porta de escrita é a ingestão.
- O arquivo de portabilidade carrega as dez colunas e `VERSAO_DO_DUMP` é `3`.
- A aba de dados do cliente mostra uma seção "Atribuição de anúncio", que não aparece quando não há nada.
- `ENDPOINTS.md`, `CaptacaoDocPage` e a Política de Privacidade estão coerentes com o que o código faz.
- Um `fbclid` nunca existe sem o `fbclidAt` do par — afirmado por invariante no banco.

## What We're NOT Doing

- **Envio de conversão** a Meta, Google ou qualquer plataforma. Fora do escopo declarado. Não há cliente HTTP novo, não há job, não há credencial de plataforma.
- **Gatilho de "oportunidade ganha"**. O motor de regras é a Fase 16 (`ROADMAP.md:272-283`), e `owner-webhooks-emitter.service.ts:37-39` registra que o event bus foi deliberadamente evitado por isso.
- **Evento novo de webhook** (`negociacao.ganha` ou similar). O catálogo é contrato público "só acrescente", e acrescentar sem consumidor é dívida.
- **Registro de consentimento na ingestão.** Nada sai para terceiro nesta fase, então não há `compartilhamento_terceiro` a consentir; e quem registra consentimento é quem exibe o formulário — o `site-v2`, em outro repositório. A dívida é registrada explicitamente (Fase 5), com a condição de bloqueio: **a fase de envio não pode começar sem porta de consentimento na ingestão.** Nenhuma quinta finalidade entra no catálogo: `compartilhamento_terceiro` já cobre o envio, e finalidade sem porta que a registre só encheria a tela de opção morta.
- **`metaLeadId` / `lead_id` do Lead Ads.** Ele só existe em lead de Instant Form, que não entra por esta rota (landing page própria não tem `leadgen_id`). Coluna aditiva no dia em que houver ingestão de Lead Ads.
- **`client_ip_address` e `client_user_agent`**, que a CAPI valoriza. A Fase 19-A decidiu não registrar IP além do evento de autenticação, e reabrir isso é decisão de privacidade, não de captação.
- **Índice nas colunas novas.** Nesta fase nada FILTRA por atribuição — o relatório por campanha é fase futura. Índice sem consulta é escrita mais lenta em toda ingestão em troca de nada.
- **Colunas de atribuição no CSV/XLSX de clientes.** Decisão deliberada, documentada no próprio arquivo (Fase 3): seriam dez colunas permanentemente vazias na planilha de todo owner que não roda anúncio. A portabilidade (o dump) carrega tudo, porque ali é obrigação legal e o formato já é largo.
- **Último toque.** Guarda-se o primeiro (mais o preenchimento de lacuna). Um segundo conjunto `lastX` é aditivo e é decisão da fase de envio, que é quem tem o requisito.
- **Renomear qualquer campo do DTO.** Os nomes são contrato com o `site-v2`; acrescentar é seguro, renomear quebra a captação em produção sem quebrar nenhum teste (17-A).
- **Mudar `apps/api/prisma/fixtures/banco-populado.sql`.** A fixture usa só colunas do `init`.

## Convenções que valem para todas as fases

**Nenhuma fase é fronteira de PR.** O docblock de `CaptacaoDocPage.tsx:16-24` e o Definition of Done de `apps/api/CLAUDE.md` obrigam a doc no mesmo PR do DTO. As cinco fases entram juntas; os `⏸ PAUSE` são checkpoints de verificação, não pontos de merge.

**Nomes dos campos.** O DTO usa o nome canônico da plataforma onde existe um (`fbclid`, `fbp`, `gclid`, `utmSource`…) porque são identificadores de terceiro, não vocabulário de domínio — `idDeCliqueFacebook` quebraria o reconhecimento de quem integra. `urlDeEntrada` é pt-BR porque não é nome de plataforma, e o pt-BR o distingue de `pagina` (que é caminho, não URL). As **colunas** seguem o inglês do resto de `Client` (`landingUrl`, como `zipCode`/`tradeName`), e o mapeamento DTO→coluna mora num lugar só.

**Nada de log.** `CHAVE_SENSIVEL` (`apps/api/src/shared/logging/log.ts:28-29`) não cobre `fbclid`, `fbp`, `utm` nem `url`, `msg` nunca é redigida, e a linha vive 30 dias num Grafana publicado na internet. **Nenhum valor de atribuição entra em nenhum log**, nem como campo de contexto. O log existente de `lead.ingerido` não muda.

---

## Phase 1: Schema, migration e invariante

### Goal

`Client` tem as dez colunas nullable no banco e no Prisma Client, e o banco afirma que `fbclid` e `fbclidAt` só existem em par.

### Changes

#### Prisma

**Modify**: `apps/api/prisma/schema.prisma`

Bloco novo em `model Client`, entre o fim do endereço (`state String? // UF`, linha 314) e o comentário `// --- soft delete ---` (linha 315). `model Client` é do `init` e não tem comentários `///` hoje; o bloco segue o estilo `//` das outras seções do próprio modelo.

```prisma
  district   String?
  city       String?
  state      String? // UF
  // --- atribuição de anúncio (capturada na ingestão de lead; nunca editável) ---
  // A única porta de escrita é `POST /leads/intake`, por
  // `ClientsService.registrarAtribuicao`, que só preenche o que está vazio:
  // estes campos contam de qual clique a pessoa veio na PRIMEIRA vez.
  //
  // `fbclid` é case-sensitive e NÃO pode ser normalizado (doc da Meta: "do not
  // apply any modifications before using"). `fbclidAt` é o instante em que o
  // CRM primeiro o observou — sem ele o `fbc` (`fb.1.<ms>.<fbclid>`) não se
  // monta, e é o dado irrecuperável desta fase; os dois nascem juntos ou nenhum
  // nasce (invariante em `fixtures/invariantes.sql`).
  //
  // Sem índice de propósito: nesta fase ninguém filtra por atribuição.
  fbclid      String?
  fbclidAt    DateTime?
  fbp         String?
  gclid       String?
  utmSource   String?
  utmMedium   String?
  utmCampaign String?
  utmContent  String?
  utmTerm     String?
  landingUrl  String?
  // --- soft delete ---
  archivedAt DateTime?
```

**Create**: `apps/api/prisma/migrations/20260826100000_ad_attribution/migration.sql`

Molde de `20260814100000_account_deletion/migration.sql`: cabeçalho em pt-BR declarando *nullable, sem backfill, e por que não há índice*, um `ALTER TABLE` por linha.

```sql
-- Atribuição de anúncio na captação de lead: de qual clique o lead veio.
--
-- Colunas nulas e aditivas: nenhum backfill. E nada de RLS a fazer — a policy
-- `owner_isolation` de "Client" é `FOR ALL` sobre a expressão
-- `"ownerId" = current_setting('app.owner_id', true)`, sem enumerar coluna, e
-- privilégio de tabela no Postgres cobre coluna futura. Mesmo caminho de
-- `20260727100000_assignee_per_record` e `20260805100000_lead_source_catalog`,
-- que acrescentaram coluna a "Client" depois do `enable_rls` sem emitir policy
-- nem GRANT. A contagem-âncora de `test/rls.e2e-spec.ts` continua em 27.
--
-- SEM ÍNDICE de propósito, ao contrário de `account_deletion`: lá o índice
-- servia a uma varredura diária real. Aqui nada FILTRA por atribuição nesta
-- fase (relatório por campanha é fase futura), e índice sem consulta é escrita
-- mais lenta em toda ingestão de lead em troca de nada.
--
-- `fbclidAt` é TIMESTAMP(3): o `fbc` da Conversions API precisa do instante em
-- MILISSEGUNDOS, e `timestamp(3)` é exatamente essa precisão.
ALTER TABLE "Client" ADD COLUMN "fbclid"      TEXT;
ALTER TABLE "Client" ADD COLUMN "fbclidAt"    TIMESTAMP(3);
ALTER TABLE "Client" ADD COLUMN "fbp"         TEXT;
ALTER TABLE "Client" ADD COLUMN "gclid"       TEXT;
ALTER TABLE "Client" ADD COLUMN "utmSource"   TEXT;
ALTER TABLE "Client" ADD COLUMN "utmMedium"   TEXT;
ALTER TABLE "Client" ADD COLUMN "utmCampaign" TEXT;
ALTER TABLE "Client" ADD COLUMN "utmContent"  TEXT;
ALTER TABLE "Client" ADD COLUMN "utmTerm"     TEXT;
ALTER TABLE "Client" ADD COLUMN "landingUrl"  TEXT;
```

**Modify**: `apps/api/prisma/fixtures/invariantes.sql`

Bloco novo **no fim do arquivo**, depois do bloco de `20260825100000_retention_indexes`, seguindo o cabeçalho `-- ---` + título + migration entre parênteses que os 19 blocos existentes usam. Não é obrigatória pela letra de `apps/api/CLAUDE.md` (não há backfill nem troca de constraint), mas é o caso de "regra de conjunto que nenhuma constraint expressa" que `account_deletion` (`:317-349`) e `proposal_billing_plan` (`:391-400`) já cobrem.

```sql
-- ---------------------------------------------------------------------------
-- Atribuição de anúncio na captação (20260826100000_ad_attribution)
-- ---------------------------------------------------------------------------
-- As colunas nascem nulas e a migration é aditiva, então não há backfill a
-- conferir. O que se afirma aqui são duas REGRAS do conjunto que nenhuma
-- constraint expressa:
--
--  1. `fbclid` e `fbclidAt` andam JUNTOS. O `fbc` que a Conversions API consome
--     é `fb.1.<ms>.<fbclid>`: um `fbclid` sem o instante não monta nada, e um
--     instante sem `fbclid` não identifica ninguém. Meio-par não estoura em
--     lugar nenhum — ele vira, meses depois, um lead que parecia atribuível e
--     não é. Quem garante o par é `montarAtribuicao`; isto é o portão.
--  2. Nenhum campo é STRING VAZIA. `''` leria como "tem valor" em todo `IS NOT
--     NULL` daqui para a frente. O normalizador da ingestão (`texto()`) grava
--     NULL para vazio, e é isso que se confere.
DO $$
DECLARE
  meio_par INT;
  vazias   INT;
BEGIN
  SELECT count(*) INTO meio_par FROM "Client"
   WHERE ("fbclid" IS NULL) <> ("fbclidAt" IS NULL);
  IF meio_par > 0 THEN
    RAISE EXCEPTION 'Há % cliente(s) com fbclid meio-preenchido (um campo nulo e o outro não) — sem o par não há como montar o fbc.', meio_par;
  END IF;

  -- `'' IN (NULL, …)` avalia NULL, e WHERE NULL não conta a linha: cliente sem
  -- atribuição nenhuma passa direto, que é o comportamento desejado.
  SELECT count(*) INTO vazias FROM "Client"
   WHERE '' IN ("fbclid", "fbp", "gclid", "utmSource", "utmMedium",
                "utmCampaign", "utmContent", "utmTerm", "landingUrl");
  IF vazias > 0 THEN
    RAISE EXCEPTION 'Há % cliente(s) com campo de atribuição em string vazia — a ingestão devia ter gravado NULL.', vazias;
  END IF;
END $$;
```

### Success Criteria

#### Automated Verification

- [x] `docker compose up -d` e então `DATABASE_URL=postgresql://crm_user:crm_password@localhost:5435/crm_db apps/api/scripts/validar-migrations-com-dados.sh` — aplica o init, insere a fixture de dois owners, aplica as 44 migrations e termina nas invariantes. É o portão obrigatório de `apps/api/CLAUDE.md`.
- [x] `pnpm --filter api exec prisma validate` — o schema é válido.
- [x] `pnpm --filter api exec prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url $DATABASE_URL --exit-code` sai `0` — a migration escrita à mão bate exatamente com o schema, sem drift. *(O comando sai `1` por drift PRÉ-EXISTENTE em `main` — `ConsentRecord`/`OwnerWebhook`, nada relacionado a `Client` — confirmado rodando o mesmo diff com as mudanças desta fase retiradas via stash: o drift é idêntico. Nenhum drift novo de `Client`.)*
- [x] `pnpm --filter api build` — o Prisma Client regenerado tipa as dez colunas.
- [x] `pnpm --filter api test:e2e -- rls` — a contagem-âncora de `test/rls.e2e-spec.ts:82-92` continua em `toBe(27)`. Se ela subir, alguém emitiu policy que não devia existir.

#### Manual Verification

- [x] `psql … -c '\d "Client"'` mostra as dez colunas, todas nullable, e **nenhum índice novo**.
- [x] Rodar o bloco de invariante à mão depois de inserir um `Client` com `fbclid` e sem `fbclidAt`: ele estoura com a mensagem em pt-BR. Depois de inserir com `fbclid = ''`: estoura na segunda checagem. (Desfazer os dois inserts.)

**⏸ PAUSE**: Depois da verificação automatizada, parar para confirmação humana dos testes manuais antes da Fase 2.

---

## Phase 2: Captura na ingestão

### Goal

`POST /leads/intake` aceita os nove campos, e o lead — novo ou reincidente — passa a carregar a atribuição no `Client`, sem que nenhuma porta autenticada possa escrevê-la.

### Changes

#### Módulo de clientes — o tipo e a fronteira pública

**Create**: `apps/api/src/modules/clients/domain/ad-attribution.ts`

Mora no `domain/` do módulo de **clientes**, não no de leads: é forma do `Client`, e é o tipo do parâmetro de um método público de `ClientsService`. A lista literal é a fonte única do conjunto — `registrarAtribuicao` itera por ela, e quem esquecer um campo em outro lugar tem aqui a lista para conferir.

```ts
/**
 * Atribuição de anúncio de um `Client`: de qual clique o lead veio.
 *
 * A lista é a FONTE ÚNICA do conjunto. Ela existe porque o mesmo conjunto de
 * campos é percorrido em três lugares (o preenchimento em
 * `ClientsService.registrarAtribuicao`, o `select`/mapper da portabilidade e a
 * seção da aba de dados no front), e uma lista literal repetida três vezes
 * envelheceria em duas delas.
 *
 * `shared/audit-diff.ts` NÃO importa daqui de propósito: `shared` não pode
 * depender de `modules`. Lá os nomes estão repetidos, com um comentário
 * apontando para cá.
 */
export const CAMPOS_DE_ATRIBUICAO = [
  'fbclid',
  'fbclidAt',
  'fbp',
  'gclid',
  'utmSource',
  'utmMedium',
  'utmCampaign',
  'utmContent',
  'utmTerm',
  'landingUrl',
] as const;

export type CampoDeAtribuicao = (typeof CAMPOS_DE_ATRIBUICAO)[number];

/**
 * O valor de cada campo. `fbclidAt` é `Date` (o `fbc` precisa do instante em
 * milissegundos); o resto é texto cru da plataforma de anúncio.
 */
export type AtribuicaoDeAnuncio = {
  [K in CampoDeAtribuicao]: K extends 'fbclidAt' ? Date | null : string | null;
};
```

**Modify**: `apps/api/src/modules/clients/application/clients.service.ts`

Import novo, junto dos outros do `domain/` (bloco de `:10-16`):

```ts
import {
  CAMPOS_DE_ATRIBUICAO,
  type AtribuicaoDeAnuncio,
} from '../domain/ad-attribution';
```

Método novo, imediatamente **depois** de `promoverParaAtivo` (que termina em `:247`) e antes de `archive` — é o vizinho certo: as duas são fronteiras públicas do módulo, idempotentes e silenciosas, chamadas por outro módulo.

```ts
  /**
   * Grava a atribuição de anúncio do clique que trouxe o lead — fronteira
   * pública do módulo para a ingestão externa (`modules/leads`).
   *
   * Por que um método próprio, e não `update({ … })`: aqui a regra é do MÓDULO
   * DE CLIENTES, não de quem chama. **Só preenche coluna vazia.** A 17-A
   * decidiu que origem, tags e fonte contam de onde o cadastro veio na PRIMEIRA
   * vez, e atribuição segue a mesma lei — o clique que trouxe a pessoa de volta
   * não apaga o que a trouxe originalmente. Mas as colunas nasceram nulas nesta
   * fase, então um cadastro anterior ao deploy precisa PODER recebê-las quando o
   * lead volta; preencher-só-o-vazio é o que satisfaz as duas coisas de uma vez.
   *
   * Idempotente e silencioso, como `promoverParaAtivo`: sem lacuna a preencher
   * não escreve nada (o `updatedAt` mentiria) e não registra trilha — não há
   * ação de pessoa a auditar, e `AuditLog` retém 5 anos contra o "enquanto a
   * conta existir" do `Client`.
   *
   * Não existe porta autenticada para estes campos: eles não estão em
   * `CreateClientDto` nem em `UpdateClientDto`. É assim que "somente leitura" é
   * uma verdade da fronteira HTTP, e não uma convenção que o próximo PR quebra.
   */
  async registrarAtribuicao(
    ownerId: string,
    id: string,
    atribuicao: AtribuicaoDeAnuncio,
  ): Promise<void> {
    const atual = await this.findOne(ownerId, id);
    const patch: Record<string, string | Date> = {};
    for (const campo of CAMPOS_DE_ATRIBUICAO) {
      const valor = atribuicao[campo];
      if (valor !== null && atual[campo] === null) patch[campo] = valor;
    }
    if (Object.keys(patch).length === 0) return;
    await this.repo.update(id, ownerId, patch);
  }
```

#### Módulo de leads — o contrato HTTP e o mapeamento

**Modify**: `apps/api/src/modules/leads/api/dto/intake-lead.dto.ts`

Nove campos novos, **no fim da classe**, depois de `cenario` (`:110`). O docblock da classe (`:12-29`) já fixa as três regras que valem para todos eles (nome é contrato, `null` é aceito, `message` em pt-BR) e não muda. Bloco novo com comentário próprio, porque o grupo tem uma regra que os outros campos não têm:

```ts
  /*
    ---- Atribuição de anúncio ----

    De qual clique o lead veio. Todos opcionais e todos vazios até o `site-v2`
    passar a enviá-los — a ordem de deploy é API primeiro, site depois, porque o
    inverso responde 400 por `forbidNonWhitelisted` e PERDE o lead.

    Os nomes são o canônico de cada plataforma de propósito: quem integra
    reconhece `fbclid` e `utm_source`, e não reconheceria uma tradução. O único
    em pt-BR é `urlDeEntrada`, que não é nome de plataforma e precisa se
    distinguir de `pagina` (caminho, `/agenda-cheia`) — este é a URL inteira, o
    `event_source_url` da Conversions API.

    Nenhum deles é validado por formato. `@IsUrl` em `urlDeEntrada` reprovaria
    uma URL de staging ou com parâmetro estranho, e reprovar aqui significa
    perder o lead — o dado de contato vale mais do que a limpeza do campo. Os
    limites são generosos pelo mesmo motivo: um `fbclid` cortado é pior do que um
    `fbclid` longo.
  */

  /**
   * O `fbclid` da URL, CRU. Case-sensitive: a doc da Meta é explícita ("do not
   * apply any modifications before using, such as lower or upper case"), então
   * não normalize antes de enviar — o CRM também não normaliza.
   *
   * O instante do clique NÃO vem no corpo: o CRM o estampa a partir de
   * `recebidoEm` (ou da hora da ingestão), que é exatamente o "quando você
   * primeiro observou este fbclid" que a doc pede. É o dado irrecuperável desta
   * fase, e deixá-lo em um lugar só é o que garante que ele nunca falte.
   */
  @IsOptional()
  @IsString({ message: 'fbclid inválido.' })
  @MaxLength(400, { message: 'O fbclid deve ter no máximo 400 caracteres.' })
  fbclid?: string | null;

  /** O cookie `_fbp` do navegador, como ele está (`fb.1.<ms>.<aleatório>`). */
  @IsOptional()
  @IsString({ message: 'fbp inválido.' })
  @MaxLength(100, { message: 'O fbp deve ter no máximo 100 caracteres.' })
  fbp?: string | null;

  /** O `gclid` da URL (Google Ads). Também aceita `gbraid`/`wbraid` no lugar. */
  @IsOptional()
  @IsString({ message: 'gclid inválido.' })
  @MaxLength(400, { message: 'O gclid deve ter no máximo 400 caracteres.' })
  gclid?: string | null;

  /** `utm_source` da URL ("facebook", "google", "instagram"). */
  @IsOptional()
  @IsString({ message: 'utm_source inválido.' })
  @MaxLength(200, { message: 'O utm_source deve ter no máximo 200 caracteres.' })
  utmSource?: string | null;

  /** `utm_medium` da URL ("cpc", "paid_social", "email"). */
  @IsOptional()
  @IsString({ message: 'utm_medium inválido.' })
  @MaxLength(200, { message: 'O utm_medium deve ter no máximo 200 caracteres.' })
  utmMedium?: string | null;

  /** `utm_campaign` da URL. */
  @IsOptional()
  @IsString({ message: 'utm_campaign inválido.' })
  @MaxLength(200, {
    message: 'O utm_campaign deve ter no máximo 200 caracteres.',
  })
  utmCampaign?: string | null;

  /** `utm_content` da URL — costuma identificar o criativo. */
  @IsOptional()
  @IsString({ message: 'utm_content inválido.' })
  @MaxLength(200, {
    message: 'O utm_content deve ter no máximo 200 caracteres.',
  })
  utmContent?: string | null;

  /** `utm_term` da URL — costuma identificar a palavra-chave. */
  @IsOptional()
  @IsString({ message: 'utm_term inválido.' })
  @MaxLength(200, { message: 'O utm_term deve ter no máximo 200 caracteres.' })
  utmTerm?: string | null;

  /**
   * A URL COMPLETA onde a pessoa entrou, com esquema e query
   * ("https://programeai.com.br/agenda-cheia?utm_source=facebook"). Diferente de
   * `pagina`, que é só o caminho e vive na nota do cliente.
   */
  @IsOptional()
  @IsString({ message: 'URL de entrada inválida.' })
  @MaxLength(2000, {
    message: 'A URL de entrada deve ter no máximo 2000 caracteres.',
  })
  urlDeEntrada?: string | null;
```

**Create**: `apps/api/src/modules/leads/application/atribuicao-de-anuncio.ts`

Vizinho de `nota-de-lead.ts` e pelo mesmo motivo: função pura, testável sem banco, que traduz o vocabulário da origem para o do CRM.

```ts
/**
 * Atribuição de anúncio: a tradução do que a captação mandou para o que o
 * `Client` guarda. Função pura, ao lado de `nota-de-lead.ts`, e pelo mesmo
 * motivo — o formato é o que precisa de teste, não o banco.
 *
 * Duas coisas moram aqui e não podiam morar em outro lugar:
 *
 *  1. **O instante do `fbclid`.** A doc da Meta manda usar "o instante em que
 *     você primeiro observou este fbclid", e esse instante não é reconstruível
 *     depois — é o único dado desta fase que se perde para sempre se não for
 *     gravado agora. Ele é derivado, nunca recebido: um campo a mais no corpo
 *     seria um campo a mais para a origem esquecer.
 *  2. **O vazio.** Enquanto o `site-v2` não enviar nada, TODOS os campos chegam
 *     ausentes em todo lead. `temAtribuicao` é o portão que evita uma leitura e
 *     uma escrita por lead para gravar dez nulos.
 */

import type { AtribuicaoDeAnuncio } from '../../clients/domain/ad-attribution';

/** O que o `IntakeLeadDto` traz. Nomes do CONTRATO HTTP, não das colunas. */
export interface DadosDaAtribuicao {
  fbclid?: string | null;
  fbp?: string | null;
  gclid?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  urlDeEntrada?: string | null;
  /** `recebidoEm` do lead: quando a ORIGEM observou o clique. */
  recebidoEm?: string | null;
}

/**
 * Texto aproveitável, ou `null`. Nunca string vazia: `''` leria como "tem
 * valor" em todo `IS NOT NULL` daqui para a frente, e é o que a invariante do
 * banco proíbe. O `trim` é a ÚNICA transformação — em particular a caixa do
 * `fbclid` é preservada, porque a Meta a trata como significativa.
 */
function texto(valor?: string | null): string | null {
  const limpo = valor?.trim();
  return limpo ? limpo : null;
}

/**
 * O instante do clique. `recebidoEm` é preferido à hora da ingestão porque é
 * quando a ORIGEM viu o clique, e a chamada ao CRM pode vir minutos ou horas
 * depois (fila, retry, automação que roda de hora em hora).
 *
 * Data ilegível cai na hora da ingestão em vez de derrubar o lead: um `fbc` com
 * timestamp aproximado ainda casa dentro da janela, e lead perdido não volta. É
 * a mesma escolha que `quando()` em `nota-de-lead.ts` faz — só que lá o fallback
 * é omitir a linha, e aqui é usar `agora`, porque o par `fbclid`+`fbclidAt` não
 * admite metade.
 */
function instanteDoClique(recebidoEm: string | null | undefined, agora: Date): Date {
  if (!recebidoEm) return agora;
  const data = new Date(recebidoEm);
  return Number.isNaN(data.getTime()) ? agora : data;
}

/** `agora` é injetável para o teste do fallback não depender do relógio. */
export function montarAtribuicao(
  dados: DadosDaAtribuicao,
  agora: Date = new Date(),
): AtribuicaoDeAnuncio {
  const fbclid = texto(dados.fbclid);
  return {
    fbclid,
    // Nasce junto do `fbclid` ou não nasce: sem o par não há `fbc` a montar.
    fbclidAt: fbclid ? instanteDoClique(dados.recebidoEm, agora) : null,
    fbp: texto(dados.fbp),
    gclid: texto(dados.gclid),
    utmSource: texto(dados.utmSource),
    utmMedium: texto(dados.utmMedium),
    utmCampaign: texto(dados.utmCampaign),
    utmContent: texto(dados.utmContent),
    utmTerm: texto(dados.utmTerm),
    landingUrl: texto(dados.urlDeEntrada),
  };
}

/**
 * Algum campo chegou? Enquanto o emissor não envia atribuição, isto é `false`
 * em todo lead — e é o que mantém o custo desta fase em zero até lá.
 */
export function temAtribuicao(atribuicao: AtribuicaoDeAnuncio): boolean {
  return Object.values(atribuicao).some((valor) => valor !== null);
}
```

**Modify**: `apps/api/src/modules/leads/application/leads-intake.service.ts`

Import novo, junto do de `nota-de-lead` (`:11`):

```ts
import { empilharNota, montarNotaDeLead } from './nota-de-lead';
import { montarAtribuicao, temAtribuicao } from './atribuicao-de-anuncio';
```

Em `gravar()`, montar a atribuição junto da nota (depois do bloco `montarNotaDeLead` que termina em `:168`):

```ts
    const atribuicao = montarAtribuicao({
      fbclid: dto.fbclid,
      fbp: dto.fbp,
      gclid: dto.gclid,
      utmSource: dto.utmSource,
      utmMedium: dto.utmMedium,
      utmCampaign: dto.utmCampaign,
      utmContent: dto.utmContent,
      utmTerm: dto.utmTerm,
      urlDeEntrada: dto.urlDeEntrada,
      recebidoEm: dto.recebidoEm,
    });
```

No caminho **reincidente**, depois do `await this.clients.update(…)` que termina em `:192` e antes do `return`:

```ts
      /*
        A atribuição é a única coisa do cadastro existente que a reingestão
        pode tocar — e mesmo ela só onde está VAZIA. Fica fora do patch acima de
        propósito: aquele patch é "o que a reingestão reescreve", e atribuição
        não é reescrita, é preenchimento de lacuna. A regra mora dentro de
        `registrarAtribuicao`, não aqui, porque é regra do módulo de clientes.
      */
      if (temAtribuicao(atribuicao)) {
        await this.clients.registrarAtribuicao(
          ownerId,
          existente.id,
          atribuicao,
        );
      }
```

No caminho de **criação**, imediatamente depois do `const criado = await this.clients.create(…)` (que termina em `:230`) e antes do `contacts.create`:

```ts
    /*
      Escrita à parte, e não campo no DTO de criação: atribuição não está em
      `CreateClientDto` de propósito (é somente leitura na fronteira HTTP), e
      abri-la só para este caminho abriria para o formulário de cliente também.
      Custa uma leitura e uma escrita a mais, dentro da mesma transação, e só
      quando há algo a gravar — hoje, nunca.
    */
    if (temAtribuicao(atribuicao)) {
      await this.clients.registrarAtribuicao(ownerId, criado.id, atribuicao);
    }
```

O log de `receber` (`:128-136`) **não muda**: nenhum valor de atribuição entra nele.

### Testes desta fase

**Create**: `apps/api/src/modules/leads/application/atribuicao-de-anuncio.spec.ts`

```ts
import { montarAtribuicao, temAtribuicao } from './atribuicao-de-anuncio';

describe('montarAtribuicao', () => {
  const AGORA = new Date('2026-08-05T12:00:00.000Z');

  it('devolve tudo nulo quando nada vem — o caso de hoje', () => { /* … */ });
  it('temAtribuicao é false para o conjunto vazio', () => { /* … */ });
  it('estampa fbclidAt a partir de recebidoEm, em milissegundos', () => {
    const a = montarAtribuicao(
      { fbclid: 'IwAR2F4', recebidoEm: '2026-08-04T17:32:00.123Z' },
      AGORA,
    );
    expect(a.fbclidAt?.getTime()).toBe(
      new Date('2026-08-04T17:32:00.123Z').getTime(),
    );
  });
  it('cai em agora quando recebidoEm falta ou é ilegível', () => { /* AGORA nos dois */ });
  it('NÃO normaliza a caixa do fbclid', () => {
    expect(montarAtribuicao({ fbclid: ' IwAR2F4-dbP0l7Mn ' }, AGORA).fbclid)
      .toBe('IwAR2F4-dbP0l7Mn'); // só o espaço saiu
  });
  it('fbclidAt é nulo quando não há fbclid, mesmo com recebidoEm', () => { /* … */ });
  it('string vazia e só-espaço viram null, nunca ""', () => { /* … */ });
  it('urlDeEntrada vira landingUrl', () => { /* … */ });
});
```

**Modify**: `apps/api/src/modules/clients/application/clients.service.spec.ts`

`describe` novo para `registrarAtribuicao`, no molde do de `promoverParaAtivo`:

- preenche só o que está vazio: cliente com `utmSource: 'antigo'` e `fbclid: null` recebe patch só com `fbclid`/`fbclidAt`, e `utmSource` não aparece no patch;
- sem lacuna nenhuma **não chama `repo.update`** — nada de `updatedAt` mentindo;
- atribuição toda nula não chama `repo.update`;
- **não chama `audit.registrar`** em nenhum caso.

**Modify**: `apps/api/src/modules/leads/application/leads-intake.service.spec.ts`

O mock de `clients` (`:75-79`) ganha `registrarAtribuicao: jest.fn().mockResolvedValue(undefined)`. Testes novos:

- lead sem atribuição **não chama** `registrarAtribuicao` (é o caso de hoje, e é o que garante custo zero);
- lead com `utmSource` + `fbclid` chama uma vez, com o `ownerId`, o id do cliente criado e o objeto de dez chaves — `fbclidAt` derivado de `recebidoEm`;
- lead reincidente **também** chama, com o id do cadastro existente;
- e o teste existente `'não reescreve tags nem fonte: o patch só tem notes (e talvez assigneeId)'` (`:372-391`) continua passando **sem alteração** — é a prova de que a atribuição não entrou no patch de reescrita.

**Modify**: `apps/api/test/lead-intake.e2e-spec.ts`

`describe` novo `'atribuição de anúncio'`, e a rota é `@Public()` sobre tabela com RLS: os testes afirmam a **linha no banco** por `clientAdmin()`, não o status da resposta.

```ts
  describe('atribuição de anúncio', () => {
    const COM_ATRIBUICAO = {
      ...LEAD,
      fbclid: 'IwAR2F4-dbP0l7Mn1IawQQGCINEz7PYXQvwjNwB',
      fbp: 'fb.1.1596403881668.1116446470',
      gclid: 'Cj0KCQiAr4-ABhCDARIsACY',
      utmSource: 'facebook',
      utmMedium: 'cpc',
      utmCampaign: 'agenda-cheia-agosto',
      utmContent: 'criativo-3',
      utmTerm: 'crm para agencia',
      urlDeEntrada: 'https://programeai.com.br/agenda-cheia?utm_source=facebook',
    };

    it('grava a atribuição na linha do cliente, com o fbclidAt de recebidoEm', async () => {
      // afirma cliente.fbclid (caixa preservada), cliente.utmSource, cliente.landingUrl
      // e cliente.fbclidAt?.toISOString() === LEAD.recebidoEm
    });

    it('lead sem atribuição deixa as dez colunas nulas', async () => { /* … */ });

    it('lead reincidente PRESERVA a atribuição da primeira vez', async () => {
      // 1ª chamada com utmCampaign: 'agosto'; 2ª com utmCampaign: 'setembro'
      // → cliente.utmCampaign === 'agosto', e count() === 1
    });

    it('lead reincidente PREENCHE a coluna que estava vazia', async () => {
      // 1ª chamada sem atribuição; 2ª com gclid → cliente.gclid preenchido
    });

    it('recusa fbclid acima do limite sem gravar nada', async () => {
      await enviar({ ...LEAD, fbclid: 'x'.repeat(401) }, valor).expect(400);
      expect(await clientAdmin().client.count()).toBe(0);
    });
  });
```

### Success Criteria

#### Automated Verification

- [x] `pnpm --filter api test -- atribuicao-de-anuncio` — a função pura passa, incluindo a preservação de caixa do `fbclid` e o fallback de data ilegível. *(8/8)*
- [x] `pnpm --filter api test -- clients.service` — `registrarAtribuicao` preenche só o vazio, não escreve sem lacuna e nunca audita. *(37/37)*
- [x] `pnpm --filter api test -- leads-intake.service` — todos os testes anteriores continuam verdes (em especial `'o patch só tem notes (e talvez assigneeId)'`) e os novos passam. *(23/23)*
- [x] `pnpm --filter api test:e2e -- lead-intake` — as dez colunas estão na linha do banco depois da chamada; reincidente preserva e preenche lacuna; `fbclid` de 401 caracteres responde 400 sem gravar. *(29/29)*
- [x] `pnpm --filter api lint` e `pnpm --filter api build` limpos.
- [x] `DATABASE_URL=… apps/api/scripts/validar-migrations-com-dados.sh` — as invariantes continuam verdes com o código novo.

#### Manual Verification

- [ ] `curl` com a chave real de um canal e o corpo completo (o `CORPO_COMPLETO` da Fase 5) responde `200`, e a linha em `Client` tem `fbclid` com a caixa **exatamente** como enviada e `fbclidAt` igual ao `recebidoEm`. *(equivalente coberto pelo e2e `'grava a atribuição na linha do cliente, com o fbclidAt de recebidoEm'`)*
- [ ] `PATCH /clients/:id` com `{ "utmSource": "x" }` responde **400** (`forbidNonWhitelisted`) — a prova de que "somente leitura" vale na fronteira HTTP, e não só na intenção. *(verificado na fonte: grep por `fbclid|utmSource|gclid|landingUrl|urlDeEntrada` em `clients/api/dto/` não retorna nada)*
- [ ] `POST /public/clients` com `{ "fbclid": "x" }` responde **400** pelo mesmo motivo. *(idem: nada em `modules/public-api/` nem em `modules/data/`)*
- [ ] Grafana / stdout do container: a linha `evento="lead.ingerido"` do lead acima **não contém** `fbclid`, `utm`, `gclid` nem a URL. *(o log de `receber` não foi tocado; seus campos continuam sendo `clienteId`, `origem`, `qualificado`, `canalId`, `roteado`)*

**⏸ PAUSE**: Parar para confirmação humana antes da Fase 3.

---

## Phase 3: Superfícies de saída

### Goal

O arquivo de portabilidade carrega as dez colunas, a trilha de auditoria não as carrega, e a ausência delas no CSV é decisão escrita, não esquecimento.

### Changes

#### Portabilidade (as três superfícies, duas delas silenciosas)

**Modify**: `apps/api/src/modules/account/domain/account-dump.ts`

`VERSAO_DO_DUMP` a `3` (`:7`), mantendo o rastro histórico do comentário:

```ts
export const VERSAO_DO_DUMP = 3; // ← 3: atribuição de anúncio no cliente (2 entrou `consentimentos`)
```

Dez campos em `interface ClienteExportado` (`:99-122`), depois de `state` e antes de `archivedAt` — a mesma ordem do schema, para o arquivo ser conferível lado a lado:

```ts
  state: string | null;
  /**
   * Atribuição de anúncio, capturada na ingestão. Entra no dump porque é dado
   * que o CRM guarda SOBRE UMA PESSOA e o titular tem direito de levar — e
   * porque é o único lugar onde ele sai do CRM (o CSV de clientes não o carrega,
   * por decisão; ver `client-export-columns.ts`).
   */
  fbclid: string | null;
  fbclidAt: Date | null;
  fbp: string | null;
  gclid: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  landingUrl: string | null;
  archivedAt: Date | null;
```

**Modify**: `apps/api/src/modules/account/infra/prisma-account-dump.repository.ts`

Duas edições, e **só a do tipo acima quebra a compilação** — estas duas falham caladas.

No `select` do `db.client.findMany` (`:123-149`), depois de `state: true` e antes de `archivedAt: true`:

```ts
          state: true,
          // Atribuição de anúncio (Fase de captação). `select` explícito: coluna
          // nova NÃO aparece no arquivo de portabilidade sozinha.
          fbclid: true,
          fbclidAt: true,
          fbp: true,
          gclid: true,
          utmSource: true,
          utmMedium: true,
          utmCampaign: true,
          utmContent: true,
          utmTerm: true,
          landingUrl: true,
          archivedAt: true,
```

No mapper `clientes: clientes.map(…)` (`:360-383`), na mesma posição:

```ts
        state: c.state,
        fbclid: c.fbclid,
        fbclidAt: c.fbclidAt,
        fbp: c.fbp,
        gclid: c.gclid,
        utmSource: c.utmSource,
        utmMedium: c.utmMedium,
        utmCampaign: c.utmCampaign,
        utmContent: c.utmContent,
        utmTerm: c.utmTerm,
        landingUrl: c.landingUrl,
        archivedAt: c.archivedAt,
```

**Modify**: `apps/api/src/modules/account/application/account-export.service.spec.ts`

A âncora de `:133-136` amarra o valor de propósito. Sobe para 3, com o comentário atualizado:

```ts
    // Sobe junto de toda mudança de FORMA do dump: 2 quando `consentimentos`
    // entrou (Fase 19-B), 3 quando o cliente passou a carregar a atribuição de
    // anúncio. Quem consome um dump antigo precisa saber o que mudou.
    expect(dump.manifesto.versaoDoEsquema).toBe(VERSAO_DO_DUMP);
    expect(VERSAO_DO_DUMP).toBe(3);
```

Teste novo no mesmo arquivo, que fecha a falha silenciosa do `select`/mapper: um cliente da fixture com `fbclid`/`utmSource` preenchidos, e o dump serializado **contém** os dois valores. Sem ele, um `select` esquecido passa verde para sempre.

#### Trilha de auditoria

**Modify**: `apps/api/src/shared/audit-diff.ts`

Dez nomes em `CAMPOS_OMITIDOS` (`:10-34`), depois da linha de `document` (`:18`):

```ts
  'document', // CPF/CNPJ: dado pessoal que a trilha não precisa repetir
  // Atribuição de anúncio. Hoje NENHUMA escrita de `Client` passa `antes`/
  // `depois` ao `AuditService` (só `promoverParaAtivo`, com `{ status }`), então
  // isto é seguro preventivo, não conserto: no dia em que uma escrita de cliente
  // passar a diffar, um identificador publicitário iria para `AuditLog.diff`,
  // que retém 5 anos (`retention/domain/retencao.ts:42`) contra o "enquanto a
  // conta existir" do próprio `Client` — sobreviveria ao cliente. Mesma razão de
  // `document`. A lista canônica é `modules/clients/domain/ad-attribution.ts`;
  // aqui ela é repetida porque `shared` não pode depender de `modules`.
  'fbclid',
  'fbclidAt',
  'fbp',
  'gclid',
  'utmSource',
  'utmMedium',
  'utmCampaign',
  'utmContent',
  'utmTerm',
  'landingUrl',
```

**Modify**: `apps/api/src/shared/audit-diff.spec.ts`

Um teste afirmando que um par `antes`/`depois` que difere só em `fbclid` devolve `null`.

#### CSV/XLSX — a ausência documentada

**Modify**: `apps/api/src/modules/clients/application/client-export-columns.ts`

Nenhuma coluna nova. O que entra é o **motivo**, no docblock de `:11-15`, para a ausência ser decisão em vez de silêncio — o mesmo tratamento que `data/domain/import.ts:19-23` dá ao `personType`:

```ts
/**
 * Colunas da planilha de clientes. Espelham os rótulos pt-BR da interface: o
 * `status` sai traduzido e a origem sai por `source.name` (o `include` já vem
 * do repositório) — `sourceId` cru seria um UUID na planilha do usuário.
 *
 * A atribuição de anúncio (`fbclid`, `utmSource`, …) NÃO está aqui de propósito.
 * Seriam dez colunas permanentemente vazias na planilha de todo owner que não
 * roda anúncio, e esta planilha é a que o usuário abre para trabalhar. Quem
 * precisa do dado inteiro tem a portabilidade da conta (`GET /account/export`),
 * que carrega as dez — ali o formato já é largo e a completude é obrigação
 * legal, não conveniência. Reverter é acrescentar dez linhas aqui.
 */
```

### Success Criteria

#### Automated Verification

- [x] `pnpm --filter api test -- account-export` — `VERSAO_DO_DUMP` é 3, o manifest bate, e o teste novo encontra `fbclid`/`utmSource` no dump serializado. *(4/4)*
- [x] `pnpm --filter api test -- audit-diff` — diff que muda só `fbclid` devolve `null`. *(10/10)*
- [x] `pnpm --filter api build` — `ClienteExportado` e o mapper concordam (é a única das quatro superfícies que a compilação protege).
- [x] `pnpm --filter api test` — a suíte inteira verde. *(760/760, 76 suítes)*

#### Manual Verification

- [ ] `GET /account/export` numa conta com um lead atribuído: o JSON tem `versaoDoEsquema: 3` e o objeto do cliente traz as dez chaves, com `fbclidAt` em ISO. *(coberto pelo teste novo do spec, que afirma os valores no arquivo serializado)*
- [ ] `GET /clients/export?formato=xlsx`: a planilha tem **19** colunas, nenhuma de atribuição. *(conferido na fonte: `grep -c 'header:'` em `client-export-columns.ts` = 19)*
- [ ] Trilha de auditoria de um cliente que recebeu atribuição: nenhuma entrada nova, nenhum `diff` com `fbclid`. *(`registrarAtribuicao` não chama `audit.registrar` — amarrado por teste — e os dez nomes estão em `CAMPOS_OMITIDOS`)*

**⏸ PAUSE**: Parar para confirmação humana antes da Fase 4.

---

## Phase 4: Interface

### Goal

Quem abre o cadastro de um lead vê de qual anúncio ele veio, em rótulos pt-BR, sem poder editar — e não vê seção vazia quando não há atribuição.

### Changes

**Modify**: `apps/web/src/features/clientes/api/types.ts`

`interface Client` (`:12-38`) é a única declaração no front e tipa leitura **e** escrita (`Partial<Client>` em `clients.api.ts:11-24`). Os campos entram depois de `state` e antes de `archivedAt`:

```ts
  state?: string | null;
  /*
    Atribuição de anúncio: de qual clique o lead veio. SOMENTE LEITURA — a única
    porta de escrita é `POST /leads/intake`, e a API recusa estes campos em
    `POST`/`PATCH /clients` com 400. Este mesmo tipo alimenta `Partial<Client>`
    nas mutações, então não os inclua em nenhum formulário: o 400 viria do
    servidor, mas o erro nasceria aqui.
  */
  fbclid?: string | null;
  /** ISO 8601. Instante em que o CRM primeiro observou o `fbclid`. */
  fbclidAt?: string | null;
  fbp?: string | null;
  gclid?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  landingUrl?: string | null;
  archivedAt?: string | null;
```

**Modify**: `apps/web/src/lib/labels.ts`

`make()` não serve: ele traduz **valor** de enum, e `utm_source` é texto livre — o que se traduz aqui é a **chave**. O molde é o do `Record` irmão de `NOTIFICATION_TYPE_DESCRIPTIONS` (`:203-225`), que existe justamente por ter dois consumidores. No fim do arquivo:

```ts
/**
 * Rótulos dos campos de atribuição de anúncio. `Record` de CHAVE para rótulo, e
 * não um `make()`: `make` traduz o VALOR de um enum, e aqui o valor é texto
 * livre da plataforma de anúncio ("facebook", "cpc") — o que precisa de pt-BR é
 * o nome do campo.
 *
 * O nome técnico entra entre parênteses de propósito: quem configura a
 * integração procura por `utm_campaign`, e quem só usa o CRM lê "Campanha". Os
 * dois públicos abrem a mesma tela. E "Fonte do tráfego" em vez de "Origem"
 * porque `Origem` já é a fonte de lead do catálogo, na MESMA aba.
 */
export const AD_ATTRIBUTION_LABELS = {
  utmSource: 'Fonte do tráfego (utm_source)',
  utmMedium: 'Mídia (utm_medium)',
  utmCampaign: 'Campanha (utm_campaign)',
  utmContent: 'Conteúdo (utm_content)',
  utmTerm: 'Termo (utm_term)',
  landingUrl: 'URL de entrada',
  fbclid: 'ID de clique do Meta (fbclid)',
  fbclidAt: 'Clique observado em',
  fbp: 'Cookie do navegador Meta (_fbp)',
  gclid: 'ID de clique do Google (gclid)',
} as const;
```

**Modify**: `apps/web/src/features/clientes/tabs/DadosTab.tsx`

Três edições. Primeiro, `Row` ganha uma variante monoespaçada — um click id é uma string opaca de 100+ caracteres, e no `text-sm` do resto ele estoura o grid. É local ao arquivo, como `Row` e `Section` já são:

```tsx
function Row({
  label,
  value,
  href,
  mono,
}: {
  label: string;
  value?: string | null;
  href?: string | null;
  /** Valor opaco e longo (click id, URL): monoespaçado e quebrando no meio. */
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? 'font-mono text-xs break-all' : 'text-sm'}>
```

Depois, os imports (`:1-5`):

```tsx
import { AD_ATTRIBUTION_LABELS, translatePersonType } from '@/lib/labels';
import { formatDateTime, formatDocument, formatPhone } from '@/lib/format';
```

E a seção nova, **entre** `<Section title="Endereço">` (que fecha em `:98`) e o bloco de Tags (`:100`). A ordem interna é a de quem lê: primeiro campanha (o que uma pessoa entende), depois os identificadores técnicos.

```tsx
      </Section>

      {/*
        Atribuição de anúncio. Escondida por inteiro quando não há nada — e o
        normal é não haver: só chega em lead capturado por um site que envia
        `fbclid`/`utm_*`. Uma seção com dez "—" ensinaria que o CRM perdeu o
        dado. Tudo aqui é LEITURA: a única porta de escrita é a captação.
      */}
      {temAtribuicao(client) && (
        <Section title="Atribuição de anúncio">
          <Row label={AD_ATTRIBUTION_LABELS.utmSource} value={client.utmSource} />
          <Row label={AD_ATTRIBUTION_LABELS.utmMedium} value={client.utmMedium} />
          <Row
            label={AD_ATTRIBUTION_LABELS.utmCampaign}
            value={client.utmCampaign}
          />
          <Row label={AD_ATTRIBUTION_LABELS.utmContent} value={client.utmContent} />
          <Row label={AD_ATTRIBUTION_LABELS.utmTerm} value={client.utmTerm} />
          <Row
            label={AD_ATTRIBUTION_LABELS.landingUrl}
            value={client.landingUrl}
            href={client.landingUrl}
            mono
          />
          <Row label={AD_ATTRIBUTION_LABELS.fbclid} value={client.fbclid} mono />
          <Row
            label={AD_ATTRIBUTION_LABELS.fbclidAt}
            value={formatDateTime(client.fbclidAt)}
          />
          <Row label={AD_ATTRIBUTION_LABELS.fbp} value={client.fbp} mono />
          <Row label={AD_ATTRIBUTION_LABELS.gclid} value={client.gclid} mono />
        </Section>
      )}
```

E o predicado, junto de `toWebsiteUrl` (`:41-44`):

```tsx
/** Algum campo de atribuição chegou? Só então a seção existe. */
function temAtribuicao(client: Client): boolean {
  return Boolean(
    client.utmSource ||
      client.utmMedium ||
      client.utmCampaign ||
      client.utmContent ||
      client.utmTerm ||
      client.landingUrl ||
      client.fbclid ||
      client.fbp ||
      client.gclid,
  );
}
```

`ClientFormDialog` **não é tocado** — é o que faz "somente leitura" ser verdade na interface.

### Success Criteria

#### Automated Verification

- [x] `pnpm --filter web build` — o `tsc` do build aceita os campos novos e o `AD_ATTRIBUTION_LABELS`.
- [x] `pnpm --filter web lint` limpo. *(só os 7 warnings pré-existentes de `only-export-components`, em arquivos não tocados)*
- [x] `grep -rn "fbclid\|utmSource" apps/web/src/features/clientes/ClientFormDialog.tsx` não retorna nada — nenhum campo de atribuição vazou para o formulário.

#### Manual Verification

- [ ] Cliente cadastrado à mão (sem atribuição): a aba **Dados** não mostra a seção "Atribuição de anúncio" — nem vazia, nem com traços.
- [ ] Lead entregue por `curl` com o corpo completo: a seção aparece entre Endereço e Tags, com os cinco `utm_*` legíveis, a URL clicável, os três click ids em monoespaçado quebrando na largura do card, e "Clique observado em" no formato pt-BR `04/08/2026 14:32`.
- [ ] Tema claro e escuro: nenhuma cor hard-coded; o monoespaçado usa os tokens do tema.
- [ ] Abrir o diálogo de edição do mesmo cliente: **nenhum** campo de atribuição, e salvar não apaga o que a captação gravou.

**⏸ PAUSE**: Parar para confirmação humana antes da Fase 5.

---

## Phase 5: Documentação e Política de Privacidade

### Goal

`ENDPOINTS.md`, a página de ajuda da captação e a Política de Privacidade dizem exatamente o que o código faz — inclusive o que a Meta **não** entrega.

### Changes

#### Referência de endpoints

**Modify**: `apps/api/ENDPOINTS.md`

Na linha **Body** de `POST /leads/intake` (`:373`), acrescentar os nove campos ao fim do objeto, antes do travessão explicativo. O formato fixo por endpoint (Propósito/Auth/Body/Resposta/Erros/Handler) não muda.

```
- **Body:** `{ nome: string (2–120), whatsapp: string (10–11 dígitos, DDD + número, sem o 55), telefone?: string (E.164), email?: string, empresa?: string, cidade?: string, mensagem?: string (≤2000), origem: string (≤60), pagina?: string, recebidoEm?: string (ISO 8601), qualificacao?: object, resumo?: string (≤4000), cenario?: string (≤160), fbclid?: string (≤400), fbp?: string (≤100), gclid?: string (≤400), utmSource?: string (≤200), utmMedium?: string (≤200), utmCampaign?: string (≤200), utmContent?: string (≤200), utmTerm?: string (≤200), urlDeEntrada?: string (≤2000) }` — campo não declarado responde `400` (o `ValidationPipe` global roda com `forbidNonWhitelisted`); `null` é aceito em qualquer opcional. Os nove últimos são a **atribuição de anúncio**: são persistidos em `Client` (`fbclid`, `fbclidAt`, `fbp`, `gclid`, `utmSource`, `utmMedium`, `utmCampaign`, `utmContent`, `utmTerm`, `landingUrl`), **somente leitura** daí em diante (nem `POST/PATCH /clients` nem `POST /public/clients` os aceitam), e em lead reincidente só preenchem coluna que ainda esteja vazia. `fbclidAt` **não vem no corpo**: é o instante em que o CRM primeiro observou o `fbclid`, derivado de `recebidoEm` (ou da hora da chamada), e é o que permite montar o `fbc` (`fb.1.<ms>.<fbclid>`) depois.
```

#### Página de ajuda da captação

**Modify**: `apps/web/src/features/ajuda/CaptacaoDocPage.tsx`

O próprio arquivo (`:16-24`) obriga esta atualização no mesmo PR. Cinco edições:

1. `CORPO_COMPLETO` (`:43-56`) — os nove campos, para o exemplo copiável ficar completo:

```ts
const CORPO_COMPLETO = `{
  "nome": "Ana Ribeiro",
  "whatsapp": "84999398021",
  "telefone": "+5584999398021",
  "email": "ana@exemplo.com.br",
  "empresa": "Clínica Bem Viver",
  "cidade": "Mossoró",
  "mensagem": "Quero um site que traga paciente.",
  "origem": "landing-agenda-cheia",
  "pagina": "/agenda-cheia",
  "recebidoEm": "2026-08-04T17:32:00.000Z",
  "resumo": "Faturamento entre 20k e 50k. Sem processo de follow-up.",
  "cenario": "Operação no limite",
  "fbclid": "IwAR2F4-dbP0l7Mn1IawQQGCINEz7PYXQvwjNwB",
  "fbp": "fb.1.1596403881668.1116446470",
  "gclid": "Cj0KCQiAr4-ABhCDARIsACY",
  "utmSource": "facebook",
  "utmMedium": "cpc",
  "utmCampaign": "agenda-cheia-agosto",
  "utmContent": "criativo-3",
  "utmTerm": "crm para agencia",
  "urlDeEntrada": "https://programeai.com.br/agenda-cheia?utm_source=facebook&utm_campaign=agenda-cheia-agosto"
}`;
```

2. Tabela `CAMPOS` (`:73-153`) — nove linhas novas no fim, no mesmo formato `[campo, tipo, obrigatório, limite, o que faz]`:

```ts
  [
    'fbclid',
    'texto',
    'Não',
    'até 400',
    'Identificador de clique do Meta, exatamente como veio na URL. Não mude a caixa das letras.',
  ],
  [
    'fbp',
    'texto',
    'Não',
    'até 100',
    'O cookie _fbp do navegador, se o seu site tiver o Pixel instalado.',
  ],
  [
    'gclid',
    'texto',
    'Não',
    'até 400',
    'Identificador de clique do Google Ads (ou gbraid/wbraid, no lugar dele).',
  ],
  ['utmSource', 'texto', 'Não', 'até 200', 'O utm_source da URL.'],
  ['utmMedium', 'texto', 'Não', 'até 200', 'O utm_medium da URL.'],
  ['utmCampaign', 'texto', 'Não', 'até 200', 'O utm_campaign da URL.'],
  ['utmContent', 'texto', 'Não', 'até 200', 'O utm_content da URL.'],
  ['utmTerm', 'texto', 'Não', 'até 200', 'O utm_term da URL.'],
  [
    'urlDeEntrada',
    'texto',
    'Não',
    'até 2000',
    'A URL completa da página onde a pessoa entrou, com http e a query inteira.',
  ],
```

3. A contagem **escrita à mão** (`:282-287`) — treze vira vinte e dois. É a linha que envelhece calada:

```tsx
        <P>
          São vinte e dois campos, e só três são obrigatórios:{' '}
          <Codigo>nome</Codigo>, <Codigo>whatsapp</Codigo> e{' '}
          <Codigo>origem</Codigo>. Os opcionais aceitam <Codigo>null</Codigo> ou
          podem simplesmente não vir. Os nove últimos são a{' '}
          <Interno to="/ajuda/captacao#atribuicao">atribuição de anúncio</Interno>{' '}
          — leia a seção antes de ligá-los.
        </P>
```

4. Seção nova em `SECOES`, **depois** de `campos` e antes de `exemplos`. É onde a limitação da Meta é dita sem rodeio, porque quem lê esta página é quem vai investir dinheiro achando que o ciclo inteiro fecha:

```tsx
  {
    id: 'atribuicao',
    titulo: 'Atribuição de anúncio',
    corpo: (
      <>
        <P>
          Se o seu site recebe tráfego pago, ele pode entregar ao CRM de qual
          clique o lead veio: os <Codigo>utm_*</Codigo> da URL, o{' '}
          <Codigo>fbclid</Codigo> do Meta, o <Codigo>gclid</Codigo> do Google e o
          cookie <Codigo>_fbp</Codigo>. O CRM guarda tudo no cadastro do cliente,
          junto do resto, e mostra na aba <Forte>Dados</Forte>.
        </P>
        <P>
          Esses campos são <Forte>somente leitura</Forte> depois de gravados:
          ninguém os edita pela tela nem pela API de clientes, e um lead que volta
          a preencher o formulário <Forte>não</Forte> reescreve a atribuição da
          primeira vez — ela conta de qual anúncio a pessoa veio originalmente. A
          única exceção é campo que ficou vazio: esse o lead novo preenche.
        </P>
        <Destaque>
          <P>
            <Forte>
              Isto ainda NÃO envia conversão para o Meta nem para o Google.
            </Forte>{' '}
            Esta etapa só guarda o dado. O envio é um trabalho separado, e é bom
            você saber por que antes de contar com ele.
          </P>
          <P>
            <Forte>O prazo do Meta é curto.</Forte> A API de conversões recusa o
            envio inteiro se o evento tiver mais de <Forte>7 dias</Forte>, e a
            janela de atribuição a clique do Gerenciador de Anúncios também é de{' '}
            <Forte>7 dias</Forte> (o programa de leads aceita a conversão em até
            28 dias da geração do lead). Ou seja: um negócio que fecha{' '}
            <Forte>meses</Forte> depois do clique não tem, hoje, caminho
            documentado de atribuição no Meta. Os 90 dias que se lê por aí são a
            validade recomendada do cookie <Codigo>_fbc</Codigo>, que é outra
            coisa.
          </P>
          <P>
            <Forte>O do Google é longo.</Forte> Conversão offline por{' '}
            <Codigo>gclid</Codigo> é aceita até <Forte>90 dias</Forte> depois do
            clique — o que combina com o ciclo de venda de uma agência. Se você
            escolhe um só, mande o <Codigo>gclid</Codigo>.
          </P>
          <P>
            Vale capturar de todo modo, e por um motivo específico: o{' '}
            <Forte>instante</Forte> do clique não é recuperável depois. Ele é
            gravado agora ou nunca, e sem ele nenhum envio futuro funciona,
            qualquer que seja o prazo.
          </P>
        </Destaque>
        <Sub nivel={4}>O que o seu site precisa fazer</Sub>
        <Lista>
          <Item>
            Ler os <Codigo>utm_*</Codigo>, o <Codigo>fbclid</Codigo> e o{' '}
            <Codigo>gclid</Codigo> da URL na <Forte>primeira</Forte> visita e
            guardá-los até o formulário ser enviado (sessão, cookie próprio,{' '}
            <Codigo>localStorage</Codigo>). Quem lê só no momento do envio perde
            todo mundo que navegou uma página antes de preencher.
          </Item>
          <Item>
            Mandar o <Codigo>fbclid</Codigo> <Forte>sem mudar a caixa das
            letras</Forte>. O Meta trata maiúscula e minúscula como
            significativas, e "arrumar" o valor o invalida.
          </Item>
          <Item>
            Mandar <Codigo>recebidoEm</Codigo> junto. É dele que o CRM tira o
            instante do clique — sem ele, vale a hora em que a chamada chegou, o
            que atrasa o registro se a sua integração tem fila.
          </Item>
          <Item>
            <Forte>Consentimento é responsabilidade de quem exibe o
            formulário.</Forte> Repassar dado de lead a uma plataforma de anúncio
            é compartilhamento com terceiro, e o art. 7º § 5º da LGPD exige
            consentimento específico e separado para isso. O CRM guarda o que
            você enviar; quem coleta o consentimento é o seu site.
          </Item>
        </Lista>
      </>
    ),
  },
```

5. O `Destaque` da seção `campos` (`:295-311`) ganha uma frase final, porque a ordem de deploy é a armadilha real:

```tsx
          <P>
            <Forte>Ligue a atribuição no seu site só depois</Forte> de confirmar
            que o CRM já aceita os campos novos — o inverso responde{' '}
            <Codigo>400</Codigo> e o lead é perdido. Teste com o comando da seção
            3 antes de mexer no formulário.
          </P>
```

#### Política de Privacidade

**Modify**: `apps/web/src/features/legal/PrivacidadePage.tsx`

Três afirmações precisam ser reconciliadas, e a reconciliação escolhida distingue os dois papéis que a Fase 19-A fixou: o CRM é **controlador** dos dados da conta do owner e **operador** dos dados de terceiros que o owner cadastra. Ele continua não rastreando o owner — nenhum pixel, nenhum cookie publicitário no app, e essa frase fica de pé. O que muda é que ele passa a **armazenar**, por instrução do owner, identificador que o site do owner capturou.

1. Em `dados-coletados`, o `<P>` de `:208-212`:

```tsx
        <P>
          <Forte>Não rastreamos você.</Forte> O {EMPRESA.produto} não usa
          ferramentas de análise comportamental, rastreadores publicitários nem
          perfis de marketing sobre quem usa o CRM, e não faz decisões
          automatizadas que afetem seus interesses. Não há pixel de publicidade
          em nenhuma tela do produto.
        </P>
        <P>
          <Forte>
            Coisa diferente: o conteúdo que você registra pode conter
            identificador de publicidade.
          </Forte>{' '}
          Se você integra a captação de leads do seu site ao CRM, o seu site pode
          nos entregar de qual anúncio o lead veio — parâmetros de campanha
          (<Dado>utm_source</Dado>, <Dado>utm_campaign</Dado> e afins),
          identificadores de clique do Meta e do Google (<Dado>fbclid</Dado>,{' '}
          <Dado>gclid</Dado>) e o cookie <Dado>_fbp</Dado>, se houver. Nós{' '}
          <Forte>guardamos</Forte> isso junto do cadastro do cliente, porque{' '}
          <Forte>você</Forte> decidiu coletá-lo: quem escolhe a finalidade e
          obtém o consentimento do titular é você, como controlador desses dados;
          nós apenas os armazenamos, como operador. O {EMPRESA.produto} não envia
          esse dado a nenhuma plataforma de publicidade, e não o usa para
          finalidade própria nenhuma.
        </P>
```

2. Em `finalidades`, o `<P>` de `:260-263`:

```tsx
        <P>
          Não vendemos dados pessoais, não os cedemos para fins publicitários e
          não os usamos para treinar modelos de inteligência artificial. Isso
          inclui o identificador de publicidade que a captação de leads pode
          armazenar no conteúdo do CRM: ele fica no seu cadastro e{' '}
          <Forte>não sai daqui</Forte> — nós não o repassamos ao Meta, ao Google
          nem a ninguém.
        </P>
```

3. No `resumo` da própria página (`:606-610`):

```tsx
          <p>
            Não vendemos dados, não usamos rastreadores publicitários no produto
            e não treinamos modelos de IA com o seu conteúdo. Se você integra a
            captação de leads, guardamos o identificador de campanha que o seu
            site enviar — como operador, sem repassá-lo a ninguém. Dados de
            cartão ficam na Stripe e não passam pelos nossos servidores.
          </p>
```

`Dado` já está importado (`:5`). A tabela de prazos **não muda**: a atribuição vive no `Client`, cujo prazo declarado é "enquanto a conta existir", que já consta.

#### Dívida registrada

**Modify**: `ROADMAP.md`

Bloco novo em `## Sobras das fases concluídas`, depois do bloco da 17-A (`:133-135`), no formato dos existentes. É onde a condição de bloqueio da fase de envio fica escrita:

```markdown
**Da captação de atribuição de anúncio** (ver [spec](specs/plans/2026-08-05-atribuicao-de-anuncio-na-captacao.md)):
o **consentimento** ficou fora por decisão. Nada sai do CRM para plataforma de anúncio nesta etapa, então
não há `compartilhamento_terceiro` a consentir; e quem registra consentimento é quem exibe o formulário —
o `site-v2`, que vive em outro repositório. `POST /leads/intake` não grava nenhuma linha de `ConsentRecord`,
e a única porta de escrita (`POST /consentimentos`) exige JWT, inalcançável pela rota pública.

> **Bloqueio explícito:** a fase de **envio de conversão** não pode começar sem porta de consentimento na
> ingestão. Repassar dado de lead ao Meta ou ao Google é compartilhamento com terceiro, e o art. 7º § 5º
> exige consentimento **específico e separado** — `compartilhamento_terceiro` já existe no catálogo para isso.

Também fora por decisão, e aditivos quando houver requisito: `metaLeadId` (só existe em lead de Instant Form,
que não entra por esta rota), `client_ip_address`/`client_user_agent` (a 19-A decidiu não registrar IP fora do
evento de autenticação), colunas de **último toque** e as colunas de atribuição no CSV de clientes.
```

### Success Criteria

#### Automated Verification

- [x] `pnpm --filter web build` e `pnpm --filter web lint` — o JSX novo das duas páginas compila e passa o lint. *(Desvio: o spec mandava usar `Dado` para os nomes técnicos na Política, mas `Dado` exige `rotulo` e é bloco rótulo/valor, não inline. Trocado por `Codigo`, que é o inline usado no resto das páginas, e o import foi acrescentado.)*
- [x] A contagem escrita à mão bate: `CAMPOS` em `apps/web/src/features/ajuda/CaptacaoDocPage.tsx` tem **22** entradas e `IntakeLeadDto` tem 22 propriedades. Não há teste que amarre isso — é a linha que envelheceu calada em "treze". *(conferido: 22 e 22)*
- [x] `grep -n "fbclid\|utmSource" apps/api/ENDPOINTS.md` acha o bloco de `POST /leads/intake` e **só** ele. *(uma única linha: 373)*

#### Manual Verification

- [ ] `/ajuda/captacao`: a tabela lista os 22 campos, o exemplo "Completo" é copiável e válido, e a seção "Atribuição de anúncio" aparece no índice lateral e diz os 7 dias do Meta e os 90 do Google sem ambiguidade.
- [ ] O link `#atribuicao` do parágrafo de contagem rola para a seção certa.
- [ ] `/privacidade`: as três passagens estão coerentes entre si — a página não afirma e nega a mesma coisa em lugares diferentes. Ler as três em sequência.
- [ ] Colar o `CORPO_COMPLETO` da página num `curl` real: responde `200` e a seção de atribuição aparece no cadastro.

**⏸ PAUSE**: Revisão final antes do PR.

---

## Testing Strategy

### Unit Tests

- **`atribuicao-de-anuncio.spec.ts`** (novo): o formato. Caixa do `fbclid` preservada; `trim` sem normalização; `''` e `'   '` → `null`; `fbclidAt` derivado de `recebidoEm` com precisão de milissegundo; fallback para `agora` com `recebidoEm` ausente **e** com `recebidoEm` ilegível; `fbclidAt` nulo sem `fbclid` mesmo havendo `recebidoEm`; `urlDeEntrada` → `landingUrl`; `temAtribuicao` falso no conjunto vazio e verdadeiro com um campo só.
- **`clients.service.spec.ts`**: `registrarAtribuicao` preenche só coluna nula; não chama `repo.update` sem lacuna; não chama `audit.registrar` nunca.
- **`leads-intake.service.spec.ts`**: não chama `registrarAtribuicao` quando não há atribuição (o caso de hoje); chama nos dois caminhos quando há; e o teste existente do patch de reincidência (`Object.keys(patch).sort()` = `['assigneeId', 'notes']`) continua passando sem edição — é a prova de que a atribuição não entrou na reescrita.
- **`audit-diff.spec.ts`**: diff que muda só `fbclid` devolve `null`.
- **`account-export.service.spec.ts`**: `VERSAO_DO_DUMP` é 3, e o dump serializado contém `fbclid`/`utmSource` — o teste que fecha a falha silenciosa do `select`/mapper.

### Integration Tests

- **`test/lead-intake.e2e-spec.ts`** é o teste que importa. A rota é `@Public()` e escreve em tabela com RLS: sem `app.owner_id` o RLS **não estoura** — grava zero linha e a rota responde sucesso. Por `apps/api/CLAUDE.md`, cada afirmação é sobre a **linha no banco** por `clientAdmin()`, nunca sobre o status. Cobre: gravação das dez colunas com `fbclidAt` de `recebidoEm`; lead sem atribuição deixando tudo nulo; reincidente preservando o primeiro toque; reincidente preenchendo lacuna; `fbclid` de 401 caracteres respondendo 400 sem gravar nada.
- **`test/rls.e2e-spec.ts`**: a contagem-âncora continua em 27. Nenhuma tabela nova, nenhuma policy nova.
- **O portão de migration com dado dentro** é integração de fato: `validar-migrations-com-dados.sh` aplica as migrations sobre dois owners e termina nas invariantes.

### Migration & Rollback

**Aplicar.** `prisma migrate deploy` no deploy normal da API. Dez `ALTER TABLE ADD COLUMN` nullable é lock `ACCESS EXCLUSIVE` de duração desprezível (o Postgres não reescreve a tabela para coluna nullable sem default) — não há janela de manutenção a pedir. Nenhum backfill, nada de RLS, nenhum `GRANT`.

**Ordem de deploy — obrigatória e assimétrica.** API primeiro, `site-v2` depois. Se o site começar a enviar `utmSource` antes do deploy da API, `forbidNonWhitelisted` responde 400 e **o lead é perdido** — comportamento documentado como intencional em `CaptacaoDocPage`. O inverso é inofensivo: os campos simplesmente vêm vazios.

**Reverter.** Nada a reverter no dado: as colunas nascem nulas e ficam nulas até o `site-v2` mudar, e nenhum caminho existente muda de comportamento. Se for preciso voltar atrás depois de o site já enviar, a ordem inverte: **site primeiro** (para de enviar), API depois. Um `DROP COLUMN` descarta dado irrecuperável — preferir deixar as colunas e parar de ler.

**Dado existente.** As duas linhas de `Client` de `banco-populado.sql` e todo cliente de produção ficam com as dez colunas nulas. Não há como reconstruí-las: o `fbclid` e o instante do clique já se perderam para todo lead capturado antes deste deploy. É o custo já pago, e a razão de a captura vir antes do envio.

## Environment Considerations

- **CI/CD**: nenhuma etapa nova. `validar-migrations-com-dados.sh` já roda a cada push que toca a API e passa a exercitar a migration e a invariante novas.
- **Migrations**: uma, `20260826100000_ad_attribution`. Aditiva, nullable, sem índice.
- **Config/Secrets**: **nenhuma** variável de ambiente nova, nenhuma credencial nova. Não há chamada de saída nesta fase, então não há token de plataforma a guardar.
- **Multi-environment**: idêntico em dev, staging e produção. O que difere é o emissor: só o `site-v2` de produção envia atribuição, e só depois de o time de lá mudar o código.
- **Repositório externo**: `site-v2` precisa (a) ler `utm_*`/`fbclid`/`gclid` na primeira visita e persistir até o envio, (b) ler o cookie `_fbp` quando o Pixel existir, (c) enviar sem alterar a caixa do `fbclid`, e (d) tratar consentimento. Nada disso está neste repositório, e enquanto não acontecer **todas as dez colunas ficam nulas** — a captura no CRM é condição necessária e insuficiente.

## Dependencies & Risks

- **Nenhuma dependência nova.** Nada de `node:crypto`, nada de cliente HTTP: não há hash nem envio nesta fase.
- **A contagem "vinte e dois campos" na página de ajuda é escrita à mão** e envelhece calada — foi o que aconteceu com "treze". Não há teste que a amarre; ela é item de verificação manual da Fase 5.
- **`Client` chega a 30 colunas.** Nenhum `select` explícito do CRM lista todas (o repositório usa `include`), então nada quebra — mas o dump usa `select` explícito, e é justamente lá que a Fase 3 age. Vale reler `prisma-account-dump.repository.ts` a cada coluna nova de `Client`.
- **Duas escritas extras por lead atribuído** (um `findById` + um `update` dentro da transação de `executarComoOwner`, que tem 5s de timeout). São queries locais, sem I/O de rede, e só acontecem quando há algo a gravar — hoje, nunca. Se a ingestão vier a receber volume, o caminho de otimização é passar o registro recém-criado a `registrarAtribuicao` em vez de relê-lo; não vale antecipar.
- **A promessa sobre o Meta é o risco de produto**, não de código. Se alguém ligar a captura esperando conversão atribuída meses depois, vai concluir que o CRM está quebrado. A seção nova da página de ajuda existe exatamente para isso, e é a parte deste trabalho que **não** deve ser cortada por brevidade.
- **LGPD**: a captura fica dentro do papel de operador, mas o **envio** não fica sem consentimento específico (art. 7º § 5º). A dívida está registrada no `ROADMAP.md` como bloqueio explícito da fase de envio, não como observação.

## References

- PRD: `specs/research/2026-08-05-atribuicao-de-anuncio-na-captacao.md`
- Specs relacionadas: `specs/plans/2026-07-28-fase-17a-entrada-de-lead.md` (nomes do DTO são contrato; lead reincidente não reescreve atribuição; tag × `sourceId`), `specs/plans/2026-08-04-fase-19b-plataforma-aberta.md` (catálogo de finalidades de consentimento; "o CRM registra, não comunica")
- Molde de migration: `apps/api/prisma/migrations/20260814100000_account_deletion/migration.sql`
- Molde de invariante de par: `apps/api/prisma/fixtures/invariantes.sql:317-349`
- [ClickID and the fbp and fbc Parameters](https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/fbp-and-fbc) — formato do `fbc`, `creationTime` em ms, `fbclid` case-sensitive
- [Conversions API — Using the API](https://developers.facebook.com/docs/marketing-api/conversions-api/using-the-api/) — `event_time` acima de 7 dias reprova o request inteiro
- [Changes to attribution settings](https://en-gb.facebook.com/business/help/395050428485124) — janela de clique de 7 dias
- [Conversion Leads Integration](https://developers.facebook.com/docs/marketing-api/conversions-api/conversion-leads-integration/) — conversão em ≤28 dias do lead
- [Guidelines for importing offline conversions](https://support.google.com/google-ads/answer/15081888) — 90 dias no Google Ads
