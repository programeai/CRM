# apps/api — Instruções do backend (NestJS + Prisma)

> As regras de idioma (pt-BR) e de arquitetura geral do monorepo estão no `CLAUDE.md` da raiz e também valem aqui. As regras abaixo **são obrigatórias**: código novo nasce em conformidade e código existente que divergir deve ser **corrigido para respeitá-las**, nunca o inverso.

## Idioma das mensagens

Toda mensagem visível ao usuário em pt-BR, incluindo as exceções lançadas (`ConflictException`, `NotFoundException`, `UnauthorizedException`, `ForbiddenException`, `BadRequestException`, `GoneException`, `UnprocessableEntityException`, etc.) e as mensagens de validação (class-validator / Zod).

## Modular Monolith

Cada módulo de negócio é uma **fronteira clara**, e vive em `src/modules/<nome>/`. Um módulo não acessa o interior de outro: a comunicação acontece pelos *services* públicos que aquele módulo exporta no seu `*.module.ts`.

Recursos transversais (não são módulos de negócio) ficam fora de `modules/`:

```
src/
  modules/     → módulos de negócio (auth, users, clients, deals, …)
  prisma/      → PrismaService + PrismaModule (global)
  config/      → validação de env
  shared/      → utilitários e tipos transversais (quando existirem)
```

## Estrutura por módulo (em camadas)

Módulos de negócio com regra relevante seguem o mesmo formato em camadas:

```
src/modules/<nome>/
  <nome>.module.ts
  domain/        → tipos de domínio, contratos e interfaces de repositório (tokens DI)
  application/   → use cases (services) — a regra de negócio
  infra/         → repositórios Prisma que implementam as interfaces do domain
  api/           → controllers e DTOs (fronteira HTTP)
```

## Repository pattern

- **Não vaze o `PrismaService` para dentro dos use cases.** A camada `application` depende de **interfaces de repositório** declaradas no `domain/` (via token DI), nunca do `PrismaClient`/`PrismaService` diretamente.
- As implementações Prisma ficam em `infra/` (`prisma-<nome>.repository.ts`) e são ligadas à interface no módulo: `{ provide: TOKEN, useClass: PrismaXRepository }`.
- Isso garante testabilidade (mock da interface) e mantém a regra de negócio livre de detalhes de ORM.

## Domínio vs. persistência — evite over-engineering

- Quando a regra de negócio for **complexa**, separe o **modelo de domínio** do registro do Prisma, com mappers em `infra/`.
- Para **CRUD simples**, o tipo gerado pelo Prisma pode servir direto como modelo — não crie camadas vazias só por simetria.
- Módulos **transversais e simples** (ex.: `auth`, `users`) podem viver em `modules/` sem a subdivisão `domain/application/infra/api` completa, desde que continuem sendo uma fronteira clara.

## DTOs e fronteira HTTP

- **Validação de entrada com class-validator** em DTOs (`api/dto/*.dto.ts`), aplicada por `ValidationPipe`. Mensagens de validação em pt-BR.
- **Nunca exponha o registro do Prisma cru na resposta quando ele contiver segredos** (ex.: `passwordHash`, `refreshTokenHash`). Remova campos sensíveis antes de retornar.
- Qualquer mudança de modelo de dados começa em `prisma/schema.prisma` (+ migration) e se propaga para o módulo.

## Documentação de endpoints (obrigatória)

A API **sempre** mantém uma referência de endpoints clara e **consumível por IA** em `apps/api/ENDPOINTS.md`. Isso é parte do **padrão de progresso (Definition of Done)**: nenhum endpoint é considerado pronto sem doc.

Regras:
- **Toda** rota nova, alterada ou removida é refletida em `ENDPOINTS.md` **no mesmo commit/PR**. PR que mexe em controller sem atualizar a doc está incompleto.
- **Formato fixo por endpoint** (não altere os rótulos, para o parsing por IA permanecer trivial): cabeçalho `### MÉTODO /caminho` seguido de **Propósito**, **Auth**, **Body**, **Resposta**, **Erros**, **Handler**.
- Cada endpoint declara **para que serve** (Propósito), quem pode chamar (Auth) e o shape de entrada/saída e os erros esperados.
- Idioma pt-BR.

## Log estruturado (obrigatório)

Os containers do CRM são coletados pela stack de observabilidade da VPS (Alloy → Loki → Grafana), que espera **uma linha JSON por evento** no stdout. Regras:

- **Nunca use `console.log`.** Em services/controllers use o `Logger` do Nest (`new Logger(Classe.name)`), que já escreve JSON via `JsonLogger`; em código transversal sem DI, use `registrarLog` de `shared/logging/log.ts`.
- **Todo log passa um objeto com `evento`** — nome curto, estável e em pt-BR, no formato `substantivo.acao_no_passado` (`contrato.ativado`, `email.envio_falhou`). Renomear um evento existente quebra a contagem histórica no Grafana.
- `msg` é o texto humano; qualquer outro campo é contexto filtrável (`contratoId`, `quantidade`, `ms`). Nada de interpolar contexto dentro da string.
- **Nunca logue segredo** — senha, hash, token, cookie, `authorization`. Chaves com esses nomes são redigidas automaticamente, mas o texto de `msg` não é: o Grafana é publicado na internet e a linha vive 30 dias.
- `requestId` e `contexto` entram sozinhos — não os repasse à mão.

```ts
this.logger.log({ evento: 'contrato.ativado', msg: 'Contrato ativado.', contratoId: id });   // correto
this.logger.log(`Contrato ${id} ativado`);                                                   // errado
```

Detalhes, eventos existentes e consultas prontas em [`docs/observabilidade.md`](../../docs/observabilidade.md).

