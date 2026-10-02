import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeEmail, normalizePhone } from "./normalize.js";

describe("normalizePhone", () => {
  it("maps every common German notation to one value", () => {
    const variants = [
      "+49 170 1234567",
      "0170 1234567",
      "0049 170 1234567",
      "+49 (0) 170 1234567",
      "(0170) 123-4567",
      "0170/1234567",
      "491701234567",
    ];
    for (const v of variants)
      assert.equal(normalizePhone(v), "+491701234567", v);
  });

  it("keeps other countries distinct", () => {
    assert.equal(normalizePhone("+43 660 1234567"), "+436601234567");
    assert.equal(normalizePhone("+1 (415) 555-2671"), "+14155552671");
  });

  it("rejects values that cannot be a phone number", () => {
    for (const v of [
      "",
      "abc",
      "123",
      "+49 170 12345678901234567",
      undefined,
      null,
    ]) {
      assert.equal(normalizePhone(v), undefined, String(v));
    }
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases, and treats blank as missing", () => {
    assert.equal(normalizeEmail("  Max@Example.DE "), "max@example.de");
    assert.equal(normalizeEmail(""), undefined);
    assert.equal(normalizeEmail(undefined), undefined);
  });
});
