---
date: 2026-07-21T00:00:00-03:00
author: claude
source_prd: standalone
git_commit: 1cb38d2b8651265a3e302d79f5c68ab4370dd86b
branch: main
status: implemented
tags: [spec, web, design-system, app-shell]
---

# Spec: Alinhar a interface do CRM ao painel admin do Ecomerce-menager (shell + design system base)

## Overview

O CRM (`apps/web`) deve reproduzir as **características e padrões** do painel admin do Ecomerce-menager
(`apps/web`), porém **reimplementados no stack atual do CRM**: `@base-ui/react` + shadcn v4 + React 19 +
Tailwind v4. É proibido reintroduzir Radix (regra do `apps/web/CLAUDE.md` do CRM).

A linguagem visual (tokens de tema, marca laranja Solarz, escala 112.5%, `.rich-text-content`) **já está
alinhada** — o `src/index.css` do CRM é uma port fiel do `globals.css` do Ecomerce. O que falta é
**maturidade de shell e de biblioteca de componentes**: o CRM tem ~16 componentes base e um `AppLayout`
raso; o Ecomerce tem um AppShell completo (sidebar agrupada colapsável, topbar com menu de usuário) e
~40 componentes.

Esta rodada cobre **SHELL + DESIGN SYSTEM BASE**. Portamos os componentes de UI essenciais que faltam e
reescrevemos o `AppLayout` para reproduzir o AppShell do Ecomerce usando o bloco `sidebar.tsx` que o CRM
**já possui**. Não implementamos páginas de negócio.

## Current State

- `src/components/ui/`: `button`, `card`, `checkbox`, `empty`, `field`, `input`, `label`, `money-input`,
  `password-input`, `separator`, `sheet`, `sidebar`, `skeleton`, `sonner`, `spinner`, `tooltip`.
- `src/app/AppLayout.tsx`: usa o bloco `sidebar` de forma rasa — NAV plana (sem grupos), sem colapso para
  ícone, sem menu de usuário (apenas botão "Sair" na topbar).
- `src/main.tsx`: providers `QueryClientProvider`, `AuthProvider`, `TooltipProvider`, `Toaster`. **Sem**
  `ThemeProvider` (dark mode documentado mas inoperante).
- `src/lib/auth.tsx`: `useAuth()` expõe `isAuthenticated`, `loading`, `login`, `logout`. **Sem dados do
  usuário** (nome/email).
- Idioma de componentes @base-ui do CRM (molde a seguir): wrapper sobre `@base-ui/react/<primitivo>`,
  `data-slot`, `cn()`, e para polimorfismo `useRender` + `mergeProps` (ver `tooltip.tsx`, `sheet.tsx`,
  `sidebar.tsx`).

Referência de padrões (Ecomerce, somente leitura): `apps/web/src/shared/ui/shell/AppShell.tsx` e
`apps/web/src/shared/ui/{badge,table,table-link,stat-card,section-tabs,confirm-dialog}.tsx`.

## Desired End State

- `src/components/ui/` ganha: `badge`, `table` (+ `TableEmpty`), `table-link`, `stat-card`, `section-tabs`,
  `avatar`, `dropdown-menu`, `dialog`, `alert-dialog`, `select`, `tabs`, `confirm-dialog`.
- `src/app/AppLayout.tsx` reproduz o AppShell do Ecomerce: NAV **agrupada** por seção, colapso para ícone
  com tooltip, drawer mobile, topbar com rótulo de contexto + **menu de usuário** (Avatar + DropdownMenu).
- Dark mode funcional: `ThemeProvider` (next-themes) no `main.tsx` + toggle no menu de usuário.
- `tsc -b` e `oxlint` passam; todos os textos visíveis em pt-BR; cores só via tokens; classes via `cn()`.

## What We're NOT Doing

- **Não** portamos `form.tsx` (padrão `FormField`+context/Radix do Ecomerce). O CRM já tem o sistema
  `Field*` (shadcn v4) em `field.tsx`; formulários usam `Field*` + `react-hook-form` diretamente. Portar o
  `form.tsx` seria retroceder de stack.
- **Não** portamos componentes avançados do Ecomerce fora do escopo desta rodada: `combobox`, `multi-select`,
  `column-filter`, `column-sort`, `period-filter`, `currency-input` (o CRM já tem `money-input`),
  `rich-text-editor`, `media-uploader`, `video-uploader`, `calendar`, `switch`, `popover`, `Can`,
  `ImpersonationNotice`.
