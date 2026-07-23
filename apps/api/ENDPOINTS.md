# Endpoints da API

Referência de todas as rotas HTTP, consumível por IA. **Fonte de verdade viva:** toda rota nova/alterada/removida é refletida aqui no mesmo commit/PR (ver `apps/api/CLAUDE.md` → "Documentação de endpoints").

Prefixo global: `/api/v1`. Formato fixo por endpoint — não altere os rótulos.

---

## Auth

### POST /auth/login
- **Propósito:** Autenticar por e-mail e senha, emitindo um access token e um refresh token.
- **Auth:** Pública (`@Public()`). Rate limit: 5 req/min.
- **Body:** `{ email: string (e-mail), password: string (mín. 6) }`
- **Resposta:** `200 { accessToken: string }` + cookie `httpOnly` `refresh_token` (path `/api/v1/auth`).
- **Erros:** `401 Credenciais inválidas`.
- **Handler:** `modules/auth/auth.controller.ts` → `AuthController.login`

### POST /auth/refresh
- **Propósito:** Renovar o access token a partir do refresh token em cookie, rotacionando o refresh.
- **Auth:** Pública (`@Public()`); exige o cookie `refresh_token` válido.
- **Body:** — (lê o cookie `refresh_token`)
- **Resposta:** `200 { accessToken: string }` + novo cookie `refresh_token`.
- **Erros:** `401` (cookie ausente, inválido ou não confere com o hash persistido).
- **Handler:** `modules/auth/auth.controller.ts` → `AuthController.refresh`

### GET /auth/me
- **Propósito:** Retornar o usuário autenticado (sem campos sensíveis).
- **Auth:** Bearer (access token).
- **Body:** —
- **Resposta:** `200 { id, name, email, createdAt }` (sem `passwordHash`/`refreshTokenHash`).
- **Erros:** `401`.
- **Handler:** `modules/auth/auth.controller.ts` → `AuthController.me`

### POST /auth/logout
- **Propósito:** Encerrar a sessão: revoga o refresh token persistido e limpa o cookie.
- **Auth:** Bearer (access token).
- **Body:** —
- **Resposta:** `200 { ok: true }` + `Set-Cookie` limpando `refresh_token`.
- **Erros:** `401`.
- **Handler:** `modules/auth/auth.controller.ts` → `AuthController.logout`

---

## Clients

### GET /clients
- **Propósito:** Listar clientes do usuário autenticado (não arquivados), com busca e filtros, paginado.
- **Auth:** Bearer (access token).
- **Body:** — (query: `page?`, `limit?`, `search?`, `status?`, `source?`)
- **Resposta:** `200 { data: Client[], meta: { total, page, limit } }`.
- **Erros:** `400` (query inválida), `401`.
- **Handler:** `modules/clients/api/clients.controller.ts` → `ClientsController.list`

### POST /clients
- **Propósito:** Criar um cliente para o usuário autenticado (`ownerId` derivado do token).
- **Auth:** Bearer (access token).
- **Body:** `{ name: string (mín. 2), personType: PersonType, tradeName?, document?, email?, phone?, website?, source?, status?, tags?: string[], notes?, zipCode?, street?, number?, complement?, district?, city?, state? }`
- **Resposta:** `201 Client`.
- **Erros:** `400` (validação / `CPF inválido.` / `CNPJ inválido.`), `409 Já existe um cliente com este documento.`, `401`.
- **Handler:** `modules/clients/api/clients.controller.ts` → `ClientsController.create`

### GET /clients/:id
- **Propósito:** Buscar um cliente do usuário autenticado pelo id.
- **Auth:** Bearer (access token).
- **Body:** —
- **Resposta:** `200 Client`.
- **Erros:** `404 Cliente não encontrado.`, `401`.
- **Handler:** `modules/clients/api/clients.controller.ts` → `ClientsController.findOne`

### PATCH /clients/:id
- **Propósito:** Atualizar parcialmente um cliente do usuário autenticado.
- **Auth:** Bearer (access token).
- **Body:** Campos parciais de `POST /clients` (todos opcionais). `document` pode ser enviado como `null`/vazio para limpar.
- **Resposta:** `200 Client`.
- **Erros:** `400` (validação / `CPF inválido.` / `CNPJ inválido.`), `409 Já existe um cliente com este documento.`, `404 Cliente não encontrado.`, `401`.
- **Handler:** `modules/clients/api/clients.controller.ts` → `ClientsController.update`

