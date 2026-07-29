# specs — a especificação e o registro de decisões

Esta pasta guarda duas coisas com status bem diferentes:

- **[SPEC.md](SPEC.md) — vigente e vinculante.** A especificação funcional do
  domínio: o que cada módulo faz, quais transições são válidas, o que o sistema
  recusa. É mantido atualizado e vale sobre qualquer plano.
- **`research/` e `plans/` — registro histórico.** Como cada frente de trabalho foi
  pesquisada e planejada antes de ser implementada — o *porquê* das decisões, em
  ordem cronológica. São documentos datados, preservados como foram escritos; não
  são documentação do produto.

Se você quer entender ou usar o sistema, o mapa é este:

| O que você procura | Onde está |
| --- | --- |
| Como rodar, autohospedar e contribuir | [README.md](../README.md) e [CONTRIBUTING.md](../CONTRIBUTING.md) |
| As regras de negócio do domínio | [SPEC.md](SPEC.md) |
| O modelo de dados (tabelas, campos, enums) | [apps/api/prisma/schema.prisma](../apps/api/prisma/schema.prisma) |
| As rotas da API | [apps/api/ENDPOINTS.md](../apps/api/ENDPOINTS.md) |
| O que já foi entregue e o que vem depois | [ROADMAP.md](../ROADMAP.md) |
| Convenções obrigatórias de arquitetura | `CLAUDE.md` na raiz, em `apps/api/` e em `apps/web/` |
| Como usar o CRM no dia a dia | [docs/uso/](../docs/uso/) |

## Como está organizado

- **`research/`** — PRDs: levantamento de contexto feito antes de planejar. Mapeiam
  o código existente, as restrições e as decisões em aberto de uma frente de trabalho.
- **`plans/`** — specs de implementação: o plano fase a fase derivado de um PRD, com
  os critérios de verificação de cada etapa.

O fluxo é `research → plans → implementação`, um par de documentos por frente de
trabalho, nomeados por data. O `ROADMAP.md` linka cada fase aos seus documentos.

## Leia `research/` e `plans/` com estas ressalvas

As ressalvas abaixo valem para os documentos históricos — **não** para o `SPEC.md`.

- **São documentos datados e não são atualizados depois da implementação.** Descrevem
  o que se sabia e se pretendia *naquele momento*. Onde um plano divergir do código
  atual, **o código e o `SPEC.md` valem** — não o plano.
- **Os trechos de código são ilustrativos.** Vários já não correspondem aos arquivos
  reais: assinaturas mudaram, arquivos foram movidos ou removidos. Não copie de uma
  spec sem conferir o estado atual do repositório.
- **"CRM Solarz" aparece nos documentos mais antigos.** Era o nome de trabalho
  interno do projeto antes de virar **ProgrameAi CRM**. Os documentos foram
  mantidos como escritos, em vez de reescritos, justamente porque são registro
  histórico — a marca atual é a única válida (ver [NOTICE](../NOTICE)).
- **Uma spec concluída não é uma promessa.** Itens marcados como adiados ou
  recortados podem nunca ser feitos; o `ROADMAP.md` é a referência de intenção.

## Contribuindo

Você **não precisa** escrever uma spec para contribuir — correções e melhorias
pontuais vão direto por pull request, conforme o [CONTRIBUTING.md](../CONTRIBUTING.md).
Este formato existe para frentes de trabalho grandes o suficiente para se
beneficiarem de pesquisa e planejamento antes do código, e é opcional para quem
vem de fora.
