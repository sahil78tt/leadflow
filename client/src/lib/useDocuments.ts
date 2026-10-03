import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { mergeDoc, type Doc } from "@/lib/documents";
import { connectSocket } from "@/lib/socket";

/** A live document list. `clientId` filters socket events when staff receive events for the whole brokerage. */
export function useDocuments(listPath: string, clientId?: string) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api<{ documents: Doc[] }>(listPath)
      .then((r) => {
        if (cancelled) return;
        setDocs(r.documents);
        setError("");
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load documents");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [listPath, refreshKey]);

  useEffect(() => {
    const socket = connectSocket();
    let firstConnect = true;
    socket.on("connect", () => {
      if (firstConnect) firstConnect = false;
      else setRefreshKey((k) => k + 1); // reconnected: reload to catch anything missed
    });
    socket.on("document:changed", ({ document }: { document: Doc }) => {
      if (clientId && document.clientId !== clientId) return;
      setDocs((prev) => mergeDoc(prev, document));
    });
    return () => {
      socket.disconnect();
    };
  }, [clientId]);

  const upsert = useCallback(
    (doc: Doc) => setDocs((prev) => mergeDoc(prev, doc)),
    [],
  );
  return { docs, loading, error, upsert };
}
