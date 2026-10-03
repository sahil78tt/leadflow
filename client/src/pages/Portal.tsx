import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

interface CaseView {
  id: string;
  name: string;
  email: string;
  phone?: string;
  openedAt: string;
  advisor: { name: string } | null;
}

export default function Portal() {
  const [data, setData] = useState<CaseView | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api<{ case: CaseView }>("/api/portal/case")
      .then((r) => {
        if (!cancelled) setData(r.case);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404)
          setError("No case found for your account.");
        else
          setError(e instanceof Error ? e.message : "Failed to load your case");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows: [string, string][] = data
    ? [
        ["Name", data.name],
        ["Email", data.email],
        ["Phone", data.phone ?? "—"],
        ["Your advisor", data.advisor?.name ?? "—"],
        ["Case opened", new Date(data.openedAt).toLocaleDateString("de-DE")],
      ]
    : [];

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-8">
      <div className="space-y-2">
        <p className="type-eyebrow text-mute">Your case</p>
        <h1 className="type-heading-lg">{data?.name ?? "Welcome"}</h1>
      </div>
      {loading && <p className="text-sm text-body">Loading your case…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {data && (
        <dl className="divide-y divide-border rounded-xl border border-border bg-card">
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="flex items-center justify-between gap-4 px-6 py-4"
            >
              <dt className="type-eyebrow text-mute">{label}</dt>
              <dd className="text-sm">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
