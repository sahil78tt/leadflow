import { useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";
import type { Lead } from "@/lib/leads";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ConvertResponse {
  lead: Lead;
  portal: { email: string; temporaryPassword: string };
}

// `lead` is the live board state, so its version is always the latest one we know of.
export default function ConvertDialog({
  lead,
  onClose,
  onUpdated,
}: {
  lead: Lead;
  onClose: () => void;
  onUpdated: (lead: Lead) => void;
}) {
  const [email, setEmail] = useState(lead.email ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ConvertResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const r = await api<ConvertResponse>(`/api/leads/${lead.id}/convert`, {
        method: "POST",
        body: JSON.stringify({ version: lead.version, email }),
      });
      onUpdated(r.lead);
      setResult(r);
    } catch (err) {
      const current =
        err instanceof ApiError
          ? (err.data as { lead?: Lead } | null)?.lead
          : undefined;
      if (current) onUpdated(current); // the board shows the latest state; the user can retry
      setError(err instanceof Error ? err.message : "Conversion failed");
    } finally {
      setSubmitting(false);
    }
  };

  const copy = () => {
    if (!result) return;
    void navigator.clipboard
      .writeText(result.portal.temporaryPassword)
      .then(() => setCopied(true));
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DialogContent className="rounded-xl sm:max-w-md">
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>{lead.name} is now a client</DialogTitle>
              <DialogDescription>
                Give them these portal login details. The password is shown only
                once.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 rounded-xl border border-border bg-card p-4 text-sm">
              <div>
                <p className="type-eyebrow text-mute">Email</p>
                <p>{result.portal.email}</p>
              </div>
              <div>
                <p className="type-eyebrow text-mute">Temporary password</p>
                <code className="font-mono">
                  {result.portal.temporaryPassword}
                </code>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" className="bg-card" onClick={copy}>
                {copied ? "Copied" : "Copy password"}
              </Button>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Convert {lead.name} to a client</DialogTitle>
              <DialogDescription>
                This creates a client record and a portal login, and moves the
                lead to Won.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="portal-email">Portal login email</Label>
              <Input
                id="portal-email"
                type="email"
                required
                className="bg-card shadow-none"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="bg-card"
                onClick={onClose}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Converting…" : "Convert to client"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
