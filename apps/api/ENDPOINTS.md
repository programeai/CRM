# Endpoints da API

Referência de todas as rotas HTTP, consumível por IA. **Fonte de verdade viva:** toda rota nova/alterada/removida é refletida aqui no mesmo commit/PR (ver `apps/api/CLAUDE.md` → "Documentação de endpoints").

Prefixo global: `/api/v1`. Formato fixo por endpoint — não altere os rótulos.

**Vale para todas as rotas:** a resposta traz o cabeçalho `x-request-id` (o valor
recebido na requisição, se houver, senão um UUID novo). É a chave para puxar a
requisição inteira no Grafana — ver [`docs/observabilidade.md`](../../docs/observabilidade.md).
Erros não previstos respondem `500 { statusCode: 500, message: 'Erro interno do servidor.' }`.

**Owner × colaborador (vale para todas as rotas autenticadas):** o eixo de
isolamento é o `ownerId` da **workspace**, não o id de quem está logado. O
`AccessGuard` resolve `req.access = { userId, ownerId, isOwner, permissions }` a
cada requisição; é o `ownerId` daí que vira `app.owner_id` no RLS e que alimenta
`@CurrentOwnerId()`. Um colaborador enxerga e escreve exatamente os dados do
owner que o convidou, limitado pelas permissões do seu papel, e herda a
assinatura desse owner. O **owner tem todas as permissões** por definição.

- Onde o campo **Auth** cita `Permissão:`, várias chaves valem como **ou** — ter
  uma delas basta. Nessas rotas, faltar a permissão responde
  `403 { message: 'Você não tem permissão para <ação>.' }`.
- Toda rota autenticada responde `401 { message: 'Sua sessão não é mais válida. Entre novamente.' }`
  quando a conta foi apagada ou o colaborador foi desativado — a sessão cai na
  requisição seguinte, sem esperar o access token expirar.
- Catálogo de permissões: `GET /permissions` (e `apps/api/src/shared/permissions.ts`).

---

## Health

### GET /health
- **Propósito:** Liveness do processo da API. Usado pelo `healthcheck` do container em produção (`docker-compose.prod.yml`). Não toca o banco de propósito: responde se o Nest está de pé, não se as dependências estão saudáveis.
- **Auth:** Pública (`@Public()`).
- **Body:** —
- **Resposta:** `200 { status: 'ok', uptime: number }` — `uptime` em segundos inteiros desde o start do processo.
- **Erros:** —
- **Handler:** `modules/health/health.controller.ts` → `HealthController.check`

---

## Auth

### POST /auth/register
- **Propósito:** Autocadastro de usuário: cria a conta e já autentica, emitindo access token e refresh token.
- **Auth:** Pública (`@Public()`). Rate limit: 5 req/min.
- **Body:** `{ name: string (2–120), email: string (e-mail), password: string (mín. 6), captchaToken?: string }` — `captchaToken` (Cloudflare Turnstile) é obrigatório quando `TURNSTILE_SECRET_KEY` está configurado.
- **Resposta:** `201 { accessToken: string }` + cookie `httpOnly` `refresh_token` (path `/api/v1/auth`) + cookie `httpOnly` `device_id` (path `/api/v1`, 400 dias).
- **Erros:** `403 O autocadastro está desativado nesta instância. Peça um convite ao responsável pela conta.` (`REGISTRATION_ENABLED=false`); `409 Já existe uma conta com este e-mail.`; `400 Confirme que você não é um robô.` / `400 Falha na verificação do captcha. Tente novamente.` (captcha); `400` (validação).
- **Handler:** `modules/auth/auth.controller.ts` → `AuthController.register`

### POST /auth/login
- **Propósito:** Autenticar por e-mail e senha, emitindo um access token e um refresh token.
- **Auth:** Pública (`@Public()`). Rate limit: 5 req/min.
- **Body:** `{ email: string (e-mail), password: string (mín. 6) }`
- **Resposta:** `200 { accessToken: string }` + cookie `httpOnly` `refresh_token` (path `/api/v1/auth`) + cookie `httpOnly` `device_id` (path `/api/v1`, 400 dias).
- **Erros:** `401 Credenciais inválidas`.
- **Handler:** `modules/auth/auth.controller.ts` → `AuthController.login`

### POST /auth/forgot-password
- **Propósito:** Iniciar a redefinição de senha: gera um token de uso único (validade 1h), persiste apenas o hash e envia por e-mail (SMTP) o link `{FRONTEND_URL}/redefinir-senha?token=…`. Sem SMTP configurado, o link é logado no console (ver `MailService`).
- **Auth:** Pública (`@Public()`). Rate limit: 3 req/min.
- **Body:** `{ email: string (e-mail) }`
- **Resposta:** `201 { ok: true }` — resposta genérica (anti-enumeração): idêntica se o e-mail existe, não existe ou é de conta só-OAuth (sem senha).
- **Erros:** `400` (validação do e-mail).
- **Handler:** `modules/auth/auth.controller.ts` → `AuthController.forgotPassword`

### POST /auth/reset-password
- **Propósito:** Concluir a redefinição: valida o token, grava a nova senha (argon2) e revoga a sessão vigente (refresh token) forçando novo login.
- **Auth:** Pública (`@Public()`). Rate limit: 5 req/min.
- **Body:** `{ token: string, password: string (mín. 6) }`
- **Resposta:** `201 { ok: true }`.
- **Erros:** `410 Link de redefinição inválido. Solicite um novo.` / `410 Este link de redefinição já foi utilizado. Solicite um novo.` / `410 Este link de redefinição expirou. Solicite um novo.`; `400` (validação da senha).
- **Handler:** `modules/auth/auth.controller.ts` → `AuthController.resetPassword`

### POST /auth/refresh
- **Propósito:** Renovar o access token a partir do refresh token em cookie, rotacionando o refresh.
- **Auth:** Pública (`@Public()`); exige o cookie `refresh_token` válido.
- **Body:** — (lê o cookie `refresh_token`)
- **Resposta:** `200 { accessToken: string }` + novo cookie `refresh_token` + cookie `httpOnly` `device_id` (path `/api/v1`, 400 dias).
- **Erros:** `401` (cookie ausente, inválido ou não confere com o hash persistido).
- **Handler:** `modules/auth/auth.controller.ts` → `AuthController.refresh`

### GET /auth/me
- **Propósito:** Retornar o usuário autenticado (sem campos sensíveis) junto com o contexto de acesso — é o que o frontend usa para esconder navegação e ações (ver `useCan`).
- **Auth:** Bearer (access token).
- **Body:** —
- **Resposta:** `200 { id, name, email, active, acceptedAt, stripeCustomerId, createdAt, isOwner: boolean, role: { id, name } | null, permissions: string[] }`. Sem `passwordHash`; sem `ownerId`/`roleId` (o mesmo estado é expresso por `isOwner`/`role`). No owner, `isOwner: true`, `role: null` e `permissions` traz o catálogo inteiro.
- **Erros:** `401`.
- **Handler:** `modules/auth/auth.controller.ts` → `AuthController.me`

### PATCH /auth/me
- **Propósito:** Atualizar os dados cadastrais (nome e e-mail) do próprio usuário autenticado.
- **Auth:** Bearer (access token).
- **Body:** `{ name: string (2–120), email: string (e-mail) }`
- **Resposta:** `200 { id, name, email, createdAt }` (sem `passwordHash`).
- **Erros:** `409 Já existe uma conta com este e-mail.` (e-mail já usado por outra conta); `400` (validação); `401`.
- **Handler:** `modules/auth/auth.controller.ts` → `AuthController.updateMe`

### POST /auth/logout
- **Propósito:** Encerrar a sessão corrente: revoga a sessão deste dispositivo e limpa o cookie. Os demais dispositivos seguem logados.
- **Auth:** Bearer (access token).
- **Body:** —
- **Resposta:** `200 { ok: true }` + `Set-Cookie` limpando `refresh_token`.
- **Erros:** `401`.
- **Handler:** `modules/auth/auth.controller.ts` → `AuthController.logout`

### GET /auth/sessions
- **Propósito:** Listar as sessões ativas (dispositivos logados) do próprio usuário, da mais usada recentemente para a mais antiga. **Uma linha por aparelho**: o login novo revoga a sessão anterior do mesmo `device_id` (ver `modules/auth/device-cookie.ts`).
- **Auth:** Bearer (access token). Sem permissão — é dado de identidade do próprio usuário.
- **Body:** —
- **Resposta:** `200 Array<{ id, device, ip, createdAt, lastUsedAt, current }>`. `device` é um rótulo derivado do User-Agent ("Chrome no Windows"); `current: true` marca a sessão que fez esta requisição (ausente em access token emitido antes da Fase 8A). Sessão criada antes do cookie `device_id` não tem aparelho associado e só colapsa depois do primeiro refresh, que a adota.
- **Erros:** `401`.
- **Handler:** `modules/auth/auth.controller.ts` → `AuthController.sessions`

### DELETE /auth/sessions
- **Propósito:** Encerrar todas as sessões do próprio usuário **exceto a atual** ("Encerrar as outras sessões").
- **Auth:** Bearer (access token). Sem permissão.
- **Body:** —
- **Resposta:** `200 { revoked: number }`.
- **Erros:** `401`.
- **Handler:** `modules/auth/auth.controller.ts` → `AuthController.revokeOtherSessions`

### DELETE /auth/sessions/:id
- **Propósito:** Encerrar uma sessão específica do próprio usuário. O dispositivo revogado cai no próximo refresh; o access token dele vale até expirar.
- **Auth:** Bearer (access token). Sem permissão — só alcança sessões do próprio `userId`.
- **Body:** —
- **Resposta:** `200 { ok: true }`.
- **Erros:** `404 Sessão não encontrada.` (id inexistente, de outro usuário ou já revogado), `401`.
- **Handler:** `modules/auth/auth.controller.ts` → `AuthController.revokeSession`

### GET /auth/registration
- **Propósito:** Informar se o autocadastro está aberto nesta instância, para a UI não oferecer a tela de registro quando a API vai recusar.
- **Auth:** Pública (`@Public()`).
- **Body:** —
- **Resposta:** `200 { enabled: boolean }` — reflete `REGISTRATION_ENABLED` (default `true`).
- **Erros:** —
- **Handler:** `modules/auth/auth.controller.ts` → `AuthController.registration`

### GET /auth/oauth/providers
- **Propósito:** Informar quais provedores OAuth estão configurados, para a UI exibir só os botões que funcionam.
- **Auth:** Pública (`@Public()`).
- **Body:** —
- **Resposta:** `200 { google: boolean, github: boolean }` (true quando as duas credenciais do provedor estão presentes).
- **Erros:** —
- **Handler:** `modules/auth/auth.controller.ts` → `AuthController.oauthProviders`

### GET /auth/oauth/:provider
- **Propósito:** Iniciar o login/cadastro OAuth: gera o `state` anti-CSRF (cookie `oauth_state`) e redireciona ao provedor. `:provider` ∈ `google | github`.
- **Auth:** Pública (`@Public()`).
- **Body:** —
- **Resposta:** `302` para a tela de consentimento do provedor.
- **Erros:** `400` (provedor não suportado); `302 → {FRONTEND_URL}/login?error=oauth_indisponivel` (provedor sem credenciais).
- **Handler:** `modules/auth/auth.controller.ts` → `AuthController.oauthStart`

### GET /auth/oauth/:provider/callback
- **Propósito:** Retorno do provedor: valida o `state`, troca o `code` por perfil, entra ou cadastra (vínculo por e-mail verificado) e volta ao frontend. Emite o refresh token em cookie; o access token é obtido pelo frontend via `POST /auth/refresh`.
- **Auth:** Pública (`@Public()`); exige o cookie `oauth_state` conferindo com o `state` da query.
- **Query:** `code: string`, `state: string`
- **Resposta:** `302 → {FRONTEND_URL}` (autenticado) + cookie `httpOnly` `refresh_token` + cookie `httpOnly` `device_id` (path `/api/v1`, 400 dias).
- **Erros:** `302 → {FRONTEND_URL}/login?error=oauth` (state inválido, falha na troca, ou e-mail não verificado); `302 → {FRONTEND_URL}/login?error=cadastro_desativado` (e-mail desconhecido com `REGISTRATION_ENABLED=false`).
- **Handler:** `modules/auth/auth.controller.ts` → `AuthController.oauthCallback`

---

