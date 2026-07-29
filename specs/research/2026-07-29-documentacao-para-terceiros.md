---
date: 2026-07-29T10:18:23-03:00
researcher: claude
git_commit: bda3d6e0e5d37ca29db008749914c39792760fb1
branch: main
topic: "Documentação e instruções de uso para terceiros"
tags: [research, docs, open-source, marca, legal, onboarding, integracoes]
status: complete
---

# Research: Documentação e instruções de uso para terceiros

## Research Question

Mapear os principais pontos que precisam de documentação ou instrução de uso para
que o CRM seja utilizável por terceiros — quem sobe a própria instância, quem usa
o produto no dia a dia e quem integra ou contribui com código.

## Summary

A documentação **de instalação** está acima da média de projeto open source: o
[README](../../README.md) leva do clone ao login com tabela de problemas comuns, e
[docs/autohospedagem.md](../../docs/autohospedagem.md) cobre requisitos,
topologia, operação, backup, atualização e segurança em 304 linhas. Não é aí que
está o gargalo.

O gargalo é triplo:

1. **Dois bloqueios legais/de marca.** A licença exige que um fork use identidade
   própria, mas não existe guia de rebranding — e há 38 ocorrências de
   "ProgrameAi" no código, em pontos não óbvios (templates de e-mail, canal de
   webhook, DTO de intake, assets raster). Pior: os documentos legais públicos da
   instância são renderizados a partir da razão social, CNPJ, endereço, foro e DPO
   da PROGRAMEAI LTDA. Quem sobe a instância hoje publica os Termos e a Política
   de Privacidade de outra empresa como se fossem os seus.
2. **Documentação de uso do produto: cobertura zero.** 22 features no front, 23
   módulos na API, nenhum documento voltado a quem opera o CRM. `SPEC.md` e
   `ROADMAP.md` são internos e não cumprem esse papel.
3. **Integração externa documentada só para consumo interno.** A ingestão de lead
   e as chaves de integração existem apenas no `ENDPOINTS.md`, que se declara
   "consumível por IA". Sem OpenAPI, sem exemplo de curl, sem ciclo de vida da
   credencial em prosa.

Somado a isso, não há CHANGELOG nem tag de versão: quem autohospeda atualiza com
`git pull` sem saber o que mudou nem se alguma migration é destrutiva.

## Estado atual — o que já está coberto

| Documento | Linhas | Papel |
|---|---|---|
| [README.md](../../README.md) | 256 | Vitrine + setup de dev + resumo de autohospedagem |
| [docs/autohospedagem.md](../../docs/autohospedagem.md) | 304 | Subir instância própria numa VPS (start aqui) |
| [docs/deploy.md](../../docs/deploy.md) | 295 | Deploy do mantenedor (Traefik, secrets, rollback) |
| [docs/observabilidade.md](../../docs/observabilidade.md) | 294 | Log estruturado, consultas, `x-request-id` |
| [docs/billing-stripe.md](../../docs/billing-stripe.md) | 197 | Assinatura via Stripe (opcional) |
| [apps/api/ENDPOINTS.md](../../apps/api/ENDPOINTS.md) | 1383 | Referência de rotas — declaradamente para IA |
| [CLAUDE.md](../../CLAUDE.md) + os dois de app | 4,0k + 145 + 98 | Regras de arquitetura (normativas) |
| [CONTRIBUTING.md](../../CONTRIBUTING.md) | 55 | Fluxo de contribuição |
| [.github/](../../.github/) | — | Código de conduta, SECURITY, templates de issue/PR |
| [scripts/](../../scripts/) | — | `gerar-env-autohospedagem.sh`, `backup-postgres.sh`, `cor-da-marca.mjs` |

## Lacuna 1 — Rebranding obrigatório sem guia

[NOTICE](../../NOTICE) e o README declaram que o nome, o logo e a identidade
visual (teal `#0E7C7B`) **não** são licenciados, e que forks devem usar identidade
própria. Não existe documento explicando como.

`grep -ro "ProgrameAi" apps/web/src apps/api/src` → 38 ocorrências, em quatro
grupos:

