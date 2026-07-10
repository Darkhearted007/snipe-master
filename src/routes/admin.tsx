import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldAlert, ShieldCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { listAdminUsers, grantRole, revokeRole } from "@/lib/admin.functions";
import { useHasRole } from "@/hooks/use-auth-session";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — SniperBot" },
      { name: "description", content: "Manage user roles and access to the bot." },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  const { ready, allowed, session } = useHasRole("admin");
  const navigate = useNavigate();

  if (!ready) {
    return (
      <div className="flex h-64 items-center justify-center text-xs text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Checking access…
      </div>
    );
  }
  if (!session) {
    navigate({ to: "/auth" });
    return null;
  }
  if (!allowed) {
    return (
      <div className="mx-auto max-w-md">
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Admin only</AlertTitle>
          <AlertDescription className="text-xs">
            Your wallet does not have the admin role. Ask an existing admin to
            promote you, or sign in with the bootstrap wallet.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return <UsersPanel currentUserId={session.user.id} />;
}

function UsersPanel({ currentUserId }: { currentUserId: string }) {
  const listUsers = useServerFn(listAdminUsers);
  const q = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => listUsers(),
    staleTime: 15_000,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">User & Role Management</h1>
          <p className="text-xs text-muted-foreground">
            Grant <span className="font-mono">trader</span> to allow live-mode
            control, or <span className="font-mono">admin</span> for full access.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => q.refetch()}>
          Refresh
        </Button>
      </div>

      {q.isLoading && (
        <Card>
          <CardContent className="flex items-center justify-center py-10 text-xs text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading users…
          </CardContent>
        </Card>
      )}
      {q.isError && (
        <Alert variant="destructive">
          <AlertTitle>Failed to load users</AlertTitle>
          <AlertDescription className="text-xs">
            {(q.error as Error).message}
          </AlertDescription>
        </Alert>
      )}

      {q.data && (
        <div className="grid gap-3">
          {q.data.map((u) => (
            <UserRow key={u.id} user={u} isSelf={u.id === currentUserId} />
          ))}
          {q.data.length === 0 && (
            <Card>
              <CardContent className="py-10 text-center text-xs text-muted-foreground">
                No users yet.
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

const ALL_ROLES = ["viewer", "trader", "admin"] as const;

function UserRow({
  user,
  isSelf,
}: {
  user: {
    id: string;
    walletAddress: string;
    displayName: string | null;
    createdAt: string;
    roles: readonly ("viewer" | "trader" | "admin")[];
  };
  isSelf: boolean;
}) {
  const grant = useServerFn(grantRole);
  const revoke = useServerFn(revokeRole);
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const toggle = async (role: "viewer" | "trader" | "admin", has: boolean) => {
    setBusy(role);
    try {
      if (has) {
        await revoke({ data: { userId: user.id, role } });
        toast.success(`Revoked ${role}`);
      } else {
        await grant({ data: { userId: user.id, role } });
        toast.success(`Granted ${role}`);
      }
      await qc.invalidateQueries({ queryKey: ["admin", "users"] });
    } catch (e) {
      toast.error("Role update failed", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const short = `${user.walletAddress.slice(0, 4)}…${user.walletAddress.slice(-4)}`;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <span className="font-mono">{user.displayName ?? short}</span>
              {isSelf && (
                <Badge variant="outline" className="text-[10px]">
                  you
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="mt-1 font-mono text-[11px] break-all">
              {user.walletAddress}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-1 justify-end">
            {user.roles.length === 0 && (
              <Badge variant="destructive" className="gap-1 text-[10px]">
                <UserX className="h-3 w-3" /> no roles
              </Badge>
            )}
            {user.roles.map((r) => (
              <Badge
                key={r}
                variant={r === "admin" ? "default" : "secondary"}
                className="text-[10px]"
              >
                {r}
              </Badge>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex flex-wrap gap-2">
          {ALL_ROLES.map((role) => {
            const has = user.roles.includes(role);
            return (
              <Button
                key={role}
                size="sm"
                variant={has ? "destructive" : "outline"}
                disabled={busy !== null}
                onClick={() => toggle(role, has)}
                className="gap-1.5 text-xs"
              >
                {busy === role && <Loader2 className="h-3 w-3 animate-spin" />}
                {has ? `Revoke ${role}` : `Grant ${role}`}
              </Button>
            );
          })}
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Joined {new Date(user.createdAt).toLocaleString()}
        </p>
      </CardContent>
    </Card>
  );
}