### POST /clients/:id/archive
- **Propósito:** Arquivar (soft delete) um cliente, setando `archivedAt`. O cliente some da listagem padrão.
- **Auth:** Bearer (access token).
- **Body:** —
- **Resposta:** `200 Client` (com `archivedAt` preenchido).
- **Erros:** `404 Cliente não encontrado.`, `401`.
- **Handler:** `modules/clients/api/clients.controller.ts` → `ClientsController.archive`

---

## Contacts

### GET /clients/:clientId/contacts
- **Propósito:** Listar os contatos de um cliente (principal primeiro, depois por nome).
- **Auth:** Bearer (access token).
- **Body:** —
- **Resposta:** `200 Contact[]`.
- **Erros:** `404 Cliente não encontrado.` (cliente de outro dono ou inexistente), `401`.
- **Handler:** `modules/contacts/api/contacts.controller.ts` → `ContactsController.list`

### POST /clients/:clientId/contacts
- **Propósito:** Criar um contato para o cliente. O primeiro contato vira principal automaticamente; marcar `isPrimary` desmarca os demais.
- **Auth:** Bearer (access token).
- **Body:** `{ name: string (mín. 2), role?, email?, phone?, isPrimary?: boolean }`
- **Resposta:** `201 Contact`.
- **Erros:** `400` (validação), `404 Cliente não encontrado.`, `401`.
- **Handler:** `modules/contacts/api/contacts.controller.ts` → `ContactsController.create`

### PATCH /contacts/:id
- **Propósito:** Atualizar parcialmente um contato. Marcar `isPrimary: true` desmarca os demais contatos do cliente.
- **Auth:** Bearer (access token).
- **Body:** Campos parciais de `POST` (todos opcionais).
- **Resposta:** `200 Contact`.
- **Erros:** `400` (validação), `404 Contato não encontrado.` (ou cliente de outro dono), `401`.
- **Handler:** `modules/contacts/api/contacts.controller.ts` → `ContactsController.update`

### DELETE /contacts/:id
- **Propósito:** Excluir um contato do cliente.
- **Auth:** Bearer (access token).
- **Body:** —
- **Resposta:** `200` (sem corpo).
- **Erros:** `404 Contato não encontrado.` (ou cliente de outro dono), `401`.
- **Handler:** `modules/contacts/api/contacts.controller.ts` → `ContactsController.remove`

---

## Activities

### GET /activities
- **Propósito:** Listar atividades (timeline), filtrando por `clientId` e/ou `dealId`, em ordem `createdAt desc`, paginado.
- **Auth:** Bearer (access token).
- **Body:** — (query: `page?`, `limit?`, `clientId?`, `dealId?`)
- **Resposta:** `200 { data: Activity[], meta: { total, page, limit } }`.
- **Erros:** `400` (query inválida), `404 Cliente não encontrado.` (quando `clientId` é de outro dono), `401`.
- **Handler:** `modules/activities/api/activities.controller.ts` → `ActivitiesController.list`

### POST /activities
- **Propósito:** Criar uma atividade/anotação na timeline de um cliente. Com `type: FOLLOW_UP` e `scheduledFor`, registra um follow-up.
- **Auth:** Bearer (access token).
- **Body:** `{ clientId: uuid, type: ActivityType, content: string, dealId?: uuid, scheduledFor?: ISO date }`
- **Resposta:** `201 Activity`.
- **Erros:** `400` (validação), `404 Cliente não encontrado.`, `401`.
- **Handler:** `modules/activities/api/activities.controller.ts` → `ActivitiesController.create`

### PATCH /activities/:id
- **Propósito:** Atualizar parcialmente uma atividade (não permite mover de cliente — `clientId` omitido).
- **Auth:** Bearer (access token).
- **Body:** `{ type?, content?, dealId?, scheduledFor? }`
- **Resposta:** `200 Activity`.
- **Erros:** `400` (validação), `404 Atividade não encontrada.` (ou cliente de outro dono), `401`.
- **Handler:** `modules/activities/api/activities.controller.ts` → `ActivitiesController.update`

### POST /activities/:id/complete
- **Propósito:** Concluir uma atividade (follow-up), definindo `completedAt`.
- **Auth:** Bearer (access token).
- **Body:** —
- **Resposta:** `200 Activity` (com `completedAt` preenchido).
- **Erros:** `404 Atividade não encontrada.` (ou cliente de outro dono), `401`.
- **Handler:** `modules/activities/api/activities.controller.ts` → `ActivitiesController.complete`

---

## Pipeline stages

