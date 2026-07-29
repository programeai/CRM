# Contribuindo com o ProgrameAi CRM

Obrigado pelo interesse em contribuir! Este guia é curto e direto.

Antes de começar, leia o [Código de Conduta](./.github/CODE_OF_CONDUCT.md).
Falha de segurança **não** vai em issue pública — ver
[SECURITY.md](./.github/SECURITY.md).

## Rodando o projeto

Siga o [Setup de desenvolvimento](./README.md#setup-de-desenvolvimento) do README.
Em resumo: `pnpm install`, `docker compose up -d`, copie os `.env.example`,
rode as migrations/seed e `pnpm dev`.

## Idioma das mensagens

**Toda mensagem visível ao usuário deve estar em português do Brasil (pt-BR).**
Isso abrange validações de formulário, toasts, exceções da API e textos de UI.
Regra completa em [CLAUDE.md](./CLAUDE.md). Código, tabelas e endpoints ficam em inglês.

## Padrão de commits

Mensagens em pt-BR no formato `tipo(escopo) descrição no imperativo` — por exemplo:

```
feat(clientes) adiciona filtro por status
fix(auth) corrige refresh de token expirado
docs(readme) documenta autohospedagem
```

Tipos comuns: `feat`, `fix`, `docs`, `refactor`, `chore`, `test`.

## Pull requests

- Abra uma issue antes de mudanças grandes, para alinhar a abordagem.
- Mantenha o PR focado em uma coisa; descreva o que muda e por quê.
- Se mexer em endpoints, atualize `apps/api/ENDPOINTS.md` no mesmo PR.
- Rode `pnpm --filter api build` e os testes antes de enviar.

## Licenciamento das contribuições

Ao enviar um PR, você concorda em licenciar sua contribuição sob a
**Apache License 2.0** (ver [LICENSE](./LICENSE)), a mesma licença do projeto.

## Código de conduta

Este projeto adota o [Código de Conduta](./.github/CODE_OF_CONDUCT.md)
(Contributor Covenant 2.1). Participar significa concordar com ele.

## Falhas de segurança

**Não abra issue pública.** Use o
[reporte privado de vulnerabilidade](https://github.com/programeai/CRM/security/advisories/new)
— detalhes em [SECURITY.md](./.github/SECURITY.md).
