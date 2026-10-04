import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { connectSocket } from "@/lib/socket";
import { STAGES, STAGE_LABELS, type Stage } from "@/lib/leads";

interface Summary {
  counts: Record<Stage, number>;
  total: number;
  generatedAt: string;
}

export default function Dashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api<Summary>("/api/dashboard")
      .then((r) => {
        if (cancelled) return;
        setSummary(r);
        setError("");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 403)
          setError("Your role has no access to the dashboard.");
        else
          setError(
            e instanceof Error ? e.message : "Failed to load the dashboard",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  // Any lead change refetches. The server invalidates its cache BEFORE emitting, so the refetch is never stale.
  useEffect(() => {
    const socket = connectSocket();
    let firstConnect = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setRefreshKey((k) => k + 1), 300); // coalesce bursts
    };
    socket.on("connect", () => {
      if (firstConnect) firstConnect = false;
      else refresh(); // reconnected: catch up
    });
    socket.on("lead:changed", refresh);
    return () => {
      clearTimeout(timer);
      socket.disconnect();
    };
  }, []);

  const max = summary ? Math.max(1, ...Object.values(summary.counts)) : 1;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-8">
      <div className="space-y-1">
        <p className="type-eyebrow text-mute">Overview</p>
        <h1 className="type-heading-lg">Dashboard</h1>
        {summary && (
          <p className="text-xs text-mute">
            Updated {new Date(summary.generatedAt).toLocaleTimeString("de-DE")}
          </p>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {!summary && !error && <p className="text-sm text-body">Loading…</p>}

      {summary && (
        <div className="space-y-3">
          <div className="rounded-xl border border-border bg-card p-6">
            <p className="type-eyebrow text-mute">Total leads</p>
            <p className="mt-2 text-4xl font-semibold tracking-tight">
              {summary.total}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {STAGES.map((stage) => (
              <div
                key={stage}
                className="rounded-xl border border-border bg-card p-4"
              >
                <p className="type-eyebrow text-mute">{STAGE_LABELS[stage]}</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight">
                  {summary.counts[stage]}
                </p>
                <div className="mt-3 h-1.5 rounded-full bg-muted">
                  <div
                    className="h-1.5 rounded-full bg-primary"
                    style={{ width: `${(summary.counts[stage] / max) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
