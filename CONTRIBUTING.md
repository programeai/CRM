# Contribuindo com o CRM ProgrameAi

Obrigado pelo interesse em contribuir! Este guia é curto e direto.

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
