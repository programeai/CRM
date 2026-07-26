# CRM ProgrameAi — Instruções do projeto

## Idioma das mensagens

**Toda mensagem visível ao usuário deve estar em português do Brasil (pt-BR).** Isso é um padrão absoluto e sem exceções.

Abrange:
- Mensagens de validação de formulário (Zod, class-validator)
- Toasts de sucesso e erro (`toast.success`, `toast.error`)
- Exceções lançadas na API (`ConflictException`, `NotFoundException`, `UnauthorizedException`, `ForbiddenException`, `BadRequestException`, `GoneException`, `UnprocessableEntityException`, etc.)
- Textos de estado da UI ("Carregando…", "Falha ao carregar…")
- Mensagens inline em componentes (`<p>`, `<span>`, `role="alert"`)

Ao adicionar qualquer nova mensagem — em qualquer camada — escreva diretamente em pt-BR. Nunca escreva em inglês e depois traduza.

## Rótulos de domínio

Nenhum identificador técnico (enum, status, tipo de serviço) aparece cru na interface. Todo valor de enum do domínio é traduzido para pt-BR antes de ser exibido — ver `apps/web/src/lib/labels.ts` e as regras em `apps/web/CLAUDE.md`.

---

# Arquitetura — regras obrigatórias

> Estas regras são a **fonte de verdade**. Código novo deve nascer já em conformidade; código existente que divergir deve ser **corrigido para respeitar estas regras**, nunca o contrário. Não relaxe nenhuma regra para acomodar o estado atual do projeto.

## Combinação arquitetural

- **Backend:** Modular Monolith (NestJS + Prisma). Detalhes em `apps/api/CLAUDE.md`.
- **Frontend:** React + Vite, organizado por camadas pragmáticas (`app` / `features` / `components` / `lib`). Detalhes em `apps/web/CLAUDE.md`.
- **Persistência:** PostgreSQL via **Prisma** (`apps/api/prisma/schema.prisma` é a fonte de verdade do modelo de dados).

## Observabilidade

Os logs vão para a stack central da VPS (Alloy → Loki → Grafana), que exige **uma linha JSON por evento** no stdout. Todo log de código novo nasce estruturado, com `evento` estável em pt-BR e sem segredo nenhum — regras em `apps/api/CLAUDE.md` → "Log estruturado" e em `docs/observabilidade.md`. `console.log` é proibido.

## Ferramentas do monorepo

- Gerenciador: **pnpm workspaces** (`pnpm-workspace.yaml` → `apps/*`).
- **Comandos pnpm são sempre executados a partir da raiz** com `--filter`, nunca duplicados dentro dos workspaces. Ex.: `pnpm --filter api start:dev`, `pnpm --filter web dev`.
- Banco local via `docker compose up -d` (Postgres 16 em `localhost:5432`).

## Estrutura do monorepo

```
apps/
  web/        → React + Vite (UI do CRM)
  api/        → NestJS + Prisma (Modular Monolith)
```

## Princípio geral

Buscar o equilíbrio entre rigor arquitetural e velocidade. **Evitar over-engineering** (sem DDD pesado onde não é necessário — CRUD simples pode ser direto), mas sem violar as fronteiras definidas em cada camada.

## Escopo de produto

CRM de agência (clientes, pipeline de vendas, propostas, projetos, contratos e financeiro).

**Isolamento por owner.** Uma instância atende vários owners. `ownerId` é o **eixo único** de isolamento, aplicado no banco por RLS (policies por `ownerId`, fail-closed; ver `apps/api/prisma/migrations/*_enable_rls`) e no request pelo `OwnerContextInterceptor`. Cada owner é dono dos seus dados e da sua assinatura.

**Colaboradores e papéis.** Um owner convida colaboradores (`User.ownerId` preenchido), cada um com um papel (`Role`) que carrega permissões granulares. Colaborador enxerga e escreve **os dados do owner** — o `app.owner_id` do RLS é o do owner, não o dele — limitado pelas permissões do papel, e herda a assinatura do owner (não paga assento). Owner tem acesso total por definição e não pode ser desativado. Regras completas em `apps/api/CLAUDE.md` → "Autorização" e `apps/web/CLAUDE.md` → "Permissões na interface".

**Não** há conceito de organização/tenant como entidade separada, nem permissão por registro. Não introduza nenhum dos dois sem decisão explícita.
