# SPEC — CRM ProgrameAi

Especificação de um CRM para gestão de clientes, propostas comerciais e demandas de um desenvolvedor Full Stack que vende **software sob medida**, **construção de sites** e **gestão de tráfego pago**.

> **Status:** rascunho v1 — decisões marcadas com ⚠️ são premissas a validar.

---

## 1. Visão Geral

### 1.1 Problema
Hoje a gestão de clientes, propostas e demandas é feita de forma dispersa (planilhas, WhatsApp, memória). Isso causa:
- Perda de follow-up com leads e clientes;
- Falta de visibilidade sobre propostas em aberto e taxa de conversão;
- Demandas sem priorização clara e sem histórico.

### 1.2 Objetivo
Um CRM enxuto e centrado em três pilares:

| Pilar | O que resolve |
|---|---|
| **Clientes** | Cadastro, contatos, histórico de interações e serviços contratados |
| **Propostas** | Criação, versionamento, acompanhamento de status e conversão |
| **Demandas** | Organização do trabalho contratado em quadros Kanban por projeto |
| **Financeiro** | Contratos de mensalidade e projetos com entrada + parcelas; controle de recebimentos |

### 1.3 Premissas ⚠️
- **Multi-owner**: uma instância atende vários owners, isolados por `ownerId` (RLS no banco). Cada owner é dono dos seus dados e da sua assinatura, convida colaboradores e configura o próprio funil.
- **Monorepo**: `apps/api` (NestJS) + `apps/web` (React) no mesmo repositório.
- **Idioma**: interface 100% em PT-BR; código, tabelas e endpoints em inglês.
- **Moeda**: BRL apenas.

---

## 2. Escopo

### 2.1 Dentro do MVP (v1)
- Autenticação (login com e-mail/senha, JWT)
- CRUD de Clientes e Contatos
- Pipeline de vendas (Kanban de oportunidades)
- Propostas com itens, versões e ciclo de status
- Demandas (tarefas) organizadas por projeto, com Kanban
- Timeline de atividades por cliente (notas, reuniões, ligações, follow-ups)
- **Financeiro**: contratos de mensalidade e de entrada + parcelas, agenda de recebimentos, baixa manual de pagamentos, controle de inadimplência
- Dashboard com métricas essenciais (comercial + financeiro)

### 2.2 Fora do MVP (backlog futuro)
> Multiusuário com papéis e permissões **saiu do backlog e está entregue** — colaboradores por
> convite, papéis com permissões granulares e isolamento por owner (ver
> `specs/plans/2026-07-25-colaboradores-e-papeis.md`).

O backlog pós-MVP deixou de ser uma lista solta: está organizado em fases priorizadas no
[ROADMAP.md](ROADMAP.md) → "Evolução pós-MVP" (fases 7 a 19), que é a **fonte única** do que falta.
Resumo do que está lá:

- **P0** — funil de pipeline isolado por owner e responsável (`assigneeId`) nos registros; sessões
  múltiplas, trilha de auditoria e lixeira
- **P1** — PDF + link público de aceite + envio da proposta; notificações e lembretes; anexos;
  serviços e campos customizados por owner (o enum `ServiceType` fechado é uma limitação de produto);
  importação/exportação, busca global e duplicidade; relatórios e metas
- **P2** — captação automática de lead, e-mail e WhatsApp registrados na timeline; despesas, cobrança
  automática (Pix/boleto) e nota fiscal; agenda/calendário; automações e templates
- **P3** — API pública com API key, webhooks de saída, 2FA e LGPD operacional

---

## 3. Módulos Funcionais

### 3.1 Clientes
Cadastro de clientes **pessoa física ou jurídica**.

**Campos principais:**
- Nome / Razão social, nome fantasia
- Tipo (`PF` / `PJ`), CPF/CNPJ (opcional, validado quando informado)
- E-mail, telefone/WhatsApp, site
- Endereço (opcional, campos simples)
- Origem do lead (`indicação`, `tráfego pago`, `orgânico`, `prospecção ativa`, `outro`)
- Status (`lead`, `ativo`, `inativo`, `perdido`)
- Tags livres (ex.: "e-commerce", "recorrente")
- Observações (texto livre)

**Contatos:** um cliente PJ pode ter N contatos (nome, cargo, e-mail, telefone, flag "contato principal").

