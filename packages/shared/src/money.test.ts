import { describe, it, expect } from "vitest";
import {
  takaToPoisha,
  poishaToTaka,
  groupLakh,
  formatMoney,
} from "./money";

describe("money conversions", () => {
  it("converts taka to integer poisha without float errors", () => {
    expect(takaToPoisha(18400)).toBe(1840000);
    expect(takaToPoisha(0.1)).toBe(10);
    expect(takaToPoisha(1234.56)).toBe(123456);
  });

  it("round-trips", () => {
    expect(poishaToTaka(1840000)).toBe(18400);
  });
});

describe("lakh grouping", () => {
  it("groups in South-Asian style", () => {
    expect(groupLakh("1234567")).toBe("12,34,567");
    expect(groupLakh("1000")).toBe("1,000");
    expect(groupLakh("100")).toBe("100");
    expect(groupLakh("112000")).toBe("1,12,000");
  });
  it("handles negatives", () => {
    expect(groupLakh("-700000")).toBe("-7,00,000");
  });
});

describe("formatMoney", () => {
  it("formats whole taka with symbol", () => {
    expect(formatMoney(1840000)).toBe("Tk 18,400");
    expect(formatMoney(112000000)).toBe("Tk 11,20,000");
  });
  it("omits symbol when asked", () => {
    expect(formatMoney(50000, { symbol: false })).toBe("500");
  });
  it("shows paisa only when non-zero and requested", () => {
    expect(formatMoney(123456, { showPaisa: true })).toBe("Tk 1,234.56");
    expect(formatMoney(120000, { showPaisa: true })).toBe("Tk 1,200");
  });
  it("renders Bangla digits when requested", () => {
    expect(formatMoney(1840000, { bangla: true })).toBe("Tk ১৮,৪০০");
  });
  it("handles negatives (e.g. closing shortfall)", () => {
    expect(formatMoney(-30000)).toBe("Tk -300");
  });
});