| Grupo | Arquivos |
|---|---|
| **Marca na UI** | `apps/web/src/components/ui/brand-lockup.tsx`, `wordmark.tsx`, `apps/web/src/features/auth/AuthLayout.tsx` |
| **Tokens de cor** | `apps/web/src/index.css` (`--primary` e variantes) |
| **E-mail** | 8 arquivos em `apps/api/src/mail/templates/` — `brand.ts`, `layout.ts`, `password-reset`, `collaborator-invite`, `digest`, `notification`, `account-deletion-scheduled` (+ specs) |
| **Diversos** | `apps/api/src/modules/notifications/infra/webhook.channel.ts`, `apps/web/src/features/billing/PaywallPage.tsx`, `apps/api/src/modules/leads/api/dto/intake-lead.dto.ts`, `apps/web/src/features/legal/company.ts` |

Assets fora do grep: `apps/web/public/marca/` (símbolo raster) e
`apps/web/public/favicon.svg` — ambos citados como obrigação conjunta em
`apps/web/CLAUDE.md`.

Existe [scripts/cor-da-marca.mjs](../../scripts/cor-da-marca.mjs), que resolve a
parte difícil da cor (deriva duas variantes da matiz com contraste WCAG conferido
e imprime os blocos para colar em quatro lugares). Ele cobre **só a cor** e não é
citado em nenhum documento voltado a terceiros.

**Falta:** `docs/personalizar-marca.md` — o que a licença exige, os quatro grupos
acima, os assets raster, e o `cor-da-marca.mjs` como ferramenta.

## Lacuna 2 — Documentos legais com dados do mantenedor

[apps/web/src/features/legal/company.ts](../../apps/web/src/features/legal/company.ts)
é a fonte única de `TermosPage` e `PrivacidadePage`, e contém: nome comercial,
razão social, CNPJ, endereço completo, sócio-administrador, foro eleito, e-mail de
contato, encarregado de dados (LGPD art. 41), domínio, preço vigente do plano e
duração do teste.

São páginas **públicas** da instância. Um terceiro que suba o CRM e não edite esse
arquivo publica os Termos de Uso e a Política de Privacidade da PROGRAMEAI LTDA,
com CNPJ e DPO que não são dele — risco jurídico concreto, não cosmético.

Duas saídas possíveis (decisão de produto, não resolvida aqui):

- **Mínimo:** documentar como passo obrigatório do checklist de autohospedagem,
  antes de expor a instância à internet.
- **Melhor:** tornar os dados configuráveis por variável de ambiente, com as
  páginas legais se desativando (ou exibindo aviso) enquanto não preenchidas.

## Lacuna 3 — Uso do produto (maior volume, cobertura zero)

Superfícies existentes hoje, sem nenhuma documentação de uso:

**Front — 22 features** (`apps/web/src/features/`): administracao, atividades,
auditoria, auth, billing, catalogos, clientes, configuracoes, conta, dados,
dashboard, demandas, financeiro, integracoes, legal, lixeira, notificacoes,
organizacao, perfil, pipeline, propostas.

**API — 23 módulos** (`apps/api/src/modules/`): access, account, activities,
audit, auth, billing, catalogos, clients, collaborators, contacts, dashboard,
data, finance, health, integracoes, leads, notifications, pipeline, projects,
proposals, trash, users, workspace.

Ordem de valor para documentar:

1. **Primeiros passos do owner** — criar conta, configurar catálogos e estágios do
   pipeline, convidar colaborador, cadastrar o primeiro cliente. É o que decide se
   a pessoa continua ou abandona.
