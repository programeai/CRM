# Roadmap — CRM Solarz

> Documento **vivo**: atualize o status e os checkboxes a cada avanço. Fonte de escopo: [SPEC.md](SPEC.md) §7.
> Convenção de status: ✅ concluída · 🚧 em andamento · 🔜 próxima · ⬜ não iniciada.
>
> **Última atualização:** 2026-07-21 · commit `66c2291`

## Visão

CRM enxuto para agência/dev full stack (software sob medida, sites, tráfego pago), centrado em
quatro pilares: **Clientes**, **Propostas**, **Demandas** e **Financeiro**. Single-tenant no MVP
(há `ownerId` como preparação, sem multi-tenancy). Interface 100% pt-BR; código/tabelas/endpoints em inglês.

## Panorama das fases

| Fase | Entrega | Status | Spec |
|---|---|---|---|
| 0 | Fundação (monorepo, infra, auth, layout base) | ✅ concluída | [research](specs/research/2026-07-20-fase-0-fundacao.md) · [plan](specs/plans/2026-07-20-fase-0-fundacao.md) |
| 1 | Clientes (CRUD clientes + contatos, timeline, follow-ups) | 🚧 em pesquisa | [research](specs/research/2026-07-21-fase-1-clientes.md) |
| 2 | Pipeline (estágios configuráveis, Kanban de oportunidades) | ⬜ não iniciada | — |
| 3 | Propostas (itens, total, ciclo de status, versionamento, expiração) | ⬜ não iniciada | — |
| 4 | Demandas (projetos, tarefas, Kanban por projeto, "Minhas demandas") | ⬜ não iniciada | — |
| 5 | Financeiro (contratos, cobranças, agenda, baixa/estorno, crons) | ⬜ não iniciada | — |
| 6 | Dashboard (métricas comerciais e financeiras, funil, polimento) | ⬜ não iniciada | — |

Cada fase termina com o sistema **utilizável de ponta a ponta**.

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

## Fase 1 — Clientes 🚧

CRUD de clientes e contatos, timeline de atividades e follow-ups. Ver [SPEC.md](SPEC.md) §3.1, §3.5, §5.

**Backend** (`apps/api/src/modules/`)
- [ ] Módulo `clients`: `GET/POST /clients`, `GET/PATCH /clients/:id`, `POST /clients/:id/archive` (soft delete via `archivedAt`; sem DELETE)
- [ ] Módulo `contacts`: `GET/POST /clients/:id/contacts`, `PATCH/DELETE /contacts/:id` (regra: único `isPrimary` por cliente)
- [ ] Módulo `activities`: `GET/POST /activities`, `PATCH /activities/:id`, `POST /activities/:id/complete` (follow-up com `scheduledFor`/`completedAt`)
- [ ] DTOs com class-validator em pt-BR; validação de CPF/CNPJ quando informado
- [ ] Paginação `?page=&limit=` → `{ data, meta: { total, page, limit } }` (novo padrão do projeto)
- [ ] `ownerId` derivado do usuário autenticado (`req.user.sub`)
- [ ] Testes unitários dos services (arquivamento, contato principal, validação de documento)
- [ ] Atualizar `apps/api/ENDPOINTS.md` (Definition of Done)

**Frontend** (`apps/web/src/features/clientes/`)
- [ ] Listagem de clientes (Table + TableLink + Badge de status + filtros/busca)
- [ ] Formulário de cadastro/edição (RHF + Zod pt-BR, Select para enums via `@/lib/labels`)
- [ ] Ficha do cliente com sub-abas (Dados + Contatos + Timeline; demais abas placeholder)
- [ ] CRUD de contatos na ficha
- [ ] Timeline de atividades + registro de follow-ups + marcar como concluído
- [ ] Primeiro padrão de TanStack Query (queryKeys, mutations, invalidação)
- [ ] Helpers de formatação em `lib/` (CPF/CNPJ, telefone, datas)
- [ ] Trocar `PlaceholderPage` das rotas `/clientes` e `/clientes/:id`

