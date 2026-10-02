import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import Login from "@/pages/Login";
import { Button } from "@/components/ui/button";

// Placeholder landing page; replaced by the Kanban board in M4.
function Home() {
  const { user, logout } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8 text-foreground">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-6">
        <p className="type-eyebrow text-mute">Signed in</p>
        <p className="type-heading-md">{user?.name}</p>
        <p className="text-sm text-body">{user?.role}</p>
        <Button variant="outline" className="bg-card" onClick={logout}>
          Sign out
        </Button>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<Home />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
