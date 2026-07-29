# SPEC — ProgrameAi CRM

Especificação funcional de um CRM de agência: gestão de clientes, pipeline de vendas,
propostas comerciais, projetos/demandas e financeiro, para quem vende **software sob
medida**, **construção de sites** e **gestão de tráfego pago**.

> **O que este documento é.** A referência das **regras de negócio** do domínio — o que
> cada módulo faz, quais transições são válidas e o que o sistema recusa. As decisões de
> produto registradas aqui são vinculantes: quando um plano de implementação divergir
> delas, este documento vale.
>
> **O que ele não é.** Não é referência de schema, de rotas nem de estrutura de código.
> Essas partes viviam aqui, ficaram defasadas e foram substituídas por ponteiros para as
> fontes vivas:
>
> | Assunto | Fonte de verdade |
> |---|---|
> | Modelo de dados (tabelas, campos, enums, índices) | [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma) |
> | Rotas HTTP, contratos de request/response | [`apps/api/ENDPOINTS.md`](apps/api/ENDPOINTS.md) |
> | Estrutura de pastas e convenções obrigatórias | `CLAUDE.md` na raiz, em `apps/api/` e em `apps/web/` |
> | O que está entregue e o que falta | [`ROADMAP.md`](ROADMAP.md) |
> | Como rodar, autohospedar e contribuir | [`README.md`](README.md), [`CONTRIBUTING.md`](CONTRIBUTING.md) |

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

### 1.3 Premissas
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

O backlog pós-MVP está organizado em fases priorizadas no [ROADMAP.md](ROADMAP.md) →
"Evolução pós-MVP" (fases 7 a 19), que é a **fonte única** do que falta e do que já foi
entregue. Não há resumo aqui de propósito: uma segunda lista de prioridades divergiria da
primeira na primeira entrega.

---

## 3. Módulos Funcionais

### 3.1 Clientes
Cadastro de clientes **pessoa física ou jurídica**.

**Campos principais:**
- Nome / Razão social, nome fantasia
- Tipo (`PF` / `PJ`), CPF/CNPJ (opcional, validado quando informado)
- E-mail, telefone/WhatsApp, site
- Endereço (opcional, campos simples)
- Origem do lead — item de catálogo **configurável pelo owner** (`LeadSourceCatalog`); a conta nasce com `indicação`, `tráfego pago`, `orgânico`, `prospecção ativa` e `outro`
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
- Título, cliente vinculado, tipo de serviço — item de catálogo **configurável pelo owner** (`ServiceCatalog`); a conta nasce com `software`, `site` e `tráfego pago`
- Valor estimado (BRL), probabilidade (%), data prevista de fechamento
- Estágio atual, motivo da perda (obrigatório ao mover para "Perdeu")

**Regras:**
- Mover para "Ganhou" cria um **Projeto** a partir da oportunidade e promove o cliente de Lead a Ativo.
- Drag & drop entre colunas; ordenação manual dentro da coluna.
- Oportunidade parada há mais de 7 dias em estágio não terminal ganha indicador visual de "esfriando"
  **e** notifica o responsável (uma vez por parada). O limite é constante nas duas pontas
  (`DIAS_ESFRIANDO` na API, `COOLING_DAYS` no front); torná-lo configurável por owner segue pendente.

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

## 4. Modelo de Dados

O modelo de dados vive em [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma) —
models, campos, enums, índices e as policies de RLS por `ownerId`. É a fonte de verdade, e por
isso não há transcrição dele aqui: uma segunda cópia do schema envelhece a cada migration.

O que este documento acrescenta são os invariantes **de negócio** que o schema não expressa
por si só:

- Valores monetários sempre `Decimal(12,2)`, **nunca** float.
- O `total` da proposta é **sempre recalculado no backend** a partir dos itens + desconto;
  valor vindo do cliente é ignorado.
- `billingDay` limitado a **1–28**, para não haver vencimento ambíguo em meses curtos.
- `OVERDUE` é derivado por job diário, mas as consultas de dashboard também tratam
  `PENDING` com `dueDate < hoje` como atraso — fecha a janela entre o cron e a leitura.
- Isolamento por `ownerId` é imposto **no banco** (RLS, fail-closed) e não apenas na
  aplicação; ver `apps/api/CLAUDE.md`.

---

## 5. API (NestJS — REST)

Base: `/api/v1`.

A relação completa das rotas — com request, response, códigos de erro e regras de permissão de
cada uma — vive em [`apps/api/ENDPOINTS.md`](apps/api/ENDPOINTS.md), atualizado no mesmo commit
da rota. Abaixo ficam apenas as convenções transversais, que mudam pouco e valem para qualquer
rota nova.

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

