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
      {/* Left: brand + case status preview on the hero mesh gradient */}
      <div className="mesh-gradient hidden flex-col justify-between border-r border-border p-12 lg:flex">
        <div className="type-heading-md">LeadFlow</div>
        <div className="space-y-8">
          <h1 className="type-display">
            Every lead, every document,
            <br />
            one pipeline.
          </h1>
          <div className="max-w-sm space-y-3">
            <p className="type-eyebrow text-mute">Case status</p>
            <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="type-label">Case #2041 · Baufinanzierung</span>
                <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success-foreground">
                  Documents verified
                </span>
              </div>
              <div className="mt-4 h-1.5 rounded-full bg-muted">
                <div className="h-1.5 w-3/5 rounded-full bg-primary" />
              </div>
              <p className="mt-2 text-xs text-mute">
                3 of 5 documents received
              </p>
            </div>
          </div>
        </div>
        <p className="text-xs text-body">
          Secure workspace for mortgage brokerage teams.
        </p>
      </div>

      {/* Right: form */}
      <div className="flex items-center justify-center p-8">
        <form onSubmit={onSubmit} className="w-full max-w-sm space-y-6">
          <div className="space-y-2">
            <h2 className="type-heading-lg">Sign in</h2>
            <p className="text-sm text-body">Use your brokerage account.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              className="bg-card shadow-none"
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
              className="bg-card shadow-none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="h-10 w-full" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
