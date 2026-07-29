---
date: 2026-07-28T13:22:48-03:00
researcher: claude
git_commit: 4da2faa88d80ac95ac7c254c257c0708eff948ec
branch: main
topic: "Fase 19-A — LGPD mínimo: excluir a própria conta e exportar meus dados"
tags: [research, auth, users, billing, data, audit, prisma, rls, legal]
status: complete
---

# Research: Fase 19-A — LGPD mínimo

## Research Question

Duas operações do titular, conforme [ROADMAP.md:634-650](../../ROADMAP.md#L634-L650):

1. **Excluir a própria conta (owner)**, com o efeito em cascata explícito e irreversível.
2. **Exportar meus dados** — dump da workspace num formato legível pelo titular.

Escopo mínimo: só essas duas. Consentimento, retenção e opt-out ficam na 19-B. O roadmap
pede para avaliar reaproveitar o `ExportService` genérico da 14-A.

## Summary

**Ponto de partida: não existe nada.** Nenhuma rota apaga um `User` — zero ocorrências de
`user.delete` / `deleteMany` / `DELETE FROM "User"` em todo o repositório. Nenhuma rota exporta
mais de uma listagem por vez. Colaborador é **desativado** (`User.active`), nunca apagado. Os
Termos declaram o encerramento de conta como **processo manual por e-mail**
([TermosPage.tsx:367-374](../../apps/web/src/features/legal/TermosPage.tsx#L367-L374)).

**Três achados invertem premissas do roadmap e são o coração desta fase:**

1. **O `ExportService` da 14-A serve menos do que o roadmap supõe.** Ele *só serializa* — não
   consulta banco, não conhece `ownerId`. Isso é decisão de segurança escrita em
   [data.module.ts:13-30](../../apps/api/src/modules/data/data.module.ts#L13-L30): "um exportador
   genérico que remontasse o `where` seria exatamente onde o vazamento aconteceria". Some-se o teto
   de **5.000 linhas** ([shared/export.ts:13](../../apps/api/src/shared/export.ts#L13)), o buffer
   montado dentro da transação de 5s do request, e o fato de só existirem CSV e XLSX de **aba
   única**. Reaproveitável para serializar; insuficiente como dump de workspace.
2. **A Política de Privacidade já promete mais do que "exportar":** portabilidade **"em formato
   legível por máquina"** ([PrivacidadePage.tsx:359-362](../../apps/web/src/features/legal/PrivacidadePage.tsx#L359-L362)),
   exclusão em até **30 dias** após o encerramento com backups expirando no prazo
   ([:285-289](../../apps/web/src/features/legal/PrivacidadePage.tsx#L285-L289)), e resposta em
   **15 dias** ([:377-384](../../apps/web/src/features/legal/PrivacidadePage.tsx#L377-L384)). O
   passivo já está publicado: a fase não escolhe o contrato, ela o cumpre.
3. **A doutrina de exclusão do projeto é o oposto do que a fase precisa.**
   [shared/purge.ts:13-15](../../apps/api/src/shared/purge.ts#L13-L15) fixa "**nenhuma cascata**":
   filho pendurado → `409` com instrução de expurgar de baixo para cima. Encerrar conta não pode
   pedir que o usuário expurgue 12 tabelas à mão. Esta fase é a **primeira exceção declarada** a
   essa regra.

Somam-se quatro bloqueios técnicos concretos, todos verificados na fonte: o `DELETE` do owner
**falha por FK** enquanto houver dado de negócio; `AuditLog` é **inapagável pela aplicação**
(`REVOKE`); a **assinatura do Stripe continuaria cobrando**; e o `BillingGuard` responde **402 em
tudo** justamente para quem quer sair.

## Codebase Map

### Afetados — API

| File | Role | Relevance |
|------|------|-----------|
| [auth.controller.ts:159-206](../../apps/api/src/modules/auth/auth.controller.ts#L159-L206) | Rotas de identidade (`GET/PATCH /auth/me`, sessões) | Onde as duas rotas novas mais provavelmente entram — `users/` **não tem controller** |
| [auth.service.ts:105-114](../../apps/api/src/modules/auth/auth.service.ts#L105-L114) | Login com `argon2.verify` | Único precedente de verificação de senha; base da reautenticação |
| [users.service.ts:128-208](../../apps/api/src/modules/users/users.service.ts#L128-L208) | `create` / `createWithOAuth` via `PrismaAdminService` | O **inverso** do que a fase faz: provisiona `Subscription`, `Role`, `PipelineStage` e 4 catálogos. Ler para saber o que desmontar |
| [prisma-admin.service.ts:5-19](../../apps/api/src/prisma/prisma-admin.service.ts#L5-L19) | Client `crm_user`, bypassa RLS | Único que apaga `AuditLog` e vê `User`. Docblock proíbe uso em rota HTTP — tensão a resolver |
| [owner-context.interceptor.ts:36-51](../../apps/api/src/prisma/owner-context.interceptor.ts#L36-L51) | Transação por request + `app.owner_id` | Impõe o orçamento de 5s a qualquer operação dentro do request |
| [prisma.service.ts:75-94](../../apps/api/src/prisma/prisma.service.ts#L75-L94) | `executarComoOwner` | Escrita sob RLS fora do request; hoje só a ingestão de lead usa |
| [billing.guard.ts:56-61](../../apps/api/src/modules/billing/billing.guard.ts#L56-L61) | `402` quando assinatura inativa | **Bloqueia as duas rotas novas** sem `@AllowWithoutSubscription()` |
| [billing.service.ts:67-78](../../apps/api/src/modules/billing/application/billing.service.ts#L67-L78) | `createPortalSession` | Único caminho de cancelamento hoje — humano, pelo Portal |
| [stripe.service.ts:29-34](../../apps/api/src/modules/billing/application/stripe.service.ts#L29-L34) | Wrapper do SDK; `client` cru | Não há método de cancelamento: a fase precisa criar um |
| [audit.service.ts:58-118](../../apps/api/src/modules/audit/audit.service.ts#L58-L118) | `registrar` (request) e `registrarPeloSistema` (admin) | O segundo é o caminho de um cron de expurgo |
| [shared/purge.ts:6-30](../../apps/api/src/shared/purge.ts#L6-L30) | `assertArquivado` / `assertSemFilhos` | A doutrina que esta fase excetua |
| [shared/export.ts:3-37](../../apps/api/src/shared/export.ts#L3-L37) | `ExportColumn<T>`, `MAX_EXPORT_ROWS`, `assertCabeNaExportacao` | Contrato do que é reaproveitável |
| [export.service.ts:20-36](../../apps/api/src/modules/data/application/export.service.ts#L20-L36) | `gerar<T>(linhas, colunas, formato, nomeBase)` | Serialização; `StreamableFile` sobre Buffer pronto |
| [access-context.ts:13-23](../../apps/api/src/modules/access/domain/access-context.ts#L13-L23) | `AccessContext.isOwner` | O portão correto — permissão não serve (ver Constraints) |
| [sessions-cleanup.job.ts:10-37](../../apps/api/src/modules/auth/sessions-cleanup.job.ts#L10-L37) | Cron 3h, retenção 30 dias | Molde exato de um expurgo agendado por carência |
| [shared/permissions.ts:172-200](../../apps/api/src/shared/permissions.ts#L172-L200) | Catálogo (fonte única) | Onde `lixeira:expurgar` e `dados:importar` vivem; **não existe `dados:exportar`** |
| [seed.ts:242-251](../../apps/api/prisma/seed.ts#L242-L251) | Limpeza das 10 tabelas de negócio por `ownerId` | **A ordem topológica já existe implementada** — ponto de partida direto |

### Afetados — Web

| File | Role | Relevance |
|------|------|-----------|
| [ConfiguracoesLayout.tsx:10-14](../../apps/web/src/features/configuracoes/ConfiguracoesLayout.tsx#L10-L14) | Abas Perfil / Dispositivos / Notificações, **sem gate de permissão** | Destino natural das duas ações |
| [PerfilTab.tsx](../../apps/web/src/features/perfil/PerfilTab.tsx) | Só nome + e-mail; **nenhuma seção de senha** | Não há precedente de ação sensível no perfil |
| [SessoesAtivas.tsx:123-145](../../apps/web/src/features/perfil/SessoesAtivas.tsx#L123-L145) | Dois `ConfirmDialog destructive` | Padrão de confirmação da casa |
| [confirm-dialog.tsx:13-23](../../apps/web/src/components/ui/confirm-dialog.tsx#L13-L23) | `ConfirmDialog` | **Não tem confirmação por digitação** — primitivo novo ou diálogo próprio |
| [administracao/tabs.ts:16-55](../../apps/web/src/features/administracao/tabs.ts#L16-L55) | Abas da workspace, gateadas por permissão | Alternativa de local; ver Open Questions |
| [PrivacidadePage.tsx](../../apps/web/src/features/legal/PrivacidadePage.tsx) · [TermosPage.tsx](../../apps/web/src/features/legal/TermosPage.tsx) | O contrato publicado | Precisam ser atualizados no mesmo PR (hoje prometem encerramento por e-mail) |

### O grafo de exclusão — verificado no schema

**Cascateia de `User` sozinho (16 FKs `Cascade`):** `User` colaborador
([:24](../../apps/api/prisma/schema.prisma#L24)), `Role` :64, `CollaboratorInvite` :86,
`IntegrationKey` :111, `LeadIntakeChannel` :144, `OAuthAccount` :180, `PasswordResetToken` :193,
`Session` :217, `Subscription` :247, `PipelineStage` :326, `LeadSourceCatalog` :355,
`ServiceCatalog` :370, `ActivityTypeCatalog` :385, `LostReasonCatalog` :405, `Notification` :848,
`UserNotificationTarget` :913. Mais `NotificationDelivery`, que morre por cascata de `Notification`
([:881](../../apps/api/prisma/schema.prisma#L881)).

**Não cascateia — `ownerId` é coluna solta, sem FK (usada só pelo RLS).** São **11 tabelas** que
um `DELETE FROM "User"` não toca: `Client` :259, `Contact` :304, `Deal` :416, `Proposal` :452,
`ProposalItem` :488, `Project` :501, `Task` :529, `Contract` :558, `Payment` :587, `Activity` :608,
`AuditLog` :643. Confirmado: `grep -c 'FOREIGN KEY ("ownerId")'` no `init` = **0**.

**Por isso o `DELETE` do owner falha.** As cascatas atingem os catálogos, mas as tabelas de negócio
sobrevivem e as prendem por `RESTRICT`:

| Cascata que morre | Bloqueada por | NOT NULL? |
|---|---|---|
| `PipelineStage` | `Deal.stageId` ([:420](../../apps/api/prisma/schema.prisma#L420)) | sim |
| `ServiceCatalog` | `Deal.serviceTypeId` :423, `Proposal.serviceTypeId` :463, `Project.serviceTypeId` :510 | sim |
| `ActivityTypeCatalog` | `Activity.typeId` :616 | sim |
| `LeadSourceCatalog` | `Client.sourceId` :268, `LeadIntakeChannel.sourceId` :155 | não |
| `LostReasonCatalog` | `Deal.lostReasonId` :428 | não |

Sutileza que morde mesmo sem dado de negócio: `LeadIntakeChannel.sourceId` é `RESTRICT` **e** o
`LeadIntakeChannel` é alvo de cascata do mesmo `DELETE`. Em Postgres `RESTRICT` é checado
imediatamente (não é `NO ACTION` diferível), então a ordem interna das ações do mesmo statement pode
fazer esse par colidir sozinho.

**Ordem topológica exigida:** `Payment` → `Task` → `ProposalItem` → `Contract` → `Project` →
`Activity` → `Proposal` (auto-ref `parentId` é `SetNull`) → `Deal` → `Contact` → `Client` →
catálogos → `User`. **Já implementada** em [seed.ts:242-251](../../apps/api/prisma/seed.ts#L242-L251)
para as 10 de negócio; falta ali `AuditLog`, `LeadIntakeChannel`, `IntegrationKey`, os catálogos e o
`User`.

Distribuição total das 50 FKs: **17 `RESTRICT`** (núcleo de negócio + catálogos), **17 `Cascade`**
(16 delas para `User`), **16 `SetNull`** (relações opcionais e os 5 `assigneeId`). Nenhum
`NO ACTION`.

### Padrões a seguir

**Contagem de bloqueadores (o mais próximo do que a exclusão precisa inverter)** — de
[prisma-client.repository.ts:111-150](../../apps/api/src/modules/clients/infra/prisma-client.repository.ts#L111-L150):

```ts
async countChildren(id: string): Promise<ClientChildrenCount> {
  const [contatos, atividades, oportunidades, propostas, projetos, contratos] =
    await Promise.all([
      this.prisma.db.contact.count({ where: { clientId: id } }),
      this.prisma.db.activity.count({ where: { clientId: id } }),
      // …deal, proposal, project, contract
    ]);
}
```

**Por que importa:** é a lista canônica de tudo que pende de um `Client`. A exclusão de conta usa a
mesma enumeração, mas para **apagar em ordem** em vez de recusar com `409`.

**Trilha agregada de operação em massa** — de
[import.service.ts:148-161](../../apps/api/src/modules/data/application/import.service.ts#L148-L161):

```ts
const importacaoId = randomUUID();
await this.audit.registrar({
  entity: 'IMPORT',
  entityId: importacaoId, // uuid do lote; AuditLog.entityId não tem FK
  entityLabel: nomeArquivo,
  action: 'IMPORTAR',
  extra: { tipo, totalDeLinhas: linhas.length, criados, /* … */ },
});
```

**Por que importa:** é o molde para registrar "conta encerrada" e "dados exportados" — `entity`
sintética, `entityId` do lote, contexto em `extra`. `AuditEntity.USER` e `AuditAction.EXCLUIR` já
existem ([schema.prisma:756-798](../../apps/api/prisma/schema.prisma#L756-L798)) e `USER` já é usado
para ativar/desativar colaborador.

**Ordenação manual de DELETE (único precedente)** — de
[prisma-proposal.repository.ts:109-114](../../apps/api/src/modules/proposals/infra/prisma-proposal.repository.ts#L109-L114):

```ts
async delete(id: string) {
  // itens primeiro (FK sem cascade); atômico via transação do request.
  const db = this.prisma.db;
  await db.proposalItem.deleteMany({ where: { proposalId: id } });
  await db.proposal.delete({ where: { id } });
}
```

**Escrita sob RLS fora do request** — [prisma.service.ts:75-94](../../apps/api/src/prisma/prisma.service.ts#L75-L94).
O docblock impõe duas obrigações: o `ownerId` vem de onde a **rota** autenticou (nunca do corpo), e
nada de I/O de rede dentro (timeout de 5s). E: "Não use isto para contornar o interceptor em rota
autenticada."

**Cron de retenção** — [sessions-cleanup.job.ts](../../apps/api/src/modules/auth/sessions-cleanup.job.ts):
constante de dias exportada + `@Cron(EVERY_DAY_AT_3AM, { name: … })` + log `evento` com `quantidade`
e `retencaoDias`. É o desenho pronto para "carência de N dias, depois apaga".

**Formato do `ENDPOINTS.md`** — 6 bullets em ordem imutável (`Propósito` → `Auth` → `Body` →
`Resposta` → `Erros` → `Handler`), `### MÉTODO /caminho` sem o prefixo `/api/v1`, mensagem pt-BR
literal entre backticks nos erros próprios. Modelo em
[ENDPOINTS.md:209-215](../../apps/api/ENDPOINTS.md#L209-L215).

### Data Flow — o que já funciona sozinho

**Queda de sessão após a exclusão: nada a fazer.** O `AccessGuard` resolve `User` a cada requisição
por `PrismaAdminService` e devolve `401` quando não acha
([access.guard.ts:52-58](../../apps/api/src/modules/access/access.guard.ts#L52-L58),
[access.service.ts:26-39](../../apps/api/src/modules/access/application/access.service.ts#L26-L39)).
O `ENDPOINTS.md:23` **já documenta** "quando a conta foi apagada" — a documentação previu o cenário
que nenhuma rota produz. Apagado o owner, a sessão dele e a dos colaboradores caem na requisição
seguinte, sem código novo.

**Exportação hoje (3 rotas, todas no módulo dono):** controller resolve o escopo →
`resolveAssigneeScope(access, 'x:ver_todos')` → service repete o **mesmo** `filter` de `list()` com
`take: MAX_EXPORT_ROWS` → `assertCabeNaExportacao(total)` → `exporter.gerar(...)`. Ver
[clients.service.ts:266-294](../../apps/api/src/modules/clients/application/clients.service.ts#L266-L294)
e [clients.controller.ts:67-79](../../apps/api/src/modules/clients/api/clients.controller.ts#L67-L79).
Colunas fixas no código do módulo dono: `COLUNAS_DE_CLIENTE` (19), `COLUNAS_DE_CONTRATO` (10),
`COLUNAS_DE_COBRANCA` (8). **Não há registry recurso→colunas.** Fora de export hoje: contatos,
deals, propostas, projetos, tarefas, atividades, catálogos, colaboradores, auditoria, notificações —
ou seja, a maior parte de um dump.

## External Research

### LGPD — o que o texto legal exige

**Art. 18** garante, "a qualquer momento e mediante requisição": confirmação (I), acesso (II),
eliminação de dados desnecessários/excessivos/em desconformidade (IV), **portabilidade** (V) e
eliminação dos dados tratados com consentimento (VI). O **§ 5º** diz que é atendido "sem custos
para o titular, nos prazos e nos termos previstos em **regulamento**".

**Correção importante sobre prazo:** o prazo de 15 dias **não é do Art. 18** — está no **Art. 19,
II**, e vale para confirmação/acesso ("declaração clara e completa, fornecida no prazo de até 15
dias"). Para **eliminação e portabilidade não há prazo legal**: ambos remetem a regulamento
inexistente. Os 15 dias são analogia de mercado, não texto de lei.

**Art. 19, § 3º** é o requisito de formato mais próximo que existe: "cópia eletrônica integral de
seus dados pessoais (…) em formato que **permita a sua utilização subsequente**, inclusive em outras
operações de tratamento". O critério substantivo é autoaplicável mesmo sem regulamento.

**Art. 40**: a ANPD "**poderá**" dispor sobre padrões de interoperabilidade — competência
facultativa **não exercida**. Verificado em 28/07/2026: nenhuma consulta pública em andamento sobre
direitos dos titulares; o Balanço da Agenda Regulatória 2025-2026 registra que o Item 1 (Direitos
dos Titulares) "aguarda deliberação do Conselho Diretor sobre a realização de consulta pública".

**Res. CD/ANPD nº 2/2022** (agentes de pequeno porte — inclui **startups**): art. 14, III concede
**prazo em dobro** para a declaração completa do Art. 19, II (→ 30 dias); art. 15 permite fornecer a
declaração simplificada em até 15 dias (em vez de "imediatamente").

**Sinal de fiscalização:** direitos dos titulares é o **tema prioritário nº 1** para o biênio
2026-2027 (Mapa de Temas Prioritários, Res. CD/ANPD nº 30/2025).

Fontes: [Lei 13.709/2018](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm) ·
[Res. 2/2022](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-2-de-27-de-janeiro-de-2022) ·
[Consultas públicas ANPD](https://www.gov.br/anpd/pt-br/acesso-a-informacao/participacao-social/audiencias-e-consultas-publicas/consultas-publicas) ·
[Mapa de temas prioritários](https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-publica-mapa-de-temas-prioritarios-para-o-bienio-2026-2027-e-atualiza-agenda-regulatoria-2025-2026)

### Papel duplo: o CRM é controlador e operador ao mesmo tempo

A [PrivacidadePage.tsx:45-70](../../apps/web/src/features/legal/PrivacidadePage.tsx#L45-L70) já
declara a distinção, e ela governa o desenho:

| Dado | Papel do CRM | Titular |
|---|---|---|
| Conta do owner, e-mail, senha, assinatura, logs de acesso | **Controlador** | o próprio owner |
| Clientes/contatos/propostas/contratos cadastrados | **Operador** | terceiros (clientes do owner) |

Consequências, ancoradas no [Guia Orientativo da ANPD para Definições dos Agentes de Tratamento](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia-agentes-de-tratamento-e-encarregado-versao-1-0-defeso-eleitoral.pdf)
(§§17, 49, 51, 55) e no **Art. 39**:

1. **"Excluir a conta" é instrução do controlador, e o CRM deve executá-la.** O owner age
   simultaneamente como titular dos *seus* dados (Art. 18) e como controlador dos dados de
   terceiros. Reter aquilo para finalidade própria é tratar fora das instruções, o que pelo
   **Art. 42, § 1º, I** equipara o operador ao controlador — o Guia é explícito: "a princípio, essa
   é a **única** hipótese em que o operador é equiparado ao controlador".
2. **Titular-terceiro não pode exigir exclusão do CRM.** O caminho é o **Art. 18, § 4º, I**:
   responder que não é o agente responsável e indicar o controlador. A
   [PrivacidadePage.tsx:385-392](../../apps/web/src/features/legal/PrivacidadePage.tsx#L385-L392)
   já promete exatamente isso ("encaminhamos e avisamos você") — é processo humano, não código.
3. **Art. 18, § 6º** obriga a informar "de maneira imediata" os agentes com quem houve uso
   compartilhado, para que repitam o procedimento. No caso: **Stripe** (assinatura) e o **provedor
   SMTP**.

### Retenção legítima pós-exclusão (Art. 16)

O **Art. 16** autoriza conservar para: cumprimento de obrigação legal (I), estudo por órgão de
pesquisa (II), transferência a terceiro (III) e **uso exclusivo do controlador, vedado acesso por
terceiro e desde que anonimizados** (IV). Duas expressões sustentam o desenho técnico: "no âmbito e
nos **limites técnicos** das atividades" (abre espaço para janela de backup e carência) e o inciso
IV (métrica de produto só sobrevive anonimizada).

Aplicado:

- **Fiscal/financeiro (do owner, não dos clientes dele):** ~5 anos, por **CTN** art. 195 § único
  (conservar até a prescrição) + arts. 173 e 174 (5 anos).
- **Registros de acesso:** **6 meses**, por **Marco Civil art. 15** — obrigação, não faculdade.
  Complementarmente **LGPD art. 37** manda manter registro das operações de tratamento.
- **Registro do próprio evento de exclusão** (quem pediu, quando, o que foi apagado — sem os dados
  apagados): defensável pelo art. 37 e pelo princípio de responsabilização.

### Formato da portabilidade

Sem formato exigido por lei ou regulamento. A referência prática é o WP29/EDPB, que a ANPD cita
rotineiramente: "commonly used open formats (e.g., **XML, JSON, CSV**) along with useful metadata at
the best possible level of granularity". O **Art. 18, § 7º** exclui da portabilidade os dados já
anonimizados.

Desenho defensável: **JSON** completo e tipado por entidade (é o que atende "utilização subsequente"
do Art. 19 § 3º e o que a página já prometeu como "legível por máquina"), acompanhado de manifest com
esquema, versão e data. CSV por tabela é complemento útil, não substituto — planilha de aba única não
carrega um grafo relacional.

Fontes: [WP29 Guidelines on data portability](https://www.bvdnet.de/wp-content/uploads/2022/03/Guidelines-on-the-right-to-data-portability.pdf) ·
[ICO — Right to data portability](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-data-portability/)

### Padrão de mercado para "delete my account"

**Norma de segurança:** OWASP ASVS **3.7.1** (L1/L2/L3, CWE-306) — "requires re-authentication or
secondary verification before allowing any sensitive transactions or account modifications".

**Norma de UX:** NN/g — descreva a consequência em vez de perguntar "Are you sure?", e para as
operações mais perigosas "require a nonstandard action from the user to confirm (…) for example, type
a word into a box", com a ressalva de que o recurso perde força se usado com frequência.

| Produto | Confirmação | Carência | Hard delete |
|---|---|---|---|
| **GitHub** | digitar username/e-mail **+** frase fornecida pelo sistema | nenhuma | imediato, irreversível; instrui exportar antes |
| **Atlassian** | pelas configurações da conta | **14 dias**, cancelável, prazo **não acelerável** | permanente depois; dados de billing removidos em até 30 dias, salvo obrigação legal |
| **GitLab** | — | **30 dias** obrigatórios em SaaS desde 15/09/2025 | limpeza automática após a janela |
| **Slack** | checkbox + **digitar a senha**; só o Primary Owner | nenhuma | permanente; recomenda exportar antes |
| **Notion** | digitar o e-mail da conta | 30 dias via suporte | — |

Duas escolas: irreversível-imediato (GitHub, Slack) × agendado-cancelável (Atlassian, GitLab).
**Para um CRM com dado de terceiro, o agendado é mais defensável** — reduz o risco de exclusão por
sequestro de conta, e o "irreversível" prometido continua verdadeiro: é irreversível *depois* da
janela. E não há conflito com a LGPD: o Art. 16 caput fala em "limites técnicos" e o Art. 18 § 4º
admite providência não imediata com resposta fundamentada. O que importa é **declarar o prazo** e
**bloquear o uso** durante a janela — e a Política já declarou 30 dias.

Fontes: [GitHub](https://docs.github.com/en/account-and-profile/setting-up-and-managing-your-personal-account-on-github/managing-your-personal-account/deleting-your-personal-account) ·
[Atlassian](https://support.atlassian.com/atlassian-account/docs/delete-your-atlassian-account/) ·
[GitLab](https://about.gitlab.com/blog/2023/04/03/delayed-deletion/) ·
[Slack](https://slack.com/help/articles/204067366-Delete-a-workspace) ·
[ASVS V3](https://github.com/OWASP/ASVS/blob/master/4.0/en/0x11-V3-Session-management.md) ·
[NN/g](https://www.nngroup.com/articles/confirmation-dialog/)

### Backups

**Sem fonte oficial brasileira.** O único guia da ANPD que menciona backup (*Segurança da Informação
para Agentes de Pequeno Porte*, out/2021) trata de disponibilidade/ransomware (§49) e de **descarte
de mídia física** (§50) — não de expurgo de registro em backup lógico.

A prática aceita é a doutrina **"beyond use"** do ICO: se não é possível sobrescrever de imediato,
"the key issue is to put the backup data 'beyond use'" — não reutilizar para nenhuma outra
finalidade, deixar expirar por **cronograma estabelecido**, e ser "absolutely clear with individuals
as to what will happen to their data (…) including in respect of backup systems". No Brasil ancora
em Art. 6º (finalidade, necessidade, transparência) e Art. 16 caput.

Prazos publicados por comparáveis: Google declara ~2 meses até a exclusão completa e "up to 6
months" em backups; Notion declara janela de snapshot de 30 dias mesmo anunciando exclusão
permanente.

**Consequência de engenharia:** se um backup for restaurado, a exclusão precisa ser **reaplicada** —
via lista de tombstones (`ownerId` + timestamp, sem PII) fora do escopo do backup, ou como etapa
obrigatória do runbook de restore. Sem isso a promessa quebra no primeiro disaster recovery.

Fonte: [ICO — Right to erasure](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-erasure/) ·
[Google — Data retention](https://policies.google.com/technologies/retention)

## Historical Context

- **[ROADMAP.md:67](../../ROADMAP.md#L67)** — 19-A é o 1º da trilha de produção: "risco legal com
  dado de terceiro, não feature". **[:97-99](../../ROADMAP.md#L97-L99)**: "o que resta de bloqueio de
  produção é jurídico, não funcional".
- **[ROADMAP.md:648-650](../../ROADMAP.md#L648-L650)** — a premissa a corrigir: "a exportação **pode
  reaproveitar** a egressão de 14-A (…) `ExportService` é genérico (a listagem passa as colunas) e
  serve a um dump da workspace inteira". Verdadeiro quanto à serialização; falso quanto à consulta,
  ao teto e ao formato.
- **[fase-8c-lixeira.md:19,36,44-46](../../specs/plans/2026-07-26-fase-8c-lixeira.md#L19)** — "a
  ordem de remoção é regra, não detalhe"; expurgo exige registro já arquivado (`422`), sem cascata
  (`409` com instrução), e **cron de expurgo ficou fora de escopo** porque "um cron que apaga dado de
  negócio sozinho é decisão de produto, não de implementação". Esta fase toma essa decisão.
- **[fase-8c-lixeira.md:328-339](../../specs/plans/2026-07-26-fase-8c-lixeira.md#L328)** — precedente
  direto de política: `lixeira:expurgar` **não** ganhou backfill em papéis existentes porque
  "conceder automaticamente seria o oposto do desejado". Owner e papel `system` recebem em runtime.
- **[fase-14a](../../specs/plans/2026-07-27-fase-14a-importacao-e-exportacao.md#L1776)** — já
  antecipava: "**Sobreposição com a Fase 19-A (LGPD)**, que é a próxima da trilha e exporta a
  workspace inteira do titular. `ExportService` + `ExportColumn<T>` foram desenhados para servir a
  ela". E [:96-99](../../specs/plans/2026-07-27-fase-14a-importacao-e-exportacao.md#L96): "job
  assíncrono / fila" ficou fora porque "hoje custaria `PrismaAdminService` (que bypassa RLS) e
  transferiria o isolamento para o código".
- **[colaboradores-e-papeis.md:19,63,68](../../specs/plans/2026-07-25-colaboradores-e-papeis.md#L19)**
  — owner "não pode ser desativado"; **sem transferir titularidade** da workspace nem promover
  colaborador a owner; **sem exclusão de colaborador** (desativa/reativa). A exclusão de conta é
  portanto a *única* forma de a workspace terminar.
- **[fase-8b-auditoria.md:172,1292,1298](../../specs/plans/2026-07-26-fase-8b-auditoria.md#L172)** —
  o `REVOKE` "impede que a aplicação o faça, o que é o desenho pretendido"; uma futura política de
  retenção "vai passar por `crm_user`"; e a trilha **guarda dado pessoal**: `document` é omitido por
  regra, mas "nome, e-mail e telefone de cliente **podem** entrar num diff de `CLIENT`".
- **Git:** `apps/web/src/features/legal/` tem **um único commit** (`bca3a89`), nunca revisado desde
  então. Nenhum commit de LGPD/privacidade/conta nos últimos 40.
- **[SPEC.md:188](../SPEC.md#L188)** — "Cobrança paga não pode ser excluída — apenas estornada".
  Regra em tensão: a exclusão de conta necessariamente apaga `Payment`.

## Constraints & Considerations

**Bloqueios técnicos duros**

1. **`AuditLog` é inapagável pela aplicação.**
   [migration.sql:65](../../apps/api/prisma/migrations/20260729100000_audit_log/migration.sql#L65):
   `REVOKE UPDATE, DELETE ON "AuditLog" FROM crm_app`. E `ownerId`/`actorId` **não têm FK** de
   propósito ([schema.prisma:645](../../apps/api/prisma/schema.prisma#L645): "Sem FK: apagar um
   usuário não pode apagar a trilha"). Só `crm_user` alcança. Como a trilha contém dado pessoal em
   `diff`, ou se apaga pelo admin client, ou se anonimiza, ou se declara retenção — as três são
   decisões de produto, não de implementação.
2. **`PrismaAdminService` proíbe uso em rota HTTP**
   ([:8](../../apps/api/src/prisma/prisma-admin.service.ts#L8): "nunca deve ser usado no caminho de
   requisição HTTP"), mas é o único client que bypassa RLS, vê `User` e apaga `AuditLog`. Precedentes
   que já o usam no request: `AccessGuard`, `UsersService.create`,
   `prisma-collaborator.repository.existsByEmail`. A exclusão de conta precisa dele — a fase declara
   a exceção ou move o trabalho para fora do request (cron), que é o caminho mais alinhado.
3. **Orçamento de 5s por request.** O `OwnerContextInterceptor` envolve todo handler autenticado numa
   `$transaction` sem opções → timeout default do Prisma. Nenhuma `$transaction` do projeto passa
   opções. Apagar 12 tabelas de uma workspace grande, ou serializar um dump inteiro, pode não caber.
4. **`BillingGuard` responde 402 em tudo** quando a assinatura está inativa
   ([:56-61](../../apps/api/src/modules/billing/billing.guard.ts#L56-L61); `CANCELED` e `INCOMPLETE`
   nunca dão acesso, [subscription-access.service.ts:40-43](../../apps/api/src/modules/billing/application/subscription-access.service.ts#L40-L43)).
   Sem `@AllowWithoutSubscription()`, quem mais precisa exportar e sair é justamente quem não
   consegue — e a Política promete os direitos "a qualquer momento e sem custo".
5. **A assinatura do Stripe continuaria cobrando.** `onDelete: Cascade` apaga a linha local
   `Subscription`, mas nada cancela o objeto remoto: não existe chamada a `subscriptions.cancel` em
   todo o repositório. Pior, some o `stripeCustomerId`, e
   [prisma-subscription.repository.ts:82-86](../../apps/api/src/modules/billing/infra/prisma-subscription.repository.ts#L82-L86)
   passa a devolver `null` **silenciosamente** para todo evento futuro daquele customer — o webhook
   fica órfão e idempotentemente inútil. Cancelar no Stripe é requisito, e é I/O de rede: **não pode
   rodar dentro da transação** (regra explícita em [prisma.service.ts:69](../../apps/api/src/prisma/prisma.service.ts#L69)).
6. **`document` tem unicidade por owner adiada (14-C)** — irrelevante aqui, mas a exclusão remove
   linhas que a 14-C um dia vai querer mesclar. Sem interação.

**Decisões de desenho forçadas pelo que existe**

7. **O portão é `isOwner`, não uma permissão.** Owner recebe **todas** as chaves do catálogo por
   definição ([shared/permissions.ts](../../apps/api/src/shared/permissions.ts)), mas uma chave nova
   também poderia ser atribuída a um papel de colaborador — e colaborador não encerra a conta de
   ninguém. `AccessContext.isOwner` já existe; **nenhuma rota hoje se restringe a ele**, então é
   padrão novo.
8. **Não existe reconfirmação de senha em nenhum lugar do projeto.** Não há rota autenticada de troca
   de senha; `PATCH /auth/me` troca nome e e-mail sem reconfirmar nada. O único `argon2.verify` de
   senha é o do login. E **`passwordHash` é nullable**
   ([schema.prisma:17](../../apps/api/prisma/schema.prisma#L17)): owner criado por OAuth não tem
   senha — reautenticação por senha não pode ser o único portão.
9. **`ConfirmDialog` não tem confirmação por digitação**
   ([:13-23](../../apps/web/src/components/ui/confirm-dialog.tsx#L13-L23)) — o padrão de mercado
   (digitar o e-mail da conta) pede primitivo novo ou diálogo próprio.
10. **Sem biblioteca de ZIP.** As deps da API não têm `archiver`/`jszip`/`yazl`. Um pacote multi-arquivo
    exige dependência nova; um único JSON não exige nada. A 14-A recusou dependência nova para
    streaming pelo mesmo tipo de razão.
11. **SMTP é opcional** ([mail.service.ts:27-29](../../apps/api/src/mail/mail.service.ts#L27-L29)):
    sem `SMTP_HOST` o envio é desabilitado e o conteúdo só é logado. Um fluxo que **dependa** de
    e-mail de confirmação quebra na autohospedagem — os dois fluxos de link existentes (reset,
    convite) têm fallback pela interface justamente por isso.
12. **A doutrina "nenhuma cascata" precisa de exceção declarada.**
    [shared/purge.ts:13-15](../../apps/api/src/shared/purge.ts#L13-L15). Encerrar conta não pode
    pedir expurgo manual de 12 tabelas. A exceção deve ser escrita no código e no plano, senão a
    próxima leitura a trata como violação.
13. **Migration com dado dentro é portão de CI.** Se a fase adicionar coluna (ex.: agendamento de
    exclusão em `User`), precisa de invariante nova em
    [invariantes.sql](../../apps/api/prisma/fixtures/invariantes.sql) — "não estourou" é portão
    fraco. A fixture usa só colunas do `init`.
14. **Rota `@Public()` que escreve exige e2e.** Regra de
    [apps/api/CLAUDE.md](../../apps/api/CLAUDE.md). As rotas desta fase são autenticadas, mas um
    **cron** de expurgo roda fora do request e sem `app.owner_id` — mesmo tipo de risco (RLS
    fail-closed grava zero linha e a rota responde sucesso).

**Divergências entre o que está publicado e o que o sistema faz** (achados; não são
necessariamente escopo desta fase)

15. **Registros de acesso: a Política promete 6 meses, o sistema guarda 30 dias.** Não existe tabela
    de log de acesso; `http.requisicao` vai só para stdout → Loki, e
    [docs/observabilidade.md:176-178](../../docs/observabilidade.md#L176-L178) declara "a linha vive
    30 dias". Marco Civil art. 15 exige 6 meses. É desvio de obrigação legal **e** afirmação falsa na
    Política.
16. **Backups: a Política afirma "os backups em rotação também expiram"; não há rotação
    documentada.** [docs/deploy.md:206-216](../../docs/deploy.md#L206-L216) descreve `pg_dump` manual,
    sem política de retenção, janela ou expiração.
17. **Autocadastro: o ROADMAP descreve como aberto; o README e o deploy instruem a fechar**
    (`REGISTRATION_ENABLED=false` após criar a conta —
    [README.md:186](../../README.md#L186)). A memória do projeto registra a decisão de produto de
    mantê-lo aberto. Vale confirmar antes de dimensionar o risco.
18. **`Notification`/`NotificationDelivery` crescem sem política de expurgo**
    ([docs/observabilidade.md:263-273](../../docs/observabilidade.md#L263-L273)) — e o próprio doc
    nota que o expurgo "passa pelo `crm_user`, `crm_app` não tem `DELETE` em massa como caminho
    previsto".

## Open Questions

Precisam de decisão humana antes do `/spec`:

1. **Exclusão imediata ou com carência?** A Política já promete "em até 30 dias", o que **acomoda as
   duas** leituras. Carência (padrão Atlassian/GitLab) protege contra exclusão por sequestro de conta
   e permite fazer o trabalho fora do request de 5s, mas exige coluna/modelo novo, cron e uma decisão
   sobre o que acontece com o acesso durante a janela (bloqueado? somente leitura?). Imediato
   (GitHub/Slack) é mais simples e cumpre literalmente o "irreversível" do roadmap, mas empurra a
   exclusão inteira para dentro do orçamento de 5s.
2. **O que fazer com o `AuditLog` do owner excluído?** Três saídas, todas defensáveis: apagar pelo
   `crm_user`; anonimizar (`actorName`, e limpar `diff`, que pode conter nome/e-mail/telefone de
   cliente); ou retê-lo declaradamente como registro de tratamento (Art. 37) com prazo publicado. A
   escolha muda a Política de Privacidade.
3. **Formato do dump: JSON único, ou JSON + CSVs em ZIP?** JSON único não exige dependência nova e já
   cumpre "legível por máquina". ZIP com CSVs é mais amigável a quem vai abrir no Excel, mas custa
   `archiver`/`yazl` e a decisão de precedente. E: o dump inclui só as entidades de negócio, ou
   também trilha de auditoria, notificações, colaboradores e catálogos?
4. **O teto de 5.000 linhas se aplica ao dump?** Ele existe pela transação do request. Se o dump
   rodar dentro do request, alguma workspace grande vai bater no teto — e um `422` "refine os
   filtros" não faz sentido num pedido de portabilidade, que por definição é "tudo". Isso empurra
   para geração assíncrona, que a 14-A recusou explicitamente por custar `PrismaAdminService`.
5. **Cancelar a assinatura no Stripe: automático ou pré-requisito?** Cancelar automaticamente é o que
   evita cobrar quem já saiu, mas é I/O de rede que não pode entrar na transação e pode falhar
   (Stripe fora do ar) — e aí a conta some com a assinatura viva. Alternativa: exigir assinatura já
   cancelada antes de aceitar o encerramento (`409`), o que transfere um passo manual ao usuário.
6. **Onde as duas ações moram na interface?** `/configuracoes` (própria conta, sem gate — mas
   encerrar a workspace não é "própria conta" no sentido do colaborador) ou `/administracao` (a
   workspace, mas todas as abas de lá são gateadas por permissão, e aqui o gate é `isOwner`).
7. **Reautenticação de owner sem senha (OAuth).** `passwordHash` nullable. Fluxo alternativo: link de
   confirmação por e-mail (quebra sem SMTP), digitação do e-mail da conta, ou exigir que a pessoa
   defina uma senha antes. Precisa de decisão porque atinge um subconjunto real de usuários.
8. **Os desvios #15 e #16 entram nesta fase ou viram PR próprio?** A retenção de log de acesso
   (6 meses × 30 dias) é obrigação de Marco Civil e afirmação falsa na Política. Não é a 19-A, mas foi
   encontrado ao ler o contrato que a 19-A cumpre — e a Política vai ser editada de qualquer forma
   neste PR.

## Code References Index

- [apps/api/prisma/schema.prisma:17](../../apps/api/prisma/schema.prisma#L17) — `passwordHash` nullable (OAuth/convite)
- [apps/api/prisma/schema.prisma:24](../../apps/api/prisma/schema.prisma#L24) — auto-relação de colaborador, `onDelete: Cascade`
- [apps/api/prisma/schema.prisma:247](../../apps/api/prisma/schema.prisma#L247) — `Subscription.owner` Cascade
- [apps/api/prisma/schema.prisma:259-643](../../apps/api/prisma/schema.prisma#L259) — as 11 tabelas com `ownerId` sem FK
- [apps/api/prisma/schema.prisma:283-286](../../apps/api/prisma/schema.prisma#L283) — `assigneeId` SetNull: "apagar um usuário não pode apagar o dado de negócio do owner"
- [apps/api/prisma/schema.prisma:645](../../apps/api/prisma/schema.prisma#L645) — `AuditLog.actorId` sem FK, por decisão
- [apps/api/prisma/schema.prisma:756-798](../../apps/api/prisma/schema.prisma#L756) — enums `AuditEntity` / `AuditAction`
- [apps/api/prisma/migrations/20260724040000_create_app_role/migration.sql:11](../../apps/api/prisma/migrations/20260724040000_create_app_role/migration.sql#L11) — `crm_app` NOBYPASSRLS
- [apps/api/prisma/migrations/20260724050000_enable_rls/migration.sql:1-12](../../apps/api/prisma/migrations/20260724050000_enable_rls/migration.sql#L1) — template de policy, fail-closed
- [apps/api/prisma/migrations/20260729100000_audit_log/migration.sql:65](../../apps/api/prisma/migrations/20260729100000_audit_log/migration.sql#L65) — `REVOKE UPDATE, DELETE ... FROM crm_app`
- [apps/api/prisma/seed.ts:242-251](../../apps/api/prisma/seed.ts#L242) — ordem topológica das 10 tabelas de negócio
- [apps/api/src/prisma/prisma-admin.service.ts:5-19](../../apps/api/src/prisma/prisma-admin.service.ts#L5) — client admin e sua proibição
- [apps/api/src/prisma/prisma.service.ts:75-94](../../apps/api/src/prisma/prisma.service.ts#L75) — `executarComoOwner`
- [apps/api/src/prisma/owner-context.interceptor.ts:36-51](../../apps/api/src/prisma/owner-context.interceptor.ts#L36) — transação por request
- [apps/api/src/modules/access/domain/access-context.ts:13-23](../../apps/api/src/modules/access/domain/access-context.ts#L13) — `AccessContext.isOwner`
- [apps/api/src/modules/access/access.guard.ts:52-58](../../apps/api/src/modules/access/access.guard.ts#L52) — `401` para conta apagada
- [apps/api/src/modules/auth/auth.controller.ts:159-206](../../apps/api/src/modules/auth/auth.controller.ts#L159) — rotas de identidade
- [apps/api/src/modules/auth/auth.service.ts:105-114](../../apps/api/src/modules/auth/auth.service.ts#L105) — `argon2.verify` no login
- [apps/api/src/modules/auth/auth.service.ts:201-203](../../apps/api/src/modules/auth/auth.service.ts#L201) — trocar senha revoga todas as sessões
- [apps/api/src/modules/auth/sessions-cleanup.job.ts:10-37](../../apps/api/src/modules/auth/sessions-cleanup.job.ts#L10) — cron de retenção de 30 dias
- [apps/api/src/modules/billing/billing.guard.ts:56-61](../../apps/api/src/modules/billing/billing.guard.ts#L56) — `402` em rota autenticada
- [apps/api/src/modules/billing/application/billing.service.ts:67-78](../../apps/api/src/modules/billing/application/billing.service.ts#L67) — Portal do Stripe
- [apps/api/src/modules/billing/application/stripe.service.ts:29-34](../../apps/api/src/modules/billing/application/stripe.service.ts#L29) — wrapper sem cancelamento
- [apps/api/src/modules/billing/infra/prisma-subscription.repository.ts:82-86](../../apps/api/src/modules/billing/infra/prisma-subscription.repository.ts#L82) — webhook órfão devolve `null`
- [apps/api/src/modules/audit/audit.service.ts:58-118](../../apps/api/src/modules/audit/audit.service.ts#L58) — `registrar` × `registrarPeloSistema`
- [apps/api/src/modules/clients/application/clients.service.ts:266-294](../../apps/api/src/modules/clients/application/clients.service.ts#L266) — export reusa `filter` + `scope`
- [apps/api/src/modules/clients/infra/prisma-client.repository.ts:111-150](../../apps/api/src/modules/clients/infra/prisma-client.repository.ts#L111) — `countChildren`
- [apps/api/src/modules/data/data.module.ts:13-30](../../apps/api/src/modules/data/data.module.ts#L13) — por que a exportação não é genérica
- [apps/api/src/modules/data/application/export.service.ts:20-36](../../apps/api/src/modules/data/application/export.service.ts#L20) — `gerar<T>`
- [apps/api/src/modules/data/application/import.service.ts:148-161](../../apps/api/src/modules/data/application/import.service.ts#L148) — trilha agregada
- [apps/api/src/modules/proposals/infra/prisma-proposal.repository.ts:109-114](../../apps/api/src/modules/proposals/infra/prisma-proposal.repository.ts#L109) — único DELETE ordenado à mão
- [apps/api/src/shared/export.ts:3-37](../../apps/api/src/shared/export.ts#L3) — `MAX_EXPORT_ROWS`, `ExportColumn<T>`
- [apps/api/src/shared/purge.ts:6-30](../../apps/api/src/shared/purge.ts#L6) — doutrina "nenhuma cascata"
- [apps/api/src/shared/permissions.ts:172-200](../../apps/api/src/shared/permissions.ts#L172) — `lixeira:expurgar`, `dados:importar`
- [apps/api/src/mail/mail.service.ts:27-29](../../apps/api/src/mail/mail.service.ts#L27) — SMTP opcional
- [apps/api/ENDPOINTS.md:23](../../apps/api/ENDPOINTS.md#L23) — já documenta "conta apagada"
- [apps/api/ENDPOINTS.md:209-215](../../apps/api/ENDPOINTS.md#L209) — formato de doc a seguir
- [apps/web/src/features/configuracoes/ConfiguracoesLayout.tsx:10-14](../../apps/web/src/features/configuracoes/ConfiguracoesLayout.tsx#L10) — abas da própria conta
- [apps/web/src/features/perfil/SessoesAtivas.tsx:123-145](../../apps/web/src/features/perfil/SessoesAtivas.tsx#L123) — `ConfirmDialog destructive`
- [apps/web/src/components/ui/confirm-dialog.tsx:13-23](../../apps/web/src/components/ui/confirm-dialog.tsx#L13) — sem confirmação por digitação
- [apps/web/src/features/legal/PrivacidadePage.tsx:285-289](../../apps/web/src/features/legal/PrivacidadePage.tsx#L285) — 30 dias + backups
- [apps/web/src/features/legal/PrivacidadePage.tsx:359-362](../../apps/web/src/features/legal/PrivacidadePage.tsx#L359) — "formato legível por máquina"
- [apps/web/src/features/legal/PrivacidadePage.tsx:377-392](../../apps/web/src/features/legal/PrivacidadePage.tsx#L377) — 15 dias + roteamento de terceiro
- [apps/web/src/features/legal/TermosPage.tsx:196-204](../../apps/web/src/features/legal/TermosPage.tsx#L196) — "exporte o que precisa" antes de encerrar
- [apps/web/src/features/legal/TermosPage.tsx:367-374](../../apps/web/src/features/legal/TermosPage.tsx#L367) — encerramento por e-mail (hoje)
- [docs/observabilidade.md:176-178](../../docs/observabilidade.md#L176) — Loki retém 30 dias
- [docs/deploy.md:206-216](../../docs/deploy.md#L206) — backup manual, sem rotação
- [SPEC.md:188](../SPEC.md#L188) — cobrança paga não pode ser excluída