### GET /pipeline-stages
- **Propósito:** Listar os estágios do pipeline, ordenados por `order`.
- **Auth:** Bearer (access token).
- **Body:** —
- **Resposta:** `200 PipelineStage[]`.
- **Erros:** `401`.
- **Handler:** `modules/pipeline/api/pipeline-stages.controller.ts` → `PipelineStagesController.list`

### POST /pipeline-stages
- **Propósito:** Criar um novo estágio no fim da ordem atual.
- **Auth:** Bearer (access token).
- **Body:** `{ name: string (mín. 2), isWon?: boolean, isLost?: boolean }`
- **Resposta:** `201 PipelineStage`.
- **Erros:** `400` (validação), `409 Já existe um estágio com este nome.`, `401`.
- **Handler:** `modules/pipeline/api/pipeline-stages.controller.ts` → `PipelineStagesController.create`

### PATCH /pipeline-stages/reorder
- **Propósito:** Reatribuir a ordem (`order`) sequencial dos estágios conforme a lista de ids informada.
- **Auth:** Bearer (access token).
- **Body:** `{ ids: uuid[] }`
- **Resposta:** `200 PipelineStage[]` (já reordenados).
- **Erros:** `400` (validação), `401`.
- **Handler:** `modules/pipeline/api/pipeline-stages.controller.ts` → `PipelineStagesController.reorder`

### PATCH /pipeline-stages/:id
- **Propósito:** Atualizar parcialmente um estágio (nome, `isWon`, `isLost`).
- **Auth:** Bearer (access token).
- **Body:** Campos parciais de `POST /pipeline-stages`.
- **Resposta:** `200 PipelineStage`.
- **Erros:** `400` (validação), `404 Estágio não encontrado.`, `409 Já existe um estágio com este nome.`, `401`.
- **Handler:** `modules/pipeline/api/pipeline-stages.controller.ts` → `PipelineStagesController.update`

### DELETE /pipeline-stages/:id
- **Propósito:** Excluir um estágio, desde que não possua oportunidades vinculadas.
- **Auth:** Bearer (access token).
- **Body:** —
- **Resposta:** `200` (sem corpo).
- **Erros:** `404 Estágio não encontrado.`, `409 Não é possível excluir um estágio que possui oportunidades.`, `401`.
- **Handler:** `modules/pipeline/api/pipeline-stages.controller.ts` → `PipelineStagesController.remove`

---

## Deals

### GET /deals
- **Propósito:** Listar oportunidades do usuário autenticado (via cliente), com filtros e paginação.
- **Auth:** Bearer (access token).
- **Body:** — (query: `page?`, `limit?`, `clientId?`, `stageId?`, `search?`)
- **Resposta:** `200 { data: Deal[], meta: { total, page, limit } }` (`Deal` inclui `client: { id, name }`).
- **Erros:** `400` (query inválida), `404 Cliente não encontrado.` (quando `clientId` é de outro dono), `401`.
- **Handler:** `modules/pipeline/api/deals.controller.ts` → `DealsController.list`

### GET /deals/board
- **Propósito:** Retornar todas as oportunidades do usuário autenticado, sem paginação, ordenadas por `stageId` e `position` — alimenta o Kanban.
- **Auth:** Bearer (access token).
- **Body:** —
- **Resposta:** `200 Deal[]` (com `client: { id, name }`).
- **Erros:** `401`.
- **Handler:** `modules/pipeline/api/deals.controller.ts` → `DealsController.board`

### POST /deals
- **Propósito:** Criar uma oportunidade para um cliente do usuário autenticado. Sem `stageId`, entra no primeiro estágio; `position` vai para o fim da coluna.
- **Auth:** Bearer (access token).
- **Body:** `{ title: string (mín. 2), clientId: uuid, serviceType: ServiceType, stageId?: uuid, amount?: number, probability?: number (0-100), expectedClose?: ISO date }`
- **Resposta:** `201 Deal`.
- **Erros:** `400` (validação), `404 Cliente não encontrado.` / `404 Estágio não encontrado.`, `401`.
- **Handler:** `modules/pipeline/api/deals.controller.ts` → `DealsController.create`

### GET /deals/:id
- **Propósito:** Buscar uma oportunidade, validando que o cliente pertence ao usuário autenticado.
- **Auth:** Bearer (access token).
- **Body:** —
- **Resposta:** `200 Deal`.
- **Erros:** `404 Oportunidade não encontrada.` (ou cliente de outro dono), `401`.
- **Handler:** `modules/pipeline/api/deals.controller.ts` → `DealsController.findOne`

