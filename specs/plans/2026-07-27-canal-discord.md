---
date: 2026-07-27T13:38:36-03:00
author: claude
source_prd: standalone
git_commit: 4f7e622d124eb9be2cb50ca9eefbb86f592e98d5
branch: main
status: approved
tags: [spec, notifications, notificacoes, discord, canal, integracao]
---

# Spec: Canal `DISCORD`

## Overview

Um quinto canal de notificação, `DISCORD`, como **destino do usuário** — a mesma natureza do
`SLACK` e do `WEBHOOK` entregues na Fase 9, e não o webhook de saída do owner (esse é a Fase 19,
ver [ROADMAP.md](../../ROADMAP.md) → Fase 19).

Esta spec é curta de propósito, e o motivo é o contrato que a Fase 9 estabeleceu: **plugar um canal
novo é 1 arquivo em `infra/` + 1 linha no `inject` do módulo**. Se ela ficar grande, o registry
falhou. O que sobra além disso é o valor novo do enum (que exige migration, porque enum do Postgres
é DDL), a tradução em pt-BR do rótulo (regra de rótulo de domínio do projeto) e o seletor da
interface.

O trabalho de segurança **já está feito**: o destino nasce `verified: false`/`active: false`, passa
por `validarUrlDeWebhook` (HTTPS, porta 443, bloqueio de IP interno/SSRF), exige a permissão
`notificacao:integrar` para ser criado, e só entrega depois do ping de
`POST /notifications/targets/:id/verify`. Nada disso é reescrito aqui.

## Current State

A Fase 9 está implementada e commitada (`4f7e622`). Vale para esta spec:

- `NotificationChannelKind` tem quatro valores: `IN_APP`, `EMAIL`, `WEBHOOK`, `SLACK`
  ([schema.prisma](../../apps/api/prisma/schema.prisma))