## Clients

### GET /clients
- **Propósito:** Listar clientes do usuário autenticado (não arquivados), com busca e filtros, paginado. Sem `cliente:ver_todos`, devolve apenas os registros do usuário e os sem responsável.
- **Auth:** Bearer (access token). Permissão: `cliente:ver` ou `cliente:gerenciar`.
- **Body:** — (query: `page?`, `limit?`, `search?`, `status?`, `sourceId?: uuid`, `assigneeId?: uuid`)
- **Resposta:** `200 { data: Client[], meta: { total, page, limit } }` (cada item inclui `source: { id, name, active } | null`).
- **Erros:** `400` (query inválida), `401`.
- **Handler:** `modules/clients/api/clients.controller.ts` → `ClientsController.list`

### POST /clients
- **Propósito:** Criar um cliente para o usuário autenticado (`ownerId` derivado do token).
- **Auth:** Bearer (access token). Permissão: `cliente:gerenciar`.
- **Body:** `{ name: string (mín. 2), tradeName?, document?, email?, phone?, website?, sourceId?: uuid | null, status?, tags?: string[], notes?, zipCode?, street?, number?, complement?, district?, city?, state?, assigneeId?: uuid | null }`
  `personType` **não** entra no corpo: é deduzido do `document` (11 dígitos = CPF → `INDIVIDUAL`, 14 = CNPJ → `COMPANY`). Sem documento, vale o default do schema (`COMPANY`). `sourceId` referencia um item vivo de `GET /catalogos/fontes-de-lead` do mesmo owner.
- **Resposta:** `201 Client` (com `assignee: { id, name } | null` e `source: { id, name, active } | null`).
- **Erros:** `400` (validação / `Documento inválido: informe um CPF (11 dígitos) ou um CNPJ (14 dígitos).` / `CPF inválido.` / `CNPJ inválido.`), `409 Já existe um cliente com este documento.`, `404 Fonte de lead não encontrado no catálogo.`, `422 Responsável inválido: escolha alguém da sua equipe.` / `422 Este fonte de lead foi excluído. Escolha outro ou cadastre-o novamente.`, `401`.
- **Handler:** `modules/clients/api/clients.controller.ts` → `ClientsController.create`

### GET /clients/tags
- **Propósito:** Listar as tags existentes do usuário autenticado (agregadas dos seus clientes não arquivados), com a contagem de uso de cada uma. Alimenta o autocomplete do seletor de tags. Não há catálogo próprio de tags: elas vivem como `String[]` por cliente.
- **Auth:** Bearer (access token). Permissão: `cliente:ver` ou `cliente:gerenciar`.
- **Body:** —
- **Resposta:** `200 { tag: string; count: number }[]` (ordenado por `count desc`, depois alfabético pt-BR).
- **Erros:** `401`.
- **Handler:** `modules/clients/api/clients.controller.ts` → `ClientsController.listTags`

### GET /clients/tags/usage
- **Propósito:** Listar os clientes do usuário autenticado que usam determinada tag. Usado pelo modal de confirmação de exclusão para mostrar onde a tag está em uso.
- **Auth:** Bearer (access token). Permissão: `cliente:ver` ou `cliente:gerenciar`.
- **Body:** — (query: `tag` obrigatório).
- **Resposta:** `200 { id: string; name: string }[]` (ordenado por `name asc`).
- **Erros:** `400 Tag inválida.` (tag vazia), `401`.
- **Handler:** `modules/clients/api/clients.controller.ts` → `ClientsController.tagUsage`

### DELETE /clients/tags
- **Propósito:** Excluir uma tag globalmente, removendo-a de todos os clientes do usuário autenticado (inclusive arquivados).
- **Auth:** Bearer (access token). Permissão: `cliente:gerenciar`.
- **Body:** — (query: `tag` obrigatório).
- **Resposta:** `200 { removed: number }` (quantidade de clientes afetados).
- **Erros:** `400 Tag inválida.` (tag vazia), `401`.
- **Handler:** `modules/clients/api/clients.controller.ts` → `ClientsController.deleteTag`

### GET /clients/:id
- **Propósito:** Buscar um cliente do usuário autenticado pelo id. Sem `cliente:ver_todos`, devolve apenas os registros do usuário e os sem responsável.
- **Auth:** Bearer (access token). Permissão: `cliente:ver` ou `cliente:gerenciar`.
- **Body:** —
- **Resposta:** `200 Client` (com `assignee: { id, name } | null` e `source: { id, name, active } | null`).
- **Erros:** `404 Cliente não encontrado.`, `401`.
- **Handler:** `modules/clients/api/clients.controller.ts` → `ClientsController.findOne`

### PATCH /clients/:id
- **Propósito:** Atualizar parcialmente um cliente do usuário autenticado.
- **Auth:** Bearer (access token). Permissão: `cliente:gerenciar`.
- **Body:** Campos parciais de `POST /clients` (todos opcionais). `document` pode ser enviado como `null`/vazio para limpar; `assigneeId: null` limpa o responsável, o campo ausente preserva. Trocar o `document` reclassifica o `personType`; limpá-lo preserva a classificação atual.
- **Resposta:** `200 Client` (com `assignee: { id, name } | null` e `source: { id, name, active } | null`).
- **Erros:** `400` (validação / `Documento inválido: informe um CPF (11 dígitos) ou um CNPJ (14 dígitos).` / `CPF inválido.` / `CNPJ inválido.`), `409 Já existe um cliente com este documento.`, `404 Cliente não encontrado.` / `404 Fonte de lead não encontrado no catálogo.`, `422 Responsável inválido: escolha alguém da sua equipe.` / `422 Este fonte de lead foi excluído. Escolha outro ou cadastre-o novamente.`, `401`.
- **Handler:** `modules/clients/api/clients.controller.ts` → `ClientsController.update`

### POST /clients/:id/archive
- **Propósito:** Arquivar (soft delete) um cliente, setando `archivedAt`. O cliente some da listagem padrão e passa a aparecer em `GET /trash`.
- **Auth:** Bearer (access token). Permissão: `cliente:gerenciar`.
- **Body:** —
- **Resposta:** `200 Client` (com `archivedAt` preenchido).
- **Erros:** `404 Cliente não encontrado.`, `401`.
- **Handler:** `modules/clients/api/clients.controller.ts` → `ClientsController.archive`

### POST /clients/:id/restore
- **Propósito:** Restaurar um cliente arquivado (limpa `archivedAt`), devolvendo-o às listagens.
- **Auth:** Bearer (access token). Permissão: `cliente:gerenciar`.
- **Body:** —
- **Resposta:** `200 Client` (com `archivedAt: null`).
- **Erros:** `404 Cliente não encontrado.`, `401`.
- **Handler:** `modules/clients/api/clients.controller.ts` → `ClientsController.restore`

### DELETE /clients/:id
- **Propósito:** Excluir em definitivo (expurgo) um cliente já arquivado. Exige que todos os vínculos (contatos, atividades, oportunidades, propostas, projetos, contratos) já tenham sido removidos antes — todas as FKs de filho para `Client` são `RESTRICT`.
- **Auth:** Bearer (access token). Permissão: `lixeira:expurgar`.
- **Body:** —
- **Resposta:** `200` (sem corpo).
- **Erros:** `404 Cliente não encontrado.`, `422 Só é possível excluir em definitivo um cliente que já esteja na lixeira. Arquive antes.`, `409 Não é possível excluir em definitivo um cliente com registros vinculados (…). Expurgue-os primeiro.`, `403`, `401`.
- **Handler:** `modules/clients/api/clients.controller.ts` → `ClientsController.purge`

---

## Contacts

### GET /clients/:clientId/contacts
- **Propósito:** Listar os contatos de um cliente (principal primeiro, depois por nome).
- **Auth:** Bearer (access token). Permissão: `cliente:ver` ou `cliente:gerenciar`.
- **Body:** —
- **Resposta:** `200 Contact[]`.
- **Erros:** `404 Cliente não encontrado.` (cliente de outro dono ou inexistente), `401`.
- **Handler:** `modules/contacts/api/contacts.controller.ts` → `ContactsController.list`

### POST /clients/:clientId/contacts
- **Propósito:** Criar um contato para o cliente. O primeiro contato vira principal automaticamente; marcar `isPrimary` desmarca os demais.
- **Auth:** Bearer (access token). Permissão: `cliente:gerenciar`.
- **Body:** `{ name: string (mín. 2), role?, email?, phone?, isPrimary?: boolean }`
- **Resposta:** `201 Contact`.
- **Erros:** `400` (validação), `404 Cliente não encontrado.`, `401`.
- **Handler:** `modules/contacts/api/contacts.controller.ts` → `ContactsController.create`

### PATCH /contacts/:id
- **Propósito:** Atualizar parcialmente um contato. Marcar `isPrimary: true` desmarca os demais contatos do cliente.
- **Auth:** Bearer (access token). Permissão: `cliente:gerenciar`.
- **Body:** Campos parciais de `POST` (todos opcionais).
- **Resposta:** `200 Contact`.
- **Erros:** `400` (validação), `404 Contato não encontrado.` (ou cliente de outro dono), `401`.
- **Handler:** `modules/contacts/api/contacts.controller.ts` → `ContactsController.update`

### POST /contacts/:id/archive
- **Propósito:** Arquivar (soft delete) um contato do cliente, setando `archivedAt`. O contato some da aba de contatos e passa a aparecer em `GET /trash`.
- **Auth:** Bearer (access token). Permissão: `cliente:gerenciar`.
- **Body:** —
- **Resposta:** `200 Contact` (com `archivedAt` preenchido).
- **Erros:** `404 Contato não encontrado.` (ou cliente de outro dono), `401`.
- **Handler:** `modules/contacts/api/contacts.controller.ts` → `ContactsController.archive`

### POST /contacts/:id/restore
- **Propósito:** Restaurar um contato arquivado (limpa `archivedAt`), devolvendo-o à aba do cliente.
- **Auth:** Bearer (access token). Permissão: `cliente:gerenciar`.
- **Body:** —
- **Resposta:** `200 Contact` (com `archivedAt: null`).
- **Erros:** `404 Contato não encontrado.` (ou cliente de outro dono), `401`.
- **Handler:** `modules/contacts/api/contacts.controller.ts` → `ContactsController.restore`

### DELETE /contacts/:id
- **Propósito:** Excluir em definitivo (expurgo) um contato já arquivado.
- **Auth:** Bearer (access token). Permissão: `lixeira:expurgar`.
- **Body:** —
- **Resposta:** `200` (sem corpo).
- **Erros:** `404 Contato não encontrado.` (ou cliente de outro dono), `422 Só é possível excluir em definitivo um contato que já esteja na lixeira. Arquive antes.`, `403`, `401`.
- **Handler:** `modules/contacts/api/contacts.controller.ts` → `ContactsController.purge`

---

## Activities

### GET /activities
- **Propósito:** Listar atividades (timeline), filtrando por `clientId` e/ou `dealId`, em ordem `createdAt desc`, paginado. Sem `cliente:ver_todos`, devolve apenas os registros do usuário e os sem responsável.
- **Auth:** Bearer (access token). Permissão: `cliente:ver` ou `cliente:gerenciar`.
- **Body:** — (query: `page?`, `limit?`, `clientId?`, `dealId?`, `assigneeId?: uuid`)
- **Resposta:** `200 { data: Activity[], meta: { total, page, limit } }` (cada item com `assignee: { id, name } | null` e `type: { id, name, active, isFollowUp }`).
- **Erros:** `400` (query inválida), `404 Cliente não encontrado.` (quando `clientId` é de outro dono), `401`.
- **Handler:** `modules/activities/api/activities.controller.ts` → `ActivitiesController.list`

### POST /activities
- **Propósito:** Criar uma atividade/anotação na timeline de um cliente. Com um `typeId` marcado como `isFollowUp` no catálogo e `scheduledFor`, registra um follow-up (é essa marca — não o nome do tipo — que o cron das 6h e o dashboard consultam).
- **Auth:** Bearer (access token). Permissão: `cliente:gerenciar`.
- **Body:** `{ clientId: uuid, typeId: uuid, content: string, dealId?: uuid, scheduledFor?: ISO date, assigneeId?: uuid | null }` (`typeId` referencia um item vivo de `GET /catalogos/tipos-de-atividade` do mesmo owner)
- **Resposta:** `201 Activity` (com `assignee: { id, name } | null` e `type: { id, name, active, isFollowUp }`).
- **Erros:** `400` (validação), `422 Responsável inválido: escolha alguém da sua equipe.`, `404 Cliente não encontrado.`, `401`.
- **Handler:** `modules/activities/api/activities.controller.ts` → `ActivitiesController.create`

