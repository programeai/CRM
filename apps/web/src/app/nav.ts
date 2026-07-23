import {
  LayoutDashboard,
  Users,
  KanbanSquare,
  FileText,
  ListTodo,
  FolderKanban,
  Wallet,
  FileSignature,
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
  {
    label: "Operação",
    items: [
      { to: "/demandas", label: "Demandas", icon: ListTodo },
      { to: "/projetos", label: "Projetos", icon: FolderKanban },
    ],
  },
  {
    label: "Financeiro",
    items: [
      { to: "/financeiro", label: "Financeiro", icon: Wallet, end: true },
      { to: "/financeiro/contratos", label: "Contratos", icon: FileSignature },
    ],
  },
]
