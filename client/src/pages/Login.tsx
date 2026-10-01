import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Login() {
  const { user, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid min-h-screen bg-background text-foreground lg:grid-cols-2">
      {/* Left: brand + case status preview */}
      <div className="hidden flex-col justify-between border-r border-border bg-muted/30 p-12 lg:flex">
        <div className="text-xl font-semibold tracking-tight">LeadFlow</div>
        <div className="space-y-6">
          <h1 className="text-3xl font-semibold leading-tight">
            Every lead, every document,
            <br />
            one pipeline.
          </h1>
          <div className="max-w-sm rounded-lg border border-border bg-card p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">Case #2041 · Baufinanzierung</span>
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-400">
                Documents verified
              </span>
            </div>
            <div className="mt-3 h-1.5 rounded-full bg-muted">
              <div className="h-1.5 w-3/5 rounded-full bg-primary" />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              3 of 5 documents received
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Secure workspace for mortgage brokerage teams.
        </p>
      </div>

      {/* Right: form */}
      <div className="flex items-center justify-center p-8">
        <form onSubmit={onSubmit} className="w-full max-w-sm space-y-5">
          <div>
            <h2 className="text-2xl font-semibold">Sign in</h2>
            <p className="text-sm text-muted-foreground">
              Use your brokerage account.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