- **Não** implementamos RBAC/`useCan`. O CRM é single-tenant; a nav e o `section-tabs` ficam **preparados**
  (campo `permission` opcional aceito e ignorado) mas **sem exigir** permissão.
- **Não** buscamos dados reais do usuário (`/auth/me` não existe). O menu de usuário usa rótulo genérico
  ("Minha conta"); o rótulo é uma prop pronta para receber nome/email quando o endpoint existir.
- **Não** implementamos páginas de negócio (Dashboard, Clientes, etc. seguem como `PlaceholderPage`).
- **Não** mexemos no tema (`index.css`) nem em `apps/api`.

---

## Phase 1: Componentes de apresentação (HTML/cva, baixo risco)

### Goal
Portar os componentes puramente visuais do Ecomerce, adaptados ao CRM (imports, router, sem `useCan`).

### Changes

#### Badge

**Create**: `apps/web/src/components/ui/badge.tsx`
Port do Ecomerce, mantendo `cva` + variantes. Sem mudança de API.
```tsx
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive: "border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80",
        outline: "text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
)

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
```
> Nota: o Ecomerce usa `<div>`; no CRM usamos `<span>` (semântica inline de badge) e `data-slot`, mantendo o padrão dos demais componentes do CRM.

#### Table (+ TableEmpty)

**Create**: `apps/web/src/components/ui/table.tsx`
Port quase verbatim do Ecomerce (`Table`, `TableHeader`, `TableBody`, `TableFooter`, `TableRow`,
`TableHead`, `TableCell`, `TableCaption`, `TableEmpty`). Trocar `@/shared/lib/utils` → `@/lib/utils`.
Manter zebrado (`[&_tr:nth-child(even)]:bg-muted/40`), hover e `data-[state=selected]`. Trocar
`React.forwardRef` por componentes de função com `data-slot` (padrão React 19 do CRM — não use `forwardRef`;
ref é prop normal). `TableEmpty` mantém `colSpan`, `icon` (default `Inbox`) e `children` (mensagem pt-BR).

#### TableLink

**Create**: `apps/web/src/components/ui/table-link.tsx`
Port do Ecomerce. **Ajuste crítico de import**: `react-router-dom` → `react-router` (o CRM usa
react-router v7 unificado — ver `AppLayout.tsx`). Mantém `stopPropagation` no `onClick`.
```tsx
import * as React from "react"
import { Link, type LinkProps } from "react-router"
import { cn } from "@/lib/utils"

function TableLink({ className, onClick, ...props }: LinkProps) {
  return (
    <Link
      data-slot="table-link"
      className={cn(
        "rounded-sm font-medium text-foreground transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
        className,
      )}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.(e)
      }}
      {...props}
    />
  )
}

export { TableLink }
```

#### StatCard

**Create**: `apps/web/src/components/ui/stat-card.tsx`
Port do Ecomerce compondo `Card`/`CardHeader`/`CardContent`/`CardTitle` (APIs idênticas às do CRM). Trocar
import de utils. Mantém `label`, `value`, `hint`, `tone` (`default|positive|warning|danger`), `icon`.

#### SectionTabs