- O registry é um array-provider sob `NOTIFICATION_CHANNELS`, montado num `Map<kind, Canal>` pelo
  [notifications-dispatcher.service.ts:25](../../apps/api/src/modules/notifications/application/notifications-dispatcher.service.ts#L25).
  `if`/`switch` por canal é **proibido** fora desse `Map`.
- O transporte HTTP já é compartilhado: `postar(url, corpo, deliveryId)` é exportado de
  [webhook.channel.ts](../../apps/api/src/modules/notifications/infra/webhook.channel.ts) e o
  `SlackChannel` já o reusa. Ele manda os quatro cabeçalhos (`X-CRM-Delivery` inclusive), aplica
  timeout de 10s e rejeita fora da faixa 2xx.
- **Verificado**: os únicos dois pontos que decidem por `kind` fora do registry —
  `resumirConfig` e `verificar()` em
  [notification-targets.service.ts](../../apps/api/src/modules/notifications/application/notification-targets.service.ts)
  — já tratam um `kind` novo corretamente **sem alteração nenhuma**: `resumirConfig` cai no ramo
  "devolve só o host da URL" (que é o certo para o Discord) e `verificar()` cai no ramo "precisa de
  ping" (idem). Isso não é sorte: os dois foram escritos como "IN_APP e EMAIL são a exceção, o resto
  é URL".

### Fatos da API do Discord (conferidos na doc oficial, não de memória)

Fonte: [docs.discord.com/developers/resources/webhook](https://docs.discord.com/developers/resources/webhook)

| Fato | Valor | Por que importa aqui |
|---|---|---|
| Endpoint | `POST /webhooks/{id}/{token}` (URL cheia: `https://discord.com/api/webhooks/...`) | É a URL que o usuário cola; nada a montar |
| Sucesso | **`204 No Content`** sem `?wait=true` | `postar()` testa `resposta.ok`, que é `true` para 204 — **nenhum ajuste no transporte** |
| Corpo | `content` é aceito (a exigência é "ao menos um" de `content`/`embeds`/`components`/`file`/`poll`) | `{ content }` basta |
| Limite | `content` até **2000 caracteres** | Exige truncar — ver Fase 1 |

## Desired End State

- `UserNotificationTarget.kind` aceita `DISCORD`, e a matriz tipo × destino funciona nele igual aos
  outros quatro.
- `POST /notifications/targets/integrations` aceita `kind: 'DISCORD'`, atrás da mesma permissão
  `notificacao:integrar` e das mesmas travas de URL.
- Uma notificação entregue no Discord aparece com o título em negrito, o corpo em texto e o link do
  registro clicável, sem card de preview.
- O Perfil oferece "Discord" no seletor de integração, com rótulo em pt-BR e ícone próprio.
- **Cinco canais registrados, e o `NotificationsDispatcherService` continua sem um único `if` por
  canal.**

## What We're NOT Doing

- **Embed rico** (`{ embeds: [{ title, description, url, color }] }`) — decidido: dá um card mais
  bonito e link mascarado garantido, mas é um segundo formato de payload para manter, com mais
  superfície que todo o resto desta spec somado. `{ content }` com markdown resolve o caso de uso.
  Se a leitura no Discord incomodar, é dívida registrada, não replanejamento.
- **Link mascarado `[Abrir no CRM](url)`** — decidido: o suporte fora de embeds é contestado entre
  as fontes, e quando não funciona o usuário vê os colchetes crus na mensagem. A URL entre `<>` é
  clicável em qualquer contexto e suprime o preview. Trocar depois é uma linha.
- **Restringir a URL ao host do Discord** — decidido: o fluxo de `verified` + SSRF + permissão já é
  a trava, e exigir `discord.com` fecharia proxy legítimo (quem roda um relay próprio). O `kind`
  aqui declara **formato de payload**, não domínio de destino.
- **Honrar o `Retry-After` do 429.** O Discord limita webhook por janela curta; o backoff do outbox
  é fixo (`[1, 5, 30, 120, 480]` minutos) e ignora o cabeçalho. A primeira retentativa em +1min já
  cobre uma janela por minuto, então o comportamento atual é aceitável. Backoff que lê `Retry-After`
  é melhoria transversal do dispatcher (valeria para os três canais HTTP), não desta spec.
- **`username`/`avatar_url` no payload** (o Discord permite sobrescrever o nome e o avatar do
  webhook por mensagem) — é personalização, não função. Fora de escopo.
- **Provisionar destino `DISCORD` por padrão** — como `WEBHOOK` e `SLACK`, ele é sempre criado à
  mão pelo usuário. `provisionarPadraoPeloSistema` continua só com `IN_APP` e `EMAIL`.

---

## Fase 1: Canal `DISCORD` na API

### Goal

O canal registrado, entregando de verdade, com o `kind` novo aceito na rota de integração.

### Changes

#### Modelo de dados

**Modify**: `apps/api/prisma/schema.prisma`

Um valor no enum existente (bloco `--- notificações (Fase 9) ---`):

```prisma
enum NotificationChannelKind {
  IN_APP
  EMAIL
  WEBHOOK
  SLACK
  DISCORD
}
```

**Create**: `apps/api/prisma/migrations/20260802100000_notification_discord/migration.sql`

Timestamp na sequência (a última é `20260801100000_notification_trigger_indexes`), escrito à mão,
como todas desde `20260724040000`.

```sql
-- Canal DISCORD: um valor novo no enum de destino.
--
-- Notas de projeto:
--  * `ALTER TYPE ... ADD VALUE` roda dentro de transação no PG 12+ desde que o
--    valor novo não seja USADO na mesma transação. Aqui só é declarado — quem
--    usa é o app, depois do deploy.
--  * NÃO TEM ROLLBACK: valor de enum não se remove no Postgres. É aditivo e
--    inofensivo (nenhuma linha usa 'DISCORD' antes de existir um destino), mas é
--    o único passo irreversível desta mudança — o mesmo caso do 'ACTIVITY' em
--    20260731100000_notifications.
--  * Nenhuma tabela, índice ou policy muda: o destino Discord é uma LINHA em
--    UserNotificationTarget, que já tem RLS.
--  * Roda como crm_user (superuser), que bypassa RLS.

ALTER TYPE "NotificationChannelKind" ADD VALUE 'DISCORD';
```

> **Portão obrigatório** ([apps/api/CLAUDE.md](../../apps/api/CLAUDE.md) → "Migration é validada com
> dado dentro"): rodar
> `DATABASE_URL=postgresql://crm_user:crm_password@localhost:5435/crm_db apps/api/scripts/validar-migrations-com-dados.sh`
> antes de abrir o PR. **Não** é preciso invariante nova em `invariantes.sql`: a migration não faz
> backfill nem troca constraint, e a invariante de RLS/policy das três tabelas de notificação
> (acrescentada na Fase 9) já cobre o que poderia quebrar.

#### O adapter

**Create**: `apps/api/src/modules/notifications/infra/discord.channel.ts`

Molde exato do [slack.channel.ts](../../apps/api/src/modules/notifications/infra/slack.channel.ts):
mesmo transporte (`postar`), `ConfigService` para o host público, corpo próprio.

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NotificationChannelKind } from '@prisma/client';
import type {
  CanalDeNotificacao,
  ConteudoDeNotificacao,
  DestinoDeNotificacao,
} from '../domain/notification-channel';
import { postar } from './webhook.channel';

/**
 * Teto do `content` no Discord (doc oficial). Truncar é defensivo: o nosso texto
 * é curto, mas `corpo` interpola nome de cliente, que é entrada do usuário — e um
 * 400 por corpo grande queimaria as seis tentativas do outbox de graça.
 */
export const MAX_CONTENT = 2000;

/**
 * Escape do markdown do Discord. São caracteres DIFERENTES dos do Slack (que
 * pede `&`, `<`, `>`): aqui o que causa formatação acidental é `* _ ~ | ` \`.
 * A barra invertida vem primeiro, senão escaparíamos as barras que acabamos de
 * inserir.
 */
export function escaparMarkdown(texto: string): string {
  return texto.replace(/([\\*_~`|])/g, '\\$1');
}

/**
 * Canal do Discord. Mesmo transporte do webhook genérico — o que muda é **só o
 * formato do corpo**, que é exatamente o ponto da terceira costura da Fase 9.
 *
 * Existe separado do `WebhookChannel` pela mesma razão do `SlackChannel`: o
 * Discord quer `{ content }` e ignora corpo arbitrário, então um canal genérico
 * apontado para cá não renderiza nada.
 *
 * O link vai **entre `< >`**: assim ele é clicável e o Discord não tenta montar
 * card de preview (que aqui seria inútil — a URL do CRM exige sessão). Link
 * mascarado `[label](url)` foi avaliado e recusado: o suporte fora de embeds é
 * contestado, e quando falha o usuário vê os colchetes crus.
 */
@Injectable()
export class DiscordChannel implements CanalDeNotificacao {
  readonly kind: NotificationChannelKind = 'DISCORD';

  constructor(private readonly config: ConfigService) {}

  /** Não depende de config de ambiente: a URL vem do destino do usuário. */
  isEnabled(): boolean {
    return true;
  }

  async entregar(
    destino: DestinoDeNotificacao,
    conteudo: ConteudoDeNotificacao,
  ): Promise<void> {
    const { url } = destino.config as { url?: string };
    if (!url) throw new Error('Destino do Discord sem URL configurada.');

    const linhas = [
      `**${escaparMarkdown(conteudo.titulo)}**`,
      escaparMarkdown(conteudo.corpo),
    ];
    // O `link` vem relativo do core (é ele que não conhece o host público) — o
    // adapter prefixa, como o template de e-mail e o canal do Slack já fazem.
    const appUrl = (this.config.get<string>('FRONTEND_URL') ?? '').replace(
      /\/+$/,
      '',
    );
    if (conteudo.link && appUrl) {
      linhas.push(`<${appUrl}${conteudo.link}>`);
    }

    await postar(
      url,
      { content: linhas.join('\n').slice(0, MAX_CONTENT) },
      conteudo.deliveryId,
    );
  }
}
```

> **Nota para o /code — não "conserte" o `postar()`.** O Discord responde **204** no sucesso, e
> `postar()` testa `resposta.ok`, que é `true` para 204. Nenhum ajuste é necessário no transporte.

#### Registro no módulo

**Modify**: [apps/api/src/modules/notifications/notifications.module.ts](../../apps/api/src/modules/notifications/notifications.module.ts)

O import, uma entrada em `providers` e uma no `inject`. **É a prova do contrato**: canal novo, um
arquivo, uma linha.

```ts
import { SlackChannel } from './infra/slack.channel';
import { DiscordChannel } from './infra/discord.channel';
```

```ts
    InAppChannel,
    EmailChannel,
    WebhookChannel,
    SlackChannel,
    DiscordChannel,
    {
      provide: NOTIFICATION_CHANNELS,
      useFactory: (...canais: CanalDeNotificacao[]) => canais,
      inject: [
        InAppChannel,
        EmailChannel,
        WebhookChannel,
        SlackChannel,
        DiscordChannel,
      ],
    },
```

#### A rota de integração aceita o `kind` novo

**Modify**: [apps/api/src/modules/notifications/api/dto/create-webhook-target.dto.ts:27-30](../../apps/api/src/modules/notifications/api/dto/create-webhook-target.dto.ts#L27-L30)

```ts
  @IsIn(['WEBHOOK', 'SLACK', 'DISCORD'], {
    message: 'O tipo de integração deve ser WEBHOOK, SLACK ou DISCORD.',
  })
  kind!: 'WEBHOOK' | 'SLACK' | 'DISCORD';
```

**Nada mais na API muda.** `NotificationTargetsService.criarIntegracao` já grava
`kind: dto.kind` e `config: { url }`, já chama `validarUrlDeWebhook`, e já nasce
`verified: false`/`active: false`. `verificar()` e `resumirConfig` já tratam o kind novo pelo ramo
correto (ver Current State) — **não os altere**.

#### Testes

**Create**: `apps/api/src/modules/notifications/infra/discord.channel.spec.ts`

Molde de [slack.channel.spec.ts](../../apps/api/src/modules/notifications/infra/slack.channel.spec.ts):
mock de `global.fetch` (a fronteira externa), restaurado no `afterAll`. Títulos de `it()` em pt-BR.
Casos:

- posta em `{ content }` (**não** `{ text }` — é o erro que faria a mensagem chegar vazia), com o
  título entre `**` e o link entre `<>` já absoluto;
- **204 é sucesso, não falha** — é o caso que prova que o transporte compartilhado serve ao Discord
  (`fetch` devolvendo `{ ok: true, status: 204 }` não deve rejeitar);
- manda o `X-CRM-Delivery`, que é o que permite deduplicar no retry;
- rejeita fora da faixa 2xx, com o status na mensagem;
- **a URL do destino nunca entra na mensagem de erro** (ela é a credencial);
- rejeita destino sem URL configurada, sem chamar o `fetch`;
- sem `link` no conteúdo, a mensagem sai com duas linhas e nenhum `<>`;
- `content` maior que 2000 é truncado em 2000.

E de `escaparMarkdown`, unitário puro:
- escapa `* _ ~ | ` \`;
- a barra invertida é escapada **uma vez só** (não vira `\\\\`) — é o bug que a ordem do regex evita;
- não mexe em texto comum (acento, pontuação, `#`, `@`).

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api exec prisma validate` — o schema é válido
- [x] `pnpm --filter api exec prisma migrate deploy && pnpm --filter api exec prisma generate` — a
      migration aplica e o client regenerado expõe `'DISCORD'` no tipo (**não** `db:reset`: banco não
      é resetado neste projeto)
- [x] `DATABASE_URL=postgresql://crm_user:crm_password@localhost:5435/crm_db apps/api/scripts/validar-migrations-com-dados.sh`
      — a migration aplica sobre banco populado e as invariantes seguem válidas
- [x] `pnpm --filter api test` — o spec novo passa e os 396 existentes continuam verdes (407 no total)
- [x] `pnpm --filter api test:e2e` — a âncora de RLS continua em 18 (nenhuma tabela nova)
- [x] `pnpm --filter api lint` — sem erro novo (os 2 de `main.ts` são pré-existentes)
- [x] `pnpm --filter api build` — compila

#### Manual Verification
- [ ] Criar um webhook num servidor de Discord de teste e cadastrá-lo por
      `POST /notifications/targets/integrations` com `kind: 'DISCORD'` — responde `201` com
      `verified: false`, `active: false` e `configResumo: "discord.com"` (**só o host**)
- [ ] `POST /notifications/targets/:id/verify` — chega a mensagem de teste no canal e o destino passa
      a `verified: true`, `active: true`
- [ ] Atribuir um registro ao usuário e ver a notificação real chegar no canal, com o título em
      **negrito** e o link clicável **sem card de preview**
- [ ] `GET /notifications/targets` **não** devolve o caminho da URL de nenhum destino, só o host
- [ ] Colaborador **sem** `notificacao:integrar` recebe `403` em pt-BR ao criar destino Discord
- [ ] `https://127.0.0.1/x` e `http://discord.com/...` são recusados com a mensagem em pt-BR
- [ ] Nenhuma linha de log contém a URL do webhook, em nenhum nível
- [ ] Um nome de cliente com `*asterisco*` chega sem virar itálico na mensagem

**⏸ PAUSE**: Depois da verificação automatizada, parar para a confirmação humana antes da Fase 2.

---

## Fase 2: `DISCORD` na interface

### Goal

O usuário consegue cadastrar e gerenciar um destino Discord pelo Perfil, com texto em pt-BR.

### Changes

#### Rótulo do enum

**Modify**: [apps/web/src/lib/labels.ts](../../apps/web/src/lib/labels.ts) —
`NOTIFICATION_CHANNEL_KIND_LABELS`

Obrigatório pela regra de [apps/web/CLAUDE.md](../../apps/web/CLAUDE.md): valor novo de enum no
schema exige a tradução no mesmo PR, e nenhum identificador técnico aparece cru na tela.

```ts
export const NOTIFICATION_CHANNEL_KIND_LABELS = {
  IN_APP: 'Central de notificações',
  EMAIL: 'E-mail',
  WEBHOOK: 'Webhook',
  SLACK: 'Slack',
  DISCORD: 'Discord',
} as const;
```

#### Seletor e ícone

**Modify**: [apps/web/src/features/notificacoes/PreferenciasDeNotificacao.tsx](../../apps/web/src/features/notificacoes/PreferenciasDeNotificacao.tsx)

Duas linhas, em dois mapas:

```ts
// :41 — o Record é tipado por NotificationChannelKind, então o `tsc` COBRA esta
// entrada assim que o enum ganha o valor. Sem ela o build quebra — é a rede de
// segurança que garante que nenhum kind chega à tela sem ícone.
const ICONE: Record<NotificationChannelKind, typeof Bell> = {
  IN_APP: Bell,
  EMAIL: Mail,
  WEBHOOK: Webhook,
  SLACK: Webhook,
  DISCORD: MessageCircle,
};
```

```ts
// :339 — o que o seletor de "Nova integração" oferece.
const KIND_INTEGRACAO = {
  WEBHOOK: 'Webhook',
  SLACK: 'Slack',
  DISCORD: 'Discord',
} as const;
```

O import do ícone entra no bloco do `lucide-react` já existente na linha 3 — **`MessageCircle` está
confirmado como export do `lucide-react@1.25.0` que o projeto tem instalado**:

```ts
import { Bell, Mail, MessageCircle, Plus, Trash2, Webhook } from 'lucide-react';
```

`KindIntegracao` é derivado de `keyof typeof KIND_INTEGRACAO`, então o `Select` passa a oferecer três
opções **sem mais nenhuma mudança** — nem no JSX, nem no handler.

#### Tipo do corpo da requisição

**Modify**: [apps/web/src/features/notificacoes/api/types.ts](../../apps/web/src/features/notificacoes/api/types.ts)
— `CriarIntegracaoBody`

```ts
export interface CriarIntegracaoBody {
  label: string;
  kind: 'WEBHOOK' | 'SLACK' | 'DISCORD';
  url: string;
  types?: NotificationType[];
}
```

`NotificationChannelKind` do front deriva de `NOTIFICATION_CHANNEL_KIND_LABELS`, então ele já ganha
`'DISCORD'` sozinho — só a união estreita de `CriarIntegracaoBody` precisa acompanhar.

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter web build` — `tsc -b` + build de produção, sem erro (se o `ICONE` não tiver a
      entrada nova, é aqui que aparece)
- [x] `pnpm --filter web lint` — oxlint sem erro novo

#### Manual Verification
- [ ] "Nova integração" oferece **três** opções: Webhook, Slack, Discord
- [ ] Cadastrar um Discord mostra o cartão com o rótulo "Discord", o ícone próprio, o badge "Não
      verificado" e o botão "Testar e ativar"
- [ ] Depois de verificar, o cartão fica ativo e a matriz dos seis tipos é editável
- [ ] Desmarcar um tipo no destino Discord para de entregar **só** aquele tipo, e só nele
- [ ] O resumo da config mostra `discord.com`, nunca o caminho com o token
- [ ] Colaborador sem `notificacao:integrar` **não** vê o botão "Nova integração"
- [ ] Tema claro e escuro, e nenhum identificador de enum cru na tela

**⏸ PAUSE**: Confirmação humana final. Depois, o commit `docs()` de fechamento e a marcação deste
plano como `implemented`.

---

## Testing Strategy

### Unit Tests

- **`DiscordChannel`** — instanciação direta, `global.fetch` mockado e restaurado. Os dois casos que
  mais importam são **`{ content }` e não `{ text }`** (copiar do Slack e esquecer de trocar a chave
  é o erro provável, e ele passa silenciosamente: o Discord aceita a requisição e não renderiza
  nada) e **204 como sucesso**.
- **`escaparMarkdown`** — unitário puro, com o caso da barra invertida (ordem do regex).
- **Nenhum spec de repositório novo** — não há consulta nova; o kind entra pela linha que
  `criarIntegracao` já grava.
- **Não mexer** nos specs de `NotificationsDispatcherService` nem de
  `NotificationTargetsService`: se o canal novo exigisse mudança neles, o registry teria falhado. Um
  diff ali é sinal de que algo saiu do desenho.

### Integration Tests

- Nada entra no `rls.e2e-spec.ts`: **nenhuma tabela nova**, e a âncora de policies continua em 18.
- Nada entra no `auth.e2e-spec.ts`: nenhuma rota nova, nenhuma rota `@Public()`.
- As duas rotas tocadas já existem e já são cobertas pelo caminho autenticado.

### Migration & Rollback

- Uma migration, aplicada por `prisma migrate deploy` no entrypoint do container (que já aborta o
  start quando falha — `app.migracao_falhou`).
- **Sem backfill**: nenhuma linha existente usa o valor novo.
- **`ALTER TYPE ... ADD VALUE` não tem rollback** em Postgres — valor de enum não se remove. É o
  único passo irreversível, e é inofensivo: um enum com um valor que nada usa não afeta consulta
  nenhuma. Mesmo caso do `ACTIVITY` na Fase 9.
- **Rollback de código**: voltar a imagem anterior basta. Um destino `DISCORD` já cadastrado passa a
  cair no ramo "canal não registrado" do dispatcher, que marca a entrega como `SKIPPED` com
  `'Canal não registrado.'` — **não** como falha, e sem retry. Degrada limpo por desenho.
- **Ordem entre as fases**: a Fase 1 precisa estar em produção antes da 2 — o front ofereceria um
  `kind` que o banco recusaria.

## Environment Considerations

- **CI/CD**: nenhum passo novo. O portão `validar-migrations-com-dados.sh` já roda a cada push que
  toca a API e passa a cobrir esta migration automaticamente.
- **Config/Secrets**: **nenhuma variável nova**. `FRONTEND_URL` já é obrigatório
  ([env.validation.ts:14](../../apps/api/src/config/env.validation.ts#L14)); a URL do webhook é dado
  do usuário, guardado na `config` do destino.
- **Multi-environment**: sem diferença entre dev e produção. O canal não depende de SMTP nem de
  serviço externo configurado pelo operador — o `isEnabled()` é sempre `true`, porque a URL vem do
  destino.
- **Cron**: nenhuma rotina nova. O `NotificationsDispatchJob` de minuto em minuto já entrega este
  canal pelo registry.

## Dependencies & Risks

- **Nenhuma dependência nova.** `fetch` é global no Node 18+, `AbortSignal.timeout` já é usado pelo
  transporte compartilhado.
- **Copiar o Slack e esquecer de trocar `text` por `content`** é o risco real desta spec, e ele
  **falha em silêncio**: o Discord responde 2xx e não mostra mensagem. Coberto por teste explícito.
- **Rate limit do Discord (429).** Webhook tem janela curta por canal. O backoff fixo do outbox não
  lê `Retry-After`; a primeira retentativa em +1min cobre uma janela por minuto. Se virar problema
  de verdade, a correção é no dispatcher e vale para os três canais HTTP — não neste adapter.
- **A URL é a credencial**, sem assinatura nem segredo separado (decisão **D4** da Fase 9). Vale
  igual aqui: quem tiver a URL escreve no canal. HMAC é Fase 19.
- **Erosão do registry.** O risco de longo prazo não é este canal, é o próximo: alguém acrescentar um
  `if (kind === 'DISCORD')` fora do `Map` do dispatcher e desfazer o contrato. O comentário do módulo
  proíbe explicitamente e o teste do dispatcher cobre o caminho genérico.

## References

- Spec da fase que criou o registry: [specs/plans/2026-07-27-fase-9-notificacoes-e-lembretes.md](./2026-07-27-fase-9-notificacoes-e-lembretes.md)
- PRD da Fase 9 (decisões **D1**–**D4**, que valem aqui): [specs/research/2026-07-27-fase-9-notificacoes-e-lembretes.md](../research/2026-07-27-fase-9-notificacoes-e-lembretes.md)
- Molde do adapter: [apps/api/src/modules/notifications/infra/slack.channel.ts](../../apps/api/src/modules/notifications/infra/slack.channel.ts)
- Transporte compartilhado: [apps/api/src/modules/notifications/infra/webhook.channel.ts](../../apps/api/src/modules/notifications/infra/webhook.channel.ts)
- Regras obrigatórias: [apps/api/CLAUDE.md](../../apps/api/CLAUDE.md) · [apps/web/CLAUDE.md](../../apps/web/CLAUDE.md)
- Doc externa: [Execute Webhook — Discord Developer Docs](https://docs.discord.com/developers/resources/webhook)
- Distinção com a Fase 19 (webhook **do owner**): [ROADMAP.md](../../ROADMAP.md)