Monorepo pnpm com dois workspaces: `apps/api` (NestJS + Prisma) e `apps/web` (React + Vite).
A árvore de pastas e as **convenções obrigatórias** de cada lado — fronteiras de módulo,
organização por camada, o que pode importar o quê — estão nos `CLAUDE.md`: na raiz (visão
geral), em [`apps/api/CLAUDE.md`](apps/api/CLAUDE.md) e em
[`apps/web/CLAUDE.md`](apps/web/CLAUDE.md). São eles a fonte de verdade; a árvore que ficava
desenhada aqui apontava para uma organização que o backend já não usa.

### 6.2 Backend
- **NestJS 11** com módulos por domínio (controller → service → repositório Prisma)
- **Prisma 6** como ORM sobre PostgreSQL 16
- **Auth**: JWT access token (15 min) + refresh token (7 dias, cookie HttpOnly), guard global com rota pública via decorator `@Public()`
- Senha com **argon2**
- Config via `@nestjs/config` + validação de `.env`
- Log estruturado (uma linha JSON por evento), com `evento` estável em pt-BR — ver [`docs/observabilidade.md`](docs/observabilidade.md)
- Testes: unitários nos services de regra de negócio (transições de status, cálculo de total, versionamento, geração de parcelas e de mensalidades — incluindo idempotência do cron)

### 6.3 Frontend
- **React 19 + Vite + TypeScript** (strict)
- **React Router** para as rotas da aplicação
- **TanStack Query** para dados de servidor (cache, invalidação, optimistic update no drag & drop)
- **React Hook Form + Zod** para formulários
- **Tailwind CSS v4 + shadcn/ui** (sobre `@base-ui/react`) para UI
- **dnd-kit** para os Kanbans (pipeline e demandas)
- Axios com interceptor: injeta token e faz refresh automático em 401

### 6.4 Infra & requisitos não-funcionais
- `docker-compose.yml` com PostgreSQL 16 para desenvolvimento
- Migrations versionadas (`prisma migrate`)
- Seed inicial: usuários de demonstração + funil padrão **por owner** (em produção o funil nasce na criação da conta)
- CORS restrito ao domínio do front; rate limit no login (`@nestjs/throttler`)
- Backup: `pg_dump` diário ([`scripts/backup-postgres.sh`](scripts/backup-postgres.sh))
- Deploy: VPS com Docker — ver [`docs/deploy.md`](docs/deploy.md) e [`docs/autohospedagem.md`](docs/autohospedagem.md)

---

## 7. Roadmap de Implementação

As fases 0 a 6 construíram o MVP descrito em §2.1 e estão concluídas. O estado de cada fase,
o que veio depois do MVP (fases 7 a 19) e o que segue pendente vivem no
[`ROADMAP.md`](ROADMAP.md), que é a **fonte única** — a tabela que ficava aqui repetia as sete
primeiras fases e não acompanhava as demais.

O princípio que guiou o recorte, e que continua valendo para fases novas: **cada fase termina
com o sistema utilizável de ponta a ponta**, nunca com uma camada pronta e outra pela metade.

---

## 8. Decisões

Decisões de arquitetura e de produto já fechadas. Uma decisão nova entra aqui quando atravessa
módulos; as restritas a uma frente de trabalho ficam na seção *What We're NOT Doing* do plano
correspondente em [`specs/plans/`](specs/plans/).

1. **ORM**: Prisma sobre PostgreSQL. `schema.prisma` é a fonte de verdade do modelo de dados.
2. **UI kit**: Tailwind CSS v4 + shadcn/ui sobre `@base-ui/react` — Radix não deve ser reintroduzido.
3. **Gerenciador de pacotes**: pnpm workspaces; comandos sempre da raiz, com `--filter`.
4. **Deploy**: VPS com Docker.
5. **Isolamento**: `ownerId` como eixo único, imposto por RLS no banco (fail-closed). Sem
   entidade de organização/tenant separada e sem permissão por registro.
6. **Financeiro — juros/multa por atraso**: fora de escopo — atraso é sinalizado, sem cálculo de encargos.
7. **Financeiro — reajuste de mensalidade**: manual (editar o valor vale para as próximas
   cobranças); sem reajuste automático por índice.
8. **Licença**: AGPL-3.0, com a marca fora da licença — ver [`NOTICE`](NOTICE) e [`CLA.md`](CLA.md).