**Create**: `apps/web/src/components/ui/section-tabs.tsx`
Port do Ecomerce (`SectionTabs`, `SectionTabsLayout`, tipo `SectionTabItem`). **Ajustes**:
`react-router-dom` → `react-router`; **remover** `useCan`/gating — manter o campo `permission?` no tipo
(aceito e ignorado) para compatibilidade futura, sem filtrar. Mantém o padrão de aba com borda inferior
`[&.active]:border-primary`.
```tsx
import { NavLink, Outlet } from "react-router"
import { cn } from "@/lib/utils"

export interface SectionTabItem {
  label: string
  to: string
  end?: boolean
  /** Reservado para RBAC futuro; hoje ignorado (CRM é single-tenant). */
  permission?: string | string[]
}

function SectionTabLink({ item }: { item: SectionTabItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={cn(
        "inline-flex items-center justify-center rounded-t-md border-b-2 border-transparent px-3 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-primary/5 hover:text-primary",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
        "[&.active]:border-primary [&.active]:text-primary",
      )}
    >
      {item.label}
    </NavLink>
  )
}

export function SectionTabs({ items }: { items: SectionTabItem[] }) {
  return (
    <nav className="-mb-[2px] flex items-center gap-2">
      {items.map((item) => (
        <SectionTabLink key={item.to} item={item} />
      ))}
    </nav>
  )
}

export function SectionTabsLayout({ items }: { items: SectionTabItem[] }) {
  return (
    <div>
      <div className="px-6 pt-4">
        <div className="border-b-2">
          <SectionTabs items={items} />
        </div>
      </div>
      <Outlet />
    </div>
  )
}
```

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter web exec tsc -b` — compila sem erros de tipo.
- [x] `pnpm --filter web lint` (oxlint) — sem erros.
- [x] `grep -rn "shared/lib/utils\|react-router-dom\|useCan" apps/web/src/components/ui` — **sem** ocorrências (imports adaptados).

#### Manual Verification
- [ ] Renderizar `Badge`, `Table` (com `TableEmpty`), `StatCard` numa rota placeholder confirma aparência idêntica ao Ecomerce (zebrado, tons de KPI, badge laranja).

**⏸ PAUSE**: Após a verificação automatizada passar, parar para confirmação humana antes da Fase 2.

---

## Phase 2: Primitivos interativos @base-ui

### Goal
Reimplementar, no idioma @base-ui/shadcn v4 do CRM, os primitivos que no Ecomerce são Radix, e o
`confirm-dialog` que os compõe.

> Idioma obrigatório (ver `tooltip.tsx`/`sheet.tsx`): wrapper sobre `@base-ui/react/<primitivo>`; overlays
> montam `Portal > Positioner > Popup` (menu/select) ou `Portal > Backdrop > Popup` (dialog); `data-slot`
> em cada parte; animação via `data-open`/`data-closed`/`data-starting-style`/`data-ending-style`
> (tw-animate-css); `cn()` sempre. **Não** usar `forwardRef`. Alternativa aceita: gerar via
> `pnpm --filter web exec shadcn@latest add <componente>` e depois conformar ao idioma acima.

### Changes

#### Avatar

**Create**: `apps/web/src/components/ui/avatar.tsx` — sobre `@base-ui/react/avatar`.
```tsx
import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar"
import { cn } from "@/lib/utils"

function Avatar({ className, ...props }: AvatarPrimitive.Root.Props) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn("relative flex size-8 shrink-0 overflow-hidden rounded-full select-none", className)}
      {...props}
    />
  )
}

function AvatarImage({ className, ...props }: AvatarPrimitive.Image.Props) {
  return <AvatarPrimitive.Image data-slot="avatar-image" className={cn("aspect-square size-full", className)} {...props} />
}

function AvatarFallback({ className, ...props }: AvatarPrimitive.Fallback.Props) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn("flex size-full items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground", className)}
      {...props}
    />
  )
}

export { Avatar, AvatarImage, AvatarFallback }
```

#### DropdownMenu

**Create**: `apps/web/src/components/ui/dropdown-menu.tsx` — sobre `@base-ui/react/menu`.
Exports mínimos consumidos pelo shell: `DropdownMenu` (`Menu.Root`), `DropdownMenuTrigger`
(`Menu.Trigger`), `DropdownMenuContent` (`Menu.Portal`>`Menu.Positioner`>`Menu.Popup`),
`DropdownMenuItem` (`Menu.Item`), `DropdownMenuLabel` (`Menu.GroupLabel` ou `<div>`),
`DropdownMenuSeparator` (`Menu.Separator`). `DropdownMenuContent` aceita `align`/`side`/`sideOffset`
(default `align="end"`, `sideOffset={4}`), repassados ao `Positioner`.
```tsx
"use client"
import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { cn } from "@/lib/utils"

