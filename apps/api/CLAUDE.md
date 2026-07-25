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
