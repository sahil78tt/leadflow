import { Outlet } from "react-router-dom";
import { useAuth, type Role } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";

const ROLE_LABELS: Record<Role, string> = {
  platform_admin: "Platform admin",
  brokerage_admin: "Brokerage admin",
  advisor: "Advisor",
  client: "Client",
};

export default function AppShell() {
  const { user, logout } = useAuth();
  return (
    <div className="grid min-h-screen grid-cols-[240px_1fr] bg-background text-foreground">
      <aside className="flex flex-col justify-between border-r border-sidebar-border bg-sidebar p-4">
        <div className="space-y-6">
          <div className="type-heading-md px-2">LeadFlow</div>
          <nav className="space-y-1">
            <span className="type-label flex items-center rounded-md bg-sidebar-accent px-2 py-1.5 text-sidebar-accent-foreground">
              Pipeline
            </span>
          </nav>
        </div>
        <div className="space-y-3 border-t border-sidebar-border pt-4">
          <div className="px-2">
            <p className="type-label">{user?.name}</p>
            <p className="text-xs text-mute">
              {user ? ROLE_LABELS[user.role] : ""}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={logout}
          >
            Sign out
          </Button>
        </div>
      </aside>
      <main className="min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
