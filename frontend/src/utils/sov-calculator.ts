import type { SovData, SovElement } from "../api/client";

/**
 * Compose the SOV lookup code from a base element code and its active markers.
 *
 * - Markers `e` and `<` add suffixes to the code (order: `e` then `<`).
 * - Marker `<<` adds a `<<` suffix. Since 2026-2027 the SOV ships an explicit row
 *   for every downgraded jump, so this is a lookup and no longer a rotation-1
 *   derivation — the two disagree for quints (5S<< is 9.50, 4S is 9.70).
 * - Marker `V` adds `V` suffix (spins only — e.g., CCoSp3 → CCoSp3V).
 * - Markers `q`, `!`, `*`, `x`, `+REP` do NOT affect the SOV lookup code.
 *
 * The return type stays `string | null` so callers need no change, but composing
 * can no longer fail: every marker combination is a suffix. A code with no SOV row
 * (1T<<) is caught downstream by the lookup, which returns 0.
 */
export function composeSovCode(baseCode: string, markers: string[]): string | null {
  const hasDowngrade = markers.includes("<<");
  const hasEdge = markers.includes("e");
  const hasUnderRotation = markers.includes("<");
  const hasV = markers.includes("V");

  let code = baseCode;

  if (hasV) code += "V";
  if (hasEdge) code += "e";
  if (hasDowngrade) code += "<<";
  else if (hasUnderRotation) code += "<";

  return code;
}

/**
 * Look up a SOV element by its composed code.
 */
export function lookupSov(sov: SovData, code: string): SovElement | null {
  return sov.elements[code] ?? null;
}

/**
 * Calculate the effective base value for a single element (not a combo).
 */
export function calculateElementBV(
  sov: SovData,
  baseCode: string,
  markers: string[],
): number {
  if (markers.includes("*")) return 0;

  const sovCode = composeSovCode(baseCode, markers);
  if (!sovCode) return 0;

  const element = lookupSov(sov, sovCode);
  if (!element) return 0;

  let bv = element.base_value;

  if (markers.includes("x")) bv *= 1.10;
  if (markers.includes("+REP")) bv *= 0.70;

  return Math.round(bv * 100) / 100;
}

/**
 * Get the GOE array for an element after marker application.
 */
export function getElementGoe(
  sov: SovData,
  baseCode: string,
  markers: string[],
): number[] | null {
  if (markers.includes("*")) return null;

  const sovCode = composeSovCode(baseCode, markers);
  if (!sovCode) return null;

  const element = lookupSov(sov, sovCode);
  return element?.goe ?? null;
}

/**
 * A single jump within a combo/sequence, with its own code and markers.
 */
export interface ComboJump {
  code: string;
  markers: string[];
}

/**
 * Calculate base value for a combo/sequence.
 * Sum of individual jump BVs (after per-jump markers), then apply combo-level multiplicators.
 */
export function calculateComboBV(
  sov: SovData,
  jumps: ComboJump[],
  comboMarkers: string[],
): number {
  if (comboMarkers.includes("*")) return 0;

  let totalBV = 0;
  for (const jump of jumps) {
    const jumpMarkersForBV = jump.markers.filter(m => !["x", "+REP"].includes(m));
    const bv = calculateElementBV(sov, jump.code, jumpMarkersForBV);
    totalBV += bv;
  }

  if (comboMarkers.includes("x")) totalBV *= 1.10;
  if (comboMarkers.includes("+REP")) totalBV *= 0.70;

  return Math.round(totalBV * 100) / 100;
}

/**
 * Calculate min score (BV + GOE at -5) for a single element.
 */
export function calculateElementMin(
  sov: SovData,
  baseCode: string,
  markers: string[],
): number {
  const bv = calculateElementBV(sov, baseCode, markers);
  const goe = getElementGoe(sov, baseCode, markers);
  if (!goe) return bv;
  return Math.round((bv + goe[0]) * 100) / 100;
}

/**
 * Calculate max score (BV + GOE at +5) for a single element.
 */
export function calculateElementMax(
  sov: SovData,
  baseCode: string,
  markers: string[],
): number {
  const bv = calculateElementBV(sov, baseCode, markers);
  const goe = getElementGoe(sov, baseCode, markers);
  if (!goe) return bv;
  return Math.round((bv + goe[9]) * 100) / 100;
}

/**
 * Get full GOE breakdown for hover tooltips.
 */
export function getGoeBreakdown(
  sov: SovData,
  baseCode: string,
  markers: string[],
  side: "negative" | "positive",
): { level: number; value: number }[] | null {
  const goe = getElementGoe(sov, baseCode, markers);
  if (!goe) return null;

  const bv = calculateElementBV(sov, baseCode, markers);

  if (side === "negative") {
    return [
      { level: -1, value: Math.round((bv + goe[4]) * 100) / 100 },
      { level: -2, value: Math.round((bv + goe[3]) * 100) / 100 },
      { level: -3, value: Math.round((bv + goe[2]) * 100) / 100 },
      { level: -4, value: Math.round((bv + goe[1]) * 100) / 100 },
      { level: -5, value: Math.round((bv + goe[0]) * 100) / 100 },
    ];
  }

  return [
    { level: +1, value: Math.round((bv + goe[5]) * 100) / 100 },
    { level: +2, value: Math.round((bv + goe[6]) * 100) / 100 },
    { level: +3, value: Math.round((bv + goe[7]) * 100) / 100 },
    { level: +4, value: Math.round((bv + goe[8]) * 100) / 100 },
    { level: +5, value: Math.round((bv + goe[9]) * 100) / 100 },
  ];
}