### PATCH /activities/:id
- **Propósito:** Atualizar parcialmente uma atividade (não permite mover de cliente — `clientId` omitido).
- **Auth:** Bearer (access token). Permissão: `cliente:gerenciar`.
- **Body:** `{ typeId?: uuid, content?, dealId?, scheduledFor?, assigneeId? }`. `assigneeId: null` limpa o responsável, o campo ausente preserva.
- **Resposta:** `200 Activity` (com `assignee: { id, name } | null` e `type: { id, name, active, isFollowUp }`).
- **Erros:** `400` (validação), `422 Responsável inválido: escolha alguém da sua equipe.`, `404 Atividade não encontrada.` (ou cliente de outro dono), `401`.
- **Handler:** `modules/activities/api/activities.controller.ts` → `ActivitiesController.update`

### POST /activities/:id/complete
- **Propósito:** Concluir uma atividade (follow-up), definindo `completedAt`.
- **Auth:** Bearer (access token). Permissão: `cliente:gerenciar`.
- **Body:** —
- **Resposta:** `200 Activity` (com `completedAt` preenchido).
- **Erros:** `404 Atividade não encontrada.` (ou cliente de outro dono), `401`.
- **Handler:** `modules/activities/api/activities.controller.ts` → `ActivitiesController.complete`

---

## Catálogos

> Os catálogos são **do owner**: cada workspace tem os seus itens (`ownerId`, com RLS), criados junto
> com a conta e configuráveis sem afetar ninguém. `kind` ∈ `{ servicos, fontes-de-lead,
> tipos-de-atividade, motivos-de-perda }`. A **leitura não exige permissão de
> módulo** (só sessão válida): o `Select` de um catálogo aparece em formulários de módulos diferentes.
> A escrita exige `catalogo:gerenciar`. **Só existem duas operações: cadastrar e excluir.** Renomear
> não é operação do produto — troca-se o item por outro, e cada registro segue exibindo o nome que
> valia quando foi classificado.
>
> `active` **não é estado que alguém escolhe**, e nunca aparece na interface: é como o DELETE se
> comporta quando o item ainda rotula registros. As FKs são `RESTRICT` e três delas são NOT NULL
> (`Deal`, `Proposal`, `Project` → `serviceTypeId`; `Activity.typeId`), então apagar a linha
> exigiria apagar o histórico junto. Nesse caso a linha vira `active: false`: some do `GET` e de
> todos os Select, e sobrevive apenas embutida nos registros que já a carregavam. Cadastrar de novo
> o mesmo nome **ressuscita** a mesma linha, e os registros antigos a reencontram.

### GET /catalogos/:kind
- **Propósito:** Listar os itens vivos do catálogo do owner, ordenados por `name`. Não existe listar
  excluídos — item oculto só aparece embutido no registro de negócio que o usa.
- **Auth:** Bearer (access token). Sem `@RequirePermission` — só exige sessão válida.
- **Body:** —
- **Resposta:** `200 CatalogItem[]` (`{ id, name, active, isFollowUp? }`; `active` é sempre `true`
  aqui, `isFollowUp` só em `tipos-de-atividade`).
- **Erros:** `404 Catálogo não encontrado.` (`kind` desconhecido), `401`.
- **Handler:** `modules/catalogos/api/catalogos.controller.ts` → `CatalogosController.list`

### POST /catalogos/:kind
- **Propósito:** Cadastrar um item no catálogo do owner — ou ressuscitar o item oculto de mesmo nome,
  devolvendo o `id` original para que os registros antigos o reencontrem.
- **Auth:** Bearer (access token). Permissão: `catalogo:gerenciar`.
- **Body:** `{ name: string (2-60), isFollowUp?: boolean }` (`isFollowUp` só aceito em
  `tipos-de-atividade`).
- **Resposta:** `201 CatalogItem`.
- **Erros:** `400` (validação), `404 Catálogo não encontrado.`, `409 Já existe um <item> com este
  nome.` (só quando o item de mesmo nome está **vivo**), `422 Marcar follow-up só vale para tipos de
  atividade.`, `403`, `401`.
- **Handler:** `modules/catalogos/api/catalogos.controller.ts` → `CatalogosController.create`

### PATCH /catalogos/:kind/:id
- **Propósito:** Mover a marca `isFollowUp` — a única edição que existe. Vale só para
  `tipos-de-atividade`; marcar um item desmarca o anterior.
- **Auth:** Bearer (access token). Permissão: `catalogo:gerenciar`.
- **Body:** `{ isFollowUp?: boolean }`. Não aceita `name` (renomear não existe) nem `active`
  (consequência do DELETE, não escolha).
- **Resposta:** `200 CatalogItem`.
- **Erros:** `400` (validação), `404 Catálogo não encontrado.` / `404 <Item> não encontrado no
  catálogo.` (inexistente ou de outro owner), `422 Marcar follow-up só vale para tipos de
  atividade.`, `403`, `401`.
- **Handler:** `modules/catalogos/api/catalogos.controller.ts` → `CatalogosController.update`

### DELETE /catalogos/:kind/:id
- **Propósito:** Excluir o item. Sem nenhum registro apontando, apaga a linha; em uso (a contagem
  inclui arquivados), oculta com `active: false` para não derrubar as FKs `RESTRICT`. Nunca falha
  por conflito — a resposta diz qual dos dois aconteceu.
- **Auth:** Bearer (access token). Permissão: `catalogo:gerenciar`.
- **Body:** —
- **Resposta:** `200 { ocultado: boolean, usos: number }`. `ocultado: true` → a linha continua no
  banco rotulando `usos` registros; `false` → apagada de vez.
- **Erros:** `404 Catálogo não encontrado.` / `404 <Item> não encontrado no catálogo.` (inexistente ou
  de outro owner), `403`, `401`.
- **Handler:** `modules/catalogos/api/catalogos.controller.ts` → `CatalogosController.remove`

---

## Pipeline stages

> O funil é **do owner**: cada workspace tem os seus estágios (`ownerId`, com RLS). Colaborador lê e
> escreve os estágios do owner que o convidou, limitado pelas permissões do papel.

### GET /pipeline-stages
- **Propósito:** Listar os estágios do funil **do owner**, ordenados por `order`.
- **Auth:** Bearer (access token). Permissão: `oportunidade:ver` ou `oportunidade:gerenciar`.
- **Body:** —
- **Resposta:** `200 PipelineStage[]` (cada item inclui `ownerId`).
- **Erros:** `403 Você não tem permissão para ver pipeline.`, `401`.
- **Handler:** `modules/pipeline/api/pipeline-stages.controller.ts` → `PipelineStagesController.list`

### POST /pipeline-stages
- **Propósito:** Criar um estágio no fim da ordem atual do funil do owner.
- **Auth:** Bearer (access token). Permissão: `oportunidade:gerenciar`.
- **Body:** `{ name: string (mín. 2), isWon?: boolean, isLost?: boolean }`
- **Resposta:** `201 PipelineStage`.
- **Erros:** `400` (validação), `409 Já existe um estágio com este nome.` (nome único **por owner**), `403`, `401`.
- **Handler:** `modules/pipeline/api/pipeline-stages.controller.ts` → `PipelineStagesController.create`

### PATCH /pipeline-stages/reorder
- **Propósito:** Reatribuir a ordem (`order`) sequencial dos estágios do owner conforme a lista de ids. A lista tem de ser uma permutação exata do funil do owner.
- **Auth:** Bearer (access token). Permissão: `oportunidade:gerenciar`.
- **Body:** `{ ids: uuid[] }`
- **Resposta:** `200 PipelineStage[]` (já reordenados).
- **Erros:** `400` (validação), `422 A lista de estágios não corresponde aos estágios do funil.` (id repetido, faltando, inexistente ou de outro owner), `403`, `401`.
- **Handler:** `modules/pipeline/api/pipeline-stages.controller.ts` → `PipelineStagesController.reorder`

### PATCH /pipeline-stages/:id
- **Propósito:** Atualizar parcialmente um estágio do owner (nome, `isWon`, `isLost`).
- **Auth:** Bearer (access token). Permissão: `oportunidade:gerenciar`.
- **Body:** Campos parciais de `POST /pipeline-stages`.
- **Resposta:** `200 PipelineStage`.
- **Erros:** `400` (validação), `404 Estágio não encontrado.` (inexistente ou de outro owner), `409 Já existe um estágio com este nome.`, `403`, `401`.
- **Handler:** `modules/pipeline/api/pipeline-stages.controller.ts` → `PipelineStagesController.update`

### DELETE /pipeline-stages/:id
- **Propósito:** Excluir um estágio do owner, desde que não possua oportunidades vinculadas (a contagem inclui as arquivadas — `Deal.stageId` é `RESTRICT`).
- **Auth:** Bearer (access token). Permissão: `oportunidade:gerenciar`.
- **Body:** —
- **Resposta:** `200` (sem corpo).
- **Erros:** `404 Estágio não encontrado.` (inexistente ou de outro owner), `409 Não é possível excluir um estágio que possui oportunidades, inclusive arquivadas. Mova ou expurgue as oportunidades antes.`, `403`, `401`.
- **Handler:** `modules/pipeline/api/pipeline-stages.controller.ts` → `PipelineStagesController.remove`

---

## Deals

### GET /deals
- **Propósito:** Listar oportunidades do usuário autenticado (via cliente), com filtros e paginação. Sem `oportunidade:ver_todas`, devolve apenas os registros do usuário e os sem responsável.
- **Auth:** Bearer (access token). Permissão: `oportunidade:ver` ou `oportunidade:gerenciar`.
- **Body:** — (query: `page?`, `limit?`, `clientId?`, `stageId?`, `search?`, `assigneeId?: uuid`)
- **Resposta:** `200 { data: Deal[], meta: { total, page, limit } }` (`Deal` inclui `client: { id, name }` e `assignee: { id, name } | null`).
- **Erros:** `400` (query inválida), `404 Cliente não encontrado.` (quando `clientId` é de outro dono), `401`.
- **Handler:** `modules/pipeline/api/deals.controller.ts` → `DealsController.list`

### GET /deals/board
- **Propósito:** Retornar todas as oportunidades do usuário autenticado, sem paginação, ordenadas por `stageId` e `position` — alimenta o Kanban. Sem `oportunidade:ver_todas`, devolve apenas os registros do usuário e os sem responsável.
- **Auth:** Bearer (access token). Permissão: `oportunidade:ver` ou `oportunidade:gerenciar`.
- **Body:** — (query: `assigneeId?: uuid` — filtro "Atribuídos a mim" do quadro)
- **Resposta:** `200 Deal[]` (com `client: { id, name }` e `assignee: { id, name } | null`).
- **Erros:** `401`.
- **Handler:** `modules/pipeline/api/deals.controller.ts` → `DealsController.board`

### POST /deals
- **Propósito:** Criar uma oportunidade para um cliente do usuário autenticado. Sem `stageId`, entra no primeiro estágio **do owner**; `position` vai para o fim da coluna.
- **Auth:** Bearer (access token). Permissão: `oportunidade:gerenciar`.
- **Body:** `{ title: string (mín. 2), clientId: uuid, serviceTypeId: uuid, stageId?: uuid, amount?: number, probability?: number (0-100), expectedClose?: ISO date, assigneeId?: uuid | null }`
- **Resposta:** `201 Deal` (com `assignee: { id, name } | null`).
- **Erros:** `400` (validação), `422 Responsável inválido: escolha alguém da sua equipe.`, `404 Cliente não encontrado.` / `404 Estágio não encontrado.`, `401`.
- **Handler:** `modules/pipeline/api/deals.controller.ts` → `DealsController.create`

### GET /deals/:id
- **Propósito:** Buscar uma oportunidade, validando que o cliente pertence ao usuário autenticado. Sem `oportunidade:ver_todas`, devolve apenas os registros do usuário e os sem responsável.
- **Auth:** Bearer (access token). Permissão: `oportunidade:ver` ou `oportunidade:gerenciar`.
- **Body:** —
- **Resposta:** `200 Deal` (com `assignee: { id, name } | null`).
- **Erros:** `404 Oportunidade não encontrada.` (ou cliente de outro dono), `401`.
- **Handler:** `modules/pipeline/api/deals.controller.ts` → `DealsController.findOne`

