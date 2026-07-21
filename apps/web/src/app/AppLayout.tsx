import { NavLink, Outlet, useLocation } from 'react-router';
import {
  LayoutDashboard,
  Users,
  KanbanSquare,
  FileText,
  ListTodo,
  Wallet,
  FileSignature,
  LogOut,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { useAuth } from '@/lib/auth';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/clientes', label: 'Clientes', icon: Users },
  { to: '/pipeline', label: 'Pipeline', icon: KanbanSquare },
  { to: '/propostas', label: 'Propostas', icon: FileText },
  { to: '/demandas', label: 'Demandas', icon: ListTodo },
  { to: '/financeiro', label: 'Financeiro', icon: Wallet },
  { to: '/financeiro/contratos', label: 'Contratos', icon: FileSignature },
];

export default function AppLayout() {
  const { logout } = useAuth();
  const { pathname } = useLocation();

  const isActive = (to: string) => (to === '/' ? pathname === '/' : pathname.startsWith(to));

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <div className="px-2 py-1 text-lg font-semibold">CRM Solarz</div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Navegação</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV.map((n) => (
                  <SidebarMenuItem key={n.to}>
                    <SidebarMenuButton
                      isActive={isActive(n.to)}
                      tooltip={n.label}
                      render={<NavLink to={n.to} end={n.to === '/'} />}
                    >
                      <n.icon data-icon="inline-start" />
                      <span>{n.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-6" />
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={() => logout()}>
            <LogOut data-icon="inline-start" />
            Sair
          </Button>
        </header>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
