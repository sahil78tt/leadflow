import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";

process.env.MONGODB_URI = "mongodb://unused";
process.env.JWT_SECRET = "x".repeat(40);

const { authenticate, requireRole } = await import("./auth.js");
const { signToken } = await import("../lib/jwt.js");

function run(mw: (...a: never[]) => unknown, req: Partial<Request>) {
  let status = 0;
  let nexted = false;
  const res = {
    status(s: number) {
      status = s;
      return this;
    },
    json() {
      return this;
    },
  } as unknown as Response;
  mw(
    req as never,
    res as never,
    (() => {
      nexted = true;
    }) as never,
  );
  return { status, nexted };
}

describe("requireRole", () => {
  it("rejects a role not in the allow-list with 403", () => {
    const r = run(requireRole("brokerage_admin"), {
      user: { id: "1", role: "advisor", brokerageId: "b1" },
    });
    assert.equal(r.status, 403);
    assert.equal(r.nexted, false);
  });
  it("allows a listed role", () => {
    const r = run(requireRole("advisor", "brokerage_admin"), {
      user: { id: "1", role: "advisor", brokerageId: "b1" },
    });
    assert.equal(r.nexted, true);
  });
});

describe("authenticate", () => {
  it("401s on missing and on tampered tokens", () => {
    assert.equal(run(authenticate, { headers: {} }).status, 401);
    const token = signToken({ id: "1", role: "advisor", brokerageId: "b1" });
    assert.equal(
      run(authenticate, { headers: { authorization: `Bearer ${token}x` } })
        .status,
      401,
    );
  });
  it("attaches user and calls next on a valid token", () => {
    const token = signToken({ id: "1", role: "advisor", brokerageId: "b1" });
    const req: Partial<Request> = {
      headers: { authorization: `Bearer ${token}` },
    };
    assert.equal(run(authenticate, req).nexted, true);
    assert.deepEqual(req.user, { id: "1", role: "advisor", brokerageId: "b1" });
  });
});
