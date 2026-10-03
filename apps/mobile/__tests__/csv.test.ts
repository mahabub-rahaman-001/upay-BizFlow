import { describe, expect, it } from "vitest";
import { rowsToCsv } from "../lib/csv";

describe("rowsToCsv", () => {
  it("keeps integer minor units and escapes spreadsheet cells", () => {
    const csv = rowsToCsv(["note", "amount_minor"], [
      { note: "rent, October", amount_minor: 12500 },
      { note: "said \"paid\"", amount_minor: 300 },
    ]);
    expect(csv).toContain('"rent, October",12500');
    expect(csv).toContain('"said ""paid""",300');
    expect(csv.startsWith("\uFEFF")).toBe(true);
  });
});
