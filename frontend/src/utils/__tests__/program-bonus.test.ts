import { describe, it, expect } from "vitest";
import type { ProgramRuleSegment } from "../../api/client";
import type { ProgramElement } from "../program-validator";
import { computeBonus } from "../program-bonus";

let seq = 0;
function jump(code: string, markers: string[] = []): ProgramElement {
  return {
    id: `el-${seq++}`,
    baseCode: code,
    type: "jump",
    markers: [],
    comboJumps: [{ code, markers }],
    bv: 0, min: 0, max: 0,
  };
}

const advNoviceFS: ProgramRuleSegment = {
  bonus: { double_axel: 1, triple: 1, second_different_triple: 1, jump_variety: 2 },
};

function line(result: ReturnType<typeof computeBonus>, key: string) {
  return result.lines.find(l => l.key === key);
}

describe("jump bonuses (régime 1)", () => {
  it("awards the 2A bonus on a clean double Axel", () => {
    const r = computeBonus([jump("2A")], advNoviceFS);
    expect(line(r, "double_axel")?.earned).toBe(true);
    expect(r.total).toBe(1);
  });

  it("awards it on q and !", () => {
    expect(line(computeBonus([jump("2A", ["q"])], advNoviceFS), "double_axel")?.earned).toBe(true);
    expect(line(computeBonus([jump("2F", ["!"])], advNoviceFS), "triple")?.earned).toBe(false);
    expect(line(computeBonus([jump("3F", ["!"])], advNoviceFS), "triple")?.earned).toBe(true);
  });

  it("refuses it on <, << and e", () => {
    for (const marker of ["<", "<<", "e"]) {
      const r = computeBonus([jump("2A", [marker])], advNoviceFS);
      expect(line(r, "double_axel")?.earned, marker).toBe(false);
    }
  });

  it("awards a second triple bonus only for a different triple", () => {
    const same = computeBonus([jump("3T"), jump("3T")], advNoviceFS);
    expect(line(same, "second_different_triple")?.earned).toBe(false);

    const different = computeBonus([jump("3T"), jump("3S")], advNoviceFS);
    expect(line(different, "second_different_triple")?.earned).toBe(true);
  });
});

describe("jump variety bonus (régime 2)", () => {
  const sixTypes = () => [
    jump("1T"), jump("2S"), jump("2Lo"), jump("2F"), jump("2Lz"), jump("1A"),
  ];

  it("is awarded when all six jump types are present", () => {
    const r = computeBonus(sixTypes(), advNoviceFS);
    expect(line(r, "jump_variety")?.earned).toBe(true);
    expect(line(r, "jump_variety")?.points).toBe(2);
  });

  it("still counts a jump marked <, << or e as its type", () => {
    const elements = [
      jump("1T", ["<<"]), jump("2S", ["<"]), jump("2Lo", ["<<"]),
      jump("2F", ["e"]), jump("2Lz", ["e"]), jump("1A", ["<"]),
    ];
    const r = computeBonus(elements, advNoviceFS);
    expect(line(r, "jump_variety")?.earned).toBe(true);
  });

  it("is lost when any jump in the program is cancelled", () => {
    const elements = sixTypes();
    elements[0] = jump("1T", ["*"]);
    expect(line(computeBonus(elements, advNoviceFS), "jump_variety")?.earned).toBe(false);
  });

  it("is not awarded when a type is missing", () => {
    const r = computeBonus(sixTypes().slice(0, 5), advNoviceFS);
    expect(line(r, "jump_variety")?.earned).toBe(false);
  });

  it("does not count the Euler as a jump type", () => {
    const elements = [...sixTypes().slice(0, 5), jump("Eu")];
    expect(line(computeBonus(elements, advNoviceFS), "jump_variety")?.earned).toBe(false);
  });
});

describe("the two regimes diverge", () => {
  it("keeps the variety bonus while losing the jump bonuses", () => {
    // Six types present, but the 2A and the triple are downgraded.
    const elements = [
      jump("2A", ["<<"]), jump("3T", ["<<"]), jump("2S"),
      jump("2Lo"), jump("2F"), jump("2Lz"),
    ];
    const r = computeBonus(elements, advNoviceFS);
    expect(line(r, "jump_variety")?.earned).toBe(true);
    expect(line(r, "double_axel")?.earned).toBe(false);
    expect(line(r, "triple")?.earned).toBe(false);
    expect(r.total).toBe(2);
  });
});

describe("categories without bonuses", () => {
  it("returns an empty result", () => {
    const r = computeBonus([jump("2A")], {});
    expect(r.lines).toHaveLength(0);
    expect(r.total).toBe(0);
  });
});