### PATCH /deals/:id
- **Propósito:** Atualizar parcialmente uma oportunidade (não move de estágio — usar `/move`; `clientId`/`stageId` fora do body).
- **Auth:** Bearer (access token).
- **Body:** Campos parciais de `POST /deals` exceto `clientId`/`stageId`.
- **Resposta:** `200 Deal`.
- **Erros:** `400` (validação), `404 Oportunidade não encontrada.`, `401`.
- **Handler:** `modules/pipeline/api/deals.controller.ts` → `DealsController.update`

### PATCH /deals/:id/move
- **Propósito:** Mover a oportunidade para `(stageId, position)`, reindexando as colunas afetadas em transação. Ao mover para um estágio `isLost`, exige `lostReason`; ao sair de um estágio `isLost` para outro, limpa `lostReason`. Muda de estágio → atualiza `stageMovedAt`. Ao mover para um estágio `isWon` (mudança de estágio), cria automaticamente um Projeto a partir do deal (idempotente por `dealId`).
- **Auth:** Bearer (access token).
- **Body:** `{ stageId: uuid, position: number (>=0), lostReason?: string }`
- **Resposta:** `200 Deal`.
- **Erros:** `400` (validação), `404 Oportunidade não encontrada.` / `404 Estágio não encontrado.`, `422 Informe o motivo da perda.`, `401`.
- **Handler:** `modules/pipeline/api/deals.controller.ts` → `DealsController.move`

### DELETE /deals/:id
- **Propósito:** Excluir (hard delete) uma oportunidade. `Proposal`/`Activity` vinculados mantêm o registro com `dealId = null`.
- **Auth:** Bearer (access token).
- **Body:** —
- **Resposta:** `200` (sem corpo).
- **Erros:** `404 Oportunidade não encontrada.`, `401`.
- **Handler:** `modules/pipeline/api/deals.controller.ts` → `DealsController.remove`

---

## Proposals

### GET /proposals
- **Propósito:** Listar propostas do usuário autenticado (via cliente), com filtros e paginação. `search` filtra por número da proposta ou nome/email do cliente (contains, case-insensitive).
- **Auth:** Bearer (access token).
- **Body:** — (query: `page?`, `limit?`, `search?`, `clientId?`, `status?`)
- **Resposta:** `200 { data: Proposal[], meta: { total, page, limit } }` (`Proposal` inclui `items[]` e `client: { id, name }`).
- **Erros:** `400` (query inválida), `404 Cliente não encontrado.` (quando `clientId` é de outro dono), `401`.
- **Handler:** `modules/proposals/api/proposals.controller.ts` → `ProposalsController.list`

### POST /proposals
- **Propósito:** Criar uma proposta (status `DRAFT`, `version 1`); gera `number` PROP-AAAA-NNNN e calcula `total` no backend a partir dos itens e desconto.
- **Auth:** Bearer (access token).
- **Body:** `{ clientId: uuid, serviceType: ServiceType, items: [{ description, quantity, unitPrice }] (≥1), dealId?: uuid, discount?: number, scope?, paymentTerms?, deliveryTime?, validUntil?: ISO date }`
- **Resposta:** `201 Proposal` (com `items[]`, `total`, `number`).
- **Erros:** `400` (validação / `Informe ao menos um item.`), `404 Cliente não encontrado.` / `Oportunidade não encontrada.`, `401`.
- **Handler:** `modules/proposals/api/proposals.controller.ts` → `ProposalsController.create`

### GET /proposals/:id
- **Propósito:** Buscar uma proposta, validando que o cliente pertence ao usuário autenticado.
- **Auth:** Bearer (access token).
- **Body:** —
- **Resposta:** `200 Proposal` (com `items[]`).
- **Erros:** `404 Proposta não encontrada.`, `401`.
- **Handler:** `modules/proposals/api/proposals.controller.ts` → `ProposalsController.findOne`

### GET /proposals/:id/versions
- **Propósito:** Listar todas as versões da cadeia (mesmo `number`) da proposta informada, ordenadas por `version`.
- **Auth:** Bearer (access token).
- **Body:** —
- **Resposta:** `200 Proposal[]`.
- **Erros:** `404 Proposta não encontrada.`, `401`.
- **Handler:** `modules/proposals/api/proposals.controller.ts` → `ProposalsController.versions`

