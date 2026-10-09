import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { SkaterName } from "../CompetitionPage";

function render(isOwn?: boolean): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(SkaterName, { skaterId: 7, firstName: "Léa", lastName: "Martin", isOwn }),
    ),
  );
}

describe("SkaterName", () => {
  it("links to the skater analysis for own skaters and when is_own is absent", () => {
    for (const isOwn of [true, undefined]) {
      const html = render(isOwn);
      expect(html).toContain('href="/patineurs/7/analyse"');
      expect(html).toContain("Léa Martin");
    }
  });

  it("renders plain text for other skaters", () => {
    const html = render(false);
    expect(html).not.toContain("<a");
    expect(html).toContain("Léa Martin");
  });
});
