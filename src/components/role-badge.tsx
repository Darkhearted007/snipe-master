import { Shield, ShieldCheck, ShieldOff, LogOut } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useHasRole, type AppRole } from "@/hooks/use-auth-session";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

const rank = (roles: AppRole[]): AppRole =>
  roles.includes("admin") ? "admin" : roles.includes("trader") ? "trader" : "viewer";

const meta: Record<AppRole, { icon: typeof Shield; className: string; label: string }> = {
  admin: { icon: ShieldCheck, className: "border-primary/50 bg-primary/10 text-primary", label: "Admin" },
  trader: { icon: Shield, className: "border-success/40 bg-success/10 text-success", label: "Trader" },
  viewer: { icon: ShieldOff, className: "border-muted-foreground/30 bg-muted text-muted-foreground", label: "Viewer" },
};

export function RoleBadge() {
  const { session, roles, ready } = useHasRole("viewer");
  const navigate = useNavigate();
  const qc = useQueryClient();
  if (!ready || !session) return null;
  const r = rank(roles);
  const Icon = meta[r].icon;

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    toast("Signed out");
    navigate({ to: "/auth", replace: true });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Badge variant="outline" className={`cursor-pointer gap-1 ${meta[r].className}`}>
          <Icon className="h-3 w-3" /> {meta[r].label}
        </Badge>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs">Signed in</DropdownMenuLabel>
        <div className="px-2 pb-2 text-[10px] break-all text-muted-foreground">
          {session.user.email}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Roles
        </DropdownMenuLabel>
        <div className="px-2 pb-2 text-xs font-mono">
          {roles.length ? roles.join(", ") : "none"}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut} className="text-danger">
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
