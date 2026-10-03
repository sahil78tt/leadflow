import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { useDocuments } from "@/lib/useDocuments";
import DocumentList from "@/components/DocumentList";

interface ClientInfo {
  id: string;
  name: string;
  email: string;
  phone?: string;
  openedAt: string;
}

export default function ClientDetail() {
  const { clientId = "" } = useParams();
  const [client, setClient] = useState<ClientInfo | null>(null);
  const [error, setError] = useState("");
  const documents = useDocuments(
    `/api/clients/${clientId}/documents`,
    clientId,
  );

  useEffect(() => {
    let cancelled = false;
    api<{ client: ClientInfo }>(`/api/clients/${clientId}`)
      .then((r) => {
        if (!cancelled) setClient(r.client);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiError && (e.status === 404 || e.status === 403))
          setError("Client not found.");
        else
          setError(
            e instanceof Error ? e.message : "Failed to load the client",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-8">
      <Link to="/" className="text-sm text-body hover:underline">
        ← Pipeline
      </Link>
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <>
          <div className="space-y-2">
            <p className="type-eyebrow text-mute">Client</p>
            <h1 className="type-heading-lg">{client?.name ?? "…"}</h1>
            {client && (
              <p className="text-sm text-body">
                {client.email}
                {client.phone ? ` · ${client.phone}` : ""}
              </p>
            )}
          </div>
          <section className="space-y-4">
            <h2 className="type-heading-md">Documents</h2>
            {documents.error && (
              <p className="text-sm text-destructive">{documents.error}</p>
            )}
            <DocumentList docs={documents.docs} onChanged={documents.upsert} />
          </section>
        </>
      )}
    </div>
  );
}
