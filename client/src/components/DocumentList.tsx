import { useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  DOC_STATUS_LABELS,
  formatSize,
  type Doc,
  type DocStatus,
} from "@/lib/documents";
import { Button } from "@/components/ui/button";

const STATUS_BADGE: Record<DocStatus, string> = {
  pending: "bg-muted text-body",
  checking: "bg-warning-soft text-warning-foreground animate-pulse",
  verified: "bg-success-soft text-success-foreground",
  failed: "bg-destructive/10 text-destructive-foreground",
};

export default function DocumentList({
  docs,
  onChanged,
}: {
  docs: Doc[];
  onChanged: (doc: Doc) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function open(doc: Doc) {
    setError("");
    try {
      // The server issues a 5-minute signed link; there is no permanent URL for a document.
      const r = await api<{ url: string }>(`/api/documents/${doc.id}/link`);
      window.open(r.url, "_blank", "noopener");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the file");
    }
  }

  async function retry(doc: Doc) {
    setBusy(doc.id);
    setError("");
    try {
      const r = await api<{ document: Doc }>(
        `/api/documents/${doc.id}/recheck`,
        { method: "POST" },
      );
      onChanged(r.document);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not retry the check");
    } finally {
      setBusy(null);
    }
  }

  if (docs.length === 0)
    return <p className="text-sm text-mute">No documents yet.</p>;

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {docs.map((doc) => (
          <li
            key={doc.id}
            className="flex items-center justify-between gap-4 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="type-label truncate">{doc.filename}</p>
              <p className="text-xs text-mute">
                {formatSize(doc.size)} ·{" "}
                {new Date(doc.createdAt).toLocaleDateString("de-DE")}
              </p>
              {doc.status === "failed" && doc.failureReason && (
                <p className="mt-1 text-xs text-destructive-foreground">
                  {doc.failureReason}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  STATUS_BADGE[doc.status],
                )}
              >
                {DOC_STATUS_LABELS[doc.status]}
              </span>
              {doc.status === "failed" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-card"
                  disabled={busy === doc.id}
                  onClick={() => void retry(doc)}
                >
                  Retry check
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => void open(doc)}>
                Open
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
