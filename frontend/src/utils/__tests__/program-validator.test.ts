import { describe, it, expect } from "vitest";
import type { ProgramRuleSegment } from "../../api/client";
import type { ProgramElement } from "../program-validator";
import { validateProgram, countListedJumps } from "../program-validator";

let seq = 0;
function jump(codes: string[], markers: string[] = []): ProgramElement {
  return {
    id: `el-${seq++}`,
    baseCode: codes.join("+"),
    type: "jump",
    markers,
    comboJumps: codes.map(code => ({ code, markers: [] })),
    bv: 0, min: 0, max: 0,
  };
}

const freeSkating: ProgramRuleSegment = {
  label: "Programme Libre",
  max_jump_elements: 6,
  euler_allowed: true,
};

const shortProgram: ProgramRuleSegment = {
  label: "Programme Court",
  max_jump_elements: 3,
  euler_allowed: false,
};

function ruleOf(results: ReturnType<typeof validateProgram>, rule: string) {
  return results.find(r => r.rule === rule);
}

describe("Euler", () => {
  it("is not counted among the listed jumps of a combination", () => {
    expect(countListedJumps(jump(["3F", "Eu", "3S"]))).toBe(2);
    expect(countListedJumps(jump(["3Lz", "3T"]))).toBe(2);
    expect(countListedJumps(jump(["3Lz"]))).toBe(1);
  });

  it("is rejected in a short program", () => {
    const results = validateProgram([jump(["3F", "Eu", "3S"])], shortProgram);
    expect(ruleOf(results, "euler_allowed")?.status).toBe("error");
  });

  it("is accepted once in a free program", () => {
    const results = validateProgram([jump(["3F", "Eu", "3S"])], freeSkating);
    expect(ruleOf(results, "euler_count")?.status).toBe("ok");
  });

  it("is accepted in a sequence, not only a combination", () => {
    const results = validateProgram([jump(["3F", "Eu", "2A"])], freeSkating);
    expect(ruleOf(results, "euler_count")?.status).toBe("ok");
  });

  it("is rejected twice in the same program, across two elements", () => {
    const results = validateProgram(
      [jump(["3F", "Eu", "3S"]), jump(["2Lz", "Eu", "2S"])],
      freeSkating,
    );
    expect(ruleOf(results, "euler_count")?.status).toBe("error");
    expect(ruleOf(results, "euler_count")?.detail).toContain("2/1");
  });

  const regional3NiveauA: ProgramRuleSegment = {
    label: "Régional 3 - Niveau A",
    allowed_jumps: ["1S", "1T", "1Lo", "1F", "1Lz"],
    euler_allowed: true,
  };

  it("does not contradict euler_allowed: an Euler is not an unlisted jump under allowed_jumps", () => {
    const results = validateProgram([jump(["1F", "Eu", "1S"])], regional3NiveauA);
    expect(ruleOf(results, "allowed_jumps")?.status).toBe("ok");
    expect(ruleOf(results, "euler_count")?.status).toBe("ok");
  });

  it("recognises the pre-2026 '1Eu' notation used by imported protocols", () => {
    expect(countListedJumps(jump(["3F", "1Eu", "3S"]))).toBe(2);

    const results = validateProgram(
      [jump(["3F", "Eu", "3S"]), jump(["2Lz", "1Eu", "2S"])],
      freeSkating,
    );
    expect(ruleOf(results, "euler_count")?.status).toBe("error");
    expect(ruleOf(results, "euler_count")?.detail).toContain("2/1");
  });
});

function spin(code: string): ProgramElement {
  return { id: `el-${seq++}`, baseCode: code, type: "spin", markers: [], bv: 0, min: 0, max: 0 };
}

const seniorFreeSkating: ProgramRuleSegment = {
  label: "Programme Libre",
  max_jump_elements: 6,
  max_spins: 3,
  requires_choreo_spin: true,
  euler_allowed: true,
};

describe("choreographic spin", () => {
  it("counts toward max_spins", () => {
    const results = validateProgram(
      [spin("FCCoSp4"), spin("CSSp4"), spin("ChSp1")],
      seniorFreeSkating,
    );
    expect(ruleOf(results, "max_spins")?.detail).toBe("3/3");
    expect(ruleOf(results, "max_spins")?.status).toBe("ok");
  });

  it("is flagged as missing when the category requires it", () => {
    const results = validateProgram(
      [spin("FCCoSp4"), spin("CSSp4"), spin("CCoSp4")],
      seniorFreeSkating,
    );
    expect(ruleOf(results, "requires_choreo_spin")?.status).toBe("warning");
  });

  it("is satisfied when present", () => {
    const results = validateProgram(
      [spin("FCCoSp4"), spin("ChSp1")],
      seniorFreeSkating,
    );
    expect(ruleOf(results, "requires_choreo_spin")?.status).toBe("ok");
  });

  it("is not checked for categories that do not require it", () => {
    const results = validateProgram([spin("CCoSp4")], { max_spins: 2 });
    expect(ruleOf(results, "requires_choreo_spin")).toBeUndefined();
  });
});

const seniorPL: ProgramRuleSegment = {
  max_jump_elements: 6, quads_allowed: true, quints_allowed: true, euler_allowed: true,
};
const juniorPL: ProgramRuleSegment = {
  max_jump_elements: 6, quads_allowed: false, quints_allowed: false, euler_allowed: true,
};

describe("quint jumps", () => {
  it("are rejected in a category that forbids them", () => {
    const results = validateProgram([jump(["5Lz"])], juniorPL);
    expect(ruleOf(results, "quints_allowed")?.status).toBe("error");
  });

  it("are accepted as a solo jump in ISU Senior free skating", () => {
    const results = validateProgram([jump(["5Lz"])], seniorPL);
    expect(ruleOf(results, "quints_allowed")).toBeUndefined();
    expect(ruleOf(results, "quint_solo_only")?.status).toBe("ok");
  });

  it("are rejected inside a combination even where allowed", () => {
    const results = validateProgram([jump(["5Lz", "3T"])], seniorPL);
    expect(ruleOf(results, "quint_solo_only")?.status).toBe("error");
  });

  it("are rejected inside a sequence even where allowed", () => {
    const results = validateProgram([jump(["5Lz", "Eu", "2A"])], seniorPL);
    expect(ruleOf(results, "quint_solo_only")?.status).toBe("error");
  });
});
