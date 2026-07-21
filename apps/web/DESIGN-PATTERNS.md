# Padrões de design — CRM Solarz

> Regras e padrões de UI portados do **Ecomerce-menager** e adaptados ao stack do CRM
> (`@base-ui/react` + shadcn v4, React 19, Tailwind v4). Esta é a **fonte de verdade**
> visual do frontend: componente/tela novo nasce em conformidade; o que divergir é
> corrigido para respeitá-la, nunca o contrário.
>
> Ver também `apps/web/CLAUDE.md` (regras de arquitetura e idioma) e os tokens de
> tema em `src/index.css`.

## Sumário

1. [Princípios de marca e tema](#1-princípios-de-marca-e-tema)
2. [Ícones](#2-ícones)
3. [Inputs — formato e estados](#3-inputs--formato-e-estados)
4. [Máscaras de input](#4-máscaras-de-input)
5. [Tabelas](#5-tabelas)
6. [Filtro e ordenação por coluna](#6-filtro-e-ordenação-por-coluna) ← padrão principal
7. [Formulários](#7-formulários)
8. [Feedback (toasts, diálogos, estados)](#8-feedback-toasts-diálogos-estados)
9. [Componentes incluídos](#9-componentes-incluídos)

---

## 1. Princípios de marca e tema

- **Laranja Solarz (`--primary`, `#fe5b00`) é acento**, não fundo. Use-o só para
  ações primárias, foco, seleção e destaque de estado ativo. Fundos são neutros
  cinza-frio (claro) / navy (escuro).
- **Nunca use cor hard-coded.** Sempre tokens do tema: `bg-background`,
  `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`,
  `bg-muted`, `text-destructive`, etc. Isso garante tema claro/escuro automático.
- **Composição de classes sempre via `cn()`** de `@/lib/utils` (nunca concatenação
  manual de strings de classe).
- **Cursor de ponteiro em tudo que é clicável** — já garantido globalmente por
  `@layer base` em `src/index.css`. Não adicione `cursor-default` a clicáveis.
- **Todo texto visível ao usuário em pt-BR**, sempre — incluindo `aria-label`,
  placeholders, cabeçalhos de tabela e mensagens de estado.
- **Enums de domínio nunca aparecem crus.** Traduza via `@/lib/labels`
  (`translateClientStatus`, `translateLeadSource`, …) antes de exibir.

## 2. Ícones

- Biblioteca única: **`lucide-react`**. Não misture outros conjuntos.
- Tamanho por classe utilitária, **não** por prop `size`: `className="size-4"`
  (padrão em ações), `size-3.5` (ícones dentro de cabeçalho/popover),
  `size-8 opacity-40` (estado vazio).
- Dentro de `<Button>`, ícones herdam `size-4` automaticamente; para posicioná-los
  use `data-icon="inline-start"` / `data-icon="inline-end"` (ajusta o padding do botão).
- Ícones puramente decorativos recebem `aria-hidden`; ícones-botão recebem `aria-label` em pt-BR.

Vocabulário de ícones já convencionado:

| Uso | Ícone |
|-----|-------|
| Filtro de coluna (funil) | `ListFilter` |
| Ordenação (neutra / asc / desc) | `ArrowUpDown` / `ArrowUp` / `ArrowDown` |
| Limpar / fechar | `X` |
| Estado vazio de tabela | `Inbox` |
| Criar novo | `Plus` |
| Senha (mostrar/ocultar) | `Eye` / `EyeOff` |
| Alerta / atenção | `AlertTriangle` |

## 3. Inputs — formato e estados

O `Input` base (`@/components/ui/input`) define o formato canônico de todos os campos:

- Altura **`h-10`**, cantos **`rounded-lg`**, borda `border-input`, fundo transparente.
- Foco: `focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50`.
- Inválido: dirigido por `aria-invalid` (`border-destructive` + ring destrutivo) —
  **nunca** pinte o erro na mão; deixe o `aria-invalid` fazer o trabalho.
- Desabilitado: `disabled:opacity-50 disabled:bg-input/50`.
- Campos numéricos/monetários usam `text-right tabular-nums` (ver `MoneyInput`).

Regras:

- Todo input de formulário passa por um `Field`/`Label` com o mesmo `id` (a11y).
- Placeholders são dicas em pt-BR, terminadas em reticências quando são exemplos de
  busca: `"Buscar por nome ou documento…"`.
- **Não** crie um `<input>` cru estilizado à mão — reaproveite `Input` ou derive dele.

## 4. Máscaras de input

Duas famílias de função, ambas em `@/lib/format`:

- **`format*`** — exibição de um valor **pronto** (só formata comprimentos válidos):
  `formatDocument`, `formatPhone`, `formatDate`, `formatDateTime`.
- **`mask*`** — máscara **progressiva**, aplicada **enquanto o usuário digita**
  (formata parciais e limita o comprimento): `maskCep`, `maskPhone`, `maskDocument`.

Regra de ouro: **persista sempre os dígitos crus** (sem pontuação) e formate só na
camada de exibição/digitação. Use `onlyDigits(value)` antes de enviar à API.

Padrão de uso num campo mascarado (mesmo padrão do Ecomerce — máscara inline no `onChange`):

```tsx
import { maskPhone, onlyDigits } from '@/lib/format';
import { Input } from '@/components/ui/input';

<Input
  inputMode="numeric"
  value={maskPhone(phone)}
  onChange={(e) => setPhone(onlyDigits(e.target.value))} // guarda cru
  placeholder="(00) 00000-0000"
/>
```

Com **`react-hook-form`**, o campo mascarado é **controlado** via `Controller` —
guarda os dígitos crus no estado e exibe o valor mascarado (ex.: cadastro de cliente):

```tsx
import { Controller } from 'react-hook-form';
import { maskDocument, onlyDigits } from '@/lib/format';

<Controller
  control={control}
  name="document"
  render={({ field }) => (
    <Input
      inputMode="numeric"
      placeholder="000.000.000-00"
      value={maskDocument(field.value ?? '')}       // exibe mascarado
      onChange={(e) => field.onChange(onlyDigits(e.target.value))} // guarda cru
      onBlur={field.onBlur}
    />
  )}
/>
```

Campos que seguem um padrão fixo também são normalizados a cada tecla — ex.: **UF**
(2 letras maiúsculas): `onChange={(e) => field.onChange(e.target.value.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 2))}`.

Para dinheiro, use o componente dedicado **`MoneyInput`** (`@/components/ui/money-input`),
que já trata centavos e devolve `number` em reais via `onValueChange`. Não reimplemente
máscara monetária na mão.

| Máscara | Formato | Comprimento |
|---------|---------|-------------|
| `maskCep` | `00000-000` | 8 dígitos |
| `maskPhone` | `(11) 99999-0000` / `(11) 3333-4444` | até 11 |
| `maskDocument` | `000.000.000-00` (CPF) / `00.000.000/0000-00` (CNPJ) | até 14 |
| `MoneyInput` | `R$ 1.234,56` | — |

## 5. Tabelas

Componível a partir de `@/components/ui/table` (`Table`, `TableHeader`, `TableBody`,
`TableRow`, `TableHead`, `TableCell`, `TableEmpty`).

- **Zebrado padrão do sistema** já embutido no `TableBody` (`nth-child(even)` recebe
  `bg-muted/40`); hover em `bg-muted/50`. Não replique zebra na mão.
- **Estado vazio** sempre via `<TableEmpty colSpan={n}>Nenhum … encontrado.</TableEmpty>`
  — mantém o cabeçalho visível e mostra ícone + mensagem em pt-BR.
- **Carregando**: linhas de `Skeleton` (`<Skeleton className="h-5 w-full" />`) com a
  mesma contagem de colunas, não um spinner solto.
- Tabela envolvida por um container `rounded-lg border` e, quando pode transbordar,
  `overflow-x-auto`.
- Link para o registro na primeira coluna via **`TableLink`** (`@/components/ui/table-link`).
- Ações da linha alinhadas à direita (`flex justify-end gap-2`), com `Button size="sm"`.

## 6. Filtro e ordenação por coluna

**Padrão principal do sistema.** Cabeçalhos de coluna que filtram/ordenam são
**popovers ancorados a um ícone** ao lado do rótulo — não selects soltos acima da
tabela. O ícone fica **destacado (`bg-primary/10 text-primary`) quando há filtro/ordem
ativa**, dando feedback imediato de que a coluna está restringindo os dados.

Dois componentes cobrem o padrão:

### `ColumnFilter` — filtro por coluna (ícone de funil `ListFilter`)

Recebe o conteúdo do filtro como `children` (rádios, checkboxes, multi-select, etc.),
uma flag `active` e um `onClear` opcional (o botão "Limpar filtro" só aparece quando ativo).

```tsx
import { ColumnFilter } from '@/components/ui/column-filter';

<TableHead>
  <ColumnFilter
    label="Status"
    active={status !== 'ALL'}
    onClear={() => setStatus('ALL')}
    contentClassName="w-52"
  >
    <div className="space-y-1">
      {STATUS_OPTIONS.map((opt) => (
        <label
          key={opt.value}
          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
        >
          <input
            type="radio"
            name="status-filter"
            checked={status === opt.value}
            onChange={() => setStatus(opt.value)}
            className="size-4 accent-primary"
          />
          {opt.label}
        </label>
      ))}
    </div>
  </ColumnFilter>
</TableHead>
```

### `ColumnSort` — ordenação por coluna (ícone `ArrowUpDown`/`ArrowUp`/`ArrowDown`)

Recebe as `options` (cada uma com `key` + `dir` + `label`), a chave/direção ativas e
`onChange`/`onClear`. O ícone reflete a direção quando esta coluna está ordenando.

```tsx
import { ColumnSort, type SortDir } from '@/components/ui/column-sort';

<TableHead>
  <ColumnSort
    label="Criado em"
    options={[
      { key: 'createdAt', dir: 'desc', label: 'Mais recentes' },
      { key: 'createdAt', dir: 'asc', label: 'Mais antigos' },
    ]}
    activeKey={sortKey}
    activeDir={sortDir}
    onChange={(key, dir) => { setSortKey(key); setSortDir(dir as SortDir); }}
    onClear={() => { setSortKey('createdAt'); setSortDir('desc'); }}
  />
</TableHead>
```

Convenções ao usar filtro/ordenação:

- Sempre **volte à primeira página** ao mudar um filtro/ordem (`setPage(1)`).
- `active` deve refletir fielmente se o filtro difere do padrão (ex.: `!== 'ALL'`,
  `array.length > 0`).
- Filtragem/paginação de datasets grandes acontece **no servidor** (parâmetros de
  query); filtros puramente client-side só sobre listas já carregadas.

> Nota de migração: a tela de Clientes tinha um `ColumnFilterHead` ad-hoc embutido
> (um `Select` estilizado no cabeçalho). Prefira **`ColumnFilter`/`ColumnSort`** deste
> design system em telas novas e, ao tocar telas antigas, migre para eles.

## 7. Formulários

- **`react-hook-form` + `zod`** (via `@hookform/resolvers`). O schema Zod é a fonte
  única de validação — não duplique regras no componente.
- Toda mensagem de validação **em pt-BR**, escrita direto no schema.
- Campos obrigatórios marcados com `*` — derivado do schema quando possível.
- Erros exibidos inline abaixo do campo (`text-sm text-destructive`), com o input
  recebendo `aria-invalid`.
- Botão de submit mostra estado pendente em pt-BR ("Salvando…") e fica `disabled`
  enquanto envia.

## 8. Feedback (toasts, diálogos, estados)

- **Toasts via `sonner`** (`toast.success` / `toast.error`), sempre em pt-BR. Sucesso
  curto ("Cliente criado"); erro extrai a mensagem da API com fallback pt-BR.
- **Confirmação destrutiva** via `ConfirmDialog` (`@/components/ui/confirm-dialog`):
  título como pergunta ("Excluir cliente?"), `confirmLabel`, `pendingLabel` e
  `destructive`. Nunca exclua sem confirmação.
- **Estado de erro de carregamento**: mensagem `text-destructive` + botão
  "Tentar novamente" que refaz a query.
- **Estado de carregamento**: `Skeleton` com o formato do conteúdo real.

## 9. Componentes incluídos

Portados/estendidos junto com este documento, já adaptados ao stack do CRM
(`@base-ui/react`, `@/components/ui`, `@/lib/utils`, estilo do design system):

| Arquivo | Papel |
|---------|-------|
| `src/components/ui/popover.tsx` | Popover base (base-ui) — dependência dos filtros de coluna |
| `src/components/ui/column-filter.tsx` | `ColumnFilter` — filtro por coluna com funil |
| `src/components/ui/column-sort.tsx` | `ColumnSort` — ordenação por coluna |
| `src/lib/format.ts` (estendido) | `maskCep`, `maskPhone`, `maskDocument`, `onlyDigits` |

Já existentes no CRM e alinhados a estes padrões: `input`, `money-input`,
`password-input`, `table`, `table-link`, `badge`, `button`, `select`, `dialog`,
`confirm-dialog`, `sonner`, `skeleton`.
