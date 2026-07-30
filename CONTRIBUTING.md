# Contribuindo com o ProgrameAi CRM

Obrigado pelo interesse em contribuir! Este guia é curto e direto.

Antes de começar, leia o [Código de Conduta](./.github/CODE_OF_CONDUCT.md).
Falha de segurança **não** vai em issue pública — ver
[SECURITY.md](./.github/SECURITY.md).

## Rodando o projeto

Siga o [Setup de desenvolvimento](./README.md#setup-de-desenvolvimento) do README.
Em resumo: `pnpm install`, `docker compose up -d`, copie os `.env.example`,
rode as migrations/seed e `pnpm dev`.

## Por onde começar

As issues abertas saem do [ROADMAP.md](./ROADMAP.md), já recortadas em pedaços
que cabem num PR. Cada uma diz o contexto, os arquivos a mexer e o que precisa
estar pronto — você não precisa ler o roadmap inteiro para pegar uma.

- **[`good first issue`](https://github.com/programeai/CRM/labels/good%20first%20issue)**
  — escopo fechado e caminho já decidido. Comece por aqui.
- **[`help wanted`](https://github.com/programeai/CRM/labels/help%20wanted)** —
  maiores, mas com o desenho definido na issue.
- **[`epic`](https://github.com/programeai/CRM/labels/epic)** — issue
  guarda-chuva de uma fase. Não se pega uma delas; ela dá a ordem das filhas.
- **[`precisa de decisão`](https://github.com/programeai/CRM/labels/precisa%20de%20decis%C3%A3o)**
  — tem escolha de desenho em aberto. Comente a sua proposta na issue antes de
  codar, para não jogar trabalho fora.

As labels `área:` dizem onde a mudança cai (`api`, `web`, `banco`, `infra`,
`docs`) e as `esforço:` dão o tamanho (`P` de poucas horas a `G` de mais de três
dias ou decisão de arquitetura).

**Comente na issue antes de começar**, para ninguém duplicar trabalho — e
pergunte ali mesmo se algo não estiver claro. Se quiser trabalhar em algo que não
está listado, abra uma issue antes do PR.

## Idioma das mensagens

**Toda mensagem visível ao usuário deve estar em português do Brasil (pt-BR).**
Isso abrange validações de formulário, toasts, exceções da API e textos de UI.
Regra completa em [CLAUDE.md](./CLAUDE.md). Código, tabelas e endpoints ficam em inglês.

## Padrão de commits

Mensagens em pt-BR no formato `tipo(escopo): descrição no imperativo` — por exemplo:

```
feat(clientes): adiciona filtro por status
fix(auth): corrige refresh de token expirado
docs(readme): documenta autohospedagem
```

Tipos comuns: `feat`, `fix`, `docs`, `refactor`, `chore`, `test`.

## Pull requests

- Abra uma issue antes de mudanças grandes, para alinhar a abordagem.
- Mantenha o PR focado em uma coisa; descreva o que muda e por quê.
- Se mexer em endpoints, atualize `apps/api/ENDPOINTS.md` no mesmo PR.
- Rode `pnpm --filter api build` e os testes antes de enviar.

Ao abrir o PR, o workflow **CI - Pull request** roda sozinho: testes unitários e
e2e da API, validação das migrations contra um banco com dados, e o build das duas
imagens Docker (sem publicar nada). Os três checks precisam estar verdes para o
merge — e valem igual para PR vindo de fork, porque o CI não usa nenhum secret.

A `main` não aceita push direto de colaborador nem force-push: toda mudança entra
por PR.

## Licenciamento das contribuições

O projeto é distribuído sob a **[GNU AGPL v3](./LICENSE)**, e sua contribuição
entra no projeto sob essa licença.

Além disso, o projeto adota um **[CLA](./CLA.md)** (Acordo de Licença de
Contribuição). No seu primeiro PR, um bot vai pedir que você confirme o aceite
em um comentário — leva alguns segundos e vale para todos os PRs seguintes.
Correções triviais são dispensadas.

Em resumo: **você continua titular do seu código** e livre para usá-lo como
quiser; o CLA apenas dá ao mantenedor o direito de relicenciar o projeto como um
todo — o que viabiliza o licenciamento comercial sem precisar rastrear cada
contribuidor. Os detalhes e o texto integral estão em [CLA.md](./CLA.md).

## Código de conduta

Este projeto adota o [Código de Conduta](./.github/CODE_OF_CONDUCT.md)
(Contributor Covenant 2.1). Participar significa concordar com ele.

## Falhas de segurança

**Não abra issue pública.** Use o
[reporte privado de vulnerabilidade](https://github.com/programeai/CRM/security/advisories/new)
— detalhes em [SECURITY.md](./.github/SECURITY.md).
