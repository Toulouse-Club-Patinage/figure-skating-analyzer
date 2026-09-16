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
});
