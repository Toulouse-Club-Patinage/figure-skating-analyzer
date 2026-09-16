import type { ProgramRuleSegment } from "../api/client";

/**
 * A program element as stored in the builder state.
 */
export interface ProgramElement {
  id: string; // unique ID for React keys
  baseCode: string; // original code without markers (e.g., "3Lz")
  type: "jump" | "spin" | "step" | "choreo" | "lift" | "throw" | "twist" | "death_spiral" | "pair_spin" | "pivot";
  markers: string[]; // active markers on this element
  // For combos: array of jumps with individual markers
  comboJumps?: { code: string; markers: string[] }[];
  bv: number;
  min: number;
  max: number;
}

export interface ValidationResult {
  rule: string;
  label: string;
  status: "ok" | "warning" | "error";
  detail: string;
}

/**
 * Extract the jump rotation from a code (e.g., 3 from "3Lz").
 */
function jumpRotation(code: string): number {
  const m = code.match(/^(\d)/);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * Check if a jump code is a triple (rotation 3).
 */
function isTriple(code: string): boolean {
  return jumpRotation(code) === 3;
}

/**
 * Check if a jump code is a quad (rotation 4+).
 */
function isQuad(code: string): boolean {
  return jumpRotation(code) >= 4;
}

/** The Euler is an unlisted jump: worth nothing and outside the jump count. */
export function isEuler(code: string): boolean {
  return code === "Eu";
}

/**
 * Number of *listed* jumps in an element. The Euler is excluded — the Book:
 * "il ne sera pas considéré comme un saut listé et ne comptera pas dans le
 * nombre de sauts autorisés dans la combo ou la séquence concernée".
 */
export function countListedJumps(element: ProgramElement): number {
  const codes = element.comboJumps?.map(j => j.code) ?? [element.baseCode];
  return codes.filter(c => !isEuler(c)).length;
}

/** Total Eulers across the whole program. */
function countEulers(elements: ProgramElement[]): number {
  let total = 0;
  for (const el of elements) {
    const codes = el.comboJumps?.map(j => j.code) ?? [el.baseCode];
    total += codes.filter(isEuler).length;
  }
  return total;
}

/**
 * Validate a program against a specific category segment's rules.
 * Returns a list of validation results (pass, warning, or violation).
 */
export function validateProgram(
  elements: ProgramElement[],
  rules: ProgramRuleSegment,
): ValidationResult[] {
  const results: ValidationResult[] = [];

  // Count elements by type
  const jumpElements = elements.filter(e => e.type === "jump");
  const spinElements = elements.filter(e => e.type === "spin" || e.type === "pair_spin");
  const stepElements = elements.filter(e => e.type === "step");
  const choreoElements = elements.filter(e => e.type === "choreo");
  const combos = elements.filter(e => e.comboJumps && e.comboJumps.length > 1);

  // Collect all individual jumps (including from combos)
  const allJumpCodes: string[] = [];
  for (const el of jumpElements) {
    if (el.comboJumps && el.comboJumps.length > 1) {
      for (const j of el.comboJumps) allJumpCodes.push(j.code);
    } else {
      allJumpCodes.push(el.baseCode);
    }
  }

  // Max jump elements
  if (rules.max_jump_elements != null) {
    const count = jumpElements.length;
    const max = rules.max_jump_elements;
    results.push({
      rule: "max_jump_elements",
      label: "Éléments sauts",
      status: count > max ? "error" : count < max ? "warning" : "ok",
      detail: `${count}/${max}`,
    });
  }

  // Max spins
  if (rules.max_spins != null) {
    const count = spinElements.length;
    const max = rules.max_spins;
    results.push({
      rule: "max_spins",
      label: "Pirouettes",
      status: count > max ? "error" : count < max ? "warning" : "ok",
      detail: `${count}/${max}`,
    });
  }

  // Choreographic spin — counted among the spins, mandatory for ISU Senior/Junior FS
  if (rules.requires_choreo_spin) {
    const hasChoreoSpin = spinElements.some(e => e.baseCode.startsWith("ChSp"));
    results.push({
      rule: "requires_choreo_spin",
      label: "Pirouette chorégraphique",
      status: hasChoreoSpin ? "ok" : "warning",
      detail: hasChoreoSpin
        ? "Présente"
        : "Absente — requise dans cette catégorie",
    });
  }

  // Max steps
  if (rules.max_steps != null) {
    const count = stepElements.length;
    const max = rules.max_steps;
    results.push({
      rule: "max_steps",
      label: "Pas",
      status: count > max ? "error" : count < max ? "warning" : "ok",
      detail: `${count}/${max}`,
    });
  }

  // Max choreo
  if (rules.max_choreo != null) {
    const count = choreoElements.length;
    const max = rules.max_choreo;
    results.push({
      rule: "max_choreo",
      label: "Chorégraphique",
      status: count > max ? "error" : count < max ? "warning" : "ok",
      detail: `${count}/${max}`,
    });
  }

  // Triples allowed
  if (rules.triples_allowed === false) {
    const hasTriple = allJumpCodes.some(isTriple);
    results.push({
      rule: "triples_allowed",
      label: "Triples",
      status: hasTriple ? "error" : "ok",
      detail: hasTriple ? "Triples présents — interdit" : "Aucun triple",
    });
  }

  // Quads allowed
  if (rules.quads_allowed === false) {
    const hasQuad = allJumpCodes.some(isQuad);
    results.push({
      rule: "quads_allowed",
      label: "Quadruples",
      status: hasQuad ? "error" : "ok",
      detail: hasQuad ? "Quadruples présents — interdit" : "Aucun quadruple",
    });
  }

  // Max jump level (rotation)
  if (rules.max_jump_level != null) {
    const maxRot = Math.max(0, ...allJumpCodes.map(jumpRotation));
    const allowed = rules.max_jump_level;
    results.push({
      rule: "max_jump_level",
      label: "Niveau max sauts",
      status: maxRot > allowed ? "error" : "ok",
      detail: maxRot > allowed
        ? `Rotation ${maxRot} — max autorisé : ${allowed}`
        : `Max ${maxRot}/${allowed}`,
    });
  }

  // Max spin level
  if (rules.max_spin_level != null) {
    const spinLevels = spinElements.map(e => {
      const m = e.baseCode.match(/(\d)V?$/);
      return m ? parseInt(m[1], 10) : 0;
    });
    const maxLevel = Math.max(0, ...spinLevels);
    const allowed = rules.max_spin_level;
    results.push({
      rule: "max_spin_level",
      label: "Niveau max pirouettes",
      status: maxLevel > allowed ? "error" : "ok",
      detail: `Niveau ${maxLevel}/${allowed}`,
    });
  }

  // Allowed jumps (for Régional 3)
  if (rules.allowed_jumps) {
    const forbidden = allJumpCodes.filter(c => !rules.allowed_jumps!.includes(c));
    results.push({
      rule: "allowed_jumps",
      label: "Sauts autorisés",
      status: forbidden.length > 0 ? "error" : "ok",
      detail: forbidden.length > 0
        ? `Non autorisés : ${forbidden.join(", ")}`
        : `Tous autorisés (${rules.allowed_jumps.join(", ")})`,
    });
  }

  // Allowed spin types (for Régional 3)
  if (rules.allowed_spin_types) {
    const spinBaseCodes = spinElements.map(e => e.baseCode.replace(/[BV\d]+$/, ""));
    const forbidden = spinBaseCodes.filter(c => !rules.allowed_spin_types!.includes(c));
    results.push({
      rule: "allowed_spin_types",
      label: "Types pirouettes",
      status: forbidden.length > 0 ? "error" : "ok",
      detail: forbidden.length > 0
        ? `Non autorisés : ${forbidden.join(", ")}`
        : "Tous autorisés",
    });
  }

  // Combo rules
  if (rules.combo_allowed === false && combos.length > 0) {
    results.push({
      rule: "combo_allowed",
      label: "Combinaisons",
      status: "error",
      detail: "Combinaisons interdites pour cette catégorie",
    });
  } else if (rules.max_combos != null) {
    results.push({
      rule: "max_combos",
      label: "Combinaisons",
      status: combos.length > rules.max_combos ? "error" : combos.length < rules.max_combos ? "warning" : "ok",
      detail: `${combos.length}/${rules.max_combos}`,
    });
  }

  // Axel required (for PC)
  if (rules.axel_required) {
    const hasAxel = allJumpCodes.some(c => /\dA$/.test(c));
    results.push({
      rule: "axel_required",
      label: "Axel requis",
      status: hasAxel ? "ok" : "warning",
      detail: hasAxel ? "Axel présent" : "Pas d'Axel (requis en PC)",
    });
  }

  // Euler — forbidden in short programs, at most one per free program
  const eulerCount = countEulers(elements);
  if (rules.euler_allowed === false) {
    results.push({
      rule: "euler_allowed",
      label: "Euler",
      status: eulerCount > 0 ? "error" : "ok",
      detail: eulerCount > 0
        ? "Euler interdit en programme court"
        : "Aucun Euler",
    });
  } else if (eulerCount > 0) {
    results.push({
      rule: "euler_count",
      label: "Euler",
      status: eulerCount > 1 ? "error" : "ok",
      detail: eulerCount > 1
        ? `${eulerCount}/1 — un seul Euler autorisé sur l'ensemble du programme`
        : "1/1",
    });
  }

  // Total elements
  if (rules.total_elements != null) {
    const total = elements.length;
    const max = rules.total_elements;
    results.push({
      rule: "total_elements",
      label: "Total éléments",
      status: total > max ? "error" : total < max ? "warning" : "ok",
      detail: `${total}/${max}`,
    });
  }

  return results;
}

/**
 * Count violations (error status) in validation results.
 */
export function countViolations(results: ValidationResult[]): number {
  return results.filter(r => r.status === "error").length;
}
