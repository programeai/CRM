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
- **Sempre use os controles de formulário do design system (`src/components/ui`), nunca os elementos HTML nativos, quando existir um equivalente.** Regra absoluta: `<input>` → `Input`; `<select>` → `Select` (`SelectTrigger`/`SelectContent`/`SelectItem`); checkbox → `Checkbox`; e as variações prontas (`MoneyInput`, `PasswordInput`). Isso vale tanto em formulários quanto em filtros/toolbars. Só use um elemento nativo quando **ainda não houver** primitivo correspondente em `components/ui` (ex.: data/`type="date"` e `textarea` hoje); nesse caso, considere criar o primitivo antes de replicar o nativo. Código existente que use o nativo com equivalente disponível deve ser migrado.
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

### Formulários — campo obrigatório

- **Todo input obrigatório exibe um asterisco vermelho (`*`) na label.** Regra absoluta, sem exceção. Um campo é obrigatório quando o schema (Zod) não o marca como `.optional()` — inclui selects/enums sem valor "vazio".
- Use a prop `required` do `FieldLabel` (`@/components/ui/field`); ela renderiza o `*` em `text-destructive`. **Nunca** escreva o asterisco à mão no texto da label.

```tsx
<FieldLabel htmlFor="name" required>Nome</FieldLabel>   // correto
<FieldLabel htmlFor="name">Nome *</FieldLabel>          // errado
```

### Modais — nunca um modal sobre outro

- **É proibido abrir um modal por cima de outro.** Regra absoluta e geral da aplicação. Quando um modal abriria sobre outro, o de baixo é **soterrado** (ocultado visualmente, mas **montado** — preserva todo o estado de formulário) e volta ao topo intacto quando o de cima fecha. Se o de cima criou um item, o de baixo reaparece já com esse item preenchido no campo de origem (ex.: cadastro rápido de cliente no formulário de oportunidade).
- A regra é aplicada **automaticamente** pelos primitivos `Dialog` e `AlertDialog` (e, por consequência, `ConfirmDialog`), via a pilha global em `@/components/ui/modal-stack` (`ModalStackProvider` + `useStackedModal`). Qualquer modal novo deve usar esses primitivos — **não** monte diálogos com estado próprio fora deles.
