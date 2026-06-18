import { describe, expect, it } from "vitest";
import { dollarsFlooredToCents } from "../src/money.js";

describe("dollarsFlooredToCents (run.cost)", () => {
  it("floors micro-USD to whole cents, fixed 2dp, never rounding up", () => {
    expect(dollarsFlooredToCents(5)).toBe("0.00"); // 5 µUSD < 1 cent
    expect(dollarsFlooredToCents(9_999)).toBe("0.00"); // just under a cent
    expect(dollarsFlooredToCents(10_000)).toBe("0.01"); // exactly 1 cent
    expect(dollarsFlooredToCents(20_000)).toBe("0.02");
    expect(dollarsFlooredToCents(1_234_500)).toBe("1.23"); // floors 1.2345 → 1.23
    expect(dollarsFlooredToCents(1_000_000)).toBe("1.00");
    expect(dollarsFlooredToCents(12_345_678)).toBe("12.34");
  });

  it("treats null/undefined/0 as 0.00", () => {
    expect(dollarsFlooredToCents(0)).toBe("0.00");
    expect(dollarsFlooredToCents(null)).toBe("0.00");
    expect(dollarsFlooredToCents(undefined)).toBe("0.00");
  });

  it("handles very large runs without float drift (BigInt)", () => {
    expect(dollarsFlooredToCents(9_999_999_999_999)).toBe("9999999.99");
  });
});
