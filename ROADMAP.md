# Roadmap — ProgrameAi CRM

> **A intenção do produto:** o *porquê* de cada frente, a ordem entre elas e as decisões de recorte e
> adiamento. É o registro estratégico — **não** descreve o que já foi construído nem o passo a passo
> do que falta.
>
> **Última atualização:** 2026-07-29

| O que você procura | Onde está |
|---|---|
| O trabalho aberto, em pedaços de um PR | [issues](https://github.com/programeai/CRM/issues) — comece pelas [`good first issue`](https://github.com/programeai/CRM/labels/good%20first%20issue) |
| Como cada frente foi pesquisada e planejada | [`specs/research/`](specs/research/) e [`specs/plans/`](specs/plans/) |
| As regras de negócio vigentes | [SPEC.md](specs/SPEC.md) |
| O modelo de dados | [schema.prisma](apps/api/prisma/schema.prisma) |
| As rotas da API | [ENDPOINTS.md](apps/api/ENDPOINTS.md) |

Convenção de status: ✅ concluída · 🚧 em andamento · ⬜ não iniciada · ⏸️ adiada. Fases recortadas
trazem a letra do recorte (ex.: `13-A`) — ver [Trilha de produção](#trilha-de-produção--revisão-de-2026-07-27).
Convenção de prioridade (fases 7+): **P0** defeito que já dói · **P1** ausência que limita uso
profissional · **P2** evolução de produto · **P3** plataforma e governança.

## Visão

CRM enxuto para agência/dev full stack (software sob medida, sites, tráfego pago), centrado em
quatro pilares: **Clientes**, **Propostas**, **Demandas** e **Financeiro**. Uma instância atende
vários owners, isolados por `ownerId` (RLS no banco), cada um com seus colaboradores e assinatura.
Interface 100% pt-BR; código/tabelas/endpoints em inglês.

## Panorama das fases

| Fase | Entrega | Status | Issues | Spec |
|---|---|---|---|---|
| 0 | Fundação (monorepo, infra, auth, layout base) | ✅ | — | [research](specs/research/2026-07-20-fase-0-fundacao.md) · [plan](specs/plans/2026-07-20-fase-0-fundacao.md) |
| 1 | Clientes (CRUD clientes + contatos, timeline, follow-ups) | ✅ | — | [research](specs/research/2026-07-21-fase-1-clientes.md) · [plan](specs/plans/2026-07-21-fase-1-clientes.md) |
| 2 | Pipeline (estágios configuráveis, Kanban de oportunidades) | ✅ | — | [research](specs/research/2026-07-21-fase-2-pipeline.md) · [plan](specs/plans/2026-07-21-fase-2-pipeline.md) |
| 3 | Propostas (itens, total, ciclo de status, versionamento, expiração) | ✅ | — | [research](specs/research/2026-07-23-fase-3-propostas.md) · [plan](specs/plans/2026-07-23-fase-3-propostas.md) |
| 4 | Demandas (projetos, tarefas, Kanban por projeto, "Minhas demandas") | ✅ | — | [research](specs/research/2026-07-23-fase-4-demandas.md) · [plan](specs/plans/2026-07-23-fase-4-demandas.md) |
| 5 | Financeiro (contratos, cobranças, agenda, baixa/estorno, crons) | ✅ | [#30](https://github.com/programeai/CRM/issues/30) | [research](specs/research/2026-07-23-fase-5-financeiro.md) · [plan](specs/plans/2026-07-23-fase-5-financeiro.md) |
| 6 | Dashboard (métricas comerciais e financeiras, funil) | ✅ | — | implementação direta — ver [SPEC.md](specs/SPEC.md) §3.7 |
| 7 | Base — funil por owner e responsável por registro (**P0**) | ✅ | [#24](https://github.com/programeai/CRM/issues/24) [#28](https://github.com/programeai/CRM/issues/28) [#29](https://github.com/programeai/CRM/issues/29) | [research](specs/research/2026-07-26-fase-7-funil-por-owner-e-responsavel.md) · [plan A](specs/plans/2026-07-26-fase-7a-funil-por-owner.md) · [plan B](specs/plans/2026-07-26-fase-7b-responsavel-por-registro.md) |
| 8 | Governança — sessões, auditoria e lixeira (**P0**) | ✅ | — | [research](specs/research/2026-07-26-fase-8-sessoes-auditoria-lixeira.md) · [plan A](specs/plans/2026-07-26-fase-8a-sessoes.md) · [plan B](specs/plans/2026-07-26-fase-8b-auditoria.md) · [plan C](specs/plans/2026-07-26-fase-8c-lixeira.md) |
| 9 | Notificações e lembretes (**P1**) | ✅ | [#26](https://github.com/programeai/CRM/issues/26) | [plan](specs/plans/2026-07-27-fase-9-notificacoes-e-lembretes.md) |
| 10 | Relatórios e metas (**P1**) | ⏸️ adiada | [#25](https://github.com/programeai/CRM/issues/25) | a definir |
| 11 | Proposta que o cliente vê — PDF, link de aceite, envio (**P1**) | ⬜ | — | a definir |
| 12 | Anexos e documentos (**P1**) | ⬜ **2º na trilha** | [epic #31](https://github.com/programeai/CRM/issues/31) | a definir |
| 13 | Extensibilidade do domínio — serviços e campos por owner (**P1**) | ✅ **13-A** · 13-B adiada | — | [research](specs/research/2026-07-27-fase-13a-dominio-configuravel-por-owner.md) · [plan 13-A](specs/plans/2026-07-27-fase-13a-dominio-configuravel-por-owner.md) |
| 14 | Dados — importação, exportação, busca global, duplicidade (**P1**) | ✅ **14-A** · 14-B 3º · 14-C adiada | [epic #32](https://github.com/programeai/CRM/issues/32) | [research](specs/research/2026-07-27-fase-14-dados-importacao-exportacao-busca-duplicidade.md) · [plan 14-A](specs/plans/2026-07-27-fase-14a-importacao-e-exportacao.md) |
| 15 | Agenda e calendário (**P2**) | ⬜ | — | a definir |
| 16 | Automações e templates (**P2**) | ⬜ | — | a definir |
| 17 | Entrada de lead e comunicação (e-mail/WhatsApp) (**P2**) | ✅ **17-A** · 17-B/17-C ⬜ | [#27](https://github.com/programeai/CRM/issues/27) | [research](specs/research/2026-07-28-fase-17a-entrada-de-lead.md) · [plan 17-A](specs/plans/2026-07-28-fase-17a-entrada-de-lead.md) |
| 18 | Financeiro completo — despesas, cobrança automática, NF (**P2**) | ⬜ | — | a definir |
| 19 | Plataforma — API pública, 2FA, LGPD operacional (**P3**) | ✅ **19-A** · 19-B P3 | [#26](https://github.com/programeai/CRM/issues/26) | [research](specs/research/2026-07-28-fase-19a-lgpd-minimo.md) · [plan 19-A](specs/plans/2026-07-28-fase-19a-lgpd-minimo.md) |

Fora das fases, entregue depois do MVP: **multiusuário com papéis e permissões** — colaboradores por
convite, papéis com permissões granulares e isolamento por owner
([plan](specs/plans/2026-07-25-colaboradores-e-papeis.md)).

Cada fase termina com o sistema **utilizável de ponta a ponta**. As fases 0–6 entregaram o MVP; as
7+ são o caminho para cobrir o que se espera de um CRM profissional. A ordem é a recomendada, não
obrigatória — cada fase é independente das seguintes, exceto onde declara "Depende de".

---

## Trilha de produção — revisão de 2026-07-27

**Decisão:** o objetivo imediato deixou de ser "avançar no roadmap" e passou a ser **abrir o produto a
usuários reais**. Com o autocadastro aberto em `crm.programeai.com.br`, quem se cadastra não é mais a
nossa agência — e o critério de prioridade muda: vale o que **impede alguém de usar o sistema**, não o
que o completa.

Sob esse critério, as fases 12–14 não entram inteiras. A maior parte de cada uma **não** é bloqueio de
produção, e as partes mais difíceis (campos customizados, mesclagem de clientes) são justamente as que
menos bloqueiam. Cada fase foi **recortada**: a letra **A** é o recorte de produção, as seguintes ficam
para depois. Os números das fases não mudaram — as specs e os links continuam válidos.

| Ordem | Recorte | Fase | Por quê |
|---|---|---|---|
| ~~1~~ ✅ | Catálogo de serviços, fontes de lead e motivos de perda por owner | **13-A** | único bloqueio absoluto: `ServiceType` era enum fechado no nosso mix de serviço |
| ~~2~~ ✅ | Importação CSV/XLSX de clientes e contatos + exportação das listagens | **14-A** | onboarding de base existente e fechamento de mês fora da tela |
| ~~1~~ ✅ | LGPD mínimo: excluir a própria conta, exportar meus dados | **19-A** | risco legal com dado de terceiro, não feature |
| 2 | Anexos e documentos | **12** | primeira infra externa (S3/MinIO); desbloqueia o logo da Fase 11 |
| 3 | Busca global + detecção de duplicidade | **14-B** | conveniência: cada listagem já tem `?search=` |

> **Entrou fora da trilha:** a **17-A** (entrada de lead por integração) foi feita em 2026-07-28,
> antes da 19-A. O motivo não é ordem de valor, é que a ingestão de lead **já rodava em produção** e
> era single-tenant por construção — o segredo era um token de instância e a conta de destino vinha de
> um e-mail no ambiente. Com o autocadastro aberto, isso deixou de ser "estágio do produto" e passou a
> ser defeito: qualquer owner novo que quisesse captar lead não tinha como.

**Adiado explicitamente:** campos customizados (**13-B**), mesclagem de clientes e unicidade de
`document` (**14-C**), Fase 10 inteira (relatório é de quem já tem meses de dado) e o resto da Fase 19
(**19-B**: API pública, 2FA, consentimento).

> **Por que a Fase 12 desce para 2º**, mesmo sendo lacuna real: ninguém abandona o produto por não
> anexar arquivo — continua no Drive, como hoje. E é a única das três que pede **credencial e mudança
> de deploy**, justo na janela em que se quer estabilizar. Ela sobe de prioridade no momento em que a
> Fase 11 (proposta que o cliente vê) entrar, porque o logo do owner pressupõe upload.

> **Por que a mesclagem de clientes (14-C) é a última coisa a entrar:** é a única frente do P1 que
> **reescreve chave de registro financeiro** e não tem volta. Numa produção recém-aberta, o custo de
> errar é maior que o de conviver com duplicata.

**O que já está de pé e não é gargalo:** deploy com Traefik ([docs/deploy.md](docs/deploy.md)), backup
com `pg_dump` documentado, billing Stripe ([docs/billing-stripe.md](docs/billing-stripe.md)),
observabilidade ([docs/observabilidade.md](docs/observabilidade.md)), auditoria, sessões múltiplas e
lixeira.

> **O gargalo original caiu.** "O domínio ser fechado no nosso mix de serviço" era o gargalo desta
> revisão, e a 13-A o resolveu: as quatro listas do domínio são configuráveis por owner. Com a 14-A a
> base entra e sai por planilha, com a 17-A o lead entra por integração em qualquer workspace, e com a
> 19-A o titular exporta os próprios dados e encerra a própria conta. O bloqueio **jurídico** também
> caiu — o que resta na trilha (Anexos, Busca global) é conveniência, não risco legal.

---

## Sobras das fases concluídas

Recortes que ficaram **fora do escopo por decisão** ao fechar uma fase, e que hoje são issue própria.
Não são defeito nem dívida escondida: cada um foi excluído com motivo registrado na spec da fase.

**Da Fase 7** (responsável por registro) — ver [plan B](specs/plans/2026-07-26-fase-7b-responsavel-por-registro.md):

- Filtro "sem responsável" nas listagens → [#24](https://github.com/programeai/CRM/issues/24)
- `assigneeId` em `Proposal`/`Project`/`Contract`/`Payment` → [#28](https://github.com/programeai/CRM/issues/28)
- Reatribuição da carteira ao desativar colaborador → [#29](https://github.com/programeai/CRM/issues/29)
- **Sem issue, e continua fora por decisão:** escopo por registro nas **escritas** — sem `:ver_todos`,
  editar registro alheio segue permitido por `:gerenciar`.

**Da Fase 9** (notificações): a assinatura HMAC do canal `WEBHOOK` → [#26](https://github.com/programeai/CRM/issues/26).
Foi adiada porque assinar pedia uma máquina de segredo com rotação que não existia — e que a 17-A
depois construiu. Ver a nota da Fase 19-B, em "O que falta".

**Da Fase 17-A** (entrada de lead): o formulário público de captação → [#27](https://github.com/programeai/CRM/issues/27).
Na 17-A o lead entra apenas servidor-a-servidor. Nada no desenho impede o formulário — o canal de
captação é o registro que ele usaria.

**Da Fase 6** (dashboard): o funil é desenhado em barras **sem lib de gráfico**, com tokens de tema.
Não é limitação a corrigir, é a escolha vigente — gráfico novo segue o mesmo caminho antes de
acrescentar dependência.

**Da Fase 1** (clientes), fora do plano e entregue: autopreenchimento de endereço por CEP (ViaCEP) e
de dados da empresa pelo CNPJ (BrasilAPI), com máscaras controladas de CPF/CNPJ, telefone, CEP e UF.
Registrado aqui porque não consta de spec nenhuma.

**Da Fase 17-A**, dívida de transição **quitada na Fase 19-B**: `POST /leads/intake` aceitava o
`LEAD_INTAKE_TOKEN` do ambiente como caminho legado, porque o emissor (`site-v2`) vive em outro
repositório e cortar sem coordenar os dois deploys perderia lead sem erro visível no site. As duas
variáveis (`LEAD_INTAKE_TOKEN`, `LEAD_INTAKE_OWNER_EMAIL`) saíram do código, do compose e do workflow
de deploy — a rota tem uma credencial só, a chave de integração.

> **Antes de subir esse corte**, confirmar no Grafana que
> `{stack="crm"} | evento="lead.token_legado_aceito"` retorna **zero nos últimos 30 dias**, e apagar os
> dois secrets do repositório de deploy. Se a consulta trouxer qualquer linha, o `site-v2` ainda não
> migrou e o corte perde lead.

---

## O que falta

> **Ordem do P1 — superada pela [Trilha de produção](#trilha-de-produção--revisão-de-2026-07-27).**
> A ordem original era da mais simples para a mais complexa, pelos mesmos três critérios do P2:
> dependência externa (integração, infra nova, credencial), tamanho de schema e superfície tocada, e
> risco de dinheiro/irreversível. Essa ordem **não é mais a de execução** — a trilha reordenou por "o
> que impede alguém de usar". Os critérios seguem valendo como leitura de **esforço**.

### Fase 10 — Relatórios e metas ⏸️ **P1**

> **Adiada na revisão de 2026-07-27.** Não bloqueia usuário novo: relatório com comparação de período,
> tempo médio de ciclo e "quanto falta para a meta" só dizem algo depois de meses de dado acumulado.
> Volta à fila quando os primeiros owners tiverem histórico.

- [ ] Relatório comercial por período com comparação (mês/trimestre anterior)
- [ ] Resultado por responsável, por serviço e por fonte de lead
- [ ] Análise de perda agregada — **recortada para [#25](https://github.com/programeai/CRM/issues/25)**,
      porque contagem por motivo vale já na primeira perda e não espera histórico
- [ ] Tempo médio por estágio e ciclo de venda (`stageMovedAt` existe e não é usado analiticamente)
- [ ] Forecast ponderado por `probability` e valor esperado no período
- [ ] Metas por período e por pessoa → painel mostra "quanto falta", não só "quanto foi"
- [ ] Exportação dos relatórios (reusa o `ExportService` da 14-A)

> **Complexidade:** a menor do P1 — leitura agregada sobre dados que já existem, um único modelo novo
> (metas), nenhuma integração, nada irreversível. As janelas de tempo em UTC e o funil já têm
> precedente testado na Fase 6.

> **Ressalva:** "tempo médio por estágio" não sai do schema atual — `stageMovedAt` guarda só a
> **última** troca. Esse item pede histórico de transições do `Deal` (modelo novo, alimentado no
> `PATCH /deals/:id/move`), e é o único da fase que mexe em escrita.

### Fase 11 — Proposta que o cliente vê ⬜ **P1**

- [ ] Geração de PDF da proposta (template com identidade do owner: logo, cores, dados)
- [ ] Link público de aceite (token de uso único, expiração alinhada a `validUntil`)
- [ ] Aceite/recusa pelo cliente na página pública → status, `decidedAt` e registro na timeline
- [ ] Envio por e-mail com o PDF/link — hoje `POST /proposals/:id/send` só marca `sentAt`
- [ ] Rastreio básico: visualizada em, aceita em
- [ ] Templates de proposta reutilizáveis (escopo, condições, itens padrão)

> **Complexidade:** o e-mail e o token de uso único já têm padrão no projeto (`mail.service.ts`,
> `PasswordResetToken`, rotas `@Public()`). O custo novo é renderizar PDF dentro do container e uma
> superfície pública sem sessão — aceite de proposta é ato do cliente com efeito contratual, então
> token, expiração e idempotência do aceite viram requisito, não detalhe. A identidade visual do owner
> (**logo**) pressupõe upload: nasce limitada ou **depende da Fase 12**.

### Fase 12 — Anexos e documentos ⬜ **P1** · 2º na trilha

**O trabalho está em [epic #31](https://github.com/programeai/CRM/issues/31)**, recortado em sete
issues na ordem de execução. Comece pela [#14](https://github.com/programeai/CRM/issues/14) (storage).

> **Por quê:** não existe upload em nenhum ponto do sistema — contrato assinado, briefing, arte e
> comprovante de pagamento continuam no Drive/WhatsApp.

> **Entra inteira, não recortada.** O recorte não ajudaria: o custo é a infra, e ela é indivisível —
> sem bucket não há upload nenhum.

> **Complexidade:** primeira fase com **infra externa** — bucket S3-compatível (ou MinIO na
> autohospedagem) significa env, credencial e mudança de deploy, não só código. Soma-se uma capacidade
> que a API nunca teve (multipart), anexo polimórfico ligado a seis entidades e uma superfície de
> segurança nova: tipo/tamanho, URL assinada de curta duração e conteúdo malicioso.

### Fase 13-B — Campos customizados ⏸️ **P1**

- [ ] Campos customizados em cliente, oportunidade e projeto (texto, número, data, seleção, booleano),
      exibidos nos formulários, nos filtros e na exportação

> **Adiada na revisão de 2026-07-27.** É o item estruturalmente mais difícil do roadmap — valor
> dinâmico por tipo, validação em runtime, e todo formulário, filtro e exportação passando a se montar
> a partir de definição, não de código. E não bloqueia ninguém: sem campo customizado o CRM funciona,
> sem serviço configurável não. Dependia da 13-A e, para a exportação, da 14-A — as duas entregues,
> então o que falta é só o trabalho dela.

### Fase 14-B — Busca global e duplicidade ⬜ **P1** · 3º na trilha

**O trabalho está em [epic #32](https://github.com/programeai/CRM/issues/32)** —
[#21](https://github.com/programeai/CRM/issues/21) (endpoint),
[#22](https://github.com/programeai/CRM/issues/22) (interface) e
[#23](https://github.com/programeai/CRM/issues/23) (duplicidade).

> **Conveniência, não bloqueio.** Toda listagem já tem `?search=` própria; a busca global economiza
> cliques, não destrava uso. Custo real: índice full-text novo no Postgres sobre seis entidades, com
> RLS — e o recorte por responsável, que **não é do banco**, tem de ser reaplicado na busca.

### Fase 14-C — Mesclagem e unicidade ⏸️ **P1**

- [ ] Mesclagem de clientes duplicados (move contatos, oportunidades, propostas, projetos, contratos
      e timeline; cobranças acompanham o contrato, sem religamento próprio)
- [ ] `document` com unicidade por owner quando informado

> **Última coisa a entrar.** Única frente do P1 que **reescreve chave de registro financeiro** e não
> tem volta: religar FKs num só `$transaction`. Pede a trilha da Fase 8 e testes de posse. A unicidade
> de `document` só entra **depois** de resolver as duplicatas existentes, e a detecção da 14-B
> ([#23](https://github.com/programeai/CRM/issues/23)) é o pré-requisito prático para saber quais são.

---

> **Ordem do P2.** As quatro fases de evolução de produto estão ordenadas da mais simples para a mais
> complexa, por três critérios somados: dependência externa (integração de terceiro, aprovação,
> credencial), tamanho de schema e superfície tocada, e risco de dinheiro/irreversível. São
> independentes entre si — a ordem é de esforço, não de pré-requisito.

### Fase 15 — Agenda e calendário ⬜ **P2**

- [ ] Visão de calendário (mês/semana/dia) cruzando follow-ups, entregas, vencimentos e reuniões
- [ ] Compromisso com duração, local/link e participantes (hoje `Activity.scheduledFor` é um instante)
- [ ] Sincronia com Google Calendar (duas vias)
- [ ] Link de agendamento para o cliente escolher horário

> **Por que é a mais simples:** os três primeiros itens são leitura do que já existe
> (`Activity.scheduledFor`, `Task.dueDate`, `Payment.dueDate`) mais uma extensão de `Activity` — nenhuma
> integração, nenhum dado novo de negócio. A única frente difícil (Google Calendar em duas vias: OAuth,
> sync token, conflito) é separável e pode ficar por último sem travar o resto.

### Fase 16 — Automações e templates ⬜ **P2**

- [ ] Cadência de follow-up (sequência de lembretes por estágio ou inatividade)
- [ ] Regras "quando X, então Y" configuráveis pelo owner (mover estágio, criar tarefa, notificar, atribuir)
- [ ] Checklist/tarefas padrão de projeto por tipo de serviço
- [ ] Automatizar contrato ao ganhar (hoje só o projeto é sugerido)
- [ ] Alerta de cliente inativo (sem atividade há N dias)

> **Complexidade:** zero integração externa e tudo determinístico/testável, mas o motor de regras
> configurável (evento → condição → ação, persistido e editável na UI) é desenho de arquitetura, não
> CRUD. **Dependia de** Fase 9 (notificar é uma das ações) e Fase 13 (checklist por tipo de serviço) —
> as duas entregues, então nada mais a esperar.

### Fase 17-B e 17-C — E-mail e WhatsApp pelo CRM ⬜ **P2**

**Frente B — E-mail**

- [ ] Envio de e-mail ao cliente pelo CRM, com a mensagem registrada na timeline
- [ ] Vínculo automático da resposta do cliente ao registro correspondente

**Frente C — WhatsApp**

- [ ] WhatsApp: registro da conversa na timeline e envio de mensagem/template

> **Por que ficaram para depois:** era onde estava o custo da fase desde o começo. A entrada de lead
> (17-A) era barata — rota pública já é padrão do projeto, e o roteamento veio da Fase 7. WhatsApp
> Cloud API exige verificação de negócio, templates aprovados e respeito à janela de 24h — é a única
> dependência externa da fase —, e o vínculo automático da resposta ao registro é heurística de
> correspondência, não FK.

> **O valor está em registrar, não em disparar:** timeline alimentada à mão é timeline abandonada.

### Fase 18 — Financeiro completo ⬜ **P2**

- [ ] Despesas (fixas e por projeto), categorias e fornecedores — hoje só há receita
- [ ] DRE simplificado: receita × despesa × margem, por período e por projeto/cliente
- [ ] Juros e multa automáticos no atraso; renegociação de cobrança
- [ ] Cobrança automática via gateway (Pix e boleto) com baixa por webhook, eliminando a baixa manual
- [ ] Régua de cobrança (aviso antes do vencimento, lembretes após)
- [ ] Emissão de nota fiscal de serviço (integração com prefeitura/emissor)
- [ ] Conciliação: extrato × cobranças

> **Por que é a mais complexa:** três integrações externas de naturezas diferentes (gateway Pix/boleto,
> emissor de NFS-e — que varia por prefeitura — e extrato bancário para conciliação), o maior schema
> novo do roadmap (despesas, categorias, fornecedores) e a única frente onde o erro mexe em dinheiro de
> verdade: baixa por webhook pede idempotência, e juros/multa/renegociação exigem trilha (Fase 8).

### Fase 19-B — Plataforma aberta ⬜ **P3**

Depois do LGPD mínimo (19-A), entregue.

- [x] ~~A máquina de segredo-por-registro~~ — **antecipada para a 17-A**, já genérica e com escopos
- [ ] API key por owner, com escopos e rotação — **escopo novo em cima da máquina que já existe**
- [ ] Webhooks de saída (eventos de negócio) para n8n/Zapier
- [ ] 2FA/MFA no login (TOTP), com códigos de recuperação
- [ ] LGPD completo: consentimento e política de retenção
- [ ] Rastreio de consentimento de comunicação (opt-out de e-mail/WhatsApp)

> **A parte cara desta frente já foi paga.** O que encarecia a 19-B não era assinar nem expor rota: era
> a máquina de segredo-por-registro. Ela nasceu na **17-A** ([`modules/integracoes`](apps/api/src/modules/integracoes/)),
> genérica de propósito e **sem conhecer lead** — geração de 32 bytes com prefixo reconhecível, hash
> sha256 indexável, exibição única, mascaramento na fronteira HTTP, rotação na mesma linha, ausência em
> log e em `CAMPOS_OMITIDOS` do diff da auditoria, e `scopes[]` no próprio registro.
>
> O que sobra é **acrescentar escopo**, não construir infraestrutura: o catálogo é
> [`domain/integration-scope.ts`](apps/api/src/modules/integracoes/domain/integration-scope.ts), hoje
> com um item (`lead:receber`). Uma chave de API pública ou de webhook de saída entra ali sem tocar em
> captação. A permissão `integracao:gerenciar` e a tela de gestão também já existem.
>
> **Recuperar chave perdida não vai existir**, e não é omissão: o banco guarda hash determinístico.
> Quem perde rotaciona — decisão tomada na 17-A.

> **Não confundir com o `WebhookChannel` da Fase 9.** O que já existe é destino **do usuário**: cada
> pessoa aponta as *próprias* notificações para um n8n ou Slack pessoal, com a URL funcionando como
> credencial. O que falta aqui é o webhook **do owner**: evento de negócio da workspace **saindo** para
> um sistema externo. São duas features distintas — tratar uma como a outra vira retrabalho.
>
> A 17-A resolveu o sentido **oposto**: chave de integração é credencial de quem escreve *dentro* da
> workspace (lead entrando). O webhook de saída reusa a mesma tabela `IntegrationKey` e o mesmo
> service, com escopo próprio — a direção do dado muda, a máquina não.

---

## Como evoluímos

Frente grande segue o fluxo spec-driven do projeto:

```
/prd <fase>   →   /spec <prd>   →   issues   →   /code <plano>
 specs/research/    specs/plans/     o recorte      implementação faseada
                                     em PRs
```

Contribuição pontual não precisa de spec — vai direto por PR a partir de uma issue
([CONTRIBUTING.md](CONTRIBUTING.md#por-onde-começar)).

**Ao concluir uma frente:** mude o status na tabela de panorama, atualize a data no topo, e registre
aqui apenas o que **não** cabe na spec — divergência entre o planejado e o entregue, ou recorte que
ficou de fora com motivo. O detalhe do que foi feito fica na spec e no código; duplicá-lo aqui é o que
faz este documento envelhecer.
