# apps/web — Instruções do frontend (React + Vite)

## Idioma da interface

**Todo texto visível ao usuário deve estar em português do Brasil (pt-BR).** Sem exceção:

- Títulos de página, cards e diálogos
- Labels de formulário e placeholders
- Botões (incluindo estados de carregamento como "Salvando…")
- Cabeçalhos de tabela
- Mensagens de carregamento e erro de estado
- Badges e textos estáticos inline

Ao adicionar qualquer novo componente ou tela, escreva diretamente em pt-BR. Nunca escreva em inglês e depois traduza.

## Tradução de enums de domínio

Nunca renderize o identificador técnico de um enum (status, tipo de serviço, prioridade, etc.) diretamente. Use os tradutores de `@/lib/labels`:

```tsx
import { translateClientStatus } from '@/lib/labels';

{translateClientStatus(client.status)}  // correto → "Lead"
{client.status}                         // errado  → "LEAD"
```

Ao adicionar um novo valor de enum ao domínio (no `schema.prisma`), inclua a tradução correspondente em `src/lib/labels.ts` **no mesmo PR**.

---

## Arquitetura — regras obrigatórias

> Estas regras são a fonte de verdade (ver também o `CLAUDE.md` da raiz). Componente/feature novo nasce em conformidade; o que divergir deve ser **corrigido para respeitá-las**, nunca o contrário.

### Organização de pastas

```
src/
  app/          → layout, providers e guardas de rota (AppLayout, ProtectedRoute)
  routes/       → definição do router
  features/     → cada feature de negócio isolada (telas + lógica própria)
  components/ui → design system (componentes base shadcn / @base-ui)
  lib/          → clients, helpers e utilitários transversais (api, auth, labels, utils)
  hooks/        → hooks reutilizáveis
```

Uma feature não importa o interior de outra; reaproveitamento sobe para `components/ui` ou `lib/`.

### Stack de UI

- **`@base-ui/react` + shadcn (v4)** como primitivos. Os componentes base ficam em `src/components/ui`. **Não** reintroduza Radix.
- **Tailwind CSS v4** com tokens de tema em `src/index.css`. Estilos vêm dos tokens do design system (`bg-background`, `text-foreground`, `border-border`, `text-primary`, etc.) — evite cores hard-coded.
- Composição de classes sempre via `cn()` de `@/lib/utils`.
- Ícones: `lucide-react`.

### Estado

- **TanStack Query** para **estado de servidor** (cache, sincronização com a API). É a fonte de verdade dos dados remotos — nunca duplique dados do servidor em estado local.
- Estado de UI local fica em `useState`/`useReducer` ou contexto próprio da feature. Introduza um store global só com necessidade real e justificada.

### Comunicação com a API

- O cliente HTTP fica em `@/lib/api` (axios). A API roda sob o prefixo `/api/v1`.
- Autenticação: access token via header `Authorization: Bearer`; refresh via cookie `httpOnly` (transparente ao front). O contexto de auth vive em `@/lib/auth`.

### Design system

- Tema claro/escuro via `next-themes` e a classe `.dark`; os tokens (cores, raios, fonte) estão centralizados em `src/index.css`.
- A marca usa o **laranja Solarz** como acento (`--primary`); fundos são neutros cinza-frio (claro) / navy (escuro). Não tinja fundos com a cor de marca — use-a só para acento, foco e seleção.
- **Cursor de ponteiro em tudo que é clicável.** Todo elemento interativo (botão, link, item de menu/select, aba, switch, etc.) deve usar `cursor: pointer`. Isso já é garantido globalmente por uma regra em `src/index.css` (`@layer base`) que cobre elementos nativos e os primitivos `@base-ui` (via `role`). **Não** adicione `cursor-default` a elementos clicáveis nem anule a regra; elementos desabilitados (`disabled`/`aria-disabled`/`data-disabled`) são excluídos automaticamente e mantêm o cursor padrão.
