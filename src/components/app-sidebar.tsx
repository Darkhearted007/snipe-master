import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  ListChecks,
  ScrollText,
  Settings,
  ShieldCheck,
  Star,
  Target,
  UserCog,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useBotStore } from "@/lib/bot-store";
import { useHasRole } from "@/hooks/use-auth-session";
import { StatusDot } from "./status-dot";

const nav = [
  { title: "Overview", url: "/", icon: Activity },
  { title: "Trades", url: "/trades", icon: ListChecks },
  { title: "Watchlist", url: "/watchlist", icon: Star },
  { title: "Safety", url: "/safety", icon: ShieldCheck },
  { title: "Logs", url: "/logs", icon: ScrollText },
  { title: "Settings", url: "/settings", icon: Settings },
] as const;

export function AppSidebar() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const mode = useBotStore((s) => s.mode);
  const status = useBotStore((s) => s.status);
  const { allowed: isAdmin } = useHasRole("admin");


  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Target className="h-4 w-4" />
          </div>
          <div className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="font-mono text-sm font-semibold tracking-tight">SniperBot</span>
            <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              <StatusDot status={status} size="xs" />
              {mode} · {status}
            </span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Control</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={path === item.url}>
                    <Link to={item.url} className="flex items-center gap-2">
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {isAdmin && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={path === "/admin"}>
                    <Link to="/admin" className="flex items-center gap-2">
                      <UserCog className="h-4 w-4" />
                      <span>Admin</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