**Decisões em aberto (fechar no `/spec`):** arquitetura do módulo (repository pattern em camadas vs Prisma direto) · campos de endereço (schema não os tem) · granularidade dos módulos contacts/activities · filtro por `ownerId` e unicidade de documento. Detalhes na [pesquisa da Fase 1](specs/research/2026-07-21-fase-1-clientes.md#open-questions).

---

## Fase 2 — Pipeline ⬜

Kanban de oportunidades, da captação ao fechamento. Ver [SPEC.md](SPEC.md) §3.2.

- [ ] Estágios configuráveis: `GET/POST /pipeline-stages`, `PATCH/DELETE /pipeline-stages/:id`
- [ ] Oportunidades (Deals): `GET/POST /deals`, `GET/PATCH/DELETE /deals/:id`, `PATCH /deals/:id/move` (stage + position)
- [ ] Motivo da perda obrigatório ao mover para "Perdeu"; indicador "esfriando" (parada > X dias)
- [ ] Kanban com drag & drop (dnd-kit) + optimistic update
- [ ] Mover para "Ganhou" sugere criar Projeto

---

## Fase 3 — Propostas ⬜

Documento comercial com itens, versões e ciclo de status. Ver [SPEC.md](SPEC.md) §3.3.

- [ ] CRUD: `GET/POST /proposals`, `GET/PATCH /proposals/:id`
- [ ] Ações: `send`, `accept`, `reject`, `new-version`
- [ ] Itens com cálculo de total **no backend** (desconto incluído); nunca float
- [ ] Ciclo de status com transições validadas (422 em transição inválida)
- [ ] Versionamento (v2, v3…); só a versão mais recente é editável
- [ ] Expiração automática (cron) ao passar `validUntil`
- [ ] Proposta aceita sugere criar Projeto e Contrato

---

## Fase 4 — Demandas ⬜

Organização do trabalho após a venda. Ver [SPEC.md](SPEC.md) §3.4.

- [ ] Projetos: `GET/POST /projects`, `GET/PATCH /projects/:id`
- [ ] Tarefas: `GET/POST /tasks` (filtros), `GET/PATCH/DELETE /tasks/:id`, `PATCH /tasks/:id/move`
- [ ] Kanban por projeto (dnd-kit); checklist de subtarefas
- [ ] Visão "Minhas demandas" cruzando projetos, com filtros (prioridade, prazo, cliente)
- [ ] Destaque de demandas atrasadas

---

## Fase 5 — Financeiro ⬜

Controle de receitas por contrato (3 regimes). Ver [SPEC.md](SPEC.md) §3.6. **Fase mais densa — testes de regra críticos.**

- [ ] Contratos: `GET/POST /contracts`, `GET/PATCH /contracts/:id`, `pause`/`resume`/`cancel`
- [ ] Regimes: mensalidade (`RECURRING`), entrada + parcelas (`INSTALLMENTS`), à vista (`ONE_TIME`)
- [ ] Cobranças (Payments): `GET /payments`, `PATCH /payments/:id`, `pay`/`revert`/`cancel`
- [ ] Geração de agenda de parcelas na criação do contrato
- [ ] Cron diário: gera mensalidade 30 dias antes (idempotente) + marca `OVERDUE`
- [ ] Agenda de recebimentos, contratos por cliente, visão de inadimplência
- [ ] Baixa manual com valor/forma; estorno (nunca excluir cobrança paga)

---

## Fase 6 — Dashboard ⬜

Métricas e polimento final. Ver [SPEC.md](SPEC.md) §3.7.

- [ ] `GET /dashboard/summary` + `GET /dashboard/finance`
- [ ] Funil (oportunidades por estágio e valor em negociação)
- [ ] Propostas em aberto, aceitas no mês, taxa de conversão (90 dias)
- [ ] Demandas em andamento/atrasadas/próximas entregas
- [ ] Próximas ações (follow-ups agendados)
- [ ] Financeiro: MRR, previsto × recebido no mês, total em atraso, próximos vencimentos
- [ ] Polimento geral + seed de demonstração

---

## Fora do MVP (backlog futuro)

Multiusuário com papéis/permissões · PDF + link público de aceite da proposta · integração e-mail/WhatsApp ·
gateway de pagamento (boleto/Pix automático — no MVP a baixa é manual) · emissão de nota fiscal ·
controle de despesas · automações (lembretes, proposta expirando) · relatórios avançados e exportação CSV.

---

## Como evoluímos (esteira de trabalho)

Cada fase segue o fluxo spec-driven do projeto:

```
/prd <fase>   →   /spec <prd>   →   /code <plano>
 specs/research/    specs/plans/       implementação faseada
```

Ao concluir uma fase: marque os checkboxes, mude o status na tabela de panorama, e atualize a data no topo.
