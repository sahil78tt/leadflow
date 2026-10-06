import { useAuth } from "@/context/AuthContext";

export default function PlatformAdmin() {
  const { user } = useAuth();

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-8">
      <div className="space-y-1">
        <p className="type-eyebrow text-mute">Platform</p>
        <h1 className="type-heading-lg">Platform admin</h1>
        <p className="text-sm text-mute">
          Platform-level access for LeadFlow.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <p className="type-eyebrow text-mute">Signed in as</p>
        <p className="mt-2 text-lg font-semibold">{user?.name}</p>
        <p className="text-sm text-mute">{user?.email}</p>
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <p className="type-eyebrow text-mute">Platform scope</p>
        <p className="mt-2 text-sm text-body">
          This submission includes the platform-admin role and authentication.
          Brokerage management and platform-level operational controls are
          intentionally outside the current MVP scope.
        </p>
      </div>
    </div>
  );
}