function DropdownMenu(props: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuTrigger(props: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuContent({
  className,
  align = "end",
  side = "bottom",
  sideOffset = 4,
  ...props
}: MenuPrimitive.Popup.Props &
  Pick<MenuPrimitive.Positioner.Props, "align" | "side" | "sideOffset">) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner align={align} side={side} sideOffset={sideOffset} className="isolate z-50">
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            "min-w-[8rem] origin-(--transform-origin) overflow-hidden rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function DropdownMenuItem({ className, ...props }: MenuPrimitive.Item.Props) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  )
}

function DropdownMenuLabel({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dropdown-menu-label" className={cn("px-2 py-1.5 text-sm font-medium", className)} {...props} />
}

function DropdownMenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
  return <MenuPrimitive.Separator data-slot="dropdown-menu-separator" className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />
}

export {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
}
```
> `data-highlighted` é o atributo do @base-ui/menu para o item sob foco de teclado/hover. Confirmar contra a
> versão instalada (`@base-ui/react@^1.6.0`); se divergir, ajustar o seletor mantendo a aparência.

#### Dialog

**Create**: `apps/web/src/components/ui/dialog.tsx` — sobre `@base-ui/react/dialog` (mesmo primitivo do
`sheet.tsx`, mas centralizado). Exports: `Dialog`, `DialogTrigger`, `DialogClose`, `DialogContent`
(Portal>Backdrop>Popup centralizado, com botão fechar `XIcon`), `DialogHeader`, `DialogFooter`,
`DialogTitle`, `DialogDescription`. Reaproveitar as classes de backdrop/animação do `sheet.tsx`; Popup
centralizado com `fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg rounded-xl border bg-popover p-6`.

#### AlertDialog

**Create**: `apps/web/src/components/ui/alert-dialog.tsx` — sobre `@base-ui/react/alert-dialog`. Exports:
`AlertDialog`, `AlertDialogTrigger`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogFooter`,
`AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogCancel` (render de `Button variant="outline"`),
`AlertDialogAction` (render de `Button`). Estrutura de overlay igual à do `Dialog`.

#### Select

**Create**: `apps/web/src/components/ui/select.tsx` — sobre `@base-ui/react/select`. Exports: `Select`
(`Select.Root`), `SelectTrigger` (`Select.Trigger` com `Select.Value` + `ChevronDownIcon`), `SelectContent`
(Portal>Positioner>Popup), `SelectItem` (`Select.Item` com `Select.ItemIndicator`+`CheckIcon` e
`Select.ItemText`), `SelectGroup`, `SelectLabel` (`Select.GroupLabel`), `SelectSeparator`. Trigger estilizado
como `input` (altura `h-10`, borda, foco com `ring`).

#### Tabs

**Create**: `apps/web/src/components/ui/tabs.tsx` — sobre `@base-ui/react/tabs`. Exports: `Tabs`
(`Tabs.Root`), `TabsList` (`Tabs.List`, fundo `bg-muted` arredondado), `TabsTrigger` (`Tabs.Tab`, ativo
`data-selected:bg-background data-selected:shadow-sm`), `TabsContent` (`Tabs.Panel`). Este é o padrão de abas
"segmented" (in-page); o `section-tabs` (Fase 1) é o de navegação por rota.

#### ConfirmDialog

**Create**: `apps/web/src/components/ui/confirm-dialog.tsx`
Port do Ecomerce compondo o `alert-dialog` acima. Trocar imports para `@/components/ui/*`. Manter props e
textos pt-BR (`confirmLabel="Confirmar"`, `pendingLabel="Processando…"`, `Cancelar`, `destructive`).

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter web exec tsc -b` — sem erros de tipo (APIs @base-ui corretas).
- [x] `pnpm --filter web lint` — sem erros.
- [x] `grep -rn "@radix-ui\|forwardRef" apps/web/src/components/ui` — **sem** ocorrências.

#### Manual Verification
- [ ] Numa rota placeholder, `DropdownMenu` abre/fecha e navega por teclado; `Select` seleciona; `Dialog` e
      `ConfirmDialog` abrem/fecham com backdrop e Esc; `Tabs` alterna painéis; `Avatar` mostra o fallback.
- [ ] Aparência (raios, sombras, cores) consistente com o tema Solarz em claro e escuro.

**⏸ PAUSE**: Parar para confirmação humana antes da Fase 3.

---

## Phase 3: Reescrever o AppLayout no padrão AppShell do Ecomerce

### Goal
`AppLayout` reproduz o AppShell do Ecomerce (nav agrupada, colapso para ícone com tooltip, drawer mobile,
topbar com contexto + menu de usuário) usando o bloco `sidebar.tsx` já existente.

### Changes

#### Tipos e dados de navegação

**Create**: `apps/web/src/app/nav.ts`
Modela a navegação como grupos, espelhando `NavGroup[]`/`NavItem` do Ecomerce (com `permission?` reservado
e ignorado).
```tsx
import {
  LayoutDashboard, Users, KanbanSquare, FileText, ListTodo, Wallet, FileSignature,
  type LucideIcon,
} from "lucide-react"

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  /** Reservado para RBAC futuro; hoje ignorado. */
  permission?: string
}
export interface NavGroup {
  label: string
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  { label: "Geral", items: [{ to: "/", label: "Dashboard", icon: LayoutDashboard, end: true }] },
  {
    label: "Comercial",
    items: [
      { to: "/clientes", label: "Clientes", icon: Users },
      { to: "/pipeline", label: "Pipeline", icon: KanbanSquare },
      { to: "/propostas", label: "Propostas", icon: FileText },
    ],
  },
  { label: "Operação", items: [{ to: "/demandas", label: "Demandas", icon: ListTodo }] },
  {
    label: "Financeiro",
    items: [
      { to: "/financeiro", label: "Financeiro", icon: Wallet, end: true },
      { to: "/financeiro/contratos", label: "Contratos", icon: FileSignature },
    ],
  },
]
```

#### AppLayout

**Modify**: `apps/web/src/app/AppLayout.tsx` (reescrita completa)
Reproduz o AppShell do Ecomerce sobre o bloco `sidebar` do CRM:
- `<Sidebar collapsible="icon">` → colapso desktop para ícone (equivalente ao w-60/w-20 do Ecomerce);
  drawer mobile já embutido no bloco.
- `SidebarHeader` com marca "CRM Solarz" (colapsada mostra a inicial "C" via
  `group-data-[collapsible=icon]`).
- Para cada `NavGroup`: `SidebarGroup` + `SidebarGroupLabel` (some ao colapsar) + `SidebarMenu`. Cada item é
  `SidebarMenuButton` com `tooltip={item.label}` (o bloco já esconde o tooltip quando expandido/mobile) e
  `render={<NavLink to={item.to} end={item.end} />}`; ativo via `isActive` (comparando `pathname`).
- `SidebarInset` com topbar: `SidebarTrigger` (recolher/expandir e abrir drawer no mobile) + `Separator`
  vertical + rótulo de contexto ("CRM Solarz" ou nome do módulo atual) + `ml-auto` com o **menu de usuário**.
- Menu de usuário: `DropdownMenu` cujo trigger é um `Button` redondo com `Avatar`/`AvatarFallback`
  (inicial); conteúdo com `DropdownMenuLabel` (rótulo do usuário, default "Minha conta"),
  `DropdownMenuSeparator`, item "Sair" (`LogOut`) chamando `logout()`.
```tsx
import { NavLink, Outlet, useLocation } from "react-router"
import { LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarProvider, SidebarTrigger,
} from "@/components/ui/sidebar"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAuth } from "@/lib/auth"
import { NAV_GROUPS } from "./nav"

