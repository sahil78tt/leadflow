import "dotenv/config";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import request from "supertest";
import {
  io as connectClient,
  type Socket as ClientSocket,
} from "socket.io-client";
import type { Server as SocketServer } from "socket.io";
import { app } from "../app.js";
import { Brokerage } from "../models/Brokerage.js";
import { Lead } from "../models/Lead.js";
import type { Role } from "../models/User.js";
import { signToken } from "./jwt.js";
import { skipTenant } from "./tenantPlugin.js";
import { initSocket } from "./socket.js";

const TEST_URI = process.env.MONGODB_URI_TEST;

interface ChangedEvent {
  lead: { id: string; name: string; stage: string; version: number };
}

describe("realtime board sync", () => {
  let safe = false;
  let a: string;
  let b: string;
  let httpServer: HttpServer;
  let io: SocketServer;
  let port: number;
  const sockets: ClientSocket[] = [];

  const tokenFor = (brokerageId: string | null, role: Role = "advisor") =>
    signToken({
      id: new mongoose.Types.ObjectId().toString(),
      role,
      brokerageId,
    });

  const connect = (token: string) =>
    new Promise<ClientSocket>((resolve, reject) => {
      const socket = connectClient(`http://127.0.0.1:${port}`, {
        auth: { token },
        reconnection: false,
        transports: ["websocket"],
      });
      sockets.push(socket);
      socket.once("connect", () => resolve(socket));
      socket.once("connect_error", (err) => reject(err));
    });

  const nextChange = (socket: ClientSocket, ms = 1500) =>
    new Promise<ChangedEvent>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`No "lead:changed" within ${ms}ms`)),
        ms,
      );
      socket.once("lead:changed", (payload: ChangedEvent) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

  // Resolves if nothing arrives for `ms`; rejects if an event does.
  const noChange = (socket: ClientSocket, ms = 300) =>
    new Promise<void>((resolve, reject) => {
      const onEvent = () => reject(new Error('Unexpected "lead:changed"'));
      socket.once("lead:changed", onEvent);
      setTimeout(() => {
        socket.off("lead:changed", onEvent);
        resolve();
      }, ms);
    });

  const mk = async (brokerageId: string, name: string) =>
    await Lead.create({
      brokerageId: new mongoose.Types.ObjectId(brokerageId),
      name,
      email: `${name.toLowerCase()}@example.de`,
    });
  const move = (token: string, leadId: string, body: object) =>
    request(app)
      .patch(`/api/leads/${leadId}/stage`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  const hook = (brokerageId: string, body: object) =>
    request(app).post(`/api/leads/webhook/${brokerageId}`).send(body);

  before(async () => {
    if (!TEST_URI)
      throw new Error(
        'Set MONGODB_URI_TEST in server/.env (database name must contain "test")',
      );
    await mongoose.connect(TEST_URI);
    if (!mongoose.connection.name.includes("test")) {
      await mongoose.disconnect();
      throw new Error(
        `Refusing to run: database "${mongoose.connection.name}" does not look like a test DB`,
      );
    }
    safe = true;
    await mongoose.connection.dropDatabase();
    await Lead.syncIndexes();

    const [brokerageA, brokerageB] = await Brokerage.create([
      { name: "A" },
      { name: "B" },
    ]);
    a = brokerageA.id;
    b = brokerageB.id;

    httpServer = createServer(app);
    io = initSocket(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as AddressInfo).port;
  });

  beforeEach(async () => {
    await skipTenant(Lead.deleteMany({}));
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.close();
  });

  after(async () => {
    for (const socket of sockets.splice(0)) socket.close();
    await io.close(); // also closes the http server
    if (safe) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  describe("handshake", () => {
    it("rejects a missing or invalid token", async () => {
      await assert.rejects(connect("garbage"), {
        message: "Invalid or expired token",
      });
    });

    it("rejects roles that cannot see the board, and users with no brokerage", async () => {
      await assert.rejects(connect(tokenFor(a, "client")), {
        message: "Forbidden",
      });
      await assert.rejects(connect(tokenFor(null, "platform_admin")), {
        message: "Forbidden",
      });
    });

    it("accepts an advisor", async () => {
      const socket = await connect(tokenFor(a));
      assert.equal(socket.connected, true);
    });
  });

  describe("broadcast", () => {
    it("a stage move reaches every advisor of that brokerage and nobody else", async () => {
      const lead = await mk(a, "Anna");
      const a1 = await connect(tokenFor(a));
      const a2 = await connect(tokenFor(a));
      const b1 = await connect(tokenFor(b));

      const got1 = nextChange(a1);
      const got2 = nextChange(a2);
      const silent = noChange(b1);
      const res = await move(tokenFor(a), lead.id, {
        stage: "contacted",
        version: 0,
      });
      assert.equal(res.status, 200);

      for (const event of [await got1, await got2]) {
        assert.equal(event.lead.id, lead.id);
        assert.equal(event.lead.stage, "contacted");
        assert.equal(event.lead.version, 1);
      }
      await silent;
    });

    it("a webhook-created lead is broadcast to its own brokerage only", async () => {
      const a1 = await connect(tokenFor(a));
      const b1 = await connect(tokenFor(b));

      const got = nextChange(a1);
      const silent = noChange(b1);
      assert.equal(
        (await hook(a, { name: "New Lead", email: "new@example.de" })).status,
        202,
      );

      const event = await got;
      assert.equal(event.lead.name, "New Lead");
      assert.equal(event.lead.stage, "new");
      await silent;
    });

    it("a duplicate submission is not broadcast", async () => {
      const a1 = await connect(tokenFor(a));
      const first = nextChange(a1);
      await hook(a, { name: "Dup", email: "dup@example.de" });
      await first;

      const silent = noChange(a1);
      assert.equal(
        (await hook(a, { name: "Dup again", email: "dup@example.de" })).status,
        202,
      );
      await silent;
    });

    it("a rejected stale move or a no-op move is not broadcast", async () => {
      const lead = await mk(a, "Anna");
      await move(tokenFor(a), lead.id, { stage: "contacted", version: 0 });
      const a1 = await connect(tokenFor(a));

      const silent = noChange(a1);
      assert.equal(
        (await move(tokenFor(a), lead.id, { stage: "qualified", version: 0 }))
          .status,
        409,
      );
      assert.equal(
        (await move(tokenFor(a), lead.id, { stage: "contacted", version: 1 }))
          .status,
        200,
      );
      await silent;
    });
  });
});
