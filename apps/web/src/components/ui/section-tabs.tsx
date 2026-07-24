import { NavLink, Outlet } from "react-router"
import { cn } from "@/lib/utils"

export interface SectionTabItem {
  label: string
  to: string
  end?: boolean
  /** Descrição curta da aba, exibida abaixo do título do conteúdo. */
  description?: string
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
