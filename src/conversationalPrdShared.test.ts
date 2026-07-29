import { describe, expect, it } from "vitest";
import {
  decomposeIssueTitle,
  markerFor,
  numberFromUrl,
  parsePrdLine,
  slugify,
} from "./templates/conversational-prd/shared.ts";

// Pure helpers from the conversational-prd template (shared within the
// template only — ADR 0009). Importing shared.ts has no side effects.

describe("conversational-prd shared helpers", () => {
  it("markerFor follows the [agent · harness · model] convention", () => {
    expect(markerFor("designer")).toMatch(
      /^\*\*\[designer · claude-code · .+\]\*\*$/,
    );
  });

  it("slugify produces url-safe, bounded slugs", () => {
    expect(slugify("Add Pi digits!! (v2)")).toBe("add-pi-digits-v2");
    expect(slugify("--weird   input--")).toBe("weird-input");
    expect(slugify("x".repeat(100)).length).toBeLessThanOrEqual(40);
  });

  it("parsePrdLine extracts the load-bearing PRD path", () => {
    expect(
      parsePrdLine("**[m]**\n\n**PRD:** prd/002-pi-digits.md\n\nFollows #41."),
    ).toBe("prd/002-pi-digits.md");
    expect(parsePrdLine("no prd line here")).toBeUndefined();
  });

  it("decomposeIssueTitle is deterministic (it is the idempotency key)", () => {
    expect(decomposeIssueTitle("prd/002-pi.md")).toBe(
      "Decompose prd/002-pi.md",
    );
  });

  it("numberFromUrl takes the trailing number of an issue/PR url", () => {
    expect(numberFromUrl("https://github.com/o/r/issues/46")).toBe(46);
    expect(numberFromUrl("https://github.com/o/r/pull/23\n")).toBe(23);
    expect(numberFromUrl("https://github.com/o/r")).toBeUndefined();
  });
});