/**
 * Get full GOE breakdown for a combo element (sum of individual jump GOE at each level).
 */
export function getComboGoeBreakdown(
  sov: SovData,
  jumps: ComboJump[],
  comboMarkers: string[],
  side: "negative" | "positive",
): { level: number; value: number }[] | null {
  if (comboMarkers.includes("*")) return null;

  // Collect GOE arrays for each jump
  const jumpGoes: number[][] = [];
  let totalBV = 0;
  for (const jump of jumps) {
    const jumpMarkers = jump.markers.filter(m => !["x", "+REP"].includes(m));
    const goe = getElementGoe(sov, jump.code, jumpMarkers);
    if (!goe) return null;
    jumpGoes.push(goe);
    totalBV += calculateElementBV(sov, jump.code, jumpMarkers);
  }

  // Apply combo-level multipliers to totalBV
  if (comboMarkers.includes("x")) totalBV *= 1.10;
  if (comboMarkers.includes("+REP")) totalBV *= 0.70;
  totalBV = Math.round(totalBV * 100) / 100;

  // Sum GOE at each level across jumps
  if (side === "negative") {
    return [
      { level: -1, value: Math.round((totalBV + jumpGoes.reduce((s, g) => s + g[4], 0)) * 100) / 100 },
      { level: -2, value: Math.round((totalBV + jumpGoes.reduce((s, g) => s + g[3], 0)) * 100) / 100 },
      { level: -3, value: Math.round((totalBV + jumpGoes.reduce((s, g) => s + g[2], 0)) * 100) / 100 },
      { level: -4, value: Math.round((totalBV + jumpGoes.reduce((s, g) => s + g[1], 0)) * 100) / 100 },
      { level: -5, value: Math.round((totalBV + jumpGoes.reduce((s, g) => s + g[0], 0)) * 100) / 100 },
    ];
  }

  return [
    { level: +1, value: Math.round((totalBV + jumpGoes.reduce((s, g) => s + g[5], 0)) * 100) / 100 },
    { level: +2, value: Math.round((totalBV + jumpGoes.reduce((s, g) => s + g[6], 0)) * 100) / 100 },
    { level: +3, value: Math.round((totalBV + jumpGoes.reduce((s, g) => s + g[7], 0)) * 100) / 100 },
    { level: +4, value: Math.round((totalBV + jumpGoes.reduce((s, g) => s + g[8], 0)) * 100) / 100 },
    { level: +5, value: Math.round((totalBV + jumpGoes.reduce((s, g) => s + g[9], 0)) * 100) / 100 },
  ];
}

/**
 * Check if an element code is a Flip or Lutz (for edge marker compatibility).
 */
export function isFlipOrLutz(code: string): boolean {
  return /\d[FL](?:lz|$)/i.test(code) || code.endsWith("F") || code.endsWith("Lz");
}

/**
 * Check if an element code represents a jump (for combo/modifier logic).
 */
export function isJump(sov: SovData, code: string): boolean {
  const el = sov.elements[code];
  return el?.type === "jump";
}

/**
 * A "clean" code carries no execution marker.
 *
 * Since 2026-2027 the SOV ships an explicit row for every marker combination
 * (3Lzq, 3Lz!, 3Lz<<, 3Lze<<, 4Tw1<<...), so the picker has to allow-list
 * rather than exclude the handful of shapes the 2025-26 dataset happened to use.
 *
 * Levels and rotations are part of the code, not markers, so digits stay allowed:
 * CCoSp4, ChSp1, StSq3, 3Lz, 1A are all clean. No legitimate element code ends
 * in q, e or V — verified against the generated dataset in step 5.
 */
function isCleanCode(code: string): boolean {
  // Rejects the non-alphanumeric markers: <, <<, !, *, +
  if (!/^[A-Za-z0-9]+$/.test(code)) return false;
  // Rejects the alphanumeric suffix markers: q (quarter), e (wrong edge), V (reduced spin)
  return !/[qeV]$/.test(code);
}

/**
 * Get the available base element codes (without marker variants) from SOV,
 * optionally filtered by category.
 */
export function getBaseElements(
  sov: SovData,
  includePairs: boolean,
): Record<string, string[]> {
  const groups: Record<string, string[]> = {};

  for (const [code, el] of Object.entries(sov.elements)) {
    if (!isCleanCode(code)) continue;
    // Skip pair elements if not included
    if (!includePairs && el.category === "pair") continue;

    const type = el.type;
    if (!groups[type]) groups[type] = [];
    groups[type].push(code);
  }

  // Sort each group
  for (const codes of Object.values(groups)) {
    codes.sort((a, b) => {
      const aRot = parseInt(a) || 0;
      const bRot = parseInt(b) || 0;
      if (aRot !== bRot) return aRot - bRot;
      return a.localeCompare(b);
    });
  }

  return groups;
}
