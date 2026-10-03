import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { api, ApiError } from "@/lib/api";
import type { Doc } from "@/lib/documents";
import { useDocuments } from "@/lib/useDocuments";
import DocumentList from "@/components/DocumentList";
import { Button } from "@/components/ui/button";

interface CaseView {
  id: string;
  name: string;
  email: string;
  phone?: string;
  openedAt: string;
  advisor: { name: string } | null;
}

const MAX_BYTES = 10 * 1024 * 1024;

export default function Portal() {
  const [data, setData] = useState<CaseView | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const documents = useDocuments("/api/portal/documents");

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

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // lets the same file be chosen again
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setUploadError("That file is larger than 10 MB.");
      return;
    }
    setUploading(true);
    setUploadError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const r = await api<{ document: Doc }>("/api/portal/documents", {
        method: "POST",
        body,
      });
      documents.upsert(r.document); // later status changes arrive over the socket
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

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
    <div className="mx-auto max-w-2xl space-y-8 p-8">
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

      {data && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="type-heading-md">Documents</h2>
            <Button
              size="sm"
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
            >
              {uploading ? "Uploading…" : "Upload document"}
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              className="hidden"
              onChange={(e) => void onFile(e)}
            />
          </div>
          <p className="text-xs text-mute">
            PDF, JPEG or PNG, up to 10 MB. Each upload is checked automatically.
          </p>
          {uploadError && (
            <p className="text-sm text-destructive">{uploadError}</p>
          )}
          {documents.error && (
            <p className="text-sm text-destructive">{documents.error}</p>
          )}
          <DocumentList docs={documents.docs} onChanged={documents.upsert} />
        </section>
      )}
    </div>
  );
}