**Regras:**
- Cliente não pode ser excluído se tiver proposta ou projeto vinculado → usar arquivamento (soft delete).
- Ficha do cliente exibe: dados, contatos, timeline de atividades, propostas, projetos/demandas e contratos (com situação financeira: recebido, a receber, em atraso).

### 3.2 Pipeline de Vendas (Oportunidades)
Kanban de oportunidades comerciais, da captação ao fechamento.

**Colunas (estágios) padrão** — editáveis nas configurações:
1. Novo lead
2. Contato feito
3. Reunião/Diagnóstico
4. Proposta enviada
5. Negociação
6. Ganhou ✅ / Perdeu ❌ (estágios terminais)

**Campos da oportunidade:**
- Título, cliente vinculado, tipo de serviço (`software`, `site`, `tráfego pago`)
- Valor estimado (BRL), probabilidade (%), data prevista de fechamento
- Estágio atual, motivo da perda (obrigatório ao mover para "Perdeu")

**Regras:**
- Mover para "Ganhou" sugere criar um **Projeto** a partir da oportunidade.
- Drag & drop entre colunas; ordenação manual dentro da coluna.
- Oportunidade parada há mais de X dias (config, default 7) ganha indicador visual de "esfriando".

### 3.3 Propostas
Documento comercial vinculado a um cliente (e opcionalmente a uma oportunidade).

**Estrutura:**
- Número sequencial (ex.: `PROP-2026-0042`)
- Cliente, oportunidade (opcional), tipo de serviço
- **Itens**: descrição, quantidade, valor unitário, subtotal
- Desconto (valor ou %), total calculado
- Condições de pagamento (texto livre), prazo de entrega, validade da proposta
- Escopo/descrição (texto rico simples — markdown)

**Ciclo de status:**
```
rascunho → enviada → em negociação → aceita ✅
                   ↘ recusada ❌
                   ↘ expirada (automático ao passar a validade)
```

**Versionamento:**
- Editar uma proposta já enviada gera **nova versão** (v2, v3…) mantendo o histórico; apenas a versão mais recente é editável.

**Regras:**
- Proposta `aceita` sugere criar Projeto e move a oportunidade vinculada para "Ganhou".
- Dashboard usa propostas para calcular taxa de conversão e valor em aberto.

### 3.4 Projetos e Demandas
Organização do trabalho **após a venda** (ou interno).

**Projeto:**
- Nome, cliente, tipo de serviço, proposta de origem (opcional)
- Status (`ativo`, `pausado`, `concluído`, `cancelado`)
- Datas de início e previsão de entrega

**Demanda (tarefa):**
- Título, descrição (markdown), projeto vinculado
- Status (`backlog`, `a fazer`, `em andamento`, `em revisão`, `concluída`) — colunas do Kanban
- Prioridade (`baixa`, `média`, `alta`, `urgente`)
- Data de entrega (opcional), checklist de subtarefas simples
- Tags

**Visões:**
- Kanban por projeto (drag & drop)
- Lista geral "Minhas demandas" cruzando todos os projetos, com filtros (prioridade, prazo, cliente) — visão de trabalho do dia a dia
- Demandas atrasadas destacadas

### 3.5 Atividades (Timeline)
Registro cronológico de interações, vinculado a cliente (e opcionalmente a oportunidade/proposta).

- Tipos: `nota`, `ligação`, `reunião`, `e-mail`, `whatsapp`, `follow-up`
- Follow-up tem **data agendada** e aparece em "Próximas ações" no dashboard até ser concluído.

### 3.6 Financeiro
Controle de **receitas** por contrato, cobrindo os três regimes de remuneração do negócio:

| Regime | Uso típico | Comportamento |
|---|---|---|
| **Mensalidade** (`RECURRING`) | Tráfego pago, manutenção de site/sistema | Valor mensal fixo com dia de vencimento; gera cobrança todo mês enquanto ativo |
| **Entrada + parcelas** (`INSTALLMENTS`) | Projetos de software | Entrada + N parcelas; agenda de cobranças gerada na criação do contrato |
| **À vista** (`ONE_TIME`) | Sites pequenos, jobs pontuais | Cobrança única com data de vencimento |

