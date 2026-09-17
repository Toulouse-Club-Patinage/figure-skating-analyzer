import type { ProgramRuleSegment } from "../api/client";
import type { ProgramElement } from "./program-validator";
import { isEuler } from "./program-validator";

export interface BonusLine {
  key: string;
  label: string;
  points: number;
  earned: boolean;
  detail: string;
}

export interface BonusResult {
  lines: BonusLine[];
  total: number;
}

/** The six listed jump types. The Euler is an unlisted jump and is not one. */
const JUMP_TYPES = ["T", "S", "Lo", "F", "Lz", "A"] as const;

interface FlatJump {
  code: string;
  markers: string[];
}

/** Every individual jump in the program, with the markers that apply to it. */
function flattenJumps(elements: ProgramElement[]): FlatJump[] {
  const jumps: FlatJump[] = [];
  for (const el of elements) {
    if (el.type !== "jump") continue;
    if (el.comboJumps?.length) {
      for (const j of el.comboJumps) {
        // Element-level markers (*, x) apply to every jump inside it.
        jumps.push({ code: j.code, markers: [...j.markers, ...el.markers] });
      }
    } else {
      jumps.push({ code: el.baseCode, markers: el.markers });
    }
  }
  return jumps;
}

/** Rotation encoded at the head of a jump code ("3" in "3Lz"). */
function rotation(code: string): number {
  const m = code.match(/^(\d)/);
  return m ? parseInt(m[1], 10) : 0;
}

/** Jump type letter(s) of a code: "3Lz" -> "Lz". Returns null for the Euler. */
function jumpType(code: string): string | null {
  if (isEuler(code)) return null;
  const m = code.match(/^\d(T|S|Lo|Lz|F|A)$/);
  return m ? m[1] : null;
}

/**
 * Régime 1 — Book §4 BONUS, for the 2A and triple bonuses:
 * granted when the jump is clean, at the quarter (q), or on a doubtful edge (!);
 * refused on <, <<, a wrong edge (e), a fall, or an invalidated jump (*).
 */
function qualifiesForJumpBonus(jump: FlatJump): boolean {
  return !jump.markers.some(m => m === "<" || m === "<<" || m === "e" || m === "*");
}

/**
 * Régime 2 — jump variety: the six types must appear "indépendamment de leur
 * nombre de tours", and the only disqualifier is an invalidated jump (*).
 * A downgraded flip is still a flip.
 */
function qualifiesForVariety(jump: FlatJump): boolean {
  return !jump.markers.includes("*");
}

export function computeBonus(
  elements: ProgramElement[],
  rules: ProgramRuleSegment,
): BonusResult {
  const bonus = rules.bonus;
  if (!bonus) return { lines: [], total: 0 };

  const jumps = flattenJumps(elements);
  const lines: BonusLine[] = [];

  if (bonus.double_axel != null) {
    const earned = jumps.some(
      j => j.code.startsWith("2A") && qualifiesForJumpBonus(j),
    );
    lines.push({
      key: "double_axel",
      label: "Double Axel",
      points: bonus.double_axel,
      earned,
      detail: earned ? "2A validé" : "Aucun 2A validé",
    });
  }

  const validTriples = jumps.filter(
    j => rotation(j.code) === 3 && jumpType(j.code) && qualifiesForJumpBonus(j),
  );
  const distinctTriples = [...new Set(validTriples.map(j => j.code.slice(0, 3)))];

  if (bonus.triple != null) {
    const earned = distinctTriples.length >= 1;
    lines.push({
      key: "triple",
      label: "Triple saut",
      points: bonus.triple,
      earned,
      detail: earned ? `${distinctTriples[0]} validé` : "Aucun triple validé",
    });
  }

  if (bonus.second_different_triple != null) {
    const earned = distinctTriples.length >= 2;
    lines.push({
      key: "second_different_triple",
      label: "2ᵉ triple différent",
      points: bonus.second_different_triple,
      earned,
      detail: earned
        ? `${distinctTriples[0]} + ${distinctTriples[1]}`
        : "Pas de second triple différent",
    });
  }

  if (bonus.jump_variety != null) {
    const anyCancelled = jumps.some(j => !qualifiesForVariety(j));
    const present = new Set(
      jumps
        .filter(qualifiesForVariety)
        .map(j => jumpType(j.code))
        .filter((t): t is string => t !== null),
    );
    const missing = JUMP_TYPES.filter(t => !present.has(t));
    const earned = !anyCancelled && missing.length === 0;
    lines.push({
      key: "jump_variety",
      label: "Variété des sauts",
      points: bonus.jump_variety,
      earned,
      detail: anyCancelled
        ? "Saut invalidé (*) dans le programme"
        : missing.length === 0
          ? "Les 6 types présents"
          : `Manque : ${missing.join(", ")}`,
    });
  }

  if (bonus.death_spiral_level2 != null) {
    const earned = elements.some(
      el =>
        el.type === "death_spiral" &&
        !el.markers.includes("*") &&
        (parseInt(el.baseCode.slice(-1), 10) || 0) >= 2,
    );
    lines.push({
      key: "death_spiral_level2",
      label: "Spirale de la mort niv. 2+",
      points: bonus.death_spiral_level2,
      earned,
      detail: earned ? "Niveau 2 minimum atteint" : "Niveau 2 non atteint",
    });
  }

  const total = lines.reduce((sum, l) => sum + (l.earned ? l.points : 0), 0);
  return { lines, total };
}
