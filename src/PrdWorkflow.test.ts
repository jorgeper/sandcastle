import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  scaffoldIssueAnchoredPrdWorkflow,
  scaffoldPrdWorkflow,
} from "./PrdWorkflow.js";

const makeDir = () => mkdtemp(join(tmpdir(), "prd-workflow-"));

const run = (repoDir: string) =>
  Effect.runPromise(
    scaffoldPrdWorkflow(repoDir).pipe(Effect.provide(NodeFileSystem.layer)),
  );

describe("scaffoldPrdWorkflow", () => {
  it("writes the PRD template and both project skills", async () => {
    const dir = await makeDir();
    await run(dir);

    const template = await readFile(join(dir, "prd", "TEMPLATE.md"), "utf-8");
    expect(template).toContain("## Problem");
    expect(template).toContain("## Non-goals");

    const newPrd = await readFile(
      join(dir, ".claude", "skills", "new-prd", "SKILL.md"),
      "utf-8",
    );
    expect(newPrd).toContain("name: new-prd");
    expect(newPrd).toContain("prd/TEMPLATE.md");
    // When grilling is missing, the skill offers to install Matt Pocock's
    // skills collection via the non-interactive plugin commands.
    expect(newPrd).toContain("github.com/mattpocock/skills");
    expect(newPrd).toContain(
      "claude plugin install mattpocock-skills@mattpocock",
    );

    const decompose = await readFile(
      join(dir, ".claude", "skills", "decompose-prd", "SKILL.md"),
      "utf-8",
    );
    expect(decompose).toContain("name: decompose-prd");
    // The parent-never-labeled invariant must be stated in the skill.
    expect(decompose).toContain("never labeled");
    // Sub-issue linking uses the REST sub_issues endpoint.
    expect(decompose).toContain("sub_issues");
  });

  it("does not overwrite existing files", async () => {
    const dir = await makeDir();
    await mkdir(join(dir, ".claude", "skills", "new-prd"), { recursive: true });
    await writeFile(
      join(dir, ".claude", "skills", "new-prd", "SKILL.md"),
      "user-customized",
    );
    await run(dir);

    const newPrd = await readFile(
      join(dir, ".claude", "skills", "new-prd", "SKILL.md"),
      "utf-8",
    );
    expect(newPrd).toBe("user-customized");
    // The other files are still created.
    const template = await readFile(join(dir, "prd", "TEMPLATE.md"), "utf-8");
    expect(template).toContain("## Problem");
  });

  it("is idempotent — safe to run twice", async () => {
    const dir = await makeDir();
    await run(dir);
    await run(dir);
    const template = await readFile(join(dir, "prd", "TEMPLATE.md"), "utf-8");
    expect(template).toContain("## Problem");
  });
});

describe("scaffoldIssueAnchoredPrdWorkflow", () => {
  const runIssueAnchored = (repoDir: string) =>
    Effect.runPromise(
      scaffoldIssueAnchoredPrdWorkflow(repoDir).pipe(
        Effect.provide(NodeFileSystem.layer),
      ),
    );

  it("writes the PRD template and the issue-anchored new-prd skill only", async () => {
    const dir = await makeDir();
    await runIssueAnchored(dir);

    const template = await readFile(join(dir, "prd", "TEMPLATE.md"), "utf-8");
    expect(template).toContain("## Problem");

    const newPrd = await readFile(
      join(dir, ".claude", "skills", "new-prd", "SKILL.md"),
      "utf-8",
    );
    expect(newPrd).toContain("name: new-prd");
    // Issue-anchored: targets a requires-prd issue, opens a PR on the
    // prd/issue-<N>-<slug> branch, and must never close the issue.
    expect(newPrd).toContain("sandcastle:requires-prd");
    expect(newPrd).toContain("prd/issue-");
    expect(newPrd).toContain("PRD for #");
    expect(newPrd).toMatch(/never.*Closes/i);
    // Still wraps the grilling skill with the install offer.
    expect(newPrd).toContain("github.com/mattpocock/skills");
    expect(newPrd).toContain(
      "claude plugin install mattpocock-skills@mattpocock",
    );
    // Decompose belongs to the orchestrator now — no decompose-prd skill.
    await expect(
      readFile(
        join(dir, ".claude", "skills", "decompose-prd", "SKILL.md"),
        "utf-8",
      ),
    ).rejects.toThrow();
  });

  it("does not overwrite an existing new-prd skill", async () => {
    const dir = await makeDir();
    await mkdir(join(dir, ".claude", "skills", "new-prd"), { recursive: true });
    await writeFile(
      join(dir, ".claude", "skills", "new-prd", "SKILL.md"),
      "user-customized",
    );
    await runIssueAnchored(dir);
    expect(
      await readFile(
        join(dir, ".claude", "skills", "new-prd", "SKILL.md"),
        "utf-8",
      ),
    ).toBe("user-customized");
  });
});
