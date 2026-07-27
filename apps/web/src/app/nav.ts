import {
  LayoutDashboard,
  Users,
  KanbanSquare,
  FileText,
  ListTodo,
  FolderKanban,
  Wallet,
  FileSignature,
  UserCog,
  ShieldCheck,
  ScrollText,
  Trash2,
  type LucideIcon,
} from "lucide-react"

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  /**
   * Chaves de permissão do catálogo (`GET /permissions`). Basta **uma** delas
   * para o item aparecer — mesma semântica do `@RequirePermission` na API.
   * Sem `permission`, o item é visível para todos (ex.: Dashboard).
   */
  permission?: string[]
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
      { to: "/clientes", label: "Clientes", icon: Users, permission: ["cliente:ver", "cliente:gerenciar"] },
      { to: "/pipeline", label: "Pipeline", icon: KanbanSquare, permission: ["oportunidade:ver", "oportunidade:gerenciar"] },
      { to: "/propostas", label: "Propostas", icon: FileText, permission: ["proposta:ver", "proposta:gerenciar"] },
    ],
  },
  {
    label: "Operação",
    items: [
      { to: "/demandas", label: "Demandas", icon: ListTodo, permission: ["projeto:ver", "projeto:gerenciar", "demanda:gerenciar"] },
      { to: "/projetos", label: "Projetos", icon: FolderKanban, permission: ["projeto:ver", "projeto:gerenciar"] },
    ],
  },
  {
    label: "Financeiro",
    items: [
      { to: "/financeiro", label: "Financeiro", icon: Wallet, end: true, permission: ["financeiro:ver", "financeiro:gerenciar"] },
      { to: "/financeiro/contratos", label: "Contratos", icon: FileSignature, permission: ["financeiro:ver", "financeiro:gerenciar"] },
    ],
  },
  {
    label: "Organização",
    items: [
      { to: "/colaboradores", label: "Colaboradores", icon: UserCog, permission: ["colaborador:gerenciar"] },
      { to: "/papeis", label: "Papéis", icon: ShieldCheck, permission: ["papel:gerenciar"] },
      { to: "/auditoria", label: "Auditoria", icon: ScrollText, permission: ["auditoria:ver"] },
      { to: "/lixeira", label: "Lixeira", icon: Trash2, permission: ["lixeira:ver"] },
    ],
  },
]
