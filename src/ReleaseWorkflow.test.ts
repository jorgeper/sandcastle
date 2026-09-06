import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CUT_RELEASE_SKILL,
  NEW_RELEASE_SKILL,
  scaffoldReleaseWorkflow,
} from "./ReleaseWorkflow.js";
import {
  ARTIFACTS_APPENDED_MARKER,
  AWAITING_PUBLISH_MARKER,
  CI_GREEN_MARKER,
  CUT_FAILED_MARKER,
  DRAFT_REPORT_MARKER,
  DRAFT_VERIFIED_MARKER,
  GATE_PASSED_MARKER,
  MALFORMED_MARKER,
  OUT_OF_ORDER_MARKER,
  PREFLIGHT_ACK_MARKER,
  PRETAG_CI_GREEN_MARKER,
  parseReleaseIssueBody,
  TAG_PUSHED_MARKER,
} from "./templates/parallel-planner-goal-with-pr-review/release-lane.mts";

const makeDir = () => mkdtemp(join(tmpdir(), "release-workflow-"));

const run = (repoDir: string) =>
  Effect.runPromise(
    scaffoldReleaseWorkflow(repoDir).pipe(Effect.provide(NodeFileSystem.layer)),
  );

describe("scaffoldReleaseWorkflow", () => {
  it("writes the new-release and cut-release project skills", async () => {
    const dir = await makeDir();
    await run(dir);

    const newRelease = await readFile(
      join(dir, ".claude", "skills", "new-release", "SKILL.md"),
      "utf-8",
    );
    expect(newRelease).toContain("name: new-release");
    expect(newRelease).toContain("sandcastle:release");
    expect(newRelease).toContain("release-lane.mts");

    const cutRelease = await readFile(
      join(dir, ".claude", "skills", "cut-release", "SKILL.md"),
      "utf-8",
    );
    expect(cutRelease).toContain("name: cut-release");
    expect(cutRelease).toContain("```release-facts");
    expect(cutRelease).toContain("TODO(sandcastle)");
    expect(cutRelease).toContain("Never publish a release");
  });

  it("does not overwrite an owner's filled-in cut-release skill", async () => {
    const dir = await makeDir();
    const skillDir = join(dir, ".claude", "skills", "cut-release");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "owner facts filled in");
    await run(dir);
    expect(await readFile(join(skillDir, "SKILL.md"), "utf-8")).toBe(
      "owner facts filled in",
    );
    // The sibling is still scaffolded.
    expect(
      await readFile(
        join(dir, ".claude", "skills", "new-release", "SKILL.md"),
        "utf-8",
      ),
    ).toContain("name: new-release");
  });
});

// Drift guards: the skills are prose that drives release-lane.mts. These
// hold the two together so an edit to either side fails loudly here.
describe("skill ↔ release-lane.mts contract", () => {
  const template = (() => {
    const fence = NEW_RELEASE_SKILL.match(
      /```release-issue-body\r?\n([\s\S]*?)```/,
    );
    if (!fence)
      throw new Error("new-release skill lost its fenced body template");
    return fence[1]!;
  })();

  const fill = (
    version: string,
    targets: string,
    mode: string,
    changelog: string,
  ) =>
    template
      .replace("{{VERSION}}", version)
      .replace("{{TARGETS}}", targets)
      .replace("{{MODE}}", mode)
      .replace("{{CHANGELOG}}", changelog);

  it("a body built from the embedded template parses with every field verbatim", () => {
    expect(
      parseReleaseIssueBody(
        fill(
          "1.4.0-beta.2",
          "mac, windows",
          "cut",
          "- Fixed the sidebar.\n- Faster startup.",
        ),
      ),
    ).toEqual({
      ok: true,
      spec: {
        version: "1.4.0-beta.2",
        targets: ["mac", "windows"],
        mode: "cut",
        changelog: "- Fixed the sidebar.\n- Faster startup.",
      },
    });
    // No targets, default mode: the empty Targets line is legal.
    const bare = parseReleaseIssueBody(
      fill("1.0.0", "", "cut", "- One entry."),
    );
    expect(bare.ok && bare.spec.targets).toEqual([]);
    // Append mode with a target.
    const append = parseReleaseIssueBody(
      fill("1.0.0", "windows", "append", "- One entry."),
    );
    expect(append.ok && append.spec.mode).toBe("append");
  });

  it("the template carries exactly the four placeholders, once each", () => {
    const placeholders = (template.match(/\{\{[^{}]+\}\}/g) ?? []).sort();
    expect(placeholders).toEqual([
      "{{CHANGELOG}}",
      "{{MODE}}",
      "{{TARGETS}}",
      "{{VERSION}}",
    ]);
  });

  it("the cut-release preflight prints every phase marker the runbook posts", () => {
    // The skill never retypes a marker: each one it tells the agent to post
    // must be exported by release-lane.mts under the name the preflight
    // script prints. If a marker is renamed on either side, this fails.
    const exported: Record<string, string> = {
      PREFLIGHT_ACK: PREFLIGHT_ACK_MARKER,
      GATE_PASSED: GATE_PASSED_MARKER,
      PRETAG_CI_GREEN: PRETAG_CI_GREEN_MARKER,
      TAG_PUSHED: TAG_PUSHED_MARKER,
      CI_GREEN: CI_GREEN_MARKER,
      DRAFT_VERIFIED: DRAFT_VERIFIED_MARKER,
      ARTIFACTS_APPENDED: ARTIFACTS_APPENDED_MARKER,
      AWAITING_PUBLISH: AWAITING_PUBLISH_MARKER,
      CUT_FAILED: CUT_FAILED_MARKER,
      MALFORMED: MALFORMED_MARKER,
      OUT_OF_ORDER: OUT_OF_ORDER_MARKER,
      DRAFT_REPORT: DRAFT_REPORT_MARKER,
    };
    for (const name of Object.keys(exported)) {
      expect(CUT_RELEASE_SKILL).toContain(`${name}: lane.${name}_MARKER`);
      expect(CUT_RELEASE_SKILL).toContain(`\`${name}\``);
    }
  });
});
