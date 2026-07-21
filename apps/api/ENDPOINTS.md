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