### PATCH /deals/:id
- **Propósito:** Atualizar parcialmente uma oportunidade (não move de estágio — usar `/move`; `clientId`/`stageId` fora do body).
- **Auth:** Bearer (access token). Permissão: `oportunidade:gerenciar`.
- **Body:** Campos parciais de `POST /deals` exceto `clientId`/`stageId`. `assigneeId: null` limpa o responsável, o campo ausente preserva.
- **Resposta:** `200 Deal` (com `assignee: { id, name } | null`).
- **Erros:** `400` (validação), `422 Responsável inválido: escolha alguém da sua equipe.`, `404 Oportunidade não encontrada.`, `401`.
- **Handler:** `modules/pipeline/api/deals.controller.ts` → `DealsController.update`

### PATCH /deals/:id/move
- **Propósito:** Mover a oportunidade para `(stageId, position)`, reindexando as colunas afetadas em transação. Ao mover para um estágio `isLost`, exige `lostReasonId` (item vivo de `GET /catalogos/motivos-de-perda` do mesmo owner); ao sair de um estágio `isLost` para outro, limpa o motivo. Muda de estágio → atualiza `stageMovedAt`. Ao mover para um estágio `isWon` (mudança de estágio), cria automaticamente um Projeto a partir do deal (idempotente por `dealId`).
- **Auth:** Bearer (access token). Permissão: `oportunidade:gerenciar`.
- **Body:** `{ stageId: uuid, position: number (>=0), lostReasonId?: uuid }`
- **Resposta:** `200 Deal` (com `lostReason: { id, name, active } | null`).
- **Erros:** `400` (validação), `404 Oportunidade não encontrada.` / `404 Estágio não encontrado.` / `404 Motivo de perda não encontrado no catálogo.`, `422 Informe o motivo da perda.` / `422 Este motivo de perda foi excluído. Escolha outro ou cadastre-o novamente.`, `401`.
- **Handler:** `modules/pipeline/api/deals.controller.ts` → `DealsController.move`

### POST /deals/:id/archive
- **Propósito:** Arquivar (soft delete) uma oportunidade, setando `archivedAt`. Some do quadro `/pipeline`, da listagem e do funil do dashboard, e passa a aparecer em `GET /trash`. Sem cascata: projetos/propostas vinculados não são afetados.
- **Auth:** Bearer (access token). Permissão: `oportunidade:gerenciar`.
- **Body:** —
- **Resposta:** `200 Deal` (com `archivedAt` preenchido).
- **Erros:** `404 Oportunidade não encontrada.`, `401`.
- **Handler:** `modules/pipeline/api/deals.controller.ts` → `DealsController.archive`

### POST /deals/:id/restore
- **Propósito:** Restaurar uma oportunidade arquivada (limpa `archivedAt`), devolvendo-a ao funil na posição em que estava.
- **Auth:** Bearer (access token). Permissão: `oportunidade:gerenciar`.
- **Body:** —
- **Resposta:** `200 Deal` (com `archivedAt: null`).
- **Erros:** `404 Oportunidade não encontrada.`, `401`.
- **Handler:** `modules/pipeline/api/deals.controller.ts` → `DealsController.restore`

### DELETE /deals/:id
- **Propósito:** Excluir em definitivo (expurgo) uma oportunidade já arquivada. `Proposal`/`Project`/`Activity` vinculados são FKs opcionais com `SET NULL` — sobrevivem com `dealId = null`.
- **Auth:** Bearer (access token). Permissão: `lixeira:expurgar`.
- **Body:** —
- **Resposta:** `200` (sem corpo).
- **Erros:** `404 Oportunidade não encontrada.`, `422 Só é possível excluir em definitivo uma oportunidade que já esteja na lixeira. Arquive antes.`, `403`, `401`.
- **Handler:** `modules/pipeline/api/deals.controller.ts` → `DealsController.purge`

---

## Proposals

### GET /proposals
- **Propósito:** Listar propostas do usuário autenticado (via cliente), com filtros e paginação. `search` filtra por número da proposta ou nome/email do cliente (contains, case-insensitive).
- **Auth:** Bearer (access token). Permissão: `proposta:ver` ou `proposta:gerenciar`.
- **Body:** — (query: `page?`, `limit?`, `search?`, `clientId?`, `status?`)
- **Resposta:** `200 { data: Proposal[], meta: { total, page, limit } }` (`Proposal` inclui `items[]` e `client: { id, name }`).
- **Erros:** `400` (query inválida), `404 Cliente não encontrado.` (quando `clientId` é de outro dono), `401`.
- **Handler:** `modules/proposals/api/proposals.controller.ts` → `ProposalsController.list`

### POST /proposals
- **Propósito:** Criar uma proposta (status `DRAFT`, `version 1`); gera `number` PROP-AAAA-NNNN e calcula `total` no backend a partir dos itens e desconto.
- **Auth:** Bearer (access token). Permissão: `proposta:gerenciar`.
- **Body:** `{ clientId: uuid, serviceTypeId: uuid, items: [{ description, quantity, unitPrice }] (≥1), dealId?: uuid, discount?: number, scope?, paymentTerms?, deliveryTime?, validUntil?: ISO date }`
- **Resposta:** `201 Proposal` (com `items[]`, `total`, `number`).
- **Erros:** `400` (validação / `Informe ao menos um item.`), `404 Cliente não encontrado.` / `Oportunidade não encontrada.`, `401`.
- **Handler:** `modules/proposals/api/proposals.controller.ts` → `ProposalsController.create`

### GET /proposals/:id
- **Propósito:** Buscar uma proposta, validando que o cliente pertence ao usuário autenticado.
- **Auth:** Bearer (access token). Permissão: `proposta:ver` ou `proposta:gerenciar`.
- **Body:** —
- **Resposta:** `200 Proposal` (com `items[]`).
- **Erros:** `404 Proposta não encontrada.`, `401`.
- **Handler:** `modules/proposals/api/proposals.controller.ts` → `ProposalsController.findOne`

### GET /proposals/:id/versions
- **Propósito:** Listar todas as versões da cadeia (mesmo `number`) da proposta informada, ordenadas por `version`.
- **Auth:** Bearer (access token). Permissão: `proposta:ver` ou `proposta:gerenciar`.
- **Body:** —
- **Resposta:** `200 Proposal[]`.
- **Erros:** `404 Proposta não encontrada.`, `401`.
- **Handler:** `modules/proposals/api/proposals.controller.ts` → `ProposalsController.versions`

### PATCH /proposals/:id
- **Propósito:** Atualizar parcialmente uma proposta **apenas em rascunho** (`DRAFT`). Se `items` for informado, substitui os itens e recalcula `total`.
- **Auth:** Bearer (access token). Permissão: `proposta:gerenciar`.
- **Body:** Campos parciais de `POST /proposals` exceto `clientId`/`dealId`.
- **Resposta:** `200 Proposal`.
- **Erros:** `400` (validação), `404 Proposta não encontrada.`, `422 Apenas rascunhos podem ser editados. Crie uma nova versão.`, `401`.
- **Handler:** `modules/proposals/api/proposals.controller.ts` → `ProposalsController.update`

### DELETE /proposals/:id
- **Propósito:** Excluir uma proposta **apenas em rascunho** (`DRAFT`), removendo também seus itens.
- **Auth:** Bearer (access token). Permissão: `proposta:gerenciar`.
- **Body:** —
- **Resposta:** `200` (sem corpo).
- **Erros:** `404 Proposta não encontrada.`, `422 Apenas rascunhos podem ser excluídos.`, `401`.
- **Handler:** `modules/proposals/api/proposals.controller.ts` → `ProposalsController.remove`

### POST /proposals/:id/send
- **Propósito:** Enviar a proposta (`DRAFT` → `SENT`), setando `sentAt`.
- **Auth:** Bearer (access token). Permissão: `proposta:gerenciar`.
- **Body:** —
- **Resposta:** `200 Proposal` (status `SENT`).
- **Erros:** `404 Proposta não encontrada.`, `422 Transição de status inválida.`, `401`.
- **Handler:** `modules/proposals/api/proposals.controller.ts` → `ProposalsController.send`

### POST /proposals/:id/accept
- **Propósito:** Aceitar a proposta (`SENT`/`NEGOTIATING` → `ACCEPTED`), setando `decidedAt`. Se houver `dealId`, move o deal vinculado para o estágio "Ganhou" (isWon); ao mover, um Projeto é criado automaticamente a partir do deal (idempotente por `dealId`).
- **Auth:** Bearer (access token). Permissão: `proposta:gerenciar`.
- **Body:** —
- **Resposta:** `200 Proposal` (status `ACCEPTED`).
- **Erros:** `404 Proposta não encontrada.`, `422 Transição de status inválida.`, `401`.
- **Handler:** `modules/proposals/api/proposals.controller.ts` → `ProposalsController.accept`

### POST /proposals/:id/reject
- **Propósito:** Recusar a proposta (`SENT`/`NEGOTIATING` → `REJECTED`), setando `decidedAt`.
- **Auth:** Bearer (access token). Permissão: `proposta:gerenciar`.
- **Body:** —
- **Resposta:** `200 Proposal` (status `REJECTED`).
- **Erros:** `404 Proposta não encontrada.`, `422 Transição de status inválida.`, `401`.
- **Handler:** `modules/proposals/api/proposals.controller.ts` → `ProposalsController.reject`

### POST /proposals/:id/new-version
- **Propósito:** Criar uma nova versão da proposta (mesmo `number`, `version+1`, `parentId` = origem), copiando itens e campos, com status `DRAFT`.
- **Auth:** Bearer (access token). Permissão: `proposta:gerenciar`.
- **Body:** —
- **Resposta:** `201 Proposal` (nova versão, `DRAFT`).
- **Erros:** `404 Proposta não encontrada.`, `401`.
- **Handler:** `modules/proposals/api/proposals.controller.ts` → `ProposalsController.newVersion`

## Projects

### GET /projects
- **Propósito:** Listar projetos do usuário autenticado, paginado, com filtro opcional por cliente, status e busca por nome.
- **Auth:** Bearer (access token). Permissão: `projeto:ver` ou `projeto:gerenciar`.
- **Body:** — (query: `page`, `limit`, `clientId?`, `status?`, `search?`).
- **Resposta:** `200 Paginated<Project>` (com `client` e `_count.tasks`).
- **Erros:** `400` (validação), `404 Cliente não encontrado.` (se `clientId` não for do dono), `401`.
- **Handler:** `modules/projects/api/projects.controller.ts` → `ProjectsController.list`

### POST /projects
- **Propósito:** Criar um projeto vinculado a um cliente do usuário autenticado.
- **Auth:** Bearer (access token). Permissão: `projeto:gerenciar`.
- **Body:** `{ name, clientId, serviceTypeId: uuid, proposalId?, startDate?, dueDate? }`. `serviceTypeId` referencia um item vivo de `GET /catalogos/servicos` do mesmo owner.
- **Resposta:** `201 Project`.
- **Erros:** `400` (validação), `404 Cliente não encontrado.`, `401`.
- **Handler:** `modules/projects/api/projects.controller.ts` → `ProjectsController.create`

### GET /projects/:id
- **Propósito:** Buscar um projeto, validando que o cliente pertence ao usuário autenticado.
- **Auth:** Bearer (access token). Permissão: `projeto:ver` ou `projeto:gerenciar`.
- **Body:** —
- **Resposta:** `200 Project`.
- **Erros:** `404 Projeto não encontrado.`, `401`.
- **Handler:** `modules/projects/api/projects.controller.ts` → `ProjectsController.findOne`

### PATCH /projects/:id
- **Propósito:** Atualizar parcialmente um projeto (nome, tipo de serviço, status, início, prazo). `clientId`/`proposalId` são imutáveis.
- **Auth:** Bearer (access token). Permissão: `projeto:gerenciar`.
- **Body:** Campos parciais de `POST /projects` exceto `clientId`/`proposalId`, mais `status?`.
- **Resposta:** `200 Project`.
- **Erros:** `400` (validação), `404 Projeto não encontrado.`, `401`.
- **Handler:** `modules/projects/api/projects.controller.ts` → `ProjectsController.update`

