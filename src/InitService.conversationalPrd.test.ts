import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getAgent, listTemplates, scaffold } from "./InitService.js";

const makeDir = () => mkdtemp(join(tmpdir(), "init-conv-prd-"));

const runScaffold = (repoDir: string) =>
  Effect.runPromise(
    scaffold(repoDir, {
      agent: getAgent("claude-code")!,
      model: "claude-opus-4-8",
      templateName: "conversational-prd",
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

describe("conversational-prd template", () => {
  it("appears in listTemplates()", () => {
    const template = listTemplates().find(
      (t) => t.name === "conversational-prd",
    );
    expect(template).toBeDefined();
    expect(template!.description).toContain("design.ts");
    expect(template!.description).toContain("decompose.ts");
  });

  it("scaffolds the designer/decomposer scripts and role prompts", async () => {
    const dir = await makeDir();
    await runScaffold(dir);
    const files = await readdir(join(dir, ".sandcastle"));
    for (const expected of [
      "design.ts",
      "decompose.ts",
      "designer-prompt.md",
      "decomposer-prompt.md",
    ]) {
      expect(files).toContain(expected);
    }
  });

  it("scripts are thin wrappers over conversation + chat", async () => {
    const dir = await makeDir();
    await runScaffold(dir);
    const design = await readFile(
      join(dir, ".sandcastle", "design.ts"),
      "utf-8",
    );
    const decompose = await readFile(
      join(dir, ".sandcastle", "decompose.ts"),
      "utf-8",
    );
    for (const script of [design, decompose]) {
      expect(script).toContain('from "@ai-hero/sandcastle"');
      expect(script).toContain('from "@ai-hero/sandcastle/chat"');
      expect(script).toContain("conversation.");
      expect(script).toContain("chat(");
    }
    // design.ts drives phase B (PR feedback) from the host.
    expect(design).toContain("PR feedback");
    expect(design).toContain("reviewDecision");
  });

  it("role prompts contain methodology, not protocol mechanics", async () => {
    const dir = await makeDir();
    await runScaffold(dir);
    const designer = await readFile(
      join(dir, ".sandcastle", "designer-prompt.md"),
      "utf-8",
    );
    const decomposer = await readFile(
      join(dir, ".sandcastle", "decomposer-prompt.md"),
      "utf-8",
    );
    expect(designer).toContain("{{TOPIC}}");
    expect(designer).toContain("prd/NNN");
    expect(decomposer).toContain("{{PRD_FILE}}");
    expect(decomposer).toContain("sub_issues");
    // The <turn> envelope wire format is library-owned (appended by
    // conversation.start), so prompts must not redefine it.
    expect(designer).not.toContain("<turn>");
    expect(decomposer).not.toContain("<turn>");
  });
});
