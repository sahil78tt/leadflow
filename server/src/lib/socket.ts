import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { env } from "../config/env.js";
import { verifyToken } from "./jwt.js";

// Same roles that can load the board over HTTP.
const SOCKET_ROLES: readonly string[] = ["advisor", "brokerage_admin"];

let io: Server | null = null;

export const brokerageRoom = (brokerageId: string) =>
  `brokerage:${brokerageId}`;

export function initSocket(httpServer: HttpServer) {
  io = new Server(httpServer, { cors: { origin: env.CLIENT_URL } });

  // Handshake: the JWT is the only source of identity. Rooms are never taken from client input.
  io.use((socket, next) => {
    const token: unknown = socket.handshake.auth?.token;
    try {
      if (typeof token !== "string") throw new Error("Missing token");
      const payload = verifyToken(token);
      if (!payload.brokerageId || !SOCKET_ROLES.includes(payload.role))
        return next(new Error("Forbidden"));
      socket.data.brokerageId = payload.brokerageId;
      next();
    } catch {
      next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket) => {
    const room = brokerageRoom(socket.data.brokerageId as string);
    // join() is synchronous with the default in-memory adapter, so the socket is in its room
    // before the client even sees its "connect" event.
    void socket.join(room);
    console.log(`socket ${socket.id} joined ${room}`);
  });

  return io;
}

/** No-op until initSocket has run (HTTP-only tests never initialize it). */
export function emitLeadChanged(brokerageId: string, lead: object) {
  io?.to(brokerageRoom(brokerageId)).emit("lead:changed", { lead });
}
