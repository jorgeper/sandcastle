import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scaffoldPrdWorkflow } from "./PrdWorkflow.js";

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