**Contrato:**
- Cliente, projeto (opcional), proposta de origem (opcional), descrição
- Regime (`mensalidade`, `entrada + parcelas`, `à vista`)
- Status (`ativo`, `pausado`, `encerrado`, `cancelado`)
- Mensalidade: valor mensal, dia de vencimento, data de início, data de término (opcional — em branco = por tempo indeterminado), reajuste manual (editar o valor vale para as próximas cobranças)
- Entrada + parcelas: valor da entrada e vencimento, quantidade e valor das parcelas, vencimento da 1ª parcela (demais geradas mês a mês)

**Cobrança (parcela/mensalidade):**
- Descrição gerada automaticamente (`Entrada`, `Parcela 3/8`, `Mensalidade 07/2026`), editável
- Valor, data de vencimento
- Status: `pendente` → `paga` (baixa manual) · `vencida` (automático) · `cancelada`
- Na baixa: data do pagamento, valor recebido (permite valor parcial/diferente com observação) e forma (`pix`, `transferência`, `boleto`, `cartão`, `dinheiro`)

**Regras:**
- Criar contrato **entrada + parcelas** gera todas as cobranças de uma vez (agenda editável depois: alterar valor/vencimento de cobranças ainda pendentes).
- Contrato de **mensalidade** tem as cobranças geradas por job diário (cron): a cobrança do mês é criada com 30 dias de antecedência do vencimento, enquanto o contrato estiver `ativo`. Pausar o contrato suspende a geração (cobranças pendentes permanecem).
- Job diário também marca como `vencida` toda cobrança pendente com vencimento passado.
- Proposta **aceita** sugere criar contrato, pré-preenchendo cliente, valor total e condições de pagamento.
- Cancelar contrato cancela as cobranças pendentes (as pagas ficam no histórico).
- Cobrança paga não pode ser excluída — apenas estornada (volta a `pendente`, com registro em observação).

**Visões:**
- **Agenda de recebimentos**: lista de cobranças com filtros (mês, status, cliente, regime); ação rápida de "dar baixa"
- **Contratos**: lista geral e aba de contratos na ficha do cliente, com totais (recebido, a receber, em atraso)
- **Em atraso**: destaque para inadimplência, com total por cliente

### 3.7 Dashboard
- **Funil**: oportunidades por estágio e valor total em negociação
- **Propostas**: em aberto (qtd e valor), aceitas no mês, taxa de conversão (últimos 90 dias)
- **Demandas**: em andamento, atrasadas, próximas entregas (7 dias)
- **Próximas ações**: follow-ups agendados
- **Financeiro**: MRR (soma das mensalidades ativas), previsto × recebido no mês, total em atraso, próximos vencimentos (7 dias)

---

## 4. Modelo de Dados (PostgreSQL + Prisma)