## Autenticação

- JWT de acesso via header `Authorization: Bearer` (validado por `JwtAuthGuard`, global). Refresh token em cookie `httpOnly` no path `/api/v1/auth`, com hash (argon2) persistido para permitir revogação/logout real.
- Rotas públicas são marcadas com o decorator `@Public()`.
- Prefixo global das rotas: `/api/v1`.

## Autorização — owner, colaborador e permissões (obrigatório)

O eixo de isolamento é o **`ownerId` da workspace**, nunca o id de quem está logado. Owner (`User.ownerId` nulo) é dono dos dados e da assinatura; colaborador (`ownerId` preenchido) enxerga os mesmos dados do owner, limitado pelo papel (`Role`).

Ordem dos guards globais no `app.module.ts` — **não altere**: `ThrottlerGuard` → `JwtAuthGuard` (popula `req.user`) → `AccessGuard` (publica `req.access`) → `BillingGuard` (consome `req.access.ownerId`), e o `OwnerContextInterceptor` depois deles.

- **`AccessGuard`** (`modules/access/`) resolve, a cada requisição autenticada, `req.access = { userId, ownerId, isOwner, roleId, roleName, permissions }` — pelo `PrismaAdminService`, porque é essa leitura que descobre qual `ownerId` usar e `Role` tem RLS. Usuário inexistente ou colaborador desativado → `401` na hora, sem esperar o token expirar.
- **`@CurrentOwnerId()`** para escopo de dados (tudo que é filtrado por `ownerId`); **`@CurrentUserId()`** só para identidade (perfil, senha, logout); **`@CurrentAccess()`** quando a regra depende das permissões.
- **`@RequirePermission('chave', …)`** em toda rota de negócio; várias chaves valem como **ou** (é o que libera uma leitura para quem tem `:ver` **ou** `:gerenciar`). Sem o decorator, a rota só exige sessão válida.
- O catálogo de permissões é **fonte única** em `shared/permissions.ts` e é exposto por `GET /permissions` — o `apps/web` consome os rótulos de lá e **nunca** duplica esses textos em pt-BR.
- **Owner tem todas as permissões** por definição e não pode ser desativado — por isso não existe (nem é necessária) trava anti-lockout. O papel `system` ("Administrador") também vale o catálogo inteiro, resolvido em tempo de execução para não desatualizar quando uma permissão nova entra.
- Rota que agrega módulos diferentes sem exigir permissão (ex.: `GET /dashboard/summary`) recebe as permissões da sessão e devolve `null` no bloco que o usuário não pode ver — não vaze agregado por falta de decorator.

## Testes — o que pode e o que não pode ser mockado

Mockar o Prisma nos specs de regra de negócio é o certo: eles testam a regra,
não o ORM. Mas **classe que fala com infraestrutura direto tem spec que a
instancia de verdade** — `PrismaService`, `PrismaAdminService` e os adapters de
e-mail e Stripe. Para o adapter em si, o mock testa o mock.

Além disso, todo seam de infraestrutura tem cobertura e2e (`test/*.e2e-spec.ts`,
`pnpm --filter api test:e2e`): as rotas públicas de auth e o isolamento por
`ownerId`. Rota nova que rode FORA da transação do `OwnerContextInterceptor`
(ou seja, marcada com `@Public()`) entra num e2e no mesmo PR — no
`auth.e2e-spec.ts` quando for rota de sessão, num spec próprio quando não for
(é o caso de `lead-intake.e2e-spec.ts`, a ingestão externa de lead) — porque é
o caminho que já quebrou uma vez com a suíte inteira verde.

Rota pública que **escreve** em tabela com RLS depende de `app.owner_id` setado
à mão (`PrismaService.executarComoOwner`), e o e2e dela precisa afirmar que a
linha está no banco depois da chamada: sem contexto, o RLS não estoura — ele
grava zero linha e a rota responde sucesso.

## Migration é validada com dado dentro (obrigatório)

**Banco vazio não valida migration.** O `global-setup.ts` do e2e cria o banco e
roda `migrate deploy` numa base limpa: migration de backfill nem percorre o
caminho perigoso ali. Foi assim que `20260726120000_pipeline_stages_per_owner`
saiu verde do CI e derrubou a API em produção por 11 horas — ela replica o funil
por owner com um `CROSS JOIN` sobre `User`, e sem nenhum `User` o `CROSS JOIN`
não insere nada, então o índice único que ela violava nunca era tocado.

O portão é `scripts/validar-migrations-com-dados.sh`, rodado pelo CI a cada push
que toca a API: aplica o init, insere `prisma/fixtures/banco-populado.sql` (dois
owners, clientes, o funil e deals dos dois) e só então aplica o resto das
migrations, terminando nas invariantes de `prisma/fixtures/invariantes.sql`.

Regras ao escrever migration nova:

- Rode o portão localmente antes de abrir o PR:
  `DATABASE_URL=postgresql://crm_user:crm_password@localhost:5435/crm_db apps/api/scripts/validar-migrations-com-dados.sh`
- Migration que faz backfill ou troca constraint **precisa** de uma invariante
  nova em `invariantes.sql` afirmando o que o dado deve satisfazer depois. "Não
  estourou" é portão fraco: backfill pode terminar com exit 0 e dado errado.
- Se o portão ficar vermelho porque a fixture não tem coluna nova NOT NULL, o
  conserto é dar default ou fazer o backfill **na migration** — em produção ela
  falharia igual. Não enfraqueça a fixture para o CI passar.
- A fixture usa só colunas do `init`, porque é inserida logo depois dele. Não
  acrescente ali coluna criada por migration posterior.