### PATCH /proposals/:id
- **Propósito:** Atualizar parcialmente uma proposta **apenas em rascunho** (`DRAFT`). Se `items` for informado, substitui os itens e recalcula `total`.
- **Auth:** Bearer (access token).
- **Body:** Campos parciais de `POST /proposals` exceto `clientId`/`dealId`.
- **Resposta:** `200 Proposal`.
- **Erros:** `400` (validação), `404 Proposta não encontrada.`, `422 Apenas rascunhos podem ser editados. Crie uma nova versão.`, `401`.
- **Handler:** `modules/proposals/api/proposals.controller.ts` → `ProposalsController.update`

### DELETE /proposals/:id
- **Propósito:** Excluir uma proposta **apenas em rascunho** (`DRAFT`), removendo também seus itens.
- **Auth:** Bearer (access token).
- **Body:** —
- **Resposta:** `200` (sem corpo).
- **Erros:** `404 Proposta não encontrada.`, `422 Apenas rascunhos podem ser excluídos.`, `401`.
- **Handler:** `modules/proposals/api/proposals.controller.ts` → `ProposalsController.remove`

### POST /proposals/:id/send
- **Propósito:** Enviar a proposta (`DRAFT` → `SENT`), setando `sentAt`.
- **Auth:** Bearer (access token).
- **Body:** —
- **Resposta:** `200 Proposal` (status `SENT`).
- **Erros:** `404 Proposta não encontrada.`, `422 Transição de status inválida.`, `401`.
- **Handler:** `modules/proposals/api/proposals.controller.ts` → `ProposalsController.send`

### POST /proposals/:id/accept
- **Propósito:** Aceitar a proposta (`SENT`/`NEGOTIATING` → `ACCEPTED`), setando `decidedAt`. Se houver `dealId`, move o deal vinculado para o estágio "Ganhou" (isWon); ao mover, um Projeto é criado automaticamente a partir do deal (idempotente por `dealId`).
- **Auth:** Bearer (access token).
- **Body:** —
- **Resposta:** `200 Proposal` (status `ACCEPTED`).
- **Erros:** `404 Proposta não encontrada.`, `422 Transição de status inválida.`, `401`.
- **Handler:** `modules/proposals/api/proposals.controller.ts` → `ProposalsController.accept`

### POST /proposals/:id/reject
- **Propósito:** Recusar a proposta (`SENT`/`NEGOTIATING` → `REJECTED`), setando `decidedAt`.
- **Auth:** Bearer (access token).
- **Body:** —
- **Resposta:** `200 Proposal` (status `REJECTED`).
- **Erros:** `404 Proposta não encontrada.`, `422 Transição de status inválida.`, `401`.
- **Handler:** `modules/proposals/api/proposals.controller.ts` → `ProposalsController.reject`

### POST /proposals/:id/new-version
- **Propósito:** Criar uma nova versão da proposta (mesmo `number`, `version+1`, `parentId` = origem), copiando itens e campos, com status `DRAFT`.
- **Auth:** Bearer (access token).
- **Body:** —
- **Resposta:** `201 Proposal` (nova versão, `DRAFT`).
- **Erros:** `404 Proposta não encontrada.`, `401`.
- **Handler:** `modules/proposals/api/proposals.controller.ts` → `ProposalsController.newVersion`

## Projects

### GET /projects
- **Propósito:** Listar projetos do usuário autenticado, paginado, com filtro opcional por cliente, status e busca por nome.
- **Auth:** Bearer (access token).
- **Body:** — (query: `page`, `limit`, `clientId?`, `status?`, `search?`).
- **Resposta:** `200 Paginated<Project>` (com `client` e `_count.tasks`).
- **Erros:** `400` (validação), `404 Cliente não encontrado.` (se `clientId` não for do dono), `401`.
- **Handler:** `modules/projects/api/projects.controller.ts` → `ProjectsController.list`

### POST /projects
- **Propósito:** Criar um projeto vinculado a um cliente do usuário autenticado.
- **Auth:** Bearer (access token).
- **Body:** `{ name, clientId, serviceType, proposalId?, startDate?, dueDate? }`.
- **Resposta:** `201 Project`.
- **Erros:** `400` (validação), `404 Cliente não encontrado.`, `401`.
- **Handler:** `modules/projects/api/projects.controller.ts` → `ProjectsController.create`

### GET /projects/:id
- **Propósito:** Buscar um projeto, validando que o cliente pertence ao usuário autenticado.
- **Auth:** Bearer (access token).
- **Body:** —
- **Resposta:** `200 Project`.
- **Erros:** `404 Projeto não encontrado.`, `401`.
- **Handler:** `modules/projects/api/projects.controller.ts` → `ProjectsController.findOne`

