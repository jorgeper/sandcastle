// Init, doctor, and help — the operational commands behind
// `npx tsx .sandcastle/main.mts [--init|--doctor|--help]`.

import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";
import { parseEnvFile } from "./env.mts";
import * as github from "./github.mts";

const execFileAsync = promisify(execFile);

const LABEL_ROWS: [string, string, string, string][] = [
  [github.TRIGGER_LABEL, "issue", "you", "queue this issue for the loop"],
  [github.REQUIRE_PR_LABEL, "issue", "you", "gate it behind a PR + outer review"],
  ["sandcastle:in-review", "PR", "orchestrator", "agent debate in progress"],
  ["sandcastle:ready", "PR", "orchestrator", "debate settled, awaiting you"],
  ["sandcastle:needs-decision", "PR", "orchestrator", "deadlocked threads await your verdict"],
  ["sandcastle:approved", "PR", "you", "authorize the merge — next run squash-merges"],
];

export const printHelp = (): void => {
  console.log(
    [
      `Sandcastle orchestrator`,
      ``,
      `Usage:`,
      `  npm run sandcastle           run the loop (classify → merge → debate → plan → implement)`,
      `  npm run sandcastle:init      create the sandcastle label vocabulary in this repo`,
      `  npm run sandcastle:doctor    check env, auth, docker image, and labels`,
      `  npx tsx .sandcastle/main.mts [--init | --doctor | --help]`,
      ``,
      `Labels (see .sandcastle/PR_SETUP.md for the full protocol):`,
      ...LABEL_ROWS.map(
        ([name, on, by, meaning]) =>
          `  ${name.padEnd(26)} on ${on.padEnd(5)} set by ${by.padEnd(12)} — ${meaning}`,
      ),
    ].join("\n"),
  );
};

export const runInit = async (): Promise<void> => {
  const repo = await github.repoSlug();
  const created = await github.ensureLabelsExist(github.ALL_LABEL_DEFS);

  console.log(`Sandcastle labels in ${repo}:\n`);
  for (const [name, on, by, meaning] of LABEL_ROWS) {
    const mark = created.includes(name) ? "created" : "exists ";
    console.log(
      `  ${name.padEnd(26)} [${mark}]  on ${on.padEnd(5)} set by ${by.padEnd(12)} — ${meaning}`,
    );
  }
  console.log(
    `\nNext: label an issue \`sandcastle\` (add \`sandcastle:require-pr\` for the PR flow), then run \`npm run sandcastle\`.`,
  );
  console.log(`Details: .sandcastle/PR_SETUP.md`);
};

interface CheckResult {
  ok: boolean;
  detail: string;
  hint?: string;
}

export const runDoctor = async (): Promise<number> => {
  console.log(`Sandcastle doctor\n`);
  const results: boolean[] = [];

  // A missing binary (`gh`, `docker`) surfaces as a raw `spawn <bin> ENOENT`
  // from every check that shells out to it — translate it into an actionable
  // install hint, printed once per binary rather than under each failing
  // check.
  const INSTALL_HINTS: Record<string, string> = {
    gh: "install the GitHub CLI, then `gh auth login` — macOS: `brew install gh`; Debian/Ubuntu: `sudo apt install gh`; all platforms: https://github.com/cli/cli#installation",
    docker:
      "install Docker and start the daemon — macOS: Docker Desktop (or `brew install colima docker`); Debian/Ubuntu: `sudo apt install docker.io`; all platforms: https://docs.docker.com/get-docker/",
  };
  const hintedBinaries = new Set<string>();
  const check = async (name: string, fn: () => Promise<CheckResult>) => {
    try {
      const result = await fn();
      results.push(result.ok);
      console.log(`  ${result.ok ? "✓" : "✗"} ${name} — ${result.detail}`);
      if (!result.ok && result.hint) console.log(`      ↳ ${result.hint}`);
    } catch (error) {
      results.push(false);
      const errno = error as NodeJS.ErrnoException;
      const missingBinary =
        error instanceof Error &&
        errno.code === "ENOENT" &&
        errno.path &&
        errno.path in INSTALL_HINTS
          ? errno.path
          : undefined;
      const message = missingBinary
        ? `\`${missingBinary}\` is not installed (not found on PATH)`
        : error instanceof Error
          ? error.message.split("\n")[0]
          : String(error);
      console.log(`  ✗ ${name} — ${message}`);
      if (missingBinary && !hintedBinaries.has(missingBinary)) {
        hintedBinaries.add(missingBinary);
        console.log(`      ↳ ${INSTALL_HINTS[missingBinary]}`);
      }
    }
  };

  let envVars: Record<string, string> = {};
  await check(".sandcastle/.env", async () => {
    envVars = parseEnvFile(
      readFileSync(new URL("./.env", import.meta.url), "utf8"),
    );
    return { ok: true, detail: "found" };
  });

  await check("agent credentials", async () => {
    const ok = Boolean(
      envVars.CLAUDE_CODE_OAUTH_TOKEN || envVars.ANTHROPIC_API_KEY,
    );
    return {
      ok,
      detail: ok
        ? "Claude credential set"
        : "no CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY",
      hint: "run `claude setup-token` and add CLAUDE_CODE_OAUTH_TOKEN to .sandcastle/.env",
    };
  });

  await check("GH_TOKEN (sandbox agents)", async () => {
    if (!envVars.GH_TOKEN) {
      return {
        ok: false,
        detail: "missing from .sandcastle/.env",
        hint: "see .sandcastle/PR_SETUP.md for the required scopes",
      };
    }
    await execFileAsync("gh", ["api", "user"], {
      env: { ...process.env, GH_TOKEN: envVars.GH_TOKEN },
    });
    return {
      ok: true,
      detail:
        "present and authenticates (write scopes can't be probed — PR mode needs Contents+PRs+Issues R/W)",
    };
  });

  await check("gh CLI host auth + repo", async () => {
    const slug = await github.repoSlug();
    return { ok: true, detail: slug };
  });

  await check("docker sandbox image", async () => {
    const image = `sandcastle:${basename(process.cwd())}`;
    const { stdout } = await execFileAsync("docker", ["images", "-q", image]);
    if (!stdout.trim()) {
      return {
        ok: false,
        detail: `${image} not built`,
        hint: "run `npx sandcastle docker build-image`",
      };
    }
    return { ok: true, detail: image };
  });

  await check("labels", async () => {
    const existing = new Set(
      (await github.listLabelNames()).map((name) => name.toLowerCase()),
    );
    const missing = github.ALL_LABEL_DEFS.filter(
      (def) => !existing.has(def.name.toLowerCase()),
    ).map((def) => def.name);
    if (missing.length > 0) {
      return {
        ok: false,
        detail: `missing: ${missing.join(", ")}`,
        hint: "run `npm run sandcastle:init`",
      };
    }
    return { ok: true, detail: "all 6 sandcastle labels exist" };
  });

  await check("queued work", async () => {
    const issues = await github.listSandcastleIssues();
    return {
      ok: true,
      detail: `${issues.length} open issue(s) labeled sandcastle`,
    };
  });

  const failed = results.filter((ok) => !ok).length;
  console.log(
    failed === 0
      ? `\nAll checks passed.`
      : `\n${failed} check(s) need attention.`,
  );
  return failed === 0 ? 0 : 1;
};
