import {
  LayoutDashboard,
  Users,
  KanbanSquare,
  FileText,
  ListTodo,
  FolderKanban,
  Wallet,
  FileSignature,
  ShieldCheck,
  BookOpen,
  type LucideIcon,
} from "lucide-react"
import { ADMIN_PERMISSIONS } from "@/features/administracao/tabs"

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
  /** Todo grupo tem cabeçalho — é o padrão da sidebar, sem exceção. */
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
  // Configuração da workspace (colaboradores, papéis, catálogos, auditoria e
  // lixeira) vive atrás de uma entrada só — ver `features/administracao/tabs`.
  {
    label: "Sistema",
    items: [
      { to: "/administracao", label: "Administração", icon: ShieldCheck, permission: ADMIN_PERMISSIONS },
      // Sem `permission`: as páginas de integração são leitura, e quem cola a
      // URL do webhook no Slack não é quem administra a workspace.
      { to: "/ajuda", label: "Ajuda", icon: BookOpen },
    ],
  },
]
