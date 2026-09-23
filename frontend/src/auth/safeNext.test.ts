import { describe, expect, it } from "vitest";
import { safeNext } from "./safeNext";

describe("safeNext", () => {
  it("keeps internal paths with query", () => {
    expect(safeNext("/autorisation?demande=abc")).toBe("/autorisation?demande=abc");
  });
  it("falls back to / for missing or external targets", () => {
    for (const bad of [null, "", "https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)"]) {
      expect(safeNext(bad)).toBe("/");
    }
  });
});