```prisma
model User {
  id               String   @id @default(uuid())
  name             String
  email            String   @unique
  passwordHash     String
  refreshTokenHash String?                       // hash (argon2) do refresh token vigente; permite revogar/logout real
  createdAt        DateTime @default(now())
}

model Client {
  id          String       @id @default(uuid())
  ownerId     String                        // preparação p/ multiusuário
  name        String
  tradeName   String?
  personType  PersonType   @default(COMPANY) // INDIVIDUAL | COMPANY
  document    String?                       // CPF/CNPJ
  email       String?
  phone       String?
  website     String?
  source      LeadSource?                   // REFERRAL | PAID_TRAFFIC | ORGANIC | OUTBOUND | OTHER
  status      ClientStatus @default(LEAD)   // LEAD | ACTIVE | INACTIVE | LOST
  tags        String[]
  notes       String?
  archivedAt  DateTime?                     // soft delete
  assigneeId  String?                       // responsável pelo registro (FK User, SetNull)
  contacts    Contact[]
  activities  Activity[]
  deals       Deal[]
  proposals   Proposal[]
  projects    Project[]
  contracts   Contract[]
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt
}

model Contact {
  id        String  @id @default(uuid())
  clientId  String
  name      String
  role      String?
  email     String?
  phone     String?
  isPrimary Boolean @default(false)
}

model PipelineStage {
  id        String  @id @default(uuid())
  ownerId   String
  name      String
  order     Int
  isWon     Boolean @default(false)
  isLost    Boolean @default(false)
  deals     Deal[]

  @@unique([ownerId, name])
}

model Deal {
  id            String      @id @default(uuid())
  clientId      String
  stageId       String
  title         String
  serviceType   ServiceType               // SOFTWARE | WEBSITE | PAID_TRAFFIC
  amount        Decimal?    @db.Decimal(12, 2)
  probability   Int?                      // 0–100
  expectedClose DateTime?
  lostReason    String?
  position      Int                       // ordenação na coluna
  stageMovedAt  DateTime    @default(now()) // p/ indicador "esfriando"
  assigneeId    String?                   // responsável pelo registro (FK User, SetNull)
  proposals     Proposal[]
  activities    Activity[]
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt
}

model Proposal {
  id           String         @id @default(uuid())
  number       String         @unique      // PROP-2026-0042
  version      Int            @default(1)
  parentId     String?                     // versão anterior
  clientId     String
  dealId       String?
  serviceType  ServiceType
  status       ProposalStatus @default(DRAFT) // DRAFT | SENT | NEGOTIATING | ACCEPTED | REJECTED | EXPIRED
  scope        String?                     // markdown
  paymentTerms String?
  deliveryTime String?
  validUntil   DateTime?
  discount     Decimal?       @db.Decimal(12, 2)
  total        Decimal        @db.Decimal(12, 2) // calculado no backend
  items        ProposalItem[]
  sentAt       DateTime?
  decidedAt    DateTime?                   // aceite/recusa
  createdAt    DateTime       @default(now())
  updatedAt    DateTime       @updatedAt
}

model ProposalItem {
  id          String  @id @default(uuid())
  proposalId  String
  description String
  quantity    Decimal @db.Decimal(10, 2) @default(1)
  unitPrice   Decimal @db.Decimal(12, 2)
  order       Int
}

model Project {
  id          String        @id @default(uuid())
  clientId    String
  proposalId  String?
  name        String
  serviceType ServiceType
  status      ProjectStatus @default(ACTIVE) // ACTIVE | PAUSED | DONE | CANCELED
  startDate   DateTime?
  dueDate     DateTime?
  tasks       Task[]
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
}

model Task {
  id          String       @id @default(uuid())
  projectId   String
  title       String
  description String?                      // markdown
  status      TaskStatus   @default(BACKLOG) // BACKLOG | TODO | IN_PROGRESS | REVIEW | DONE
  priority    TaskPriority @default(MEDIUM)  // LOW | MEDIUM | HIGH | URGENT
  dueDate     DateTime?
  position    Int
  tags        String[]
  checklist   Json?                        // [{ text, done }]
  completedAt DateTime?
  assigneeId  String?                      // responsável pelo registro (FK User, SetNull)
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt
}

model Contract {
  id             String         @id @default(uuid())
  clientId       String
  projectId      String?
  proposalId     String?
  description    String
  billingType    BillingType    // RECURRING | INSTALLMENTS | ONE_TIME
  status         ContractStatus @default(ACTIVE) // ACTIVE | PAUSED | FINISHED | CANCELED
  // RECURRING
  monthlyAmount  Decimal?       @db.Decimal(12, 2)
  billingDay     Int?                            // 1–28
  startDate      DateTime?
  endDate        DateTime?                       // null = tempo indeterminado
  // INSTALLMENTS
  downPayment    Decimal?       @db.Decimal(12, 2)
  installments   Int?                            // qtd de parcelas (sem contar entrada)
  installmentAmount Decimal?    @db.Decimal(12, 2)
  payments       Payment[]
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt
}

model Payment {
  id          String        @id @default(uuid())
  contractId  String
  description String                          // "Entrada", "Parcela 3/8", "Mensalidade 07/2026"
  amount      Decimal       @db.Decimal(12, 2)
  dueDate     DateTime
  status      PaymentStatus @default(PENDING) // PENDING | PAID | OVERDUE | CANCELED
  paidAt      DateTime?
  paidAmount  Decimal?      @db.Decimal(12, 2) // permite recebimento parcial/diferente
  method      PaymentMethod?                   // PIX | TRANSFER | BOLETO | CARD | CASH
  notes       String?
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
}

model Activity {
  id           String       @id @default(uuid())
  clientId     String
  dealId       String?
  proposalId   String?
  type         ActivityType // NOTE | CALL | MEETING | EMAIL | WHATSAPP | FOLLOW_UP
  content      String
  scheduledFor DateTime?    // follow-ups
  completedAt  DateTime?
  assigneeId   String?      // responsável pelo registro (FK User, SetNull)
  createdAt    DateTime     @default(now())
}
```