### POST /projects/:id/archive
- **Propósito:** Arquivar (soft delete) um projeto, setando `archivedAt`. Some da listagem e passa a aparecer em `GET /trash`. Sem cascata: as tarefas do projeto continuam ativas (o `_count.tasks` do card some do card, mas elas seguem em "Minhas demandas").
- **Auth:** Bearer (access token). Permissão: `projeto:gerenciar`.
- **Body:** —
- **Resposta:** `200 Project` (com `archivedAt` preenchido).
- **Erros:** `404 Projeto não encontrado.`, `401`.
- **Handler:** `modules/projects/api/projects.controller.ts` → `ProjectsController.archive`

### POST /projects/:id/restore
- **Propósito:** Restaurar um projeto arquivado (limpa `archivedAt`), devolvendo-o à listagem.
- **Auth:** Bearer (access token). Permissão: `projeto:gerenciar`.
- **Body:** —
- **Resposta:** `200 Project` (com `archivedAt: null`).
- **Erros:** `404 Projeto não encontrado.`, `401`.
- **Handler:** `modules/projects/api/projects.controller.ts` → `ProjectsController.restore`

### DELETE /projects/:id
- **Propósito:** Excluir em definitivo (expurgo) um projeto já arquivado, desde que não possua nenhuma tarefa vinculada (ativa ou arquivada — `Task.projectId` é `RESTRICT`). `Contract.projectId` é opcional com `SET NULL` e não bloqueia.
- **Auth:** Bearer (access token). Permissão: `lixeira:expurgar`.
- **Body:** —
- **Resposta:** `200` (sem corpo).
- **Erros:** `404 Projeto não encontrado.`, `422 Só é possível excluir em definitivo um projeto que já esteja na lixeira. Arquive antes.`, `409 Não é possível excluir em definitivo um projeto que ainda tem demandas. Expurgue as demandas dele primeiro.`, `403`, `401`.
- **Handler:** `modules/projects/api/projects.controller.ts` → `ProjectsController.purge`

## Tasks

### GET /tasks
- **Propósito:** Listar tarefas do usuário autenticado, paginado, cruzando projetos ("Minhas demandas"), com filtros por projeto, cliente, status, prioridade, prazo e responsável. Sem `demanda:ver_todas`, devolve apenas os registros do usuário e os sem responsável.
- **Auth:** Bearer (access token). Permissão: `projeto:ver` ou `projeto:gerenciar` ou `demanda:gerenciar`.
- **Body:** — (query: `page`, `limit`, `projectId?`, `clientId?`, `status?`, `priority?`, `dueBefore?`, `assigneeId?: uuid`).
- **Resposta:** `200 Paginated<Task>` (com `project`, `project.client` e `assignee: { id, name } | null`), ordenado por prazo (`dueDate asc`, nulls por último), prioridade e criação.
- **Erros:** `400` (validação), `404 Projeto não encontrado.` (se `projectId` não for do dono), `401`.
- **Handler:** `modules/projects/api/tasks.controller.ts` → `TasksController.list`

### GET /tasks/board
- **Propósito:** Alimentar o Kanban de tarefas. Com `projectId`, lista as tarefas do projeto ordenadas por `(status, position)`. Sem `projectId`, lista todas as tarefas do usuário autenticado (board cross-projeto de "Minhas demandas"), ordenadas por `(status, prazo asc, prioridade desc, position)`. Sem `demanda:ver_todas`, devolve apenas os registros do usuário e os sem responsável.
- **Auth:** Bearer (access token). Permissão: `projeto:ver` ou `projeto:gerenciar` ou `demanda:gerenciar`.
- **Body:** — (query: `projectId?`, `assigneeId?: uuid` — filtro "Atribuídos a mim" do quadro).
- **Resposta:** `200 Task[]` (com `assignee: { id, name } | null`).
- **Erros:** `404 Projeto não encontrado.` (quando `projectId` é informado e não pertence ao usuário), `401`.
- **Handler:** `modules/projects/api/tasks.controller.ts` → `TasksController.board`

### GET /tasks/tags
- **Propósito:** Listar as tags existentes do usuário autenticado (agregadas de todas as suas tarefas), com a contagem de uso de cada uma. Alimenta o autocomplete do seletor de tags. Não há catálogo próprio de tags: elas vivem como `String[]` por tarefa.
- **Auth:** Bearer (access token). Permissão: `projeto:ver` ou `projeto:gerenciar` ou `demanda:gerenciar`.
- **Body:** —
- **Resposta:** `200 { tag: string; count: number }[]` (ordenado por `count desc`, depois alfabético pt-BR).
- **Erros:** `401`.
- **Handler:** `modules/projects/api/tasks.controller.ts` → `TasksController.listTags`

### GET /tasks/tags/usage
- **Propósito:** Listar as tarefas do usuário autenticado que usam determinada tag. Usado pelo modal de confirmação de exclusão para mostrar onde a tag está em uso.
- **Auth:** Bearer (access token). Permissão: `projeto:ver` ou `projeto:gerenciar` ou `demanda:gerenciar`.
- **Body:** — (query: `tag` obrigatório).
- **Resposta:** `200 { id: string; title: string; project: { id: string; name: string } }[]` (ordenado por `title asc`).
- **Erros:** `400 Tag inválida.` (tag vazia), `401`.
- **Handler:** `modules/projects/api/tasks.controller.ts` → `TasksController.tagUsage`

### DELETE /tasks/tags
- **Propósito:** Excluir uma tag globalmente, removendo-a de todas as tarefas do usuário autenticado.
- **Auth:** Bearer (access token). Permissão: `demanda:gerenciar`.
- **Body:** — (query: `tag` obrigatório).
- **Resposta:** `200 { removed: number }` (quantidade de tarefas afetadas).
- **Erros:** `400 Tag inválida.` (tag vazia), `401`.
- **Handler:** `modules/projects/api/tasks.controller.ts` → `TasksController.deleteTag`

### POST /tasks
- **Propósito:** Criar uma tarefa em um projeto do usuário autenticado, no fim da coluna de status (`position` sequencial).
- **Auth:** Bearer (access token). Permissão: `demanda:gerenciar`.
- **Body:** `{ projectId, title, description?, status?, priority?, dueDate?, tags?, checklist?, assigneeId?: uuid | null }`.
- **Resposta:** `201 Task` (com `assignee: { id, name } | null`).
- **Erros:** `400` (validação), `422 Responsável inválido: escolha alguém da sua equipe.`, `404 Projeto não encontrado.`, `401`.
- **Handler:** `modules/projects/api/tasks.controller.ts` → `TasksController.create`

### GET /tasks/:id
- **Propósito:** Buscar uma tarefa, validando posse via projeto→cliente do usuário autenticado. Sem `demanda:ver_todas`, devolve apenas os registros do usuário e os sem responsável.
- **Auth:** Bearer (access token). Permissão: `projeto:ver` ou `projeto:gerenciar` ou `demanda:gerenciar`.
- **Body:** —
- **Resposta:** `200 Task` (com `assignee: { id, name } | null`).
- **Erros:** `404 Tarefa não encontrada.`, `401`.
- **Handler:** `modules/projects/api/tasks.controller.ts` → `TasksController.findOne`

### PATCH /tasks/:id
- **Propósito:** Atualizar parcialmente uma tarefa (título, descrição, prioridade, prazo, tags, checklist). `projectId` é imutável; `status` só muda via `/move`.
- **Auth:** Bearer (access token). Permissão: `demanda:gerenciar`.
- **Body:** Campos parciais de `POST /tasks` exceto `projectId`/`status`. `assigneeId: null` limpa o responsável, o campo ausente preserva.
- **Resposta:** `200 Task` (com `assignee: { id, name } | null`).
- **Erros:** `400` (validação), `422 Responsável inválido: escolha alguém da sua equipe.`, `404 Tarefa não encontrada.`, `401`.
- **Handler:** `modules/projects/api/tasks.controller.ts` → `TasksController.update`

### PATCH /tasks/:id/move
- **Propósito:** Mover a tarefa para outra coluna/posição do board, reindexando as colunas de origem e destino em transação. Ao entrar em `DONE`, seta `completedAt`; ao sair, limpa.
- **Auth:** Bearer (access token). Permissão: `demanda:gerenciar`.
- **Body:** `{ status, position }`.
- **Resposta:** `200 Task`.
- **Erros:** `400` (validação), `404 Tarefa não encontrada.`, `401`.
- **Handler:** `modules/projects/api/tasks.controller.ts` → `TasksController.move`

### POST /tasks/:id/archive
- **Propósito:** Arquivar (soft delete) uma tarefa, setando `archivedAt`. Some do quadro do projeto, de "Minhas demandas" e do dashboard, e passa a aparecer em `GET /trash`.
- **Auth:** Bearer (access token). Permissão: `demanda:gerenciar`.
- **Body:** —
- **Resposta:** `200 Task` (com `archivedAt` preenchido).
- **Erros:** `404 Tarefa não encontrada.`, `401`.
- **Handler:** `modules/projects/api/tasks.controller.ts` → `TasksController.archive`

### POST /tasks/:id/restore
- **Propósito:** Restaurar uma tarefa arquivada (limpa `archivedAt`), devolvendo-a ao quadro no status em que estava.
- **Auth:** Bearer (access token). Permissão: `demanda:gerenciar`.
- **Body:** —
- **Resposta:** `200 Task` (com `archivedAt: null`).
- **Erros:** `404 Tarefa não encontrada.`, `401`.
- **Handler:** `modules/projects/api/tasks.controller.ts` → `TasksController.restore`

### DELETE /tasks/:id
- **Propósito:** Excluir em definitivo (expurgo) uma tarefa já arquivada. Task não tem filhos — sem trava adicional.
- **Auth:** Bearer (access token). Permissão: `lixeira:expurgar`.
- **Body:** —
- **Resposta:** `200` (sem corpo).
- **Erros:** `404 Tarefa não encontrada.`, `422 Só é possível excluir em definitivo uma demanda que já esteja na lixeira. Arquive antes.`, `403`, `401`.
- **Handler:** `modules/projects/api/tasks.controller.ts` → `TasksController.purge`

---

## Contracts

### GET /contracts
- **Propósito:** Listar contratos do usuário autenticado, paginado, com filtro opcional por cliente, status e regime de cobrança.
- **Auth:** Bearer (access token). Permissão: `financeiro:ver` ou `financeiro:gerenciar`.
- **Body:** — (query: `page`, `limit`, `clientId?`, `status?`, `billingType?`).
- **Resposta:** `200 Paginated<Contract>` (com `client` e `payments` ordenadas por vencimento).
- **Erros:** `400` (validação), `404 Cliente não encontrado.` (se `clientId` não for do dono), `401`.
- **Handler:** `modules/finance/api/contracts.controller.ts` → `ContractsController.list`

### POST /contracts
- **Propósito:** Criar um contrato vinculado a um cliente do usuário autenticado. Conforme o regime (`billingType`), gera a agenda de cobranças: `INSTALLMENTS` cria Entrada (se houver) + N parcelas; `ONE_TIME` cria uma cobrança única; `RECURRING` não cria nenhuma (o cron gera as mensalidades).
- **Auth:** Bearer (access token). Permissão: `financeiro:gerenciar`.
- **Body:** `{ clientId, description, billingType, projectId?, proposalId?, ` + campos condicionais por regime: RECURRING `{ monthlyAmount, billingDay (1-28), startDate, endDate? }`; INSTALLMENTS `{ downPayment?, downPaymentDueDate?, installments, installmentAmount, firstInstallmentDueDate }`; ONE_TIME `{ amount, dueDate }` `}`.
- **Resposta:** `201 Contract` (com `payments` já geradas conforme o regime).
- **Erros:** `400` (validação), `404 Cliente não encontrado.`, `401`.
- **Handler:** `modules/finance/api/contracts.controller.ts` → `ContractsController.create`

### GET /contracts/:id
- **Propósito:** Buscar um contrato, validando que o cliente pertence ao usuário autenticado.
- **Auth:** Bearer (access token). Permissão: `financeiro:ver` ou `financeiro:gerenciar`.
- **Body:** —
- **Resposta:** `200 Contract` (com `payments`).
- **Erros:** `404 Contrato não encontrado.`, `401`.
- **Handler:** `modules/finance/api/contracts.controller.ts` → `ContractsController.findOne`

