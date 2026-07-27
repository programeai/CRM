# Roadmap — CRM ProgrameAi

> Documento **vivo**: atualize o status e os checkboxes a cada avanço. Fonte de escopo: [SPEC.md](SPEC.md) §7.
> Convenção de status: ✅ concluída · 🚧 em andamento · 🔜 próxima · ⬜ não iniciada · ⏸️ adiada.
> Fases recortadas trazem o número do recorte no status (ex.: `13-A`) — ver [Trilha de produção](#trilha-de-produção--revisão-de-2026-07-27).
> Convenção de prioridade (fases 7+): **P0** defeito que já doe · **P1** ausência que limita uso profissional ·
> **P2** evolução de produto · **P3** plataforma e governança.
>
> **Última atualização:** 2026-07-27

## Visão

CRM enxuto para agência/dev full stack (software sob medida, sites, tráfego pago), centrado em
quatro pilares: **Clientes**, **Propostas**, **Demandas** e **Financeiro**. Uma instância atende
vários owners, isolados por `ownerId` (RLS no banco), cada um com seus colaboradores e assinatura.
Interface 100% pt-BR; código/tabelas/endpoints em inglês.

## Panorama das fases

| Fase | Entrega | Status | Spec |
|---|---|---|---|
| 0 | Fundação (monorepo, infra, auth, layout base) | ✅ concluída | [research](specs/research/2026-07-20-fase-0-fundacao.md) · [plan](specs/plans/2026-07-20-fase-0-fundacao.md) |
| 1 | Clientes (CRUD clientes + contatos, timeline, follow-ups) | ✅ concluída | [research](specs/research/2026-07-21-fase-1-clientes.md) · [plan](specs/plans/2026-07-21-fase-1-clientes.md) |
| 2 | Pipeline (estágios configuráveis, Kanban de oportunidades) | ✅ concluída | [research](specs/research/2026-07-21-fase-2-pipeline.md) · [plan](specs/plans/2026-07-21-fase-2-pipeline.md) |
| 3 | Propostas (itens, total, ciclo de status, versionamento, expiração) | ✅ concluída | [research](specs/research/2026-07-23-fase-3-propostas.md) · [plan](specs/plans/2026-07-23-fase-3-propostas.md) |
| 4 | Demandas (projetos, tarefas, Kanban por projeto, "Minhas demandas") | ✅ concluída | [research](specs/research/2026-07-23-fase-4-demandas.md) · [plan](specs/plans/2026-07-23-fase-4-demandas.md) |
| 5 | Financeiro (contratos, cobranças, agenda, baixa/estorno, crons) | ✅ concluída | [research](specs/research/2026-07-23-fase-5-financeiro.md) · [plan](specs/plans/2026-07-23-fase-5-financeiro.md) |
| 6 | Dashboard (métricas comerciais e financeiras, funil, polimento) | ✅ concluída | implementação direta |
| 7 | Base — funil por owner e responsável por registro (**P0**) | ✅ concluída | [research](specs/research/2026-07-26-fase-7-funil-por-owner-e-responsavel.md) · [plan A](specs/plans/2026-07-26-fase-7a-funil-por-owner.md) · [plan B](specs/plans/2026-07-26-fase-7b-responsavel-por-registro.md) |
| 8 | Governança — sessões, auditoria e lixeira (**P0**) | ✅ concluída | [research](specs/research/2026-07-26-fase-8-sessoes-auditoria-lixeira.md) · [plan A](specs/plans/2026-07-26-fase-8a-sessoes.md) · [plan B](specs/plans/2026-07-26-fase-8b-auditoria.md) · [plan C](specs/plans/2026-07-26-fase-8c-lixeira.md) |
| 9 | Notificações e lembretes (**P1**) | ✅ concluída | [plan](specs/plans/2026-07-27-fase-9-notificacoes-e-lembretes.md) |
| 10 | Relatórios e metas (**P1**) | ⏸️ adiada | a definir |
| 11 | Proposta que o cliente vê — PDF, link de aceite, envio (**P1**) | ⬜ não iniciada | a definir |
| 12 | Anexos e documentos (**P1**) | ⬜ não iniciada · **4º na trilha** | a definir |
| 13 | Extensibilidade do domínio — serviços e campos por owner (**P1**) | 🔜 **13-A é a próxima** · 13-B adiada | a definir |
| 14 | Dados — importação, exportação, busca global, duplicidade (**P1**) | ⬜ **14-A é o 2º** · 14-B 5º · 14-C adiada | a definir |
| 15 | Agenda e calendário (**P2**) | ⬜ não iniciada | a definir |
| 16 | Automações e templates (**P2**) | ⬜ não iniciada | a definir |
| 17 | Entrada de lead e comunicação (e-mail/WhatsApp) (**P2**) | ⬜ não iniciada | a definir |
| 18 | Financeiro completo — despesas, cobrança automática, NF (**P2**) | ⬜ não iniciada | a definir |
| 19 | Plataforma — API pública, 2FA, LGPD operacional (**P3**) | ⬜ **19-A é o 3º** · 19-B P3 | a definir |

Cada fase termina com o sistema **utilizável de ponta a ponta**.

As fases 0–6 entregaram o MVP; as fases 7+ são o caminho para o CRM cobrir o que se espera de um
CRM profissional. A ordem é a recomendada, não obrigatória — cada fase é independente das seguintes,
exceto onde indicado em "Depende de".

---

## Trilha de produção — revisão de 2026-07-27

**Decisão:** o objetivo imediato deixou de ser "avançar no roadmap" e passou a ser **abrir o produto a
usuários reais**. Com o autocadastro aberto em `crm.programeai.com.br`, quem se cadastra não é mais a
nossa agência — e o critério de prioridade muda: vale o que **impede alguém de usar o sistema**, não o
que o completa.

Sob esse critério, as fases 12–14 não entram inteiras. A maior parte de cada uma **não** é bloqueio de
produção, e as partes mais difíceis (campos customizados, mesclagem de clientes) são justamente as que
menos bloqueiam. Cada fase foi **recortada**: a letra **A** é o recorte de produção, as seguintes ficam
para depois. Os números das fases não mudaram — as specs e os links continuam válidos.

| Ordem | Recorte | Fase | Por quê |
|---|---|---|---|
| 1 | Catálogo de serviços, fontes de lead e motivos de perda por owner | **13-A** | único bloqueio absoluto: `ServiceType` é enum fechado no nosso mix de serviço |
| 2 | Importação CSV/XLSX de clientes e contatos + exportação das listagens | **14-A** | onboarding de base existente e fechamento de mês fora da tela |
| 3 | LGPD mínimo: excluir a própria conta, exportar meus dados | **19-A** | risco legal com dado de terceiro, não feature |
| 4 | Anexos e documentos | **12** | primeira infra externa (S3/MinIO); desbloqueia o logo da Fase 11 |
| 5 | Busca global + detecção de duplicidade | **14-B** | conveniência: cada listagem já tem `?search=` |

**Adiado explicitamente:** campos customizados (**13-B**), mesclagem de clientes e unicidade de
`document` (**14-C**), Fase 10 inteira (relatório é de quem já tem meses de dado) e o resto da Fase 19
(**19-B**: API pública, 2FA, consentimento).

> **Por que a Fase 12 desce para 4º**, mesmo sendo lacuna real: ninguém abandona o produto por não
> anexar arquivo — continua no Drive, como hoje. E é a única das três que pede **credencial e mudança
> de deploy**, justo na janela em que se quer estabilizar. Ela sobe de prioridade no momento em que a
> Fase 11 (proposta que o cliente vê) entrar, porque o logo do owner pressupõe upload.

> **Por que a mesclagem de clientes (14-C) é a última coisa a entrar:** é a única frente do P1 que
> **reescreve chave de registro financeiro** e não tem volta. Numa produção recém-aberta, o custo de
> errar é maior que o de conviver com duplicata.

**O que já está de pé e não é gargalo:** deploy com Traefik ([docs/deploy.md](docs/deploy.md)), backup
com `pg_dump` documentado, billing Stripe ([docs/billing-stripe.md](docs/billing-stripe.md)),
observabilidade ([docs/observabilidade.md](docs/observabilidade.md)), auditoria, sessões múltiplas e
lixeira. O gargalo é o **domínio ser fechado no nosso mix de serviço**.

---

## Fase 0 — Fundação ✅

Base técnica do projeto.

- [x] Monorepo pnpm (`apps/api` + `apps/web`) + `docker-compose` (Postgres 16, porta host **5435**)
- [x] NestJS + Prisma 6.19.3 + schema completo + migration `init`
- [x] Seed idempotente: admin (`admin@crm.local` / `changeme123`) + 7 estágios de pipeline
- [x] Auth: JWT access (15 min) + refresh (7 dias, cookie httpOnly), argon2, guard global, `@Public()`, throttler no login
- [x] Frontend base: Vite + Tailwind v4 + shadcn (Base UI) + React Router 7 + TanStack Query + axios com refresh automático
- [x] Layout protegido com sidebar/topbar, tela de login integrada, rotas placeholder

**Adaptações vs SPEC original:** Postgres na porta host 5435; shadcn sobre Base UI (não Radix); estrutura backend em `src/modules/<nome>/`.

---

## Fase 1 — Clientes ✅

CRUD de clientes e contatos, timeline de atividades e follow-ups. Ver [SPEC.md](SPEC.md) §3.1, §3.5, §5.

**Backend** (`apps/api/src/modules/`)
- [x] Módulo `clients`: `GET/POST /clients`, `GET/PATCH /clients/:id`, `POST /clients/:id/archive` (soft delete via `archivedAt`; sem DELETE)
- [x] Módulo `contacts`: `GET/POST /clients/:id/contacts`, `PATCH/DELETE /contacts/:id` (regra: único `isPrimary` por cliente)
- [x] Módulo `activities`: `GET/POST /activities`, `PATCH /activities/:id`, `POST /activities/:id/complete` (follow-up com `scheduledFor`/`completedAt`)
- [x] DTOs com class-validator em pt-BR; validação de CPF/CNPJ quando informado
- [x] Paginação `?page=&limit=` → `{ data, meta: { total, page, limit } }` (novo padrão do projeto)
- [x] `ownerId` derivado do usuário autenticado (`req.user.sub`)
- [x] Testes unitários dos services (arquivamento, contato principal, validação de documento)
- [x] Atualizar `apps/api/ENDPOINTS.md` (Definition of Done)

**Frontend** (`apps/web/src/features/clientes/`)
- [x] Listagem de clientes (Table + TableLink + Badge de status + filtros/busca)
- [x] Formulário de cadastro/edição (RHF + Zod pt-BR, Select para enums via `@/lib/labels`)
- [x] Ficha do cliente com sub-abas (Dados + Contatos + Timeline; demais abas placeholder)
- [x] CRUD de contatos na ficha
- [x] Timeline de atividades + registro de follow-ups + marcar como concluído
- [x] Primeiro padrão de TanStack Query (queryKeys, mutations, invalidação)
- [x] Helpers de formatação em `lib/` (CPF/CNPJ, telefone, datas)
- [x] Trocar `PlaceholderPage` das rotas `/clientes` e `/clientes/:id`

**Extras entregues além do plano:** autopreenchimento de endereço via ViaCEP (por CEP) e de dados
da empresa via BrasilAPI (ao completar o CNPJ), com máscaras controladas de CPF/CNPJ, telefone, CEP e UF.

**Decisões fechadas no `/spec`:** arquitetura em camadas (`api`/`application`/`domain`/`infra` com repository pattern) ·
campos de endereço adicionados ao schema · módulos `contacts`/`activities` separados · filtro por `ownerId` e
unicidade de documento. Ver [plano da Fase 1](specs/plans/2026-07-21-fase-1-clientes.md).

---

## Fase 2 — Pipeline ✅

Kanban de oportunidades, da captação ao fechamento. Ver [SPEC.md](SPEC.md) §3.2.

**Backend** (`apps/api/src/modules/pipeline/`)
- [x] Módulo `pipeline` (estágios + deals): `GET/POST /pipeline-stages`, `PATCH /pipeline-stages/reorder`, `PATCH/DELETE /pipeline-stages/:id`
- [x] Oportunidades (Deals): `GET/POST /deals`, `GET /deals/board` (sem paginação), `GET/PATCH/DELETE /deals/:id`, `PATCH /deals/:id/move` (stage + position, reindexação em `$transaction`)
- [x] Motivo da perda obrigatório (`422`) ao mover para estágio `isLost`; `stageMovedAt` atualizado a cada troca de estágio
- [x] Proteção contra exclusão de estágio com oportunidades vinculadas (`409`)
- [x] Posse derivada via `ClientsService` (`Deal`/`PipelineStage` não têm `ownerId`)
- [x] Testes unitários dos services (`pipeline-stages.service.spec.ts`, `deals.service.spec.ts`)
- [x] Atualizar `apps/api/ENDPOINTS.md` (Definition of Done)

**Frontend** (`apps/web/src/features/pipeline/`)
- [x] Kanban com drag & drop (`dnd-kit`) + optimistic update no cache do board (rollback em erro)
- [x] Diálogo de motivo de perda ao soltar em estágio "Perdeu"
- [x] Indicador "esfriando" derivado no client (> 7 dias parado em estágios não terminais)
- [x] Tela de configuração de estágios (criar/renomear/reordenar/excluir, marcar `isWon`/`isLost`)
- [x] Aba "Oportunidades" na ficha do cliente (lista + criação já vinculada ao cliente)
- [x] Trocar `PlaceholderPage` da rota `/pipeline`

**Deferido (fora do escopo desta fase):** criar Projeto automaticamente ao mover para "Ganhou" — fica
para a Fase 4 (Demandas), quando o módulo de Projetos existir. Ver [plano da Fase 2](specs/plans/2026-07-21-fase-2-pipeline.md).

---

## Fase 3 — Propostas ✅

Documento comercial com itens, versões e ciclo de status. Ver [SPEC.md](SPEC.md) §3.3.

- [x] CRUD: `GET/POST /proposals`, `GET/PATCH /proposals/:id`
- [x] Ações: `send`, `accept`, `reject`, `new-version`
- [x] Itens com cálculo de total **no backend** (desconto incluído); nunca float
- [x] Ciclo de status com transições validadas (422 em transição inválida)
- [x] Versionamento (v2, v3…); só a versão mais recente é editável
- [x] Expiração automática (cron `ProposalsExpirationJob`) ao passar `validUntil`
- [x] Proposta aceita sugere criar Projeto e Contrato

---

## Fase 4 — Demandas ✅

Organização do trabalho após a venda. Ver [SPEC.md](SPEC.md) §3.4.

- [x] Projetos: `GET/POST /projects`, `GET/PATCH /projects/:id`
- [x] Tarefas: `GET/POST /tasks` (filtros), `GET/PATCH/DELETE /tasks/:id`, `PATCH /tasks/:id/move`
- [x] Kanban por projeto (dnd-kit); checklist de subtarefas
- [x] Visão "Minhas demandas" cruzando projetos, com filtros (prioridade, prazo, cliente)
- [x] Destaque de demandas atrasadas

---

## Fase 5 — Financeiro ✅

Controle de receitas por contrato (3 regimes). Ver [SPEC.md](SPEC.md) §3.6. **Fase mais densa — testes de regra críticos.**

- [x] Contratos: `GET/POST /contracts`, `GET/PATCH /contracts/:id`, `pause`/`resume`/`cancel`
- [x] Regimes: mensalidade (`RECURRING`), entrada + parcelas (`INSTALLMENTS`), à vista (`ONE_TIME`)
- [x] Cobranças (Payments): `GET /payments`, `PATCH /payments/:id`, `pay`/`revert`/`cancel`
- [x] Geração de agenda de parcelas na criação do contrato
- [x] Cron diário (`FinanceBillingJob`): gera mensalidade 30 dias antes (idempotente) + marca `OVERDUE`
- [x] Agenda de recebimentos, contratos por cliente, visão de inadimplência
- [x] Baixa manual com valor/forma; estorno (nunca excluir cobrança paga)

---

## Fase 6 — Dashboard ✅

Métricas e polimento final. Ver [SPEC.md](SPEC.md) §3.7.

**Backend** (`apps/api/src/modules/dashboard/`)
- [x] `GET /dashboard/summary` + `GET /dashboard/finance` (só leitura; posse via `client.ownerId`)
- [x] Funil (oportunidades por estágio e valor em negociação)
- [x] Propostas em aberto, aceitas no mês, taxa de conversão (90 dias)
- [x] Demandas em andamento/atrasadas/próximas entregas (7 dias)
- [x] Próximas ações (follow-ups agendados)
- [x] Financeiro: MRR, previsto × recebido no mês, total em atraso, próximos vencimentos (7 dias)
- [x] Testes unitários do service (janelas de tempo em UTC, funil, taxa de conversão)
- [x] Atualizar `apps/api/ENDPOINTS.md` (Definition of Done)

**Frontend** (`apps/web/src/features/dashboard/`)
- [x] Página em seções (Comercial / Financeiro / Operação) com `StatCard` do design system
- [x] Funil em barras (sem lib de gráfico — tokens de tema) + listas de próximos itens clicáveis
- [x] Trocar `PlaceholderPage` da rota `/`

**Deferido:** seed de demonstração e polimento geral adicional ficam como refinamento futuro
(o dashboard já opera de ponta a ponta com os dados reais das fases 1–5).

---

## Entregue depois do MVP

- [x] **Multiusuário com papéis e permissões** — colaboradores por convite, papéis com permissões
      granulares e isolamento por owner (ver `specs/plans/2026-07-25-colaboradores-e-papeis.md`).

---

## Evolução pós-MVP — lacunas para cobrir um CRM profissional

Levantamento de 2026-07-26 sobre o código entregue (schema, `ENDPOINTS.md`, módulos da API e features
do web). Cada fase abaixo é uma lacuna **fechada em si mesma**, entregável isoladamente.

---

## Fase 7 — Base: funil por owner e responsável por registro ✅ **P0**

Dois defeitos estruturais que já afetavam o uso real: o funil não era isolado por owner e nenhum
registro tinha responsável — o que esvaziava o multiusuário entregue depois do MVP. A fase foi
partida em duas frentes independentes, **ambas entregues**.

**Frente A — Isolamento do funil** ✅ entregue ([plano](specs/plans/2026-07-26-fase-7a-funil-por-owner.md))
- [x] `PipelineStage` recebe `ownerId`
- [x] RLS em `PipelineStage` (`20260726120000_pipeline_stages_per_owner`)
- [x] Trocar `name @unique` global por `@@unique([ownerId, name])`
- [x] Migration de dados: replicar os estágios por owner existente e religar os `Deal`
- [x] Seed dos estágios padrão passa a rodar na criação da conta, não na instância

> **Por quê:** numa instância multi-owner, renomear/reordenar/excluir um estágio hoje afeta todos
> os owners. Funil configurável por owner é premissa de CRM, não feature.

**Frente B — Responsável por registro** ✅ entregue ([plano](specs/plans/2026-07-26-fase-7b-responsavel-por-registro.md))

- [x] `assigneeId` (FK → `User`, opcional, `ON DELETE SET NULL`) em `Deal`, `Task`, `Activity` e `Client` (`20260727100000_assignee_per_record`)
- [x] Atribuição na criação e edição, com troca de responsável e validação de pertencimento à workspace (`422`); filtro `?assigneeId=` nas listagens
- [x] "Minhas demandas" e o board do pipeline filtram por responsável (filtro do servidor, persistido na URL); `GET /workspace/members` alimenta o seletor
- [x] Permissões novas: `cliente:ver_todos`, `oportunidade:ver_todas` e `demanda:ver_todas` (catálogo em [`shared/permissions.ts`](apps/api/src/shared/permissions.ts)); sem elas, a pessoa vê apenas os seus registros e os sem responsável
- [x] Dashboard com corte por responsável (automático + alternador "Somente meus")

> **Por quê:** papéis definem *o que* alguém pode fazer, mas não existia *de quem* é o registro —
> sem carteira por vendedor, sem distribuição de lead, sem métrica por pessoa.

> **Fora do escopo, por decisão:** escopo por registro nas **escritas** (sem `:ver_todos`, editar
> um registro alheio continua permitido por `:gerenciar`), filtro "sem responsável", reatribuição
> automática ao desativar colaborador, e `assigneeId` em `Proposal`/`Project`/`Contract`/`Payment`.

---

## Fase 8 — Governança: sessões, auditoria e lixeira ✅ **P0**

Três lacunas de governança, cada uma entregável por si. A fase foi partida em três frentes
independentes, **todas entregues**.

**Frente A — Sessões múltiplas** ✅ entregue ([plano](specs/plans/2026-07-26-fase-8a-sessoes.md))
- [x] `User.refreshTokenHash` (valor único) dá lugar ao modelo `Session`, uma linha por dispositivo (`20260728100000_sessions`)
- [x] `sid` no payload do refresh token: validação por chave primária + um `argon2.verify`, independente do número de sessões
- [x] Device/IP/último uso registrados; `GET /auth/sessions`, `DELETE /auth/sessions/:id` e `DELETE /auth/sessions` (revogar todas)
- [x] Lista de sessões ativas no perfil ([`SessoesAtivas.tsx`](apps/web/src/features/perfil/SessoesAtivas.tsx)), com a sessão atual destacada

> **Por quê:** era uma sessão por usuário — logar no celular derrubava o desktop.

**Frente B — Trilha de auditoria** ✅ entregue ([plano](specs/plans/2026-07-26-fase-8b-auditoria.md))
- [x] Modelo `AuditLog` (owner, autor, entidade, ação, diff, timestamp) com RLS (`20260729100000_audit_log`)
- [x] Autor resolvido via CLS (o `AccessGuard` publica o `AccessContext`) — nenhuma assinatura de service mudou; gravação atômica na transação do `OwnerContextInterceptor`
- [x] Ações sensíveis instrumentadas: baixa/estorno/cancelamento de cobrança, edição de contrato, aceite/recusa de proposta, papéis e colaboradores, arquivamento e expurgo
- [x] Escritas sem ator humano na trilha: os dois crons diários, o webhook do Stripe e o aceite de convite
- [x] `GET /audit` e `GET /audit/entities/:entity/:id` sob permissão `auditoria:ver`
- [x] Tela de auditoria do owner ([`AuditoriaPage.tsx`](apps/web/src/features/auditoria/AuditoriaPage.tsx)) + histórico por registro ([`HistoricoDialog.tsx`](apps/web/src/features/auditoria/HistoricoDialog.tsx))

> **Por quê:** colaboradores mexem em dinheiro (`/payments/:id/pay`, `/revert`, `/cancel`) e nada
> registrava quem fez o quê.

**Frente C — Lixeira** ✅ entregue ([plano](specs/plans/2026-07-26-fase-8c-lixeira.md))
- [x] Soft delete (`archivedAt`) estendido a `Deal`, `Project`, `Task` e `Contact` — antes só `Client` tinha (`20260730100000_soft_delete_lixeira`)
- [x] Todas as leituras revisadas: listagens paginadas, os dois Kanban, "Minhas demandas", `_count.tasks`, agregações do dashboard e as travas de exclusão que contam filhos
- [x] `POST /<recurso>/:id/archive` e `/restore` nos cinco recursos; arquivar oportunidade e demanda nasceu na UI
- [x] Expurgo definitivo (`DELETE /<recurso>/:id`) sob permissão própria, respeitando a ordem imposta pelas FKs `ON DELETE RESTRICT` (`409` com registros vinculados, `422` fora da lixeira)
- [x] Permissões novas: `auditoria:ver`, `lixeira:ver` e `lixeira:expurgar` (catálogo em [`shared/permissions.ts`](apps/api/src/shared/permissions.ts))
- [x] `GET /trash` (read model dos cinco tipos) e a página [`/lixeira`](apps/web/src/features/lixeira/LixeiraPage.tsx) com restaurar e expurgar

---

> **Ordem do P1 — superada pela [Trilha de produção](#trilha-de-produção--revisão-de-2026-07-27).**
> A Fase 9 (notificações) veio primeiro **por decisão de produto** e está entregue. A ordem original da
> Fase 10 em diante era **da mais simples para a mais complexa**, pelos mesmos três critérios do P2:
> dependência externa (integração, infra nova, credencial), tamanho de schema e superfície tocada, e
> risco de dinheiro/irreversível. Essa ordem **não é mais a de execução** — a trilha de produção
> reordenou por "o que impede alguém de usar" e recortou as fases 12–14. As fases seguem independentes
> entre si, exceto onde declaram "Depende de"; os critérios abaixo continuam valendo como leitura de
> **esforço**.

## Fase 9 — Notificações e lembretes ✅ **P1**

Plano: [`specs/plans/2026-07-27-fase-9-notificacoes-e-lembretes.md`](specs/plans/2026-07-27-fase-9-notificacoes-e-lembretes.md)

- [x] Central de notificações in-app (não lidas, marcar como lida) — sino no header, polling de 45s só na contagem
- [x] Preferências por usuário: matriz **tipo × destino** no Perfil, com N destinos por pessoa
- [x] Gatilhos: follow-up agendado vencendo, proposta a expirar, cobrança a vencer e vencida,
      demanda atrasada, registro atribuído a você
- [x] Digest diário por e-mail (resumo do dia, 7h BRT)
- [x] Os crons existentes ([`FinanceBillingJob`](apps/api/src/modules/finance/application/finance-billing.job.ts), [`ProposalsExpirationJob`](apps/api/src/modules/proposals/application/proposals-expiration.job.ts)) passam a notificar, não só mudar status
- [x] Quatro canais plugáveis (`IN_APP`, `EMAIL`, `WEBHOOK`, `SLACK`) num registry — canal novo é 1 arquivo + 1 linha

> **Por quê:** hoje o sistema só informa quem já está olhando a tela.

> **Complexidade — correção do que estava previsto.** O plano previa "dois modelos novos"; a entrega
> tem **três** (`Notification`, `NotificationDelivery`, `UserNotificationTarget`). A divergência é
> consciente e é o preço de "N destinos por usuário" com opt-in por destino: sem a tabela de entrega
> não há outbox transacional (retry e status por destino), e sem a de destino o opt-in seria tipo ×
> canal, não tipo × destino. Continua sem integração externa obrigatória — o envio de e-mail já
> existia em [`mail.service.ts`](apps/api/src/mail/mail.service.ts) e os dois crons já rodavam.

---

## Fase 10 — Relatórios e metas ⬜ **P1** · ⏸️ adiada

> **Adiada na revisão de 2026-07-27.** Não bloqueia usuário novo: relatório com comparação de período,
> tempo médio de ciclo e "quanto falta para a meta" só dizem algo depois de meses de dado acumulado.
> Volta à fila quando os primeiros owners tiverem histórico.

- [ ] Relatório comercial por período com comparação (mês/trimestre anterior)
- [ ] Resultado por responsável, por serviço e por fonte de lead
- [ ] Análise de perda agregada (`lostReason` é coletado e nunca somado)
- [ ] Tempo médio por estágio e ciclo de venda (`stageMovedAt` existe e não é usado analiticamente)
- [ ] Forecast ponderado por `probability` e valor esperado no período
- [ ] Metas por período e por pessoa (comercial e financeira) → painel mostra "quanto falta", não só "quanto foi"
- [ ] Exportação dos relatórios (depende da Fase 14)

> **Complexidade:** a menor do P1 — é leitura agregada sobre dados que já existem, com um único
> modelo novo (metas) e nenhuma integração, nenhuma escrita de negócio, nada irreversível. As janelas
> de tempo em UTC e o funil já têm precedente testado na Fase 6.

> **Ressalva:** "tempo médio por estágio" não sai do schema atual — `stageMovedAt`
> ([`schema.prisma:260`](apps/api/prisma/schema.prisma#L260)) guarda só a **última** troca. Esse item
> pede histórico de transições do `Deal` (modelo novo, alimentado no `PATCH /deals/:id/move`), e é o
> único da fase que mexe em escrita. A exportação depende da Fase 14 e pode ficar por último.

---

## Fase 11 — Proposta que o cliente vê ⬜ **P1**

- [ ] Geração de PDF da proposta (template com identidade do owner: logo, cores, dados)
- [ ] Link público de aceite (token de uso único, expiração alinhada a `validUntil`)
- [ ] Aceite/recusa pelo cliente na página pública → status, `decidedAt` e registro na timeline
- [ ] Envio por e-mail com o PDF/link — hoje `POST /proposals/:id/send` só marca `sentAt`, não envia nada
- [ ] Rastreio básico: visualizada em, aceita em
- [ ] Templates de proposta reutilizáveis (escopo, condições, itens padrão)

> **Complexidade:** o e-mail e o token de uso único já têm padrão no projeto (`mail.service.ts`,
> `PasswordResetToken`, rotas `@Public()`). O custo novo é a renderização de PDF dentro do container
> e uma superfície pública sem sessão — aceite de proposta é ato do cliente com efeito contratual,
> então token, expiração e idempotência do aceite viram requisito, não detalhe. A identidade visual
> do owner (**logo**) pressupõe upload — nasce limitada ou **depende da Fase 12**.

---

## Fase 12 — Anexos e documentos ⬜ **P1** · 4º na trilha de produção

- [ ] Upload de arquivos com storage S3-compatível (config por env; autohospedagem usa MinIO ou disco)
- [ ] Anexos em cliente, proposta, projeto, tarefa, contrato e cobrança
- [ ] Limites de tamanho/tipo, antivírus opcional, URLs assinadas de curta duração
- [ ] Aba "Documentos" na ficha do cliente

> **Por quê:** não existe upload em nenhum ponto do sistema — contrato assinado, briefing, arte e
> comprovante de pagamento continuam no Drive/WhatsApp.

> **Posição na trilha (4º), não recortada.** A fase entra inteira — o recorte aqui não ajudaria, porque
> o custo é a infra, e ela é indivisível: sem bucket não há upload nenhum. Fica depois de 13-A/14-A/19-A
> porque a ausência de anexo **não impede o uso** (o arquivo continua no Drive, como hoje), e porque é a
> primeira fase a exigir credencial e mudança de deploy — o que se quer evitar na janela de
> estabilização. Sobe de prioridade junto com a Fase 11, que precisa do logo do owner.

> **Complexidade:** primeira fase com **infra externa** — bucket S3-compatível (ou MinIO na
> autohospedagem) significa env, credencial e mudança de deploy, não só código. Soma-se uma
> capacidade que a API nunca teve (multipart), anexo polimórfico ligado a seis entidades e uma
> superfície de segurança nova: tipo/tamanho, URL assinada de curta duração e conteúdo malicioso.

---

## Fase 13 — Extensibilidade do domínio ⬜ **P1** · recortada

> **Por quê:** com o enum fechado, o produto só serve a agências com exatamente o nosso mix de serviço.

**Frente A — Domínio configurável pelo owner** 🔜 **1º na trilha de produção**

- [ ] Catálogo de **serviços por owner** substituindo o enum fechado `ServiceType`
      (`SOFTWARE | WEBSITE | PAID_TRAFFIC` — [`schema.prisma:518`](apps/api/prisma/schema.prisma#L518)), com migration de dados
- [ ] Fontes de lead (`LeadSource`) e tipos de atividade (`ActivityType`) editáveis pelo owner
- [ ] Motivos de perda como lista configurável (hoje `lostReason` é texto livre)

> **Por que é o 1º:** é o **único bloqueio absoluto** do roadmap. `ServiceType` não é um detalhe de
> exibição — é obrigatório em `Deal`, `Proposal` e `Project`, e aparece em 18 arquivos entre DTOs,
> tipos do front, formulários e [`labels.ts`](apps/web/src/lib/labels.ts). Quem se cadastra e não é
> agência com o nosso mix trava no primeiro formulário de oportunidade, sem contorno na UI.

> **Complexidade:** nenhuma integração, mas **migration de dados sobre registros vivos** com RLS por
> owner — cada owner existente precisa herdar os três serviços atuais como catálogo próprio, e os
> `Deal`/`Proposal`/`Project` religados por FK. Tem precedente direto: a Frente A da Fase 7 fez
> exatamente isso com `PipelineStage` (`20260726120000_pipeline_stages_per_owner`), incluindo o seed
> por conta em vez de por instância. Seguir aquele plano de perto.

**Frente B — Campos customizados** ⬜ adiada

- [ ] Campos customizados em cliente, oportunidade e projeto (texto, número, data, seleção, booleano),
      exibidos nos formulários, nos filtros e na exportação

> **Adiada na revisão de 2026-07-27.** É o item estruturalmente mais difícil do roadmap — valor dinâmico
> por tipo, validação em runtime, e todo formulário, filtro e exportação passando a se montar a partir de
> definição, não de código. E não bloqueia ninguém: sem campo customizado o CRM funciona, sem serviço
> configurável não. Depende da Frente A e, para a exportação, de 14-A.

---

## Fase 14 — Dados: importação, exportação, busca e duplicidade ⬜ **P1** · recortada

> **Por quê:** sem import, o onboarding de um cliente real morre no primeiro dia; sem export, o
> financeiro não fecha o mês fora da tela.

> **Por que era a mais complexa do P1:** são seis frentes de naturezas diferentes numa fase — ingestão
> com mapeamento e relatório de erro, egressão genérica que atravessa **todas** as listagens
> respeitando filtro e permissão, busca full-text (índice novo no Postgres) sobre seis entidades, e
> **mesclagem de clientes**: religar FKs de contatos, oportunidades, propostas, contratos, cobranças e
> timeline num só `$transaction`, sem volta. Daí o recorte em três: só a Frente A é bloqueio de produção.

**Frente A — Entrada e saída de dados** 🔜 **2º na trilha de produção**

- [ ] Importação CSV/XLSX de clientes e contatos (mapeamento de colunas, prévia, relatório de erros)
- [ ] Exportação CSV/XLSX de qualquer listagem, respeitando filtros e permissões

> **Por que é o 2º:** são as duas pontas do onboarding. Nenhum owner migra a base à mão, e hoje **não
> existe nenhum endpoint de exportação** em todo o `ENDPOINTS.md` — o dado entra e não sai. Ambas são
> autocontidas: nenhum modelo novo de negócio, nada irreversível (import falho não corrompe, só não
> importa), e a exportação reaproveita os filtros e as permissões que cada listagem já aplica.

**Frente B — Busca global e duplicidade** ⬜ 5º na trilha

- [ ] Busca global (clientes, contatos, propostas por número, contratos, projetos, tarefas)
- [ ] Detecção de duplicidade por documento/e-mail/telefone na criação

> **Adiada por ser conveniência, não bloqueio.** Toda listagem já tem `?search=` própria (clientes,
> deals, propostas, projetos, cobranças — ver `ENDPOINTS.md`); a busca global economiza cliques, não
> destrava uso. Custo real: índice full-text novo no Postgres sobre seis entidades, com RLS.

**Frente C — Mesclagem e unicidade** ⬜ adiada

- [ ] Mesclagem de clientes duplicados (move contatos, oportunidades, propostas, contratos e timeline)
- [ ] `document` com unicidade por owner quando informado

> **Última coisa a entrar.** É a única frente do P1 que **reescreve chave de registro financeiro** e não
> tem volta: religar FKs de cobrança num só `$transaction`. Numa produção recém-aberta, o custo de errar
> é maior que o de conviver com duplicata. Pede a trilha da Fase 8 e testes de posse. A unicidade de
> `document` só entra **depois** de resolver as duplicatas já existentes, e a detecção da Frente B é o
> pré-requisito prático para saber quais são.

---

> **Ordem do P2.** As quatro fases de evolução de produto estão ordenadas **da mais simples para a
> mais complexa**, por três critérios somados: dependência externa (integração de terceiro,
> aprovação, credencial), tamanho de schema e superfície tocada, e risco de dinheiro/irreversível.
> São independentes entre si — a ordem é de esforço, não de pré-requisito.

## Fase 15 — Agenda e calendário ⬜ **P2**

- [ ] Visão de calendário (mês/semana/dia) cruzando follow-ups, entregas, vencimentos e reuniões
- [ ] Compromisso com duração, local/link e participantes (hoje `Activity.scheduledFor` é só um instante)
- [ ] Sincronia com Google Calendar (duas vias)
- [ ] Link de agendamento para o cliente escolher horário

> **Por que é a mais simples:** os três primeiros itens são leitura do que já existe
> (`Activity.scheduledFor`, `Task.dueDate`, `Payment.dueDate`) mais uma extensão de `Activity` —
> nenhuma integração, nenhum dado novo de negócio. A única frente difícil (Google Calendar em duas
> vias: OAuth, sync token, conflito) é separável e pode ficar por último sem travar o resto.

---

## Fase 16 — Automações e templates ⬜ **P2**

- [ ] Cadência de follow-up (sequência de lembretes por estágio ou inatividade)
- [ ] Regras "quando X, então Y" configuráveis pelo owner (mover estágio, criar tarefa, notificar, atribuir)
- [ ] Checklist/tarefas padrão de projeto por tipo de serviço
- [ ] Automatizar contrato ao ganhar (hoje só o projeto é sugerido)
- [ ] Alerta de cliente inativo (sem atividade há N dias)

> **Complexidade:** zero integração externa e tudo determinístico/testável, mas o motor de regras
> configurável (evento → condição → ação, persistido e editável na UI) é desenho de arquitetura, não
> CRUD. **Depende de** Fase 9 (notificar é uma das ações) e Fase 13 (checklist por tipo de serviço).

---

## Fase 17 — Entrada de lead e comunicação ⬜ **P2**

- [ ] Formulário público de captação + endpoint de entrada de lead (site, landing page)
- [ ] Webhook de entrada para Meta Ads / Google Ads / n8n, com deduplicação
- [ ] Roteamento do lead novo para um responsável (depende da Fase 7)
- [ ] Envio de e-mail ao cliente pelo CRM, com a mensagem registrada na timeline
- [ ] WhatsApp: registro da conversa na timeline e envio de mensagem/template
- [ ] Vínculo automático da resposta do cliente ao registro correspondente

> **Por quê:** vendemos tráfego pago — lead precisa entrar por integração, não por digitação. E o
> valor de e-mail/WhatsApp está em **registrar** a interação, não só em disparar: timeline
> alimentada à mão é timeline abandonada.

> **Complexidade:** a metade "entrada de lead" é barata (rota pública já é padrão do projeto, e o
> roteamento vem de graça com a Fase 7). O custo está na comunicação: WhatsApp Cloud API exige
> verificação de negócio, templates aprovados e respeito à janela de 24h, e o vínculo automático da
> resposta ao registro é heurística de correspondência, não FK.

---

## Fase 18 — Financeiro completo ⬜ **P2**

- [ ] Despesas (fixas e por projeto), categorias e fornecedores — hoje só há receita
- [ ] DRE simplificado: receita × despesa × margem, por período e por projeto/cliente
- [ ] Juros e multa automáticos no atraso; renegociação de cobrança
- [ ] Cobrança automática via gateway (Pix e boleto) com baixa por webhook, eliminando a baixa manual
- [ ] Régua de cobrança (aviso antes do vencimento, lembretes após)
- [ ] Emissão de nota fiscal de serviço (integração com prefeitura/emissor)
- [ ] Conciliação: extrato × cobranças

> **Por que é a mais complexa:** três integrações externas de naturezas diferentes (gateway Pix/boleto,
> emissor de NFS-e — que varia por prefeitura — e extrato bancário para conciliação), o maior schema
> novo do roadmap (despesas, categorias, fornecedores) e a única frente onde o erro mexe em dinheiro
> de verdade: baixa por webhook pede idempotência, e juros/multa/renegociação exigem trilha (Fase 8).

---

## Fase 19 — Plataforma: API pública, 2FA e LGPD ⬜ **P3** · recortada

**Frente A — LGPD mínimo** 🔜 **3º na trilha de produção** (promovida de P3 para bloqueio de produção)

- [ ] Excluir a própria conta (owner), com o efeito em cascata explícito e irreversível
- [ ] Exportar meus dados — dump da workspace num formato legível pelo titular

> **Por que sobe de P3 para o 3º lugar:** enquanto o usuário era a nossa agência, LGPD operacional era
> governança futura. Com autocadastro aberto, estranhos passam a guardar **dado de terceiros** (clientes
> deles, CPF/CNPJ, telefone) na nossa instância — e não existe **nenhum** endpoint de exclusão de conta
> ou de exportação de dados em todo o `ENDPOINTS.md`. A
> [página de privacidade](apps/web/src/features/legal/PrivacidadePage.tsx) promete o que o sistema não
> cumpre. Isso é exposição legal, não feature — e é o recorte mais barato dos três primeiros.

> **Escopo mínimo de propósito:** só as duas operações do titular. Consentimento, política de retenção
> e opt-out ficam na Frente B. A exportação pode reaproveitar a egressão de 14-A.

**Frente B — Plataforma aberta** ⬜ **P3**

- [ ] API key por owner, com escopos e rotação
- [ ] Webhooks de saída (eventos de negócio) para n8n/Zapier
- [ ] 2FA/MFA no login (TOTP), com códigos de recuperação
- [ ] LGPD completo: consentimento e política de retenção
- [ ] Rastreio de consentimento de comunicação (opt-out de e-mail/WhatsApp)

> **Não confundir com o `WebhookChannel` da Fase 9.** O que já existe é destino **do usuário**: cada
> pessoa aponta as *próprias* notificações para um n8n ou Slack pessoal, com a URL funcionando como
> credencial (ver `apps/api/ENDPOINTS.md` → Notificações). O que falta aqui é o webhook **do owner**:
> evento de negócio da workspace saindo para um sistema externo, com API key, escopos, assinatura e
> rotação. São duas features distintas — tratar uma como a outra vira retrabalho.

> **A assinatura HMAC das notificações entra aqui**, não na Fase 9: o custo não é assinar, é a máquina
> de segredo-por-registro (geração, exibição única, mascaramento, ausência em log e no diff da
> auditoria, rotação, recuperação) — a mesma que a API key por owner precisa. Desenho a usar:
> `HMAC-SHA256` sobre `<timestamp>.<body>` com o corpo cru **exatamente como enviado** (serializar uma
> vez, assinar e postar a mesma string — reserializar entre assinar e enviar é o bug clássico que
> invalida a verificação do outro lado), em `X-CRM-Signature: sha256=<hex>`. Acrescentar cabeçalho
> novo é aditivo: não quebra quem já recebe.

---

## Como evoluímos (esteira de trabalho)

Cada fase segue o fluxo spec-driven do projeto:

```
/prd <fase>   →   /spec <prd>   →   /code <plano>
 specs/research/    specs/plans/       implementação faseada
```

Ao concluir uma fase: marque os checkboxes, mude o status na tabela de panorama, e atualize a data no topo.