### PATCH /projects/:id
- **Propósito:** Atualizar parcialmente um projeto (nome, tipo de serviço, status, início, prazo). `clientId`/`proposalId` são imutáveis.
- **Auth:** Bearer (access token).
- **Body:** Campos parciais de `POST /projects` exceto `clientId`/`proposalId`, mais `status?`.
- **Resposta:** `200 Project`.
- **Erros:** `400` (validação), `404 Projeto não encontrado.`, `401`.
- **Handler:** `modules/projects/api/projects.controller.ts` → `ProjectsController.update`

### DELETE /projects/:id
- **Propósito:** Excluir um projeto, desde que não possua tarefas vinculadas.
- **Auth:** Bearer (access token).
- **Body:** —
- **Resposta:** `200` (sem corpo).
- **Erros:** `404 Projeto não encontrado.`, `409 Não é possível excluir um projeto que possui tarefas.`, `401`.
- **Handler:** `modules/projects/api/projects.controller.ts` → `ProjectsController.remove`

## Tasks

### GET /tasks
- **Propósito:** Listar tarefas do usuário autenticado, paginado, cruzando projetos ("Minhas demandas"), com filtros por projeto, cliente, status, prioridade e prazo.
- **Auth:** Bearer (access token).
- **Body:** — (query: `page`, `limit`, `projectId?`, `clientId?`, `status?`, `priority?`, `dueBefore?`).
- **Resposta:** `200 Paginated<Task>` (com `project` e `project.client`), ordenado por prazo (`dueDate asc`, nulls por último), prioridade e criação.
- **Erros:** `400` (validação), `404 Projeto não encontrado.` (se `projectId` não for do dono), `401`.
- **Handler:** `modules/projects/api/tasks.controller.ts` → `TasksController.list`

### GET /tasks/board
- **Propósito:** Alimentar o Kanban de tarefas. Com `projectId`, lista as tarefas do projeto ordenadas por `(status, position)`. Sem `projectId`, lista todas as tarefas do usuário autenticado (board cross-projeto de "Minhas demandas"), ordenadas por `(status, prazo asc, prioridade desc, position)`.
- **Auth:** Bearer (access token).
- **Body:** — (query: `projectId` opcional).
- **Resposta:** `200 Task[]`.
- **Erros:** `404 Projeto não encontrado.` (quando `projectId` é informado e não pertence ao usuário), `401`.
- **Handler:** `modules/projects/api/tasks.controller.ts` → `TasksController.board`

### POST /tasks
- **Propósito:** Criar uma tarefa em um projeto do usuário autenticado, no fim da coluna de status (`position` sequencial).
- **Auth:** Bearer (access token).
- **Body:** `{ projectId, title, description?, status?, priority?, dueDate?, tags?, checklist? }`.
- **Resposta:** `201 Task`.
- **Erros:** `400` (validação), `404 Projeto não encontrado.`, `401`.
- **Handler:** `modules/projects/api/tasks.controller.ts` → `TasksController.create`

### GET /tasks/:id
- **Propósito:** Buscar uma tarefa, validando posse via projeto→cliente do usuário autenticado.
- **Auth:** Bearer (access token).
- **Body:** —
- **Resposta:** `200 Task`.
- **Erros:** `404 Tarefa não encontrada.`, `401`.
- **Handler:** `modules/projects/api/tasks.controller.ts` → `TasksController.findOne`

### PATCH /tasks/:id
- **Propósito:** Atualizar parcialmente uma tarefa (título, descrição, prioridade, prazo, tags, checklist). `projectId` é imutável; `status` só muda via `/move`.
- **Auth:** Bearer (access token).
- **Body:** Campos parciais de `POST /tasks` exceto `projectId`/`status`.
- **Resposta:** `200 Task`.
- **Erros:** `400` (validação), `404 Tarefa não encontrada.`, `401`.
- **Handler:** `modules/projects/api/tasks.controller.ts` → `TasksController.update`

### PATCH /tasks/:id/move
- **Propósito:** Mover a tarefa para outra coluna/posição do board, reindexando as colunas de origem e destino em transação. Ao entrar em `DONE`, seta `completedAt`; ao sair, limpa.
- **Auth:** Bearer (access token).
- **Body:** `{ status, position }`.
- **Resposta:** `200 Task`.
- **Erros:** `400` (validação), `404 Tarefa não encontrada.`, `401`.
- **Handler:** `modules/projects/api/tasks.controller.ts` → `TasksController.move`