### PATCH /contracts/:id
- **Propósito:** Atualizar parcialmente um contrato (descrição, valor mensal, dia de vencimento, data de término). `clientId`/`billingType` e os campos de INSTALLMENTS já materializados em cobranças são imutáveis. Reajuste de `monthlyAmount` vale só para as mensalidades ainda não geradas.
- **Auth:** Bearer (access token). Permissão: `financeiro:gerenciar`.
- **Body:** `{ description?, monthlyAmount?, billingDay?, endDate? }`.
- **Resposta:** `200 Contract`.
- **Erros:** `400` (validação), `404 Contrato não encontrado.`, `401`.
- **Handler:** `modules/finance/api/contracts.controller.ts` → `ContractsController.update`

### POST /contracts/:id/pause
- **Propósito:** Pausar um contrato `ACTIVE` (suspende a geração de novas mensalidades pelo cron).
- **Auth:** Bearer (access token). Permissão: `financeiro:gerenciar`.
- **Body:** —
- **Resposta:** `200 Contract` (`status: PAUSED`).
- **Erros:** `404 Contrato não encontrado.`, `422 Transição de status inválida.`, `401`.
- **Handler:** `modules/finance/api/contracts.controller.ts` → `ContractsController.pause`

### POST /contracts/:id/resume
- **Propósito:** Retomar um contrato `PAUSED`.
- **Auth:** Bearer (access token). Permissão: `financeiro:gerenciar`.
- **Body:** —
- **Resposta:** `200 Contract` (`status: ACTIVE`).
- **Erros:** `404 Contrato não encontrado.`, `422 Transição de status inválida.`, `401`.
- **Handler:** `modules/finance/api/contracts.controller.ts` → `ContractsController.resume`

### POST /contracts/:id/cancel
- **Propósito:** Cancelar um contrato. Cancela também as cobranças `PENDING`/`OVERDUE` (em aberto); as `PAID` permanecem no histórico.
- **Auth:** Bearer (access token). Permissão: `financeiro:gerenciar`.
- **Body:** —
- **Resposta:** `200 Contract` (`status: CANCELED`, cobranças em aberto `CANCELED`).
- **Erros:** `404 Contrato não encontrado.`, `422 Transição de status inválida.`, `401`.
- **Handler:** `modules/finance/api/contracts.controller.ts` → `ContractsController.cancel`

---

## Payments

### GET /payments
- **Propósito:** Listar cobranças do usuário autenticado, paginado, com busca opcional por nome do cliente ou descrição do contrato (`search`) e filtro opcional por cliente, contrato, status, regime de cobrança e período de vencimento.
- **Auth:** Bearer (access token). Permissão: `financeiro:ver` ou `financeiro:gerenciar`.
- **Body:** — (query: `page`, `limit`, `search?` (nome do cliente ou descrição do contrato, case-insensitive), `clientId?`, `contractId?`, `status?`, `billingType?`, `dueFrom?`, `dueTo?`, `sortBy?`, `sortDir?`). O `status` aceita um único valor (`?status=PAID`) **ou** vários (`?status=PENDING&status=OVERDUE`) — o resultado inclui qualquer um dos status informados. `sortBy` ∈ `status | client | contract | dueDate | amount`; `sortDir` ∈ `asc | desc` (padrão `asc`).
- **Resposta:** `200 Paginated<Payment>` (com `contract` e `contract.client`). Ordenação padrão (sem `sortBy`): status por prioridade (Vencido → Pendente → Pago → Cancelado), depois cliente, contrato e vencimento. Com `sortBy`, ordena pela coluna escolhida usando cliente/contrato/vencimento como desempate.
- **Erros:** `400` (validação), `404 Cliente não encontrado.` (se `clientId` não for do dono), `401`.
- **Handler:** `modules/finance/api/payments.controller.ts` → `PaymentsController.list`

### GET /payments/summary
- **Propósito:** Totais agregados das cobranças (para os cards de recebimentos), respeitando os mesmos filtros da listagem, **exceto** status: `recebido` (Σ de PAID, usando `paidAmount`), `aReceber` (Σ de PENDING + OVERDUE) e `emAtraso` (Σ de OVERDUE).
- **Auth:** Bearer (access token). Permissão: `financeiro:ver` ou `financeiro:gerenciar`.
- **Body:** — (query: `search?`, `clientId?`, `contractId?`, `billingType?`, `dueFrom?`, `dueTo?`).
- **Resposta:** `200 { recebido: number, aReceber: number, emAtraso: number }`.
- **Erros:** `400` (validação), `404 Cliente não encontrado.` (se `clientId` não for do dono), `401`.
- **Handler:** `modules/finance/api/payments.controller.ts` → `PaymentsController.summary`

### PATCH /payments/:id
- **Propósito:** Editar uma cobrança (descrição, valor, vencimento), permitido apenas enquanto `PENDING`.
- **Auth:** Bearer (access token). Permissão: `financeiro:gerenciar`.
- **Body:** `{ description?, amount?, dueDate? }`.
- **Resposta:** `200 Payment`.
- **Erros:** `400` (validação), `404 Cobrança não encontrada.`, `422 Apenas cobranças pendentes podem ser editadas.`, `401`.
- **Handler:** `modules/finance/api/payments.controller.ts` → `PaymentsController.update`

### POST /payments/:id/pay
- **Propósito:** Dar baixa numa cobrança `PENDING`/`OVERDUE` (marca `PAID`, aceita valor recebido parcial/diferente).
- **Auth:** Bearer (access token). Permissão: `financeiro:gerenciar`.
- **Body:** `{ method, paidAt?, paidAmount?, notes? }`.
- **Resposta:** `200 Payment` (`status: PAID`, `paidAt`/`paidAmount`/`method` preenchidos).
- **Erros:** `400` (validação), `404 Cobrança não encontrada.`, `422 Transição de status inválida.`, `401`.
- **Handler:** `modules/finance/api/payments.controller.ts` → `PaymentsController.pay`

### POST /payments/:id/revert
- **Propósito:** Estornar uma cobrança `PAID` (volta a `PENDING`); nunca destrutivo — o estorno fica registrado em `notes`.
- **Auth:** Bearer (access token). Permissão: `financeiro:gerenciar`.
- **Body:** —
- **Resposta:** `200 Payment` (`status: PENDING`, `paidAt`/`paidAmount`/`method` limpos, `notes` com o registro do estorno).
- **Erros:** `404 Cobrança não encontrada.`, `422 Transição de status inválida.`, `401`.
- **Handler:** `modules/finance/api/payments.controller.ts` → `PaymentsController.revert`

### POST /payments/:id/cancel
- **Propósito:** Cancelar uma cobrança `PENDING`/`OVERDUE`.
- **Auth:** Bearer (access token). Permissão: `financeiro:gerenciar`.
- **Body:** —
- **Resposta:** `200 Payment` (`status: CANCELED`).
- **Erros:** `404 Cobrança não encontrada.`, `422 Transição de status inválida.`, `401`.
- **Handler:** `modules/finance/api/payments.controller.ts` → `PaymentsController.cancel`

---

## Dashboard

Métricas agregadas do dono autenticado (posse via `client.ownerId`). Somente leitura. Valores monetários são `number`; a soma ocorre no banco (sem float). Janelas de tempo em UTC: "no mês" = vencimento/decisão no mês corrente; "próximos" = 7 dias; conversão = 90 dias.

### GET /dashboard/summary
- **Propósito:** Resumo comercial e operacional: funil de oportunidades, propostas, demandas e próximas ações (follow-ups). Os blocos com responsável (funil, demandas e próximas ações) também são recortados: sem `oportunidade:ver_todas` / `demanda:ver_todas` / `cliente:ver_todos`, cada um devolve apenas os registros do usuário e os sem responsável. Propostas não têm responsável e não são recortadas.
- **Auth:** Bearer (access token).
- **Body:** — (query: `onlyMine?: boolean` — alternador "Somente meus": recorta funil, demandas e próximas ações estritamente ao usuário logado, removendo também os sem responsável)
- **Resposta:** `200 { funnel, proposals, demands, upcomingActions }`, onde:
  - `funnel: { stages: Array<{ stageId, name, isWon, isLost, count, amount }> (ordem do pipeline), totalOpen: number, amountInNegotiation: number }` — `totalOpen`/`amountInNegotiation` somam apenas estágios não terminais (nem `isWon` nem `isLost`).
  - `proposals: { openCount, openAmount, acceptedThisMonth, conversionRate }` — em aberto = `DRAFT|SENT|NEGOTIATING`; `conversionRate` (0..1) = aceitas ÷ (aceitas + recusadas) decididas nos últimos 90 dias (0 se não houver decididas).
  - `demands: { inProgress, overdue, upcoming: Array<{ id, title, status, priority, dueDate, projectId, projectName, clientId, clientName }> }` — `overdue` = tarefas não concluídas com `dueDate < agora`; `upcoming` = entregas nos próximos 7 dias (máx. 5).
  - `upcomingActions: Array<{ id, type, content, scheduledFor, clientId, clientName }>` — follow-ups agendados não concluídos (máx. 5).
- **Erros:** `401`.
- **Handler:** `modules/dashboard/api/dashboard.controller.ts` → `DashboardController.summary`

### GET /dashboard/finance
- **Propósito:** Resumo financeiro: MRR, previsto × recebido no mês, total em atraso e próximos vencimentos.
- **Auth:** Bearer (access token). Permissão: `financeiro:ver` ou `financeiro:gerenciar`.
- **Query:** `month?` (`AAAA-MM`) — mês de referência dos totais previstos/recebidos; ausente → mês corrente. Só desloca `month`; `mrr`, `overdue` e `upcoming` são sempre relativos a agora.
- **Body:** —
- **Resposta:** `200 { mrr, month, overdue, upcoming }`, onde:
  - `mrr: number` — Σ das mensalidades de contratos `ACTIVE` recorrentes.
  - `month: { expected, received }` — por vencimento no mês de referência (ver `month?`): `expected` = Σ das cobranças não canceladas; `received` = Σ do valor recebido (`paidAmount`, ou `amount` quando ausente) das cobranças `PAID`.
  - `overdue: number` — Σ de `OVERDUE` + `PENDING` com `dueDate < agora` (trata a janela entre o cron e a leitura, ver SPEC §5).
  - `upcoming: Array<{ id, description, dueDate, amount, contractId, clientId, clientName }>` — cobranças `PENDING` a vencer nos próximos 7 dias (máx. 5).
- **Erros:** `401`; `400` (`month` fora do formato `AAAA-MM`).
- **Handler:** `modules/dashboard/api/dashboard.controller.ts` → `DashboardController.finance`

---

## Billing (Stripe)

Cobrança por assinatura da instância **SaaS hospedada** (R$ 27,97/mês). Ativo apenas quando `BILLING_ENABLED=true` e as chaves Stripe estão presentes; na autohospedagem o Stripe nunca é inicializado e checkout/portal respondem `503`. O estado local (`Subscription`, 1 por owner, sob RLS) é um espelho sincronizado pelo webhook. As três rotas abaixo são isentas do `BillingGuard` (`@AllowWithoutSubscription()`) para que um owner com trial expirado ainda consiga assinar.

### POST /billing/checkout
- **Propósito:** Criar (ou reaproveitar) o customer no Stripe e abrir uma sessão de Checkout no modo assinatura para o preço único configurado (`STRIPE_PRICE_ID`). Retorna a URL hospedada do Stripe.
- **Auth:** Bearer (access token). Isenta do gate de assinatura. Permissão: `assinatura:gerenciar`.
- **Body:** —
- **Resposta:** `201 { url: string }` — URL de Checkout do Stripe (redirecionar o navegador).
- **Erros:** `503 Cobrança não está habilitada nesta instância.` (billing off); `404 Usuário não encontrado.`; `401`.
- **Handler:** `modules/billing/api/billing.controller.ts` → `BillingController.checkout`

### POST /billing/portal
- **Propósito:** Abrir o Customer Portal do Stripe para o owner gerenciar a própria assinatura (trocar cartão, cancelar, ver faturas).
- **Auth:** Bearer (access token). Isenta do gate de assinatura. Permissão: `assinatura:gerenciar`.
- **Body:** —
- **Resposta:** `201 { url: string }` — URL do Customer Portal do Stripe.
- **Erros:** `503 Cobrança não está habilitada nesta instância.` (billing off); `404 Assinatura não encontrada.` (owner sem customer Stripe); `401`.
- **Handler:** `modules/billing/api/billing.controller.ts` → `BillingController.portal`

