import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/AppShell";
import Login from "@/pages/Login";
import Home from "@/pages/Home";
import Dashboard from "@/pages/Dashboard";
import ClientDetail from "@/pages/ClientDetail";
import PlatformAdmin from "@/pages/PlatformAdmin";
import EmailTemplates from "@/pages/EmailTemplates";
import EmailTriggers from "@/pages/EmailTriggers";
import TaskTriggers from "@/pages/TaskTriggers";
import Tasks from "@/pages/Tasks";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<AppShell />}>
              <Route path="/" element={<Home />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/clients/:clientId" element={<ClientDetail />} />
              <Route path="/platform-admin" element={<PlatformAdmin />} />
              <Route path="/email-templates" element={<EmailTemplates />} />
              <Route path="/email-triggers" element={<EmailTriggers />} />
              <Route path="/task-triggers" element={<TaskTriggers />} />
              <Route path="/tasks" element={<Tasks />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
