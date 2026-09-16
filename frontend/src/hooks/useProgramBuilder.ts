import { useState, useCallback } from "react";
import type { SovData } from "../api/client";
import type { ProgramElement } from "../utils/program-validator";
import {
  calculateElementBV,
  calculateElementMin,
  calculateElementMax,
  calculateComboBV,
} from "../utils/sov-calculator";

let _nextId = 1;
function genId(): string {
  return `el-${_nextId++}`;
}

/**
 * Recalculate BV, min, and max for a program element.
 */
function recalcElement(sov: SovData, el: ProgramElement): ProgramElement {
  if (el.comboJumps && el.comboJumps.length > 1) {
    // Combo: sum of individual jump BVs + combo-level modifiers
    const comboMarkers = el.markers.filter(m => ["x", "+REP", "*"].includes(m));
    const bv = calculateComboBV(sov, el.comboJumps, comboMarkers);

    // Min/Max: sum of per-jump min/max with combo modifiers
    let minTotal = 0;
    let maxTotal = 0;
    for (const jump of el.comboJumps) {
      const jumpMarkers = jump.markers.filter(m => !["x", "+REP"].includes(m));
      minTotal += calculateElementMin(sov, jump.code, jumpMarkers);
      maxTotal += calculateElementMax(sov, jump.code, jumpMarkers);
    }
    if (comboMarkers.includes("*")) {
      minTotal = 0;
      maxTotal = 0;
    } else {
      if (comboMarkers.includes("x")) { minTotal *= 1.10; maxTotal *= 1.10; }
      if (comboMarkers.includes("+REP")) { minTotal *= 0.70; maxTotal *= 0.70; }
    }

    return {
      ...el,
      bv,
      min: Math.round(minTotal * 100) / 100,
      max: Math.round(maxTotal * 100) / 100,
    };
  }

  return {
    ...el,
    bv: calculateElementBV(sov, el.baseCode, el.markers),
    min: calculateElementMin(sov, el.baseCode, el.markers),
    max: calculateElementMax(sov, el.baseCode, el.markers),
  };
}

export function useProgramBuilder(sov: SovData | undefined) {
  const [elements, setElements] = useState<ProgramElement[]>([]);

  /** Add an element to the program. */
  const addElement = useCallback((code: string) => {
    if (!sov) return;
    const sovEl = sov.elements[code];
    if (!sovEl) return;

    const el: ProgramElement = {
      id: genId(),
      baseCode: code,
      type: sovEl.type,
      markers: [],
      bv: sovEl.base_value,
      min: sovEl.base_value + (sovEl.goe[0] ?? 0),
      max: sovEl.base_value + (sovEl.goe[9] ?? 0),
    };

    // If it's a jump, initialize comboJumps with single entry
    if (sovEl.type === "jump") {
      el.comboJumps = [{ code, markers: [] }];
    }

    setElements(prev => [...prev, el]);
  }, [sov]);

  /** Update markers on a non-combo element (or combo-level markers). */
  const updateMarkers = useCallback((elementId: string, markers: string[]) => {
    if (!sov) return;
    setElements(prev =>
      prev.map(el => {
        if (el.id !== elementId) return el;
        return recalcElement(sov, { ...el, markers });
      }),
    );
  }, [sov]);

  /** Update markers on a specific jump within a combo. */
  const updateComboJumpMarkers = useCallback((elementId: string, jumpIndex: number, markers: string[]) => {
    if (!sov) return;
    setElements(prev =>
      prev.map(el => {
        if (el.id !== elementId || !el.comboJumps) return el;
        const newJumps = el.comboJumps.map((j, i) =>
          i === jumpIndex ? { ...j, markers } : j,
        );
        return recalcElement(sov, { ...el, comboJumps: newJumps });
      }),
    );
  }, [sov]);

  /** Add a jump to an existing element to form a combo. */
  const addComboJump = useCallback((elementId: string, jumpCode: string) => {
    if (!sov) return;
    setElements(prev =>
      prev.map(el => {
        if (el.id !== elementId) return el;
        const currentJumps = el.comboJumps ?? [{ code: el.baseCode, markers: [] }];
        if (currentJumps.length >= 3) return el;

        // The Euler sits between two listed jumps, in a combination or a
        // sequence alike. It cannot open or close the element.
        if (jumpCode === "Eu" && currentJumps.length !== 1) return el;

        const newJumps = [...currentJumps, { code: jumpCode, markers: [] }];
        const newBaseCode = newJumps.map(j => j.code).join("+");
        return recalcElement(sov, { ...el, baseCode: newBaseCode, comboJumps: newJumps });
      }),
    );
  }, [sov]);

  /** Replace an element with a new one (inline edit). Resets markers and breaks combos. */
  const replaceElement = useCallback((elementId: string, newCode: string) => {
    if (!sov) return;
    const sovEl = sov.elements[newCode];
    if (!sovEl) return;

    setElements(prev =>
      prev.map(el => {
        if (el.id !== elementId) return el;
        const newEl: ProgramElement = {
          ...el,
          baseCode: newCode,
          type: sovEl.type,
          markers: [],
          comboJumps: sovEl.type === "jump" ? [{ code: newCode, markers: [] }] : undefined,
          bv: 0,
          min: 0,
          max: 0,
        };
        return recalcElement(sov, newEl);
      }),
    );
  }, [sov]);

  /** Delete an element from the program. */
  const deleteElement = useCallback((elementId: string) => {
    setElements(prev => prev.filter(el => el.id !== elementId));
  }, []);

  /** Load a program from a score's elements. Replaces the current program. */
  const loadFromScore = useCallback((scoreElements: { code: string; markers: string[] }[]) => {
    if (!sov) return;
    const newElements: ProgramElement[] = [];

    for (const { code, markers } of scoreElements) {
      // Filter out "+SEQ" notation (sequence marker, not a jump)
      const parts = code.split("+").filter(p => p !== "SEQ");
      const firstPart = parts[0];
      const sovEl = sov.elements[firstPart];
      if (!sovEl) continue;

      const baseCode = parts.join("+");
      const el: ProgramElement = {
        id: genId(),
        baseCode,
        type: sovEl.type,
        markers: markers.filter(m => m === "+REP"),
        bv: 0,
        min: 0,
        max: 0,
      };

      if (parts.length > 1 && sovEl.type === "jump") {
        // Combo element
        el.comboJumps = parts.map((p) => ({
          code: p,
          markers: [], // Score markers are positional; simplified for now
        }));
      } else if (sovEl.type === "jump") {
        el.comboJumps = [{ code: firstPart, markers: markers.filter(m => !["x", "+REP"].includes(m)) }];
      }

      newElements.push(recalcElement(sov, el));
    }

    setElements(newElements);
  }, [sov]);

  /** Reorder elements by moving one from oldIndex to newIndex. */
  const reorderElements = useCallback((oldIndex: number, newIndex: number) => {
    setElements(prev => {
      const result = [...prev];
      const [removed] = result.splice(oldIndex, 1);
      result.splice(newIndex, 0, removed);
      return result;
    });
  }, []);

  /** Clear all elements. */
  const clearProgram = useCallback(() => {
    setElements([]);
  }, []);

  return {
    elements,
    addElement,
    updateMarkers,
    updateComboJumpMarkers,
    addComboJump,
    replaceElement,
    deleteElement,
    reorderElements,
    loadFromScore,
    clearProgram,
  };
}