**Notas:**
- Valores monetários sempre `Decimal(12,2)`, nunca float.
- `total` da proposta é **sempre recalculado no backend** a partir dos itens + desconto.
- Índices: `Deal(stageId, position)`, `Task(projectId, status, position)`, `Activity(clientId, createdAt)`, `Proposal(clientId, status)`, `Payment(contractId, status)`, `Payment(dueDate, status)`.
- `billingDay` limitado a 1–28 para evitar ambiguidade em meses curtos.
- `OVERDUE` é derivado por job diário, mas as consultas de dashboard também tratam `PENDING` com `dueDate < hoje` como atraso (evita janela entre cron e leitura).

---

## 5. API (NestJS — REST)

Base: `/api/v1`. Todas as rotas autenticadas exceto `/auth/login`.

| Recurso | Endpoints |
|---|---|
| Auth | `POST /auth/login` · `GET /auth/me` · `POST /auth/refresh` |
| Clients | `GET/POST /clients` (filtro `assigneeId`) · `GET/PATCH /clients/:id` · `POST /clients/:id/archive` |
| Contacts | `GET/POST /clients/:id/contacts` · `PATCH/DELETE /contacts/:id` |
| Stages | `GET/POST /pipeline-stages` · `PATCH /pipeline-stages/reorder` · `PATCH/DELETE /pipeline-stages/:id` (escopo: owner) |
| Deals | `GET/POST /deals` (filtro `assigneeId`) · `GET/PATCH/DELETE /deals/:id` · `PATCH /deals/:id/move` (stage + position) |
| Proposals | `GET/POST /proposals` · `GET/PATCH /proposals/:id` · `POST /proposals/:id/send` · `POST /proposals/:id/accept` · `POST /proposals/:id/reject` · `POST /proposals/:id/new-version` |
| Projects | `GET/POST /projects` · `GET/PATCH /projects/:id` |
| Tasks | `GET/POST /tasks` (filtros: project, status, priority, dueBefore, assigneeId) · `GET/PATCH/DELETE /tasks/:id` · `PATCH /tasks/:id/move` |
| Activities | `GET/POST /activities` (filtro por client/deal/assigneeId) · `PATCH /activities/:id` · `POST /activities/:id/complete` |
| Contracts | `GET/POST /contracts` (filtros: client, billingType, status) · `GET/PATCH /contracts/:id` · `POST /contracts/:id/pause` · `POST /contracts/:id/resume` · `POST /contracts/:id/cancel` |
| Payments | `GET /payments` (filtros: month, status, clientId, contractId) · `PATCH /payments/:id` (valor/vencimento, só pendentes) · `POST /payments/:id/pay` (baixa) · `POST /payments/:id/revert` (estorno) · `POST /payments/:id/cancel` |
| Dashboard | `GET /dashboard/summary` (query `onlyMine`) · `GET /dashboard/finance` |
| Workspace | `GET /workspace/members` (owner + colaboradores ativos, p/ o seletor de responsável) |

**Convenções:**
- DTOs validados com `class-validator` + `ValidationPipe` global (`whitelist: true`).
- Listagens paginadas: `?page=&limit=` → `{ data, meta: { total, page, limit } }`.
- Erros no formato `{ statusCode, message, error }` (padrão Nest).
- Transições de status (proposta, deal) validadas no service — transição inválida retorna `422`.
- **Escopo por responsável nas leituras**: sem `cliente:ver_todos` / `oportunidade:ver_todas` /
  `demanda:ver_todas`, as listagens, quadros e leituras por id do recurso devolvem apenas os
  registros do usuário e os **sem responsável**. Escritas seguem governadas pelas chaves
  `:gerenciar`. Atribuir alguém de outra workspace retorna `422`.
- Jobs diários (cron do Nest `@nestjs/schedule`):
  1. Marca propostas vencidas como `EXPIRED`;
  2. Gera a próxima mensalidade de contratos `RECURRING` ativos (30 dias antes do vencimento, idempotente — nunca duplica a cobrança do mês);
  3. Marca cobranças `PENDING` com vencimento passado como `OVERDUE`.

---

## 6. Arquitetura Técnica

