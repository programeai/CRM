import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useTheme } from "next-themes";
import { CreditCard, LogOut, Moon, Sun, UserRound } from "lucide-react";
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
import { useSubscription } from "@/features/billing/useSubscription";
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

  const isActive = (to: string, end?: boolean) =>
    end || to === "/" ? pathname === to : pathname.startsWith(to);

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="p-0">
          <div className="flex h-14 items-center overflow-hidden border-b px-4 text-base font-semibold whitespace-nowrap group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-2">
            <span className="group-data-[collapsible=icon]:hidden">
              CRM ProgrameAi
            </span>
            <span className="hidden group-data-[collapsible=icon]:inline">
              CRM
            </span>
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
          <SidebarTrigger className="size-9 [&_svg]:size-6 [&_svg]:stroke-[1.5]" />
          <div className="ml-auto flex items-center gap-1">
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
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("/perfil")}>
                  <UserRound />
                  Perfil
                </DropdownMenuItem>
                {billingEnabled && (
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
        {billingEnabled && isTrialing && daysLeftInTrial != null && (
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
