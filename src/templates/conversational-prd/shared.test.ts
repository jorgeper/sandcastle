import { describe, expect, it } from "vitest";
import { interpretPickerAnswer } from "./shared.ts";

describe("interpretPickerAnswer", () => {
  it("finishes on empty or whitespace-only input", () => {
    expect(interpretPickerAnswer("", 3)).toEqual({ kind: "finish" });
    expect(interpretPickerAnswer("   ", 3)).toEqual({ kind: "finish" });
  });

  it("picks a candidate for an integer within range (1-based → 0-based)", () => {
    expect(interpretPickerAnswer("1", 3)).toEqual({ kind: "pick", index: 0 });
    expect(interpretPickerAnswer("3", 3)).toEqual({ kind: "pick", index: 2 });
    expect(interpretPickerAnswer(" 2 ", 3)).toEqual({ kind: "pick", index: 1 });
  });

  it("treats out-of-range numbers as a new topic", () => {
    expect(interpretPickerAnswer("7", 3)).toEqual({
      kind: "topic",
      topic: "7",
    });
    expect(interpretPickerAnswer("0", 3)).toEqual({
      kind: "topic",
      topic: "0",
    });
  });

  it("treats free text as a new topic, trimmed", () => {
    expect(interpretPickerAnswer("add dark mode to the site", 3)).toEqual({
      kind: "topic",
      topic: "add dark mode to the site",
    });
    expect(interpretPickerAnswer("  themed exports  ", 3)).toEqual({
      kind: "topic",
      topic: "themed exports",
    });
  });

  it("treats numeric input as a topic when there are no candidates", () => {
    expect(interpretPickerAnswer("1", 0)).toEqual({
      kind: "topic",
      topic: "1",
    });
  });

  it("only pure integers are picks — decimals are topics", () => {
    expect(interpretPickerAnswer("2.5", 3)).toEqual({
      kind: "topic",
      topic: "2.5",
    });
  });
});
