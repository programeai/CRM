## O que muda

<!-- Uma ou duas frases: o que este PR faz e por quê. -->

## Como testar

<!-- Passos para verificar. Se houver UI, inclua print ou gif. -->

## Checklist

- [ ] Toda mensagem visível ao usuário está em **pt-BR** (validações, toasts,
      exceções da API, textos de UI)
- [ ] Nenhum enum de domínio aparece cru na interface (traduzido em `apps/web/src/lib/labels.ts`)
- [ ] Se mexi em controller, atualizei `apps/api/ENDPOINTS.md` neste mesmo PR
- [ ] Log novo usa `Logger`/`registrarLog` com `evento` em pt-BR, sem segredo e
      sem dado pessoal — nunca `console.log`
- [ ] `pnpm --filter api test` e `pnpm --filter api build` passam
- [ ] Mudança de modelo de dados começou em `prisma/schema.prisma` com migration
