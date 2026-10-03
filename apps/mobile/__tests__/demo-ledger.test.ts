import { describe, expect, it } from "vitest";
import { AGENT_ID, MERCHANT_ID, balanceOf, createSeedDb } from "../lib/demo/ledger";

describe("demo ledger seed", () => {
  const db = createSeedDb();

  it("posts only balanced, positive, integer entries", () => {
    for (const t of db.txns) {
      const debit = t.lines.reduce((s, l) => s + l.debit, 0);
      const credit = t.lines.reduce((s, l) => s + l.credit, 0);
      expect(debit).toBe(credit);
      expect(Number.isSafeInteger(t.amount_minor) && t.amount_minor > 0).toBe(true);
    }
  });

  it("never leaves the drawer or wallets negative", () => {
    for (const id of [MERCHANT_ID, AGENT_ID]) {
      expect(balanceOf(db, id, "1000")).toBeGreaterThanOrEqual(0);
      expect(balanceOf(db, id, "1010")).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps the agent's drawer in a realistic range", () => {
    expect(balanceOf(db, AGENT_ID, "1000")).toBeLessThanOrEqual(15000000);
  });

  it("keeps the agent's other-wallet float in a realistic range", () => {
    for (const wallet of ["bKash", "Nagad", "Rocket"]) {
      expect(balanceOf(db, AGENT_ID, "1030", wallet)).toBeLessThanOrEqual(3000000);
    }
  });
});