### DELETE /tasks/:id
- **Propósito:** Excluir uma tarefa.
- **Auth:** Bearer (access token).
- **Body:** —
- **Resposta:** `200` (sem corpo).
- **Erros:** `404 Tarefa não encontrada.`, `401`.
- **Handler:** `modules/projects/api/tasks.controller.ts` → `TasksController.remove`

---

## Contracts

### GET /contracts
- **Propósito:** Listar contratos do usuário autenticado, paginado, com filtro opcional por cliente, status e regime de cobrança.
- **Auth:** Bearer (access token).
- **Body:** — (query: `page`, `limit`, `clientId?`, `status?`, `billingType?`).
- **Resposta:** `200 Paginated<Contract>` (com `client` e `payments` ordenadas por vencimento).
- **Erros:** `400` (validação), `404 Cliente não encontrado.` (se `clientId` não for do dono), `401`.
- **Handler:** `modules/finance/api/contracts.controller.ts` → `ContractsController.list`

### POST /contracts
- **Propósito:** Criar um contrato vinculado a um cliente do usuário autenticado. Conforme o regime (`billingType`), gera a agenda de cobranças: `INSTALLMENTS` cria Entrada (se houver) + N parcelas; `ONE_TIME` cria uma cobrança única; `RECURRING` não cria nenhuma (o cron gera as mensalidades).
- **Auth:** Bearer (access token).
- **Body:** `{ clientId, description, billingType, projectId?, proposalId?, ` + campos condicionais por regime: RECURRING `{ monthlyAmount, billingDay (1-28), startDate, endDate? }`; INSTALLMENTS `{ downPayment?, downPaymentDueDate?, installments, installmentAmount, firstInstallmentDueDate }`; ONE_TIME `{ amount, dueDate }` `}`.
- **Resposta:** `201 Contract` (com `payments` já geradas conforme o regime).
- **Erros:** `400` (validação), `404 Cliente não encontrado.`, `401`.
- **Handler:** `modules/finance/api/contracts.controller.ts` → `ContractsController.create`

### GET /contracts/:id
- **Propósito:** Buscar um contrato, validando que o cliente pertence ao usuário autenticado.
- **Auth:** Bearer (access token).
- **Body:** —
- **Resposta:** `200 Contract` (com `payments`).
- **Erros:** `404 Contrato não encontrado.`, `401`.
- **Handler:** `modules/finance/api/contracts.controller.ts` → `ContractsController.findOne`

### PATCH /contracts/:id
- **Propósito:** Atualizar parcialmente um contrato (descrição, valor mensal, dia de vencimento, data de término). `clientId`/`billingType` e os campos de INSTALLMENTS já materializados em cobranças são imutáveis. Reajuste de `monthlyAmount` vale só para as mensalidades ainda não geradas.
- **Auth:** Bearer (access token).
- **Body:** `{ description?, monthlyAmount?, billingDay?, endDate? }`.
- **Resposta:** `200 Contract`.
- **Erros:** `400` (validação), `404 Contrato não encontrado.`, `401`.
- **Handler:** `modules/finance/api/contracts.controller.ts` → `ContractsController.update`

### POST /contracts/:id/pause
- **Propósito:** Pausar um contrato `ACTIVE` (suspende a geração de novas mensalidades pelo cron).
- **Auth:** Bearer (access token).
- **Body:** —
- **Resposta:** `200 Contract` (`status: PAUSED`).
- **Erros:** `404 Contrato não encontrado.`, `422 Transição de status inválida.`, `401`.
- **Handler:** `modules/finance/api/contracts.controller.ts` → `ContractsController.pause`

### POST /contracts/:id/resume
- **Propósito:** Retomar um contrato `PAUSED`.
- **Auth:** Bearer (access token).
- **Body:** —
- **Resposta:** `200 Contract` (`status: ACTIVE`).
- **Erros:** `404 Contrato não encontrado.`, `422 Transição de status inválida.`, `401`.
- **Handler:** `modules/finance/api/contracts.controller.ts` → `ContractsController.resume`

### POST /contracts/:id/cancel
- **Propósito:** Cancelar um contrato. Cancela também as cobranças `PENDING`/`OVERDUE` (em aberto); as `PAID` permanecem no histórico.
- **Auth:** Bearer (access token).
- **Body:** —
- **Resposta:** `200 Contract` (`status: CANCELED`, cobranças em aberto `CANCELED`).
- **Erros:** `404 Contrato não encontrado.`, `422 Transição de status inválida.`, `401`.
- **Handler:** `modules/finance/api/contracts.controller.ts` → `ContractsController.cancel`

