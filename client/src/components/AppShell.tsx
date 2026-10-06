import { NavLink, Outlet } from "react-router-dom";
import { useAuth, type Role } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const ROLE_LABELS: Record<Role, string> = {
  platform_admin: "Platform admin",
  brokerage_admin: "Brokerage admin",
  advisor: "Advisor",
  client: "Client",
};

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "type-label flex items-center rounded-md px-2 py-1.5",
    isActive
      ? "bg-sidebar-accent text-sidebar-accent-foreground"
      : "text-sidebar-foreground hover:bg-sidebar-accent/60",
  );

export default function AppShell() {
  const { user, logout } = useAuth();

  return (
    <div className="grid min-h-screen grid-cols-[240px_1fr] bg-background text-foreground">
      <aside className="flex flex-col justify-between border-r border-sidebar-border bg-sidebar p-4">
        <div className="space-y-6">
          <div className="type-heading-md px-2">LeadFlow</div>

          <nav className="space-y-1">
            {user?.role === "platform_admin" ? (
              <NavLink to="/platform-admin" className={navClass}>
                Platform admin
              </NavLink>
            ) : user?.role === "client" ? (
              <NavLink to="/" end className={navClass}>
                My case
              </NavLink>
            ) : (
              <>
                <NavLink to="/" end className={navClass}>
                  Pipeline
                </NavLink>

                <NavLink to="/dashboard" className={navClass}>
                  Dashboard
                </NavLink>

                <NavLink to="/tasks" className={navClass}>
                  Tasks
                </NavLink>

                {user?.role === "brokerage_admin" && (
                  <>
                    <NavLink to="/email-templates" className={navClass}>
                      Email Templates
                    </NavLink>

                    <NavLink to="/email-triggers" className={navClass}>
                      Email Triggers
                    </NavLink>

                    <NavLink to="/task-triggers" className={navClass}>
                      Task Triggers
                    </NavLink>
                  </>
                )}
              </>
            )}
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