### GET /billing/status
- **Propósito:** Estado da assinatura do owner atual, para a UI de billing. Sempre responde (mesmo com billing off), permitindo ao frontend decidir se monta a feature.
- **Auth:** Bearer (access token). Isenta do gate de assinatura.
- **Body:** —
- **Resposta:** `200 { billingEnabled: boolean, status: 'TRIALING'|'ACTIVE'|'PAST_DUE'|'CANCELED'|'INCOMPLETE'|null, trialEndsAt: string|null, currentPeriodEnd: string|null, cancelAtPeriodEnd: boolean, hasAccess: boolean }` — `billingEnabled=false` ⇒ o front esconde toda a UI de billing; `hasAccess` é a autoridade do gate (com billing off é sempre `true`).
- **Erros:** `401`.
- **Handler:** `modules/billing/api/billing.controller.ts` → `BillingController.status`

### POST /billing/webhook
- **Propósito:** Endpoint consumido pelo Stripe para sincronizar o `Subscription` local com os eventos de assinatura (`checkout.session.completed`, `customer.subscription.created|updated|deleted`). Idempotente; eventos não tratados respondem `200` sem efeito.
- **Auth:** Pública (`@Public()`), sem JWT. A autenticidade vem da assinatura do webhook, verificada com `STRIPE_WEBHOOK_SECRET` sobre o `rawBody`. Sem contexto de owner — usa o client admin (bypassa RLS), resolvendo o owner pelo `stripeCustomerId` do evento.
- **Body:** Payload de evento do Stripe (raw). Header obrigatório `stripe-signature`.
- **Resposta:** `201 { received: true }`.
- **Erros:** `400 Assinatura do webhook inválida.` (assinatura ausente/adulterada ou secret incorreto).
- **Handler:** `modules/billing/api/stripe-webhook.controller.ts` → `StripeWebhookController.handle`

---

## Workspace

### GET /workspace/members
- **Propósito:** Listar as pessoas da workspace (owner + colaboradores ativos) para o seletor de responsável.
- **Auth:** Bearer (access token). Sem permissão específica — qualquer sessão válida.
- **Body:** —
- **Resposta:** `200 { id, name, isOwner }[]`, ordenado por nome. Convite pendente e colaborador desativado ficam de fora.
- **Erros:** `401`.
- **Handler:** `modules/workspace/api/workspace-members.controller.ts` → `WorkspaceMembersController.list`

---

## Permissões

### GET /permissions
- **Propósito:** Catálogo de permissões agrupado por categoria — fonte única dos rótulos em pt-BR usados pelo editor de papéis e pelo detalhe de um papel. O frontend **não** duplica esses textos.
- **Auth:** Bearer (access token). Sem permissão exigida: é uma lista estática de rótulos, não revela dado de ninguém.
- **Body:** —
- **Resposta:** `200 [{ category: string, permissions: [{ key, label, description, category }] }]` — na ordem de exibição das categorias (Clientes, Pipeline, Propostas, Operação, Financeiro, Organização). Chaves marcadas como `hidden` no catálogo ficam de fora (continuam válidas, só não são exibidas).
- **Erros:** `401`.
- **Handler:** `modules/access/api/permissions.controller.ts` → `PermissionsController.list`

---

## Papéis

Papéis são escopados ao owner (RLS por `ownerId`): dois owners podem ter papéis com o mesmo nome sem se verem. O papel `system` ("Administrador") nasce com a conta, **vale sempre o catálogo inteiro** (resolvido em tempo de execução, então não desatualiza quando uma permissão nova entra) e não é editável nem excluível.

### GET /roles
- **Propósito:** Listar os papéis do owner, com a contagem de colaboradores que usam cada um. Papel do sistema primeiro, depois por nome.
- **Auth:** Bearer (access token). Permissão: `papel:gerenciar`.
- **Body:** —
- **Resposta:** `200 [{ id, name, description, system, permissions: string[], collaboratorsCount, createdAt }]` — no papel `system`, `permissions` traz o catálogo inteiro.
- **Erros:** `401`, `403`.
- **Handler:** `modules/collaborators/api/roles.controller.ts` → `RolesController.list`

### POST /roles
- **Propósito:** Criar um papel para o owner atual.
- **Auth:** Bearer (access token). Permissão: `papel:gerenciar`.
- **Body:** `{ name: string (2–60), description?: string (≤200), permissions: string[] }` — chave fora do catálogo é **descartada** (não rejeitada), para que uma permissão removida do catálogo não impeça salvar.
- **Resposta:** `201 { id, name, description, system: false, permissions, collaboratorsCount: 0, createdAt }`.
- **Erros:** `409 Já existe um papel com este nome.`; `400` (validação); `401`, `403`.
- **Handler:** `modules/collaborators/api/roles.controller.ts` → `RolesController.create`

### PATCH /roles/:id
- **Propósito:** Substituir nome, descrição e o conjunto de permissões de um papel (não é patch parcial: envia o registro completo, como o formulário do painel).
- **Auth:** Bearer (access token). Permissão: `papel:gerenciar`.
- **Body:** `{ name, description?, permissions: string[] }`.
- **Resposta:** `200 { …papel }`.
- **Erros:** `404 Papel não encontrado.` (inexistente ou de outro owner); `403 O papel do sistema não pode ser editado nem excluído.`; `409 Já existe um papel com este nome.`; `400`; `401`, `403`.
- **Handler:** `modules/collaborators/api/roles.controller.ts` → `RolesController.update`

### DELETE /roles/:id/permissions/:key
- **Propósito:** Remover uma permissão pontual do papel, direto do detalhe expandido — sem abrir o formulário inteiro.
- **Auth:** Bearer (access token). Permissão: `papel:gerenciar`.
- **Body:** —
- **Resposta:** `200 { …papel }` (já sem a chave).
- **Erros:** `404 Papel não encontrado.`; `403 O papel do sistema não pode ser editado nem excluído.`; `401`, `403`.
- **Handler:** `modules/collaborators/api/roles.controller.ts` → `RolesController.removePermission`

### DELETE /roles/:id
- **Propósito:** Excluir um papel que não está em uso.
- **Auth:** Bearer (access token). Permissão: `papel:gerenciar`.
- **Body:** —
- **Resposta:** `204` (sem corpo).
- **Erros:** `404 Papel não encontrado.`; `403 O papel do sistema não pode ser editado nem excluído.`; `409 Este papel está em uso por colaboradores. Troque o papel deles antes de excluir.`; `401`, `403`.
- **Handler:** `modules/collaborators/api/roles.controller.ts` → `RolesController.remove`

---

## Colaboradores

Colaborador é um `User` com `ownerId` preenchido: enxerga os dados do owner (mesmo `app.owner_id`) limitado pelo papel, **não** tem assinatura própria (herda a do owner) e não pode alterar o próprio acesso. `User` fica fora do RLS (login busca por e-mail), então toda consulta aqui filtra `ownerId` explicitamente.

### GET /collaborators
- **Propósito:** Listar os colaboradores do owner atual, com papel e situação.
- **Auth:** Bearer (access token). Permissão: `colaborador:gerenciar`.
- **Body:** —
- **Resposta:** `200 [{ id, name, email, active, status: 'PENDING' | 'ACTIVE' | 'INACTIVE', role: { id, name, system } | null, createdAt }]` — `status` é derivado: `PENDING` enquanto o convite não foi aceito. Nunca traz `passwordHash`.
- **Erros:** `401`, `403`.
- **Handler:** `modules/collaborators/api/collaborators.controller.ts` → `CollaboratorsController.list`

### POST /collaborators
- **Propósito:** Convidar um colaborador: cria a conta **sem senha** e emite um convite de uso único (7 dias), enviado por e-mail. O link volta na resposta para o painel exibir — é o que mantém o fluxo utilizável sem SMTP configurado.
- **Auth:** Bearer (access token). Permissão: `colaborador:gerenciar`.
- **Body:** `{ name: string (2–120), email: string (e-mail), roleId: uuid }` — o papel tem de ser do próprio owner.
- **Resposta:** `201 { collaborator: {…}, inviteUrl: string, inviteExpiresInDays: 7 }`.
- **Erros:** `409 Já existe uma conta com este e-mail.` (o e-mail é único no banco inteiro); `404 Papel não encontrado.` (papel de outro owner); `400` (validação); `401`, `403`.
- **Handler:** `modules/collaborators/api/collaborators.controller.ts` → `CollaboratorsController.create`

### POST /collaborators/:id/invite
- **Propósito:** Emitir um novo convite para quem ainda não ativou o acesso. Invalida o link anterior (só o último vale).
- **Auth:** Bearer (access token). Permissão: `colaborador:gerenciar`.
- **Body:** —
- **Resposta:** `201 { inviteUrl: string, inviteExpiresInDays: 7 }`.
- **Erros:** `404 Colaborador não encontrado.`; `409 Este colaborador já ativou o acesso. Se ele perdeu a senha, use "Esqueci minha senha".`; `401`, `403`.
- **Handler:** `modules/collaborators/api/collaborators.controller.ts` → `CollaboratorsController.resendInvite`

### PATCH /collaborators/:id
- **Propósito:** Trocar o papel e/ou ativar–desativar um colaborador. Desativar revoga a sessão vigente (refresh token) e derruba o acesso na requisição seguinte.
- **Auth:** Bearer (access token). Permissão: `colaborador:gerenciar`.
- **Body:** `{ roleId?: uuid, active?: boolean }`.
- **Resposta:** `200 { …colaborador }`.
- **Erros:** `403 Você não pode alterar o seu próprio acesso.`; `404 Colaborador não encontrado.` (inexistente, de outro owner, ou o próprio owner — que não é colaborador de ninguém); `404 Papel não encontrado.` (papel de outro owner); `400`; `401`, `403`.
- **Handler:** `modules/collaborators/api/collaborators.controller.ts` → `CollaboratorsController.update`

---

## Convite de colaborador (público)

Rotas do aceite: quem abre o link ainda não tem sessão. Não têm contexto de owner, então usam o client admin (`CollaboratorInvite` tem RLS). O banco guarda apenas o **sha256** do token; o valor bruto só existe no link. Token inexistente, expirado ou já usado respondem a **mesma** mensagem — não há o que ganhar distinguindo.

### GET /collaborators/invite/:token
- **Propósito:** Dados para a tela de aceite: quem foi convidado e por qual conta.
- **Auth:** Pública (`@Public()`). Rate limit: 10 req/min.
- **Body:** —
- **Resposta:** `200 { name, email, ownerName, expiresInDays: 7 }`.
- **Erros:** `410 Este convite não é mais válido. Peça um novo ao responsável pela conta.`; `403 Este acesso foi desativado. Fale com o responsável pela conta.`
- **Handler:** `modules/collaborators/api/invites.controller.ts` → `InvitesController.preview`

### POST /collaborators/invite/:token/accept
- **Propósito:** Definir a senha, consumir o convite (uso único) e **já autenticar** — o link chegou no e-mail do próprio colaborador, então pedir login em seguida seria atrito sem ganho.
- **Auth:** Pública (`@Public()`). Rate limit: 5 req/min.
- **Body:** `{ password: string (mín. 6) }`.
- **Resposta:** `201 { accessToken: string }` + cookie `httpOnly` `refresh_token` (path `/api/v1/auth`) + cookie `httpOnly` `device_id` (path `/api/v1`, 400 dias).
- **Erros:** `410 Este convite não é mais válido. Peça um novo ao responsável pela conta.` (inclui a corrida de dois envios simultâneos do mesmo link); `403 Este acesso foi desativado. Fale com o responsável pela conta.`; `400` (senha curta).
- **Handler:** `modules/collaborators/api/invites.controller.ts` → `InvitesController.accept`

## Auditoria

Trilha de mudanças sensíveis de estado, por owner. É **somente leitura** pela API: a tabela tem RLS por `ownerId` e a aplicação (`crm_app`) só tem `SELECT`/`INSERT` — não existe rota de editar nem de excluir uma entrada, por desenho.

Uma linha nasce a cada mudança instrumentada (baixa/estorno/cancelamento de cobrança, contrato, proposta, papel, colaborador, arquivamento de cliente) e também nas mudanças **sem ator humano**: os crons diários (`actorType: CRON`), o webhook do Stripe (`WEBHOOK`) e o aceite de convite (`USER`, com o convidado como autor).

