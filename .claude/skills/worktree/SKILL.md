---
name: worktree
description: Cria (ou gerencia) git worktrees isolados para trabalhar em correções paralelas em sessões separadas do Claude Code neste monorepo pnpm + Prisma. Use quando o usuário pedir "criar worktree", "novo worktree", "worktree para <correção>", "quero uma sessão isolada", "trabalhar em paralelo", "listar worktrees" ou "remover worktree". Do NOT use para criar branch simples sem worktree, commit, push ou abrir PR.
license: CC-BY-4.0
metadata:
  author: Edson Alencar
  version: 1.0.0
---

# Worktree (CRM ProgrameAi)

Cria e gerencia **git worktrees** para trabalhar em correções paralelas, cada uma numa branch e pasta próprias, permitindo abrir uma sessão do Claude Code por worktree sem conflito de working tree.

O repositório principal fica em `/home/alencar/WorkSpace/CRM`. Os worktrees são criados **ao lado** dele (nunca dentro), no padrão `../CRM-<slug>`.

## Hard rules

- **NUNCA** crie o worktree dentro de `/home/alencar/WorkSpace/CRM` (poluiria a working tree e o `.gitignore`). Sempre em `../CRM-<slug>`.
- **NUNCA** rode `prisma migrate dev`, `prisma migrate reset` ou qualquer comando que altere o schema do banco a partir de um worktree sem avisar explicitamente o usuário — o Postgres (`localhost:5432`) é **único e compartilhado** por todos os worktrees. Ver seção "Banco compartilhado".
- **NUNCA** use `--all`/`.` em git; opere só nos worktrees que a skill gerencia.
- **SEMPRE** siga a convenção de branch do repo: `tipo/escopo-descricao` (ex.: `fix/demandas-badge`, `feat/tags-contraste`, `refactor/sidebar-header`). O `tipo` casa com os tipos de commit usados no repo (`feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `style`, `perf`).

## Invocação

`/worktree <descrição da correção>` — cria um novo worktree para a correção descrita.

Sub-comandos por palavra-chave na mensagem:
- **listar** (`/worktree listar` ou "listar worktrees") → executa `git worktree list` e mostra o estado.
- **remover** (`/worktree remover <slug>` ou "remover worktree X") → remove o worktree indicado.

Se nenhum argumento for passado, pergunte qual correção o usuário quer isolar antes de prosseguir.

## Processo — criar worktree

### Passo 1: Definir tipo, escopo e slug

A partir da descrição do usuário, derive:

- **tipo**: `fix` (correção de bug), `feat` (nova funcionalidade), `refactor`, etc. Se ambíguo, pergunte.
- **escopo**: a área do domínio afetada (`demandas`, `clientes`, `tags`, `sidebar`, `theme`, `api`, `web`…). Infira do texto; se não der, pergunte.
- **slug**: `escopo-descricao-curta` em kebab-case, sem acentos (ex.: `demandas-badge-atrasada`).

Monte:
- **branch** = `<tipo>/<slug>`
- **pasta** = `../CRM-<slug>`

Confirme com o usuário o nome da branch e da pasta em uma linha antes de criar (a menos que ele já tenha dado o nome pronto).

### Passo 2: Verificar pré-condições

Execute em paralelo (um único bloco):

- `git -C /home/alencar/WorkSpace/CRM worktree list` — evita duplicar worktree/pasta existente.
- `git -C /home/alencar/WorkSpace/CRM branch --list <tipo>/<slug>` — a branch já existe?

Se a pasta `../CRM-<slug>` já existir ou a branch já existir, avise e proponha outro slug (ou usar a branch existente com `git worktree add <pasta> <branch>` sem `-b`).

### Passo 3: Criar o worktree

Branch nova a partir de `main` atualizada:

```bash
git -C /home/alencar/WorkSpace/CRM worktree add /home/alencar/WorkSpace/CRM-<slug> -b <tipo>/<slug> main
```

Se o usuário pediu para partir de outra base (ex.: da branch atual), ajuste o último argumento.

### Passo 4: Preparar o workspace (pnpm)

Cada worktree tem `node_modules` próprio. Instale as dependências:

```bash
pnpm --dir /home/alencar/WorkSpace/CRM-<slug> install
```

> `.env`, `docker-compose` e afins não são versionados/são compartilhados via banco único — não é preciso recriar. Se o worktree precisar de `.env` local que não está no git, avise o usuário para copiar de `/home/alencar/WorkSpace/CRM/apps/api/.env` (não copie segredos automaticamente sem confirmação).

### Passo 5: Entregar instruções

Ao final, mostre ao usuário, de forma curta:

1. O caminho da pasta criada.
2. Como abrir a nova sessão: abrir o Claude Code / VSCode nessa pasta.
3. O lembrete do **banco compartilhado** (ver abaixo).
4. Como remover ao terminar: `/worktree remover <slug>`.

## Banco compartilhado — aviso obrigatório

Todos os worktrees apontam para o **mesmo Postgres** em `localhost:5432` (subido por `docker compose` no repo principal). Portanto, ao criar um worktree, sempre inclua no resumo final:

- Editar código e rodar testes de unidade em paralelo: **ok**.
- Rodar `pnpm --filter api start:dev` em mais de um worktree ao mesmo tempo: conflito de porta (ajuste `PORT`) e escrevem no **mesmo banco**.
- **Migrations/`prisma migrate`**: só **uma** sessão por vez deve tocar no schema. Combine com o usuário qual worktree é o "dono" do schema, ou suba um Postgres extra em outra porta se precisar de dados isolados.

## Processo — listar

```bash
git -C /home/alencar/WorkSpace/CRM worktree list
```

Apresente cada worktree com sua branch e destaque o repo principal.

## Processo — remover

1. Confirme com o usuário (a remoção descarta a working tree daquele worktree; mudanças não commitadas se perdem).
2. Verifique se há trabalho pendente:
   ```bash
   git -C /home/alencar/WorkSpace/CRM-<slug> status --short
   ```
   Se houver mudanças não commitadas, **pare e avise** — não remova sem confirmação explícita.
3. Remova:
   ```bash
   git -C /home/alencar/WorkSpace/CRM worktree remove /home/alencar/WorkSpace/CRM-<slug>
   ```
4. Opcional (se o usuário quiser apagar a branch também e ela já foi mesclada):
   ```bash
   git -C /home/alencar/WorkSpace/CRM branch -d <tipo>/<slug>
   ```
   Use `-D` (forçado) apenas se o usuário confirmar que a branch pode ser descartada mesmo sem merge.
5. Rode `git -C /home/alencar/WorkSpace/CRM worktree prune` para limpar referências órfãs.