export default function AppLayout() {
  const { logout } = useAuth()
  const { pathname } = useLocation()
  // Rótulo do usuário: sem endpoint /auth/me ainda; genérico por ora.
  const userLabel = "Minha conta"
  const userInitial = userLabel.charAt(0).toUpperCase()

  const isActive = (to: string, end?: boolean) =>
    end || to === "/" ? pathname === to : pathname.startsWith(to)

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex h-8 items-center px-2 text-lg font-semibold group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
            <span className="group-data-[collapsible=icon]:hidden">CRM Solarz</span>
            <span className="hidden group-data-[collapsible=icon]:inline">C</span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          {NAV_GROUPS.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton
                        isActive={isActive(item.to, item.end)}
                        tooltip={item.label}
                        render={<NavLink to={item.to} end={item.end} />}
                      >
                        <item.icon data-icon="inline-start" />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
      </Sidebar>

      <SidebarInset>
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-6" />
          <span className="truncate text-sm font-medium">CRM Solarz</span>
          <div className="ml-auto flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="icon" className="rounded-full" aria-label="Menu do usuário" />
                }
              >
                <Avatar>
                  <AvatarFallback>{userInitial}</AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="max-w-[12rem] truncate">{userLabel}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => logout()}>
                  <LogOut />
                  Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
```
> `SidebarTrigger` unifica o comportamento que no Ecomerce eram dois botões (recolher desktop / abrir drawer
> mobile): o bloco `sidebar` do CRM já alterna `open` no desktop e `openMobile` no mobile.

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter web exec tsc -b` — sem erros.
- [x] `pnpm --filter web lint` — sem erros.

#### Manual Verification
- [ ] Desktop: sidebar mostra 4 grupos rotulados; `SidebarTrigger` colapsa para ícones; itens colapsados
      exibem tooltip com o label; item ativo destacado ao navegar.
- [ ] Mobile (viewport estreito): `SidebarTrigger` abre a sidebar como drawer (Sheet); navegar fecha o drawer.
- [ ] Topbar: menu de usuário abre com Avatar; "Sair" chama `logout()` e redireciona ao login.
- [ ] Rotas atuais (`/`, `/clientes`, `/pipeline`, `/propostas`, `/demandas`, `/financeiro`,
      `/financeiro/contratos`) continuam acessíveis.