### GET /audit
- **Propósito:** Listar a trilha de auditoria do owner, paginada e ordenada da mais recente para a mais antiga, com filtro opcional por entidade, registro, autor, ação e período.
- **Auth:** Bearer (access token). Permissão: `auditoria:ver`.
- **Body:** — (query: `page`, `limit`, `entity?`, `entityId?`, `actorId?`, `action?`, `from?` (`AAAA-MM-DD`), `to?` (`AAAA-MM-DD`, inclui o dia inteiro)).
- **Resposta:** `200 Paginated<AuditLog>` — cada item traz `actorType`, `actorId`, `actorName`, `entity`, `entityId`, `entityLabel`, `action`, `diff`, `requestId`, `createdAt`. `actorName` e `entityLabel` são o que valia **no momento da ação**.
- **Erros:** `400` (validação), `403 Você não tem permissão para ver a auditoria.`, `401`.
- **Handler:** `modules/audit/api/audit.controller.ts` → `AuditController.list`

### GET /audit/entities/:entity/:id
- **Propósito:** Histórico completo de um registro específico (até 100 entradas), para a visão "quem mexeu neste cliente/cobrança/contrato".
- **Auth:** Bearer (access token). Permissão: `auditoria:ver`.
- **Body:** — (`entity` ∈ `CLIENT | CONTACT | DEAL | PROPOSAL | PROJECT | TASK | CONTRACT | PAYMENT | ROLE | USER | SUBSCRIPTION`).
- **Resposta:** `200 AuditLog[]` (mais recente primeiro).
- **Erros:** `400` (entidade fora do enum), `403`, `401`.
- **Handler:** `modules/audit/api/audit.controller.ts` → `AuditController.byEntity`

---

## Notificações

Central de notificações in-app do usuário logado. **Nenhuma rota desta seção exige `@RequirePermission`**: a caixa é do próprio usuário, como o Perfil e `GET /workspace/members` — uma chave aqui significaria "papel que pode receber notificação", que não é um conceito do produto. O recorte de cada rota é `userId` + `ownerId`, sempre os dois.

A notificação é emitida por seis gatilhos (atribuição de registro e cinco prazos por cron — ver ROADMAP), entregue de forma assíncrona pelo `NotificationsDispatchJob` (varredura a cada minuto) e lida através da entrega `IN_APP`. Por enquanto só o canal `IN_APP` está implementado; `EMAIL`, `WEBHOOK` e `SLACK` chegam nas fases seguintes.

### GET /notifications
- **Propósito:** Listar a central de notificações do usuário logado, paginada e ordenada da mais recente para a mais antiga, com filtro opcional por não lidas.
- **Auth:** Bearer (access token). Sem permissão específica.
- **Body:** — (query: `page?`, `limit?`, `unreadOnly?`).
- **Resposta:** `200 Paginated<Notificacao>` — cada item traz `id` (id da **entrega**, o que "marcar como lida" recebe), `type`, `entity`, `entityId`, `title`, `body`, `link`, `readAt`, `createdAt`.
- **Erros:** `400` (validação), `401`.
- **Handler:** `modules/notifications/api/notifications.controller.ts` → `NotificationsController.list`

### GET /notifications/unread-count
- **Propósito:** Contagem de notificações não lidas do usuário logado — alimenta o badge do sino no header.
- **Auth:** Bearer (access token). Sem permissão específica.
- **Body:** —
- **Resposta:** `200 { count: number }`.
- **Erros:** `401`.
- **Handler:** `modules/notifications/api/notifications.controller.ts` → `NotificationsController.unreadCount`

### POST /notifications/read-all
- **Propósito:** Marcar todas as notificações não lidas do usuário logado como lidas.
- **Auth:** Bearer (access token). Sem permissão específica.
- **Body:** —
- **Resposta:** `200 { updated: number }`.
- **Erros:** `401`.
- **Handler:** `modules/notifications/api/notifications.controller.ts` → `NotificationsController.readAll`

### POST /notifications/:id/read
- **Propósito:** Marcar uma notificação (pelo id da entrega `IN_APP`) como lida.
- **Auth:** Bearer (access token). Sem permissão específica.
- **Body:** —
- **Resposta:** `200 { ok: true }`.
- **Erros:** `404 Notificação não encontrada.` (id de outra pessoa, ou inexistente — de propósito, não `403`: não revela a existência de notificação alheia), `401`.
- **Handler:** `modules/notifications/api/notifications.controller.ts` → `NotificationsController.read`

### Destinos de notificação

Cada usuário tem N **destinos** (`UserNotificationTarget`), e o opt-in é uma matriz **tipo × destino** — não tipo × canal. Um destino do mesmo tipo pode existir mais de uma vez (dois e-mails, por exemplo).

**A `config` do destino nunca volta crua.** A resposta traz `configResumo`, um resumo por tipo de canal: `null` no `IN_APP`, o endereço no `EMAIL`, e **só o host** (`hooks.slack.com`) no `WEBHOOK`/`SLACK` — nunca o caminho, que é a credencial de escrita naquele canal.

**A URL de um webhook é, ela própria, a credencial.** Não há assinatura nem segredo separado nesta versão: quem tiver o endereço escreve no canal. Por isso ela nunca aparece em log nenhum, nunca volta inteira na resposta, e criar um destino de integração exige a permissão `notificacao:integrar`. Assinatura HMAC entra na Fase 19, junto da máquina de API key com escopos e rotação — acrescentar um cabeçalho de assinatura depois é aditivo e não quebra quem já recebe.

**Payload por tipo de canal:**

| Canal | Corpo enviado |
|---|---|
| `WEBHOOK` | O conteúdo neutro cru: `{ tipo, titulo, corpo, link, dados }` — para n8n/Zapier montarem o que quiserem. |
| `SLACK` | `{ text: "*<titulo>*\n<corpo>\n<link\|Abrir no CRM>" }`, no formato *mrkdwn* (o Slack não aceita corpo arbitrário). |

**Cabeçalhos de toda entrega:** `Content-Type: application/json`, `X-CRM-Delivery: <id da entrega>`, `X-CRM-Timestamp: <epoch>`, `User-Agent: CRM-ProgrameAi/1.0`. O `X-CRM-Delivery` é o que permite ao receptor **deduplicar** — necessário, porque o outbox tem retry e a mesma entrega pode chegar mais de uma vez com o mesmo id.

### GET /notifications/targets
- **Propósito:** Listar os destinos de notificação do usuário logado, com o opt-in de cada um.
- **Auth:** Bearer (access token). Sem permissão específica.
- **Body:** —
- **Resposta:** `200 DestinoNaApi[]` — cada item traz `id`, `kind`, `label`, `configResumo` (resumido, ver acima), `types`, `verified`, `active`, `createdAt`.
- **Erros:** `401`.
- **Handler:** `modules/notifications/api/notifications.controller.ts` → `NotificationsController.listTargets`

### POST /notifications/targets
- **Propósito:** Criar um destino de e-mail para o usuário logado. Nasce verificado (o endereço é do próprio usuário) e ativo.
- **Auth:** Bearer (access token). Sem permissão específica.
- **Body:** `{ label: string, email: string, types?: NotificationType[] }` (sem `types`, assina os seis tipos).
- **Resposta:** `201 DestinoNaApi`.
- **Erros:** `400` (validação — rótulo vazio, e-mail inválido, tipo fora do enum), `401`.
- **Handler:** `modules/notifications/api/notifications.controller.ts` → `NotificationsController.createTarget`

### POST /notifications/targets/integrations
- **Propósito:** Criar um destino de integração (`WEBHOOK`, `SLACK`, `DISCORD` ou `TELEGRAM`). Nasce **não verificado e inativo**: nenhuma entrega sai antes do ping de `POST /notifications/targets/:id/verify`.
- **Auth:** Bearer (access token). Permissão: `notificacao:integrar` (só esta rota e a de verificação são gateadas — as demais da seção são livres, porque a caixa é do próprio usuário).
- **Body:** `{ label: string, kind: 'WEBHOOK' | 'SLACK' | 'DISCORD' | 'TELEGRAM', url: string, types?: NotificationType[] }`. O `kind` declara o **formato do payload**, não o domínio de destino — nenhum deles exige um host específico. No `TELEGRAM` a `url` é o `sendMessage` da Bot API com o `chat_id` na query (`https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<ID>`), montada pelo front a partir dos dois campos que o usuário preenche; o adapter move o `chat_id` para o corpo JSON. Sem `types`, o destino nasce com os seis tipos.
- **Resposta:** `201 DestinoNaApi` (com `verified: false`, `active: false` e `configResumo` = só o host).
- **Erros:** `400` (validação de formato), `422 O endereço precisa usar HTTPS.` / `422 O endereço precisa usar a porta padrão do HTTPS (443).` / `422 Este endereço aponta para a rede interna e não pode ser usado.` (bloqueio de SSRF: loopback, link-local — inclusive `169.254.169.254` do metadata de cloud —, privada e CGNAT, em IPv4 e IPv6) / `422 Não foi possível resolver este endereço. Confira o domínio.`, `403 Você não tem permissão para integrar notificações.`, `401`.
- **Handler:** `modules/notifications/api/notifications.controller.ts` → `NotificationsController.createIntegration`

### POST /notifications/targets/:id/verify
- **Propósito:** Enviar um ping de teste ao destino de integração e, se ele responder 2xx, marcá-lo como verificado e ativo. É o passo que faltava para o destino começar a receber.
- **Auth:** Bearer (access token). Permissão: `notificacao:integrar`.
- **Body:** —
- **Resposta:** `200 DestinoNaApi` (com `verified: true`, `active: true`).
- **Erros:** `404 Destino não encontrado.`, `422 Este destino não precisa de verificação.` (em `IN_APP`/`EMAIL`), `422 Não foi possível entregar no destino: <motivo>` (a URL **nunca** aparece no motivo), `403`, `401`.
- **Handler:** `modules/notifications/api/notifications.controller.ts` → `NotificationsController.verifyTarget`

### PATCH /notifications/targets/:id
- **Propósito:** Renomear o destino, ligá-lo/desligá-lo ou mudar quais tipos ele recebe. **Não** permite trocar o `kind` nem a `config` — mudar o endereço é criar outro destino (o histórico de entregas aponta para este id).
- **Auth:** Bearer (access token). Sem permissão específica.
- **Body:** `{ label?: string, active?: boolean, types?: NotificationType[] }`.
- **Resposta:** `200 DestinoNaApi`.
- **Erros:** `400` (validação), `404 Destino não encontrado.` (de outra pessoa, ou inexistente), `401`.
- **Handler:** `modules/notifications/api/notifications.controller.ts` → `NotificationsController.updateTarget`

### DELETE /notifications/targets/:id
- **Propósito:** Remover um destino do usuário logado.
- **Auth:** Bearer (access token). Sem permissão específica.
- **Body:** —
- **Resposta:** `204` (sem corpo).
- **Erros:** `404 Destino não encontrado.`, `422 Não é possível remover a central de notificações. Desative-a, se preferir não receber.` (ao tentar apagar o último destino `IN_APP` — apagá-lo deixaria o sino permanentemente vazio sem explicação), `401`.
- **Handler:** `modules/notifications/api/notifications.controller.ts` → `NotificationsController.deleteTarget`

---

## Lixeira

Read model somente leitura que atravessa `Client`, `Contact`, `Deal`, `Project` e `Task` — os cinco recursos com soft delete (`archivedAt`). Arquivar/restaurar/expurgar são rotas **do recurso** (`POST /<recurso>/:id/archive`, `POST /<recurso>/:id/restore`, `DELETE /<recurso>/:id`), documentadas nas seções acima; esta seção só cobre a listagem unificada.

### GET /trash
- **Propósito:** Listar os registros arquivados dos cinco tipos, paginado (paginação em memória, ordenado por `archivedAt desc`) e filtrável por tipo.
- **Auth:** Bearer (access token). Permissão: `lixeira:ver`.
- **Body:** — (query: `page?`, `limit?`, `type?` ∈ `CLIENT | CONTACT | DEAL | PROJECT | TASK`).
- **Resposta:** `200 Paginated<TrashItem>` — cada item traz `type`, `id`, `label` (rótulo humano do registro), `context` (cliente ou projeto a que pertence, ou `null`) e `archivedAt`.
- **Erros:** `400` (validação), `403 Você não tem permissão para ver a lixeira.`, `401`.
- **Handler:** `modules/trash/api/trash.controller.ts` → `TrashController.list`
