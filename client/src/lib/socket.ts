import { io, type Socket } from "socket.io-client";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

// The token is read on every (re)connection attempt, so it is never stale.
export function connectSocket(): Socket {
  return io(BASE, {
    auth: (cb) => cb({ token: localStorage.getItem("token") ?? "" }),
  });
}