### 6.1 Estrutura do repositório
```
CRM/
├── apps/
│   ├── api/                  # NestJS
│   │   ├── src/
│   │   │   ├── auth/
│   │   │   ├── clients/
│   │   │   ├── pipeline/     # stages + deals
│   │   │   ├── proposals/
│   │   │   ├── projects/     # projects + tasks
│   │   │   ├── activities/
│   │   │   ├── dashboard/
│   │   │   └── prisma/       # PrismaService global
│   │   └── prisma/schema.prisma
│   └── web/                  # React + Vite + TS
│       └── src/
│           ├── app/          # router, providers, layout
│           ├── features/     # clients, pipeline, proposals, projects, dashboard
│           ├── components/   # UI compartilhada (shadcn/ui)
│           ├── lib/          # api client (axios), utils, formatters
│           └── types/        # tipos compartilhados da API
├── docker-compose.yml        # PostgreSQL local
└── package.json              # workspaces (npm/pnpm)
```

### 6.2 Backend
- **NestJS 10+** com módulos por domínio (controller → service → Prisma)
- **Prisma** como ORM ⚠️ (alternativa: TypeORM, se preferir)
- **Auth**: JWT access token (15 min) + refresh token (7 dias), guard global com rota pública via decorator `@Public()`
- Senha com **argon2**
- Config via `@nestjs/config` + validação de `.env`
- Testes: unitários nos services de regra de negócio (transições de status, cálculo de total, versionamento, geração de parcelas e de mensalidades — incluindo idempotência do cron)

### 6.3 Frontend
- **React 18 + Vite + TypeScript** (strict)
- **React Router** (rotas: `/login`, `/`, `/clientes`, `/clientes/:id`, `/pipeline`, `/propostas`, `/propostas/:id`, `/projetos/:id`, `/demandas`, `/financeiro` (agenda de recebimentos), `/financeiro/contratos`, `/financeiro/contratos/:id`)
- **TanStack Query** para dados de servidor (cache, invalidação, optimistic update no drag & drop)
- **React Hook Form + Zod** para formulários
- **Tailwind CSS + shadcn/ui** para UI ⚠️
- **dnd-kit** para os Kanbans (pipeline e demandas)
- Axios com interceptor: injeta token e faz refresh automático em 401

### 6.4 Infra & requisitos não-funcionais
- `docker-compose.yml` com PostgreSQL 16 para desenvolvimento
- Migrations versionadas (`prisma migrate`)
- Seed inicial: usuários de demonstração + funil padrão **por owner** (em produção o funil nasce na criação da conta)
- CORS restrito ao domínio do front; rate limit no login (`@nestjs/throttler`)
- Backup: `pg_dump` diário (script/cron no servidor)
- Deploy alvo ⚠️: VPS com Docker (a definir)

---

## 7. Roadmap de Implementação

| Fase | Entrega | Conteúdo |
|---|---|---|
| **0** | Fundação | Monorepo, docker-compose, Nest + Prisma + migrations, Vite + Tailwind + shadcn, auth completo (login, guard, refresh), layout base com navegação |
| **1** | Clientes | CRUD clientes + contatos, timeline de atividades, follow-ups |
| **2** | Pipeline | Estágios configuráveis, Kanban de oportunidades com drag & drop |
| **3** | Propostas | CRUD com itens, cálculo de total, ciclo de status, versionamento, expiração automática |
| **4** | Demandas | Projetos, tarefas, Kanban por projeto, visão "Minhas demandas" |
| **5** | Financeiro | Contratos (mensalidade, entrada + parcelas, à vista), geração de cobranças, agenda de recebimentos, baixa/estorno, crons de recorrência e atraso |
| **6** | Dashboard | Métricas comerciais e financeiras (MRR, previsto × recebido, inadimplência), funil, próximas ações; polimento geral e seed de demonstração |

Cada fase termina com o sistema **utilizável de ponta a ponta** — dá para começar a usar o CRM de verdade a partir da Fase 1.

---

## 8. Decisões

1. **ORM**: Prisma (assumido) ou TypeORM?  ⚠️
2. **UI kit**: shadcn/ui + Tailwind (assumido) ou outra biblioteca (MUI, Ant)?  ⚠️
3. **Gerenciador de pacotes/workspace**: pnpm workspaces (sugerido) ou npm?  ⚠️
4. **Deploy**: VPS com Docker. ✅ decidido
5. **Financeiro — juros/multa por atraso**: fora do MVP — atraso é só sinalizado, sem cálculo de encargos. ✅ decidido
6. **Financeiro — reajuste de mensalidade**: manual (editar o valor da mensalidade vale para as próximas cobranças); sem reajuste automático (IPCA/percentual) no MVP. ✅ decidido
