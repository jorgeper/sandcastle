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

  it("scaffolds the designer/decomposer/filer scripts, role prompts, and shared helpers", async () => {
    const dir = await makeDir();
    await runScaffold(dir);
    const files = await readdir(join(dir, ".sandcastle"));
    for (const expected of [
      "design.ts",
      "decompose.ts",
      "issue.ts",
      "shared.ts",
      "designer-prompt.md",
      "decomposer-prompt.md",
      "filer-prompt.md",
      "shared.test.ts",
    ]) {
      expect(files).toContain(expected);
    }
  });

  it("design.ts picker accepts free text to file a new design topic", async () => {
    const dir = await makeDir();
    await runScaffold(dir);
    const design = await readFile(
      join(dir, ".sandcastle", "design.ts"),
      "utf-8",
    );
    // Symmetry with issue.ts: the bare-run picker offers "or describe a new
    // topic" instead of dead-ending, and the answer is interpreted by the
    // shared pure helper.
    expect(design).toContain("interpretPickerAnswer");
    expect(design).toContain("describe a new design topic");
    // Filing a design issue from a topic exists once, used by both the
    // argument path and the picker path (declaration + ≥2 call sites).
    const filingSites = design.match(/fileDesignIssue/g) ?? [];
    expect(filingSites.length).toBeGreaterThanOrEqual(3);
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
    const issue = await readFile(join(dir, ".sandcastle", "issue.ts"), "utf-8");
    for (const script of [design, decompose, issue]) {
      expect(script).toContain('from "@ai-hero/sandcastle"');
      expect(script).toContain('from "@ai-hero/sandcastle/chat"');
      expect(script).toContain("conversation.");
      expect(script).toContain("chat(");
      expect(script).toContain('from "./shared.ts"');
    }
    // design.ts drives phase B (PR feedback) from the host, with the same
    // label-gated approval + script-side merge as the main loop, and files
    // the decompose handoff issue at merge.
    expect(design).toContain("PR feedback");
    expect(design).toContain("sandcastle:approved");
    expect(design).toContain("pr merge");
    expect(design).toContain("decomposeIssueTitle");
    // decompose.ts closes its tracking issue; issue.ts routes by label.
    expect(decompose).toContain("issue close");
    expect(issue).toContain("DESIGN_LABEL");
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
    const filer = await readFile(
      join(dir, ".sandcastle", "filer-prompt.md"),
      "utf-8",
    );
    expect(designer).toContain("{{ISSUE_NUMBER}}");
    expect(designer).toContain("Closes #{{ISSUE_NUMBER}}");
    expect(designer).toContain("prd/NNN");
    // De-escalation: a design issue that's really just a bug gets relabeled.
    expect(designer).toContain("de-escalat");
    expect(decomposer).toContain("{{PRD_FILE}}");
    expect(decomposer).toContain("{{ISSUE_NUMBER}}");
    expect(decomposer).toContain("sub_issues");
    expect(filer).toContain("{{ISSUE_NUMBER}}");
    expect(filer).toContain("sandcastle:design");
    // Grounding is a light survey, not debugging: the filer locates likely
    // code, it never reproduces or diagnoses — the implement lane owns that.
    expect(filer).toContain("Locate, don't verify");
    expect(filer).toContain("do NOT attempt to reproduce");
    // Code pointers are best-effort fallout of the quick survey, never a hunt.
    expect(filer).toContain("never hunt");
    // Routing is always the human's call, in both directions.
    expect(filer).toContain("ALWAYS ask, never assume");
    expect(filer).toContain("Create a PRD anyway");
    // Everything agents write on GitHub is attributed via the
    // [agent · harness · model] marker the scripts pass in.
    for (const prompt of [designer, decomposer, filer]) {
      expect(prompt).toContain("{{AGENT_MARKER}}");
      // The <turn> envelope wire format is library-owned (appended by
      // conversation.start), so prompts must not redefine it.
      expect(prompt).not.toContain("<turn>");
    }
  });
});