2. **O fluxo ponta a ponta** — lead → oportunidade → proposta → aceite → contrato
   → mensalidades → projeto/demandas. É a tese do produto ("a oportunidade entra
   e vira receita no mesmo lugar") e não está escrita em nenhum lugar que o
   usuário leia.
3. **Papéis e permissões** — o catálogo existe em `GET /permissions` e em
   `apps/api/src/shared/permissions.ts`, mas nada explica ao owner o que cada
   chave libera nem como desenhar um papel. Navegação e rotas são filtradas por
   essas chaves (`apps/web/src/app/nav.ts`, `PermissionRoute.tsx`), então
   permissão errada se manifesta como "menu que não aparece" — dúvida de suporte
   garantida.
4. **Importação e exportação** — `apps/web/src/features/dados/ImportacaoPage.tsx`
   aceita CSV/XLSX (`csv-parse`, `read-excel-file`, `write-excel-file`). Faltam
   colunas esperadas, regra de deduplicação e planilha modelo.
5. **Notificações, lembretes e digest** — incluindo o canal de webhook
   (Discord): o que dispara cada notificação e como configurar.
6. **Lixeira, auditoria, sessões e exclusão de conta (LGPD)** — comportamento,
   prazos e o que é recuperável.
7. **Canais de captação** — a tela que emite a chave de integração; ver Lacuna 4.

## Lacuna 4 — Integração externa

`POST /leads/intake` materializa lead capturado fora do CRM. A autenticação é por
**chave de integração** (`Authorization: Bearer crm_…`, escopo `lead:receber`),
emitida junto de um canal de captação em `POST /leads/canais`; a workspace, o
responsável e a fonte do lead vêm da chave, nunca do corpo. A chave bruta existe
**uma única vez**, na resposta que a emitiu — quem perde, rotaciona
(`POST /integracoes/chaves/:id/rotacionar`).

Tudo isso está documentado com precisão em `ENDPOINTS.md` (seções "Leads",
"Canais de captação de lead", "Integrações") — um arquivo que se apresenta como
"referência consumível por IA" e é fonte de verdade viva do time, não guia de
integrador.

**Falta:** `docs/integracoes.md` com exemplo de curl ponta a ponta, ciclo de vida
da credencial (emitir → usar → rotacionar → revogar), a distinção
escopo-de-máquina × permissão-de-pessoa, e o aviso sobre o caminho legado
`LEAD_INTAKE_TOKEN` + `LEAD_INTAKE_OWNER_EMAIL`, que o próprio ENDPOINTS.md
declara em transição (observável no log como `lead.token_legado_aceito`).

**Falta também:** contrato de máquina (OpenAPI/Swagger). Hoje não há nenhum.

## Lacuna 5 — Ciclo de release

`git tag` está vazio; não existe `CHANGELOG.md`. A instrução de atualização em
autohospedagem.md é `git pull && docker compose up -d --build`, com migrations
aplicadas automaticamente pelo entrypoint da API. O documento manda tirar backup
antes ("migration não tem botão de desfazer"), o que é correto — mas sem nota de
versão o operador não tem como saber o que muda, nem distinguir uma correção de
segurança de um refactor.

**Falta:** `CHANGELOG.md` + convenção mínima de tag/release, e uma linha no
autohospedagem.md apontando para ele antes do `git pull`.

## Lacuna 6 — Onboarding de contribuidor

`CLAUDE.md` (raiz + dois de app) é excelente como **norma** — o que é proibido,
qual fronteira não atravessar — mas não como **mapa**: um contribuidor novo não
encontra "onde fica o quê" nem "como adiciono um módulo do zero".

**Falta:** `docs/arquitetura.md` curto — desenho das camadas, um passo a passo de
módulo novo no backend e de feature nova no front, e como rodar a suíte completa
(`test`, `test:e2e` com o banco `crm_test`, mais o que o `build.yml` do CI exige).

## Correções pontuais

| Onde | Problema |
|---|---|
| [CONTRIBUTING.md](../../CONTRIBUTING.md) linha 11 | Aponta para `README.md#setup-de-desenvolvimento`; a âncora não existe (a seção hoje é "Começando"). Link quebrado. |
| [apps/api/.env.example](../../apps/api/.env.example) | Falta `LEAD_INTAKE_TOKEN` e `LEAD_INTAKE_OWNER_EMAIL`, presentes em `env.validation.ts`, `.env.example` e `.env.selfhost.example`. |
| Variáveis de ambiente | Espalhadas em 4 arquivos (`.env.example`, `.env.selfhost.example`, `apps/api/.env.example`, `apps/web/.env.example`) sem índice único. Vale uma tabela de referência em `docs/`. |

## Prioridade sugerida

1. **Marca + legais** (Lacunas 1 e 2) — destrava o uso por terceiros de fato.
2. **Uso do produto** (Lacuna 3) — maior volume, cobertura hoje zero.
3. **Integração** (Lacuna 4) e **CHANGELOG** (Lacuna 5).
4. **Arquitetura para contribuidor** (Lacuna 6) e correções pontuais.

> Decisão do usuário em 29/07/2026: começar pela **Lacuna 3** (docs de uso do
> produto), pelos itens 1 e 2 da ordem de valor.

## Perguntas abertas

- `company.ts` vira configurável por ambiente ou continua editável no código com
  instrução explícita?
- Os docs de uso ficam no repositório (`docs/uso/`) ou viram site/ajuda
  in-app? O repositório é o caminho mais barato e versionado junto do código.
- O `ENDPOINTS.md` continua sendo a única referência de rotas, com o
  `docs/integracoes.md` cobrindo só o recorte de integrador, ou vale gerar
  OpenAPI a partir dos DTOs?
