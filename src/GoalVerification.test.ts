import { describe, expect, it } from "vitest";
import {
  goalVerificationPrompt,
  parseGoalVerdict,
} from "./GoalVerification.js";

describe("independent goal verdict", () => {
  it("accepts explicit approval and rejection with concrete evidence", () => {
    for (const met of [true, false]) {
      expect(
        parseGoalVerdict(
          JSON.stringify({ met, evidence: "Ran the required tests." }),
        ),
      ).toEqual({ met, evidence: "Ran the required tests." });
    }
    expect(goalVerificationPrompt("SPEC: all requirements")).toContain(
      "SPEC: all requirements",
    );
    expect(goalVerificationPrompt("goal")).toContain(
      "Run the required verification commands yourself",
    );
  });
  it("fails closed on promises, malformed JSON, wrong types or absent evidence", () => {
    for (const value of [
      "<promise>COMPLETE</promise>",
      '{"met":true}',
      '{"met":"true","evidence":"ok"}',
      '{"met":true,"evidence":" "}',
      '{"met":true,"evidence":"ok","other":true}',
      '{"met":true,"evidence":"ok"}\n{"met":false,"evidence":"failed"}',
      "null",
      "[]",
    ])
      expect(() => parseGoalVerdict(value)).toThrow(/Goal verifier/);
  });
});
