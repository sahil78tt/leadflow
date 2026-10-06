import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { env } from "../config/env.js";
import { Client } from "../models/Client.js";
import { verifyToken } from "./jwt.js";
import { tenantStorage } from "./tenantContext.js";

const STAFF_ROLES: readonly string[] = ["advisor", "brokerage_admin"];

let io: Server | null = null;

export const brokerageRoom = (brokerageId: string) =>
  `brokerage:${brokerageId}`;
export const clientRoom = (clientId: string) => `client:${clientId}`;

export function initSocket(httpServer: HttpServer) {
  io = new Server(httpServer, { cors: { origin: env.CLIENT_URL } });

  // Handshake: the JWT is the only source of identity. Rooms are never taken from client input.
  io.use(async (socket, next) => {
    const token: unknown = socket.handshake.auth?.token;
    let payload: ReturnType<typeof verifyToken>;
    try {
      if (typeof token !== "string") throw new Error("Missing token");
      payload = verifyToken(token);
    } catch {
      return next(new Error("Invalid or expired token"));
    }
    if (!payload.brokerageId) return next(new Error("Forbidden"));

    if (STAFF_ROLES.includes(payload.role)) {
      socket.data.brokerageId = payload.brokerageId;
      return next();
    }

    if (payload.role === "client") {
      try {
        // A DB read inside socket code: there is no Express middleware here, so the tenant context is explicit.
        const client = await tenantStorage.run(
          { brokerageId: payload.brokerageId, role: payload.role },
          async () => await Client.findOne({ userId: payload.sub }),
        );
        if (!client) return next(new Error("Forbidden"));
        socket.data.clientId = client.id;
        return next();
      } catch {
        return next(new Error("Server error"));
      }
    }

    next(new Error("Forbidden"));
  });

  io.on("connection", (socket) => {
    // Staff listen to their whole brokerage; a client listens ONLY to their own room (never to lead events).
    const room = socket.data.clientId
      ? clientRoom(socket.data.clientId as string)
      : brokerageRoom(socket.data.brokerageId as string);
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

/** Tells only staff in the matching brokerage that an incoming lead already exists. */
export function emitLeadDuplicate(brokerageId: string, lead: object) {
  io?.to(brokerageRoom(brokerageId)).emit("lead:duplicate", { lead });
}

/** Reaches the brokerage's staff and that one client, and nobody else. */
export function emitDocumentChanged(
  brokerageId: string,
  clientId: string,
  document: object,
) {
  io?.to(brokerageRoom(brokerageId))
    .to(clientRoom(clientId))
    .emit("document:changed", { document });
}
