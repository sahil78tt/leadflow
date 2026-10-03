import "dotenv/config";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import mongoose, { Types } from "mongoose";
import request from "supertest";
import {
  io as connectClient,
  type Socket as ClientSocket,
} from "socket.io-client";
import type { Server as SocketServer } from "socket.io";
import { app } from "../app.js";
import { Brokerage } from "../models/Brokerage.js";
import { Client } from "../models/Client.js";
import { ClientDocument, type DocStatus } from "../models/ClientDocument.js";
import { Lead } from "../models/Lead.js";
import { signToken } from "../lib/jwt.js";
import { storage } from "../lib/cloudinary.js";
import {
  checkerConfig,
  enqueueCheck,
  recoverStuckChecks,
} from "../lib/documentChecks.js";
import { MAX_UPLOAD_BYTES } from "../lib/fileType.js";
import { initSocket } from "../lib/socket.js";
import { skipTenant } from "../lib/tenantPlugin.js";

const TEST_URI = process.env.MONGODB_URI_TEST;

interface Case {
  clientId: string;
  userId: string;
  brokerageId: string;
}

describe("documents", () => {
  let safe = false;
  let a: string;
  let b: string;
  let anna: Case; // client in brokerage A
  let ben: Case; // another client in brokerage A
  let zoe: Case; // client in brokerage B
  let uploads = 0;
  let httpServer: HttpServer;
  let io: SocketServer;
  let port: number;
  const sockets: ClientSocket[] = [];

  const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF");
  const clientToken = (c: Case) =>
    signToken({ id: c.userId, role: "client", brokerageId: c.brokerageId });
  const staffToken = (brokerageId: string) =>
    signToken({
      id: new Types.ObjectId().toString(),
      role: "advisor",
      brokerageId,
    });
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const mkCase = async (brokerageId: string, name: string): Promise<Case> => {
    const userId = new Types.ObjectId();
    const client = await Client.create({
      brokerageId: new Types.ObjectId(brokerageId),
      leadId: new Types.ObjectId(),
      userId,
      advisorId: new Types.ObjectId(),
      name,
      email: `${name.toLowerCase()}@portal.test`,
    });
    return { clientId: client.id, userId: userId.toString(), brokerageId };
  };
  const upload = (
    token: string,
    file: Buffer = pdf,
    filename = "payslip.pdf",
  ) =>
    request(app)
      .post("/api/portal/documents")
      .set(auth(token))
      .attach("file", file, { filename });
  const stored = async (id: string) =>
    await skipTenant(ClientDocument.findById(id));
  const mkDoc = async (c: Case, status: DocStatus) =>
    await ClientDocument.create({
      brokerageId: new Types.ObjectId(c.brokerageId),
      clientId: new Types.ObjectId(c.clientId),
      uploadedBy: new Types.ObjectId(),
      filename: "x.pdf",
      mimeType: "application/pdf",
      size: 10,
      publicId: "p",
      format: "pdf",
      status,
    });
  const waitForStatus = async (id: string, status: DocStatus, ms = 2000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const doc = await stored(id);
      if (doc?.status === status) return doc;
      if (Date.now() > deadline)
        throw new Error(
          `document never reached "${status}" (is "${doc?.status}")`,
        );
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

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
  const collect = <P, T>(
    socket: ClientSocket,
    event: string,
    pick: (payload: P) => T,
  ) => {
    const seen: T[] = [];
    socket.on(event, (payload: P) => seen.push(pick(payload)));
    return seen;
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 250));

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
    await ClientDocument.syncIndexes();
    await Client.syncIndexes();

    const [brokerageA, brokerageB] = await Brokerage.create([
      { name: "A" },
      { name: "B" },
    ]);
    a = brokerageA.id;
    b = brokerageB.id;
    anna = await mkCase(a, "Anna");
    ben = await mkCase(a, "Ben");
    zoe = await mkCase(b, "Zoe");

    // No network: storage is replaced by a stub.
    storage.upload = async () => {
      uploads += 1;
      return { publicId: `test/doc-${uploads}`, format: "pdf" };
    };
    storage.downloadUrl = (publicId, format) =>
      `https://files.test/${publicId}.${format}`;

    httpServer = createServer(app);
    io = initSocket(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as AddressInfo).port;
  });

  beforeEach(async () => {
    uploads = 0;
    Object.assign(checkerConfig, {
      minMs: 0,
      maxMs: 0,
      failureRate: 0.15,
      random: () => 0.5,
    }); // instant, passes
    await skipTenant(ClientDocument.deleteMany({}));
    await skipTenant(Lead.deleteMany({}));
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.close();
  });

  after(async () => {
    for (const socket of sockets.splice(0)) socket.close();
    await io.close();
    if (safe) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  describe("upload", () => {
    it("stores the file for the caller's own case and never exposes the storage reference", async () => {
      const res = await upload(clientToken(anna));
      assert.equal(res.status, 201);
      assert.equal(res.body.document.status, "pending");
      assert.equal(res.body.document.clientId, anna.clientId);
      assert.equal(res.body.document.filename, "payslip.pdf");
      assert.equal("publicId" in res.body.document, false);
      assert.equal(uploads, 1);

      const doc = await stored(res.body.document.id);
      assert.equal(String(doc?.brokerageId), a);
      assert.equal(String(doc?.clientId), anna.clientId);
    });

    it("decides the type from the content, not the filename, and does not touch storage for rejects", async () => {
      const text = await upload(
        clientToken(anna),
        Buffer.from("just some text"),
        "looks-legit.pdf",
      );
      assert.equal(text.status, 415);
      assert.equal(uploads, 0);

      const png = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(16),
      ]);
      assert.equal(
        (await upload(clientToken(anna), png, "scan.png")).status,
        201,
      );
    });

    it("rejects files over the size limit and requests without a file", async () => {
      const big = await upload(
        clientToken(anna),
        Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x25),
        "big.pdf",
      );
      assert.equal(big.status, 413);
      assert.equal(uploads, 0);
      assert.equal(
        (
          await request(app)
            .post("/api/portal/documents")
            .set(auth(clientToken(anna)))
        ).status,
        400,
      );
    });

    it("is closed to staff and anonymous callers", async () => {
      assert.equal((await upload(staffToken(a))).status, 403);
      assert.equal(
        (
          await request(app)
            .post("/api/portal/documents")
            .attach("file", pdf, "x.pdf")
        ).status,
        401,
      );
    });
  });

  describe("background check", () => {
    it("moves pending -> checking -> verified and bumps the version on every change", async () => {
      const res = await upload(clientToken(anna));
      const doc = await waitForStatus(res.body.document.id, "verified");
      assert.equal(doc.version, 2);
      assert.ok(doc.checkedAt);
    });

    it("a failed check is visible, and a retry can still verify it", async () => {
      checkerConfig.random = () => 0.01; // below the failure rate
      const res = await upload(clientToken(anna));
      const failed = await waitForStatus(res.body.document.id, "failed");
      assert.match(failed.failureReason ?? "", /retry/i);

      checkerConfig.random = () => 0.5;
      const retry = await request(app)
        .post(`/api/documents/${failed.id}/recheck`)
        .set(auth(clientToken(anna)));
      assert.equal(retry.status, 200);
      assert.equal(retry.body.document.status, "pending");
      const verified = await waitForStatus(failed.id, "verified");
      assert.equal(verified.failureReason, undefined);

      const again = await request(app)
        .post(`/api/documents/${failed.id}/recheck`)
        .set(auth(clientToken(anna)));
      assert.equal(again.status, 409); // only failed checks can be retried
    });

    it("two runners for one document: exactly one does the work", async () => {
      const doc = await mkDoc(anna, "pending");
      const ref = { id: doc.id, brokerageId: a, clientId: anna.clientId };
      enqueueCheck(ref);
      enqueueCheck(ref);
      const done = await waitForStatus(doc.id, "verified");
      await settle();
      assert.equal((await stored(done.id))?.version, 2); // pending->checking->verified, not twice
    });

    it("recovers documents orphaned by a restart", async () => {
      const orphan = await mkDoc(anna, "checking");
      const queued = await mkDoc(ben, "pending");
      const finished = await mkDoc(anna, "verified");

      assert.equal(await recoverStuckChecks(), 2);
      await waitForStatus(orphan.id, "verified");
      await waitForStatus(queued.id, "verified");
      assert.equal((await stored(finished.id))?.version, 0); // untouched
    });
  });

  describe("access control", () => {
    it("a client lists only their own documents", async () => {
      await upload(clientToken(anna), pdf, "anna.pdf");
      await upload(clientToken(ben), pdf, "ben.pdf");
      const res = await request(app)
        .get("/api/portal/documents")
        .set(auth(clientToken(anna)));
      assert.deepEqual(
        res.body.documents.map((d: { filename: string }) => d.filename),
        ["anna.pdf"],
      );
    });

    it("staff see their brokerage's client documents; another brokerage gets 404", async () => {
      await upload(clientToken(anna));
      const own = await request(app)
        .get(`/api/clients/${anna.clientId}/documents`)
        .set(auth(staffToken(a)));
      assert.equal(own.status, 200);
      assert.equal(own.body.documents.length, 1);

      const foreign = await request(app)
        .get(`/api/clients/${anna.clientId}/documents`)
        .set(auth(staffToken(b)));
      assert.equal(foreign.status, 404);
      assert.equal(
        (
          await request(app)
            .get(`/api/clients/${anna.clientId}`)
            .set(auth(staffToken(b)))
        ).status,
        404,
      );
      assert.equal(
        (
          await request(app)
            .get(`/api/clients/${anna.clientId}`)
            .set(auth(clientToken(anna)))
        ).status,
        403,
      );
    });

    it("a download link goes only to the owner or to staff of the same brokerage", async () => {
      const id = (await upload(clientToken(anna))).body.document.id as string;
      const link = (token: string) =>
        request(app).get(`/api/documents/${id}/link`).set(auth(token));

      const owner = await link(clientToken(anna));
      assert.equal(owner.status, 200);
      assert.match(owner.body.url, /^https:\/\/files\.test\//);
      assert.equal((await link(staffToken(a))).status, 200);
      assert.equal((await link(clientToken(ben))).status, 404); // same brokerage, not theirs
      assert.equal((await link(clientToken(zoe))).status, 404); // another brokerage
      assert.equal((await link(staffToken(b))).status, 404);
      assert.equal(
        (await request(app).get(`/api/documents/${id}/link`)).status,
        401,
      );
    });

    it("only the owner or same-brokerage staff can retry a check", async () => {
      checkerConfig.random = () => 0.01;
      const id = (await upload(clientToken(anna))).body.document.id as string;
      await waitForStatus(id, "failed");
      const recheck = (token: string) =>
        request(app).post(`/api/documents/${id}/recheck`).set(auth(token));

      assert.equal((await recheck(clientToken(ben))).status, 404);
      assert.equal((await recheck(staffToken(b))).status, 404);
      assert.equal((await stored(id))?.status, "failed");
    });
  });

  describe("live status over sockets", () => {
    it("broadcasts every status change to the owner and their staff, and to nobody else", async () => {
      const annaSocket = await connect(clientToken(anna));
      const benSocket = await connect(clientToken(ben));
      const zoeSocket = await connect(clientToken(zoe));
      const staffA = await connect(staffToken(a));
      const staffB = await connect(staffToken(b));
      const pick = (p: { document: { status: string; version: number } }) =>
        `${p.document.status}@${p.document.version}`;
      const seen = {
        anna: collect(annaSocket, "document:changed", pick),
        ben: collect(benSocket, "document:changed", pick),
        zoe: collect(zoeSocket, "document:changed", pick),
        staffA: collect(staffA, "document:changed", pick),
        staffB: collect(staffB, "document:changed", pick),
      };

      const res = await upload(clientToken(anna));
      await waitForStatus(res.body.document.id, "verified");
      await settle();

      const sequence = ["pending@0", "checking@1", "verified@2"];
      assert.deepEqual(seen.anna, sequence);
      assert.deepEqual(seen.staffA, sequence);
      assert.deepEqual(seen.ben, []);
      assert.deepEqual(seen.zoe, []);
      assert.deepEqual(seen.staffB, []);
    });

    it("clients never receive lead events, staff do", async () => {
      const annaSocket = await connect(clientToken(anna));
      const staffA = await connect(staffToken(a));
      const clientLeads = collect(annaSocket, "lead:changed", () => "lead");
      const staffLeads = collect(staffA, "lead:changed", () => "lead");

      const hook = await request(app)
        .post(`/api/leads/webhook/${a}`)
        .send({ name: "New Lead", email: "new@example.de" });
      assert.equal(hook.status, 202);
      await settle();

      assert.equal(staffLeads.length, 1);
      assert.equal(clientLeads.length, 0);
    });

    it("a client token with no case record is refused", async () => {
      const stranger = signToken({
        id: new Types.ObjectId().toString(),
        role: "client",
        brokerageId: a,
      });
      await assert.rejects(connect(stranger), { message: "Forbidden" });
    });
  });
});
