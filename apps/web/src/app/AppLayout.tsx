import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useTheme } from "next-themes";
import { CreditCard, LogOut, Moon, Settings, Sun, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { BrandLockup } from "@/components/ui/brand-lockup";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth";
import { useMe } from "@/features/perfil/api/hooks";
import { SinoDeNotificacoes } from "@/features/notificacoes/SinoDeNotificacoes";
import { useSubscription } from "@/features/billing/useSubscription";
import { useCan } from "@/hooks/use-can";
import { formatDate } from "@/lib/format";
import { NAV_GROUPS } from "./nav";

export default function AppLayout() {
  const { logout } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { resolvedTheme, setTheme } = useTheme();
  // Evita mismatch de hidratação: só lemos o tema resolvido após montar.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === "dark";

  const { data: me } = useMe();
  const userLabel = me?.name ?? "Minha conta";
  const userInitial = userLabel.charAt(0).toUpperCase();

  // Billing só aparece na instância SaaS hospedada (billingEnabled=true).
  const { billingEnabled, isTrialing, daysLeftInTrial } = useSubscription();

  // Navegação por permissão: o item só aparece com uma das chaves exigidas, e
  // grupo que ficou sem item nenhum não é renderizado (ex.: Organização para
  // colaborador comum). O backend continua sendo a autoridade — isto é UI.
  const { can, canAny, isOwner } = useCan();
  const navGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => canAny(item.permission ?? [])),
  })).filter((group) => group.items.length > 0);

  const isActive = (to: string, end?: boolean) =>
    end || to === "/" ? pathname === to : pathname.startsWith(to);

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="p-0">
          <div className="flex h-14 items-center overflow-hidden border-b px-4 whitespace-nowrap group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-2">
            {/* Lockup oficial. Recolhida, a sidebar guarda só o símbolo. */}
            <BrandLockup textClassName="group-data-[collapsible=icon]:hidden" />
          </div>
        </SidebarHeader>
        <SidebarContent>
          {navGroups.map((group) => (
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
        {/* Encerramento agendado: acima do banner de trial — é a informação
            mais importante da tela, e vale para owner e colaborador. */}
        {me?.deletion && (
          <div className="flex w-full items-center justify-center gap-2 border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
            <TriangleAlert className="size-4 shrink-0" />
            <span>
              Esta conta será encerrada em {formatDate(me.deletion.scheduledFor)}
              . Todos os dados serão apagados e não será possível recuperá-los.
            </span>
            {isOwner && (
              <Button
                type="button"
                variant="link"
                className="h-auto p-0 text-destructive underline"
                onClick={() => navigate("/configuracoes/conta")}
              >
                Cancelar o encerramento
              </Button>
            )}
          </div>
        )}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background px-4">
          <SidebarTrigger className="size-9 [&_svg]:size-6 [&_svg]:stroke-[1.5]" />
          <div className="ml-auto flex items-center gap-1">
            <SinoDeNotificacoes />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full"
                    aria-label={
                      isDark ? "Ativar tema claro" : "Ativar tema escuro"
                    }
                    onClick={() => setTheme(isDark ? "light" : "dark")}
                  />
                }
              >
                {isDark ? <Sun /> : <Moon />}
              </TooltipTrigger>
              <TooltipContent>
                {isDark ? "Tema claro" : "Tema escuro"}
              </TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full"
                    aria-label="Menu do usuário"
                  />
                }
              >
                <Avatar>
                  <AvatarFallback>{userInitial}</AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="flex max-w-56 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium">
                    {userLabel}
                  </span>
                  {me?.email && (
                    <span className="truncate text-xs font-normal text-muted-foreground">
                      {me.email}
                    </span>
                  )}
                  {/* Colaborador vê o próprio papel — é o que explica por que
                      a navegação dele é menor que a de outra pessoa. */}
                  {me?.role && (
                    <span className="mt-1 truncate text-xs font-normal text-primary">
                      {me.role.name}
                    </span>
                  )}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("/configuracoes")}>
                  <Settings />
                  Configurações
                </DropdownMenuItem>
                {billingEnabled && can("assinatura:gerenciar") && (
                  <DropdownMenuItem onClick={() => navigate("/assinatura")}>
                    <CreditCard />
                    Assinatura
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  closeOnClick={false}
                  onClick={() => setTheme(isDark ? "light" : "dark")}
                >
                  {isDark ? <Sun /> : <Moon />}
                  {isDark ? "Tema claro" : "Tema escuro"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => logout()}>
                  <LogOut />
                  Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        {/* Aviso do teste só para quem pode assinar — colaborador não resolveria. */}
        {billingEnabled &&
          can("assinatura:gerenciar") &&
          isTrialing &&
          daysLeftInTrial != null && (
            <button
              type="button"
              onClick={() => navigate("/assinatura")}
              className="flex w-full items-center justify-center gap-2 border-b bg-primary/10 px-4 py-2 text-sm text-primary hover:bg-primary/15"
            >
              <CreditCard className="size-4" />
              {daysLeftInTrial > 0
                ? `Você está em período de teste — ${daysLeftInTrial} ${
                    daysLeftInTrial === 1 ? "dia restante" : "dias restantes"
                  }. Assine agora.`
                : "Seu período de teste terminou. Assine para continuar."}
            </button>
          )}
        <main className="min-w-0 flex-1 p-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