---

## Payments

### GET /payments
- **Propósito:** Listar cobranças do usuário autenticado, paginado, com busca opcional por nome do cliente (`search`) e filtro opcional por cliente, contrato, status, regime de cobrança e período de vencimento.
- **Auth:** Bearer (access token).
- **Body:** — (query: `page`, `limit`, `search?` (nome do cliente, case-insensitive), `clientId?`, `contractId?`, `status?`, `billingType?`, `dueFrom?`, `dueTo?`, `sortBy?`, `sortDir?`). O `status` aceita um único valor (`?status=PAID`) **ou** vários (`?status=PENDING&status=OVERDUE`) — o resultado inclui qualquer um dos status informados. `sortBy` ∈ `status | client | contract | dueDate | amount`; `sortDir` ∈ `asc | desc` (padrão `asc`).
- **Resposta:** `200 Paginated<Payment>` (com `contract` e `contract.client`). Ordenação padrão (sem `sortBy`): status por prioridade (Vencido → Pendente → Pago → Cancelado), depois cliente, contrato e vencimento. Com `sortBy`, ordena pela coluna escolhida usando cliente/contrato/vencimento como desempate.
- **Erros:** `400` (validação), `404 Cliente não encontrado.` (se `clientId` não for do dono), `401`.
- **Handler:** `modules/finance/api/payments.controller.ts` → `PaymentsController.list`

### GET /payments/summary
- **Propósito:** Totais agregados das cobranças (para os cards de recebimentos), respeitando os mesmos filtros da listagem, **exceto** status: `recebido` (Σ de PAID, usando `paidAmount`), `aReceber` (Σ de PENDING + OVERDUE) e `emAtraso` (Σ de OVERDUE).
- **Auth:** Bearer (access token).
- **Body:** — (query: `search?`, `clientId?`, `contractId?`, `billingType?`, `dueFrom?`, `dueTo?`).
- **Resposta:** `200 { recebido: number, aReceber: number, emAtraso: number }`.
- **Erros:** `400` (validação), `404 Cliente não encontrado.` (se `clientId` não for do dono), `401`.
- **Handler:** `modules/finance/api/payments.controller.ts` → `PaymentsController.summary`

### PATCH /payments/:id
- **Propósito:** Editar uma cobrança (descrição, valor, vencimento), permitido apenas enquanto `PENDING`.
- **Auth:** Bearer (access token).
- **Body:** `{ description?, amount?, dueDate? }`.
- **Resposta:** `200 Payment`.
- **Erros:** `400` (validação), `404 Cobrança não encontrada.`, `422 Apenas cobranças pendentes podem ser editadas.`, `401`.
- **Handler:** `modules/finance/api/payments.controller.ts` → `PaymentsController.update`

### POST /payments/:id/pay
- **Propósito:** Dar baixa numa cobrança `PENDING`/`OVERDUE` (marca `PAID`, aceita valor recebido parcial/diferente).
- **Auth:** Bearer (access token).
- **Body:** `{ method, paidAt?, paidAmount?, notes? }`.
- **Resposta:** `200 Payment` (`status: PAID`, `paidAt`/`paidAmount`/`method` preenchidos).
- **Erros:** `400` (validação), `404 Cobrança não encontrada.`, `422 Transição de status inválida.`, `401`.
- **Handler:** `modules/finance/api/payments.controller.ts` → `PaymentsController.pay`

### POST /payments/:id/revert
- **Propósito:** Estornar uma cobrança `PAID` (volta a `PENDING`); nunca destrutivo — o estorno fica registrado em `notes`.
- **Auth:** Bearer (access token).
- **Body:** —
- **Resposta:** `200 Payment` (`status: PENDING`, `paidAt`/`paidAmount`/`method` limpos, `notes` com o registro do estorno).
- **Erros:** `404 Cobrança não encontrada.`, `422 Transição de status inválida.`, `401`.
- **Handler:** `modules/finance/api/payments.controller.ts` → `PaymentsController.revert`

### POST /payments/:id/cancel
- **Propósito:** Cancelar uma cobrança `PENDING`/`OVERDUE`.
- **Auth:** Bearer (access token).
- **Body:** —
- **Resposta:** `200 Payment` (`status: CANCELED`).
- **Erros:** `404 Cobrança não encontrada.`, `422 Transição de status inválida.`, `401`.
- **Handler:** `modules/finance/api/payments.controller.ts` → `PaymentsController.cancel`