**⏸ PAUSE**: Parar para confirmação humana antes da Fase 4.

---

## Phase 4 (opcional): Dark mode funcional

### Goal
Tornar o tema claro/escuro operante (documentado no design system, hoje sem `ThemeProvider`) e oferecer um
toggle no menu de usuário.

### Changes

**Modify**: `apps/web/src/main.tsx`
Envolver a árvore com o `ThemeProvider` do `next-themes` aplicando a classe `.dark` (o `index.css` usa
`@custom-variant dark (&:is(.dark *))`).
```tsx
import { ThemeProvider } from "next-themes"
// ...
<QueryClientProvider client={queryClient}>
  <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
    <AuthProvider>
      <TooltipProvider>
        <RouterProvider router={router} />
        <Toaster />
      </TooltipProvider>
    </AuthProvider>
  </ThemeProvider>
</QueryClientProvider>
```

**Modify**: `apps/web/src/app/AppLayout.tsx`
Adicionar, no `DropdownMenuContent` do menu de usuário (acima do separador de "Sair"), um item de alternância
de tema usando `useTheme` do `next-themes` e ícones `Sun`/`Moon` (lucide). Alterna entre `"light"` e
`"dark"`; texto pt-BR ("Tema claro" / "Tema escuro"). Evitar mismatch de hidratação lendo `resolvedTheme`
somente após montar (guarda `mounted`).

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter web exec tsc -b` — sem erros.
- [x] `pnpm --filter web lint` — sem erros.

#### Manual Verification
- [ ] Alternar no menu troca claro/escuro; a preferência persiste ao recarregar (localStorage do next-themes).
- [ ] Sidebar, topbar e componentes das Fases 1–2 respeitam ambos os temas (tokens navy no escuro).

**⏸ PAUSE**: Fim do escopo desta rodada.

---

## Testing Strategy

### Unit Tests
- Não há suíte de testes de front configurada no CRM (o `package.json` do `web` não tem script `test`;
  diferente do Ecomerce, que usa vitest). Esta rodada **não** introduz framework de testes — a verificação é
  `tsc -b` + `oxlint` + verificação manual por fase. Introduzir vitest fica para uma rodada futura.

### Integration Tests
- Fluxo manual ponta a ponta: login → shell carrega → navegar entre grupos → colapsar/expandir sidebar →
  abrir menu de usuário → (Fase 4) alternar tema → "Sair".

### Migration & Rollback
- Sem migração de dados (apenas frontend). Rollback = reverter os commits das fases; cada fase é
  independente e não altera contratos de API.

## Environment Considerations
- **CI/CD**: sem novos passos; `tsc -b` e `oxlint` já são os gates do `web`.
- **Migrations**: nenhuma.
- **Config/Secrets**: nenhum novo env var.
- **Multi-environment**: sem diferença dev/prod.

## Dependencies & Risks
- Todas as dependências necessárias já estão no `apps/web/package.json`: `@base-ui/react@^1.6.0`,
  `next-themes@^0.4.6`, `react-hook-form`, `@hookform/resolvers`, `class-variance-authority`,
  `lucide-react`, `react-router@^7`. **Nenhuma instalação nova.**
- **Risco (Fase 2):** nomes exatos de subcomponentes/atributos do `@base-ui/react` (ex.: `data-highlighted`
  do Menu, estrutura de `Select`) podem variar na versão instalada. Mitigação: conferir contra
  `node_modules/@base-ui/react` (ou os componentes existentes `tooltip.tsx`/`sheet.tsx`/`sidebar.tsx` que já
  usam Menu/Dialog/Tooltip) e, em último caso, gerar via `shadcn@latest add` e conformar ao idioma.
- **Risco (Fase 3):** `SidebarMenuButton` recebe `NavLink` via `render` — garantir que a classe `.active`
  do NavLink e o `isActive` do botão não conflitem (usar `isActive` como fonte do destaque; o NavLink cuida
  só do `href`/navegação).

## References
- Referência de padrões (somente leitura): `Ecomerce-menager/apps/web/src/shared/ui/shell/AppShell.tsx`,
  `.../shared/ui/{badge,table,table-link,stat-card,section-tabs,confirm-dialog}.tsx`.
- Regras do CRM: `CRM/apps/web/CLAUDE.md` (stack @base-ui, proibição de Radix, pt-BR, tokens de tema).
- Molde de idioma @base-ui no CRM: `CRM/apps/web/src/components/ui/{tooltip,sheet,sidebar}.tsx`.
