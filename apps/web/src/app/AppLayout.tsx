import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { useTheme } from "next-themes";
import { LogOut, Moon, Sun } from "lucide-react";
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
import { NAV_GROUPS } from "./nav";

export default function AppLayout() {
  const { logout } = useAuth();
  const { pathname } = useLocation();
  const { resolvedTheme, setTheme } = useTheme();
  // Evita mismatch de hidratação: só lemos o tema resolvido após montar.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === "dark";

  // Rótulo do usuário: sem endpoint /auth/me ainda; genérico por ora.
  const userLabel = "Minha conta";
  const userInitial = userLabel.charAt(0).toUpperCase();

  const isActive = (to: string, end?: boolean) =>
    end || to === "/" ? pathname === to : pathname.startsWith(to);

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex h-8 items-center px-2 text-lg font-semibold group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
            <span className="group-data-[collapsible=icon]:hidden">
              CRM ProgrameAi
            </span>
            <span className="hidden text-base group-data-[collapsible=icon]:inline">
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
          <SidebarTrigger />
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
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="max-w-48 truncate">
                  {userLabel}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
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
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
