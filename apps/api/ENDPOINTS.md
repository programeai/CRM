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
