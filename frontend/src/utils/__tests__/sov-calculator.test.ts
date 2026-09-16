import { describe, it, expect } from "vitest";
import type { SovData } from "../../api/client";
import { composeSovCode, calculateElementBV, calculateComboBV } from "../sov-calculator";

/** Minimal SOV stub carrying only the codes these tests touch. */
const sov: SovData = {
  season: "2026-2027",
  elements: {
    "5S":    { category: "single", type: "jump", base_value: 14.00, goe: Array(10).fill(0) },
    "5S<<":  { category: "single", type: "jump", base_value: 9.50, goe: Array(10).fill(0) },
    "4S":    { category: "single", type: "jump", base_value: 9.70, goe: Array(10).fill(0) },
    "3Lz":   { category: "single", type: "jump", base_value: 5.90, goe: Array(10).fill(0) },
    "3Lz<<": { category: "single", type: "jump", base_value: 2.10, goe: Array(10).fill(0) },
    "3Lze":  { category: "single", type: "jump", base_value: 5.31, goe: Array(10).fill(0) },
    "3Lz<":  { category: "single", type: "jump", base_value: 4.72, goe: Array(10).fill(0) },
    "3T":    { category: "single", type: "jump", base_value: 4.20, goe: Array(10).fill(0) },
    "1T":    { category: "single", type: "jump", base_value: 0.40, goe: Array(10).fill(0) },
    "Eu":    { category: "single", type: "jump", base_value: 0.00, goe: Array(10).fill(0) },
    "CCoSp4":  { category: "single", type: "spin", base_value: 4.20, goe: Array(10).fill(0) },
    "CCoSp4V": { category: "single", type: "spin", base_value: 3.15, goe: Array(10).fill(0) },
  },
};

describe("composeSovCode", () => {
  it("resolves << by lookup, not by reducing the rotation", () => {
    expect(composeSovCode("3Lz", ["<<"])).toBe("3Lz<<");
  });

  it("gives a downgraded quint its own value, not the quad's", () => {
    // The whole reason << stopped being a derivation: the old code derived 5S<<
    // as "one rotation less" = 4S = 9.70, but the SOV prices 5S<< at 9.50.
    expect(calculateElementBV(sov, "5S", [])).toBe(14.00);
    expect(calculateElementBV(sov, "5S", ["<<"])).toBe(9.50);
    expect(calculateElementBV(sov, "4S", [])).toBe(9.70);
  });

  it("leaves q and ! out of the lookup code", () => {
    expect(composeSovCode("3Lz", ["q"])).toBe("3Lz");
    expect(composeSovCode("3Lz", ["!"])).toBe("3Lz");
    expect(calculateElementBV(sov, "3Lz", ["q"])).toBe(5.90);
  });

  it("still applies e and < suffixes", () => {
    expect(composeSovCode("3Lz", ["e"])).toBe("3Lze");
    expect(composeSovCode("3Lz", ["<"])).toBe("3Lz<");
  });

  it("still applies V to spins", () => {
    expect(calculateElementBV(sov, "CCoSp4", ["V"])).toBe(3.15);
  });

  it("returns null when the composed code is not in the SOV", () => {
    expect(composeSovCode("1T", ["<<"])).toBe("1T<<");
    expect(calculateElementBV(sov, "1T", ["<<"])).toBe(0);
  });

  it("scores the Euler at zero", () => {
    expect(calculateElementBV(sov, "Eu", [])).toBe(0);
  });

  it("adds nothing to a combination when the Euler sits inside it", () => {
    const withoutEuler = calculateComboBV(
      sov,
      [{ code: "3Lz", markers: [] }, { code: "3T", markers: [] }],
      [],
    );
    const withEuler = calculateComboBV(
      sov,
      [{ code: "3Lz", markers: [] }, { code: "Eu", markers: [] }, { code: "3T", markers: [] }],
      [],
    );
    expect(withEuler).toBe(withoutEuler);
  });

  it("zeroes a cancelled element", () => {
    expect(calculateElementBV(sov, "3Lz", ["*"])).toBe(0);
  });

  it("applies the second-half multiplier", () => {
    expect(calculateElementBV(sov, "3Lz", ["x"])).toBe(6.49);
  });
});
