import { useAuth } from "@/context/AuthContext";
import Board from "@/pages/Board";
import Portal from "@/pages/Portal";

// Staff land on the pipeline, clients on their case.
export default function Home() {
  const { user } = useAuth();
  return user?.role === "client" ? <Portal /> : <Board />;
}
