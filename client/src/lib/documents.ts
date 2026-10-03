export type DocStatus = "pending" | "checking" | "verified" | "failed";

export const DOC_STATUS_LABELS: Record<DocStatus, string> = {
  pending: "Queued",
  checking: "Checking…",
  verified: "Verified",
  failed: "Check failed",
};

export interface Doc {
  id: string;
  clientId: string;
  filename: string;
  mimeType: string;
  size: number;
  status: DocStatus;
  failureReason?: string;
  version: number;
  createdAt: string;
}

// Same rule as the board: a change is applied only if it is newer than what we have.
export function mergeDoc(prev: Doc[], incoming: Doc): Doc[] {
  const existing = prev.find((d) => d.id === incoming.id);
  if (!existing) return [incoming, ...prev];
  if (existing.version >= incoming.version) return prev;
  return prev.map((d) => (d.id === incoming.id ? incoming : d));
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
