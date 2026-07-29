import { describe, expect, it } from "vitest";
import {
  detectInstalls,
  updateTally,
  formatNudges,
  type InstallTally,
} from "./install-scan.mts";

describe("detectInstalls", () => {
  it("detects playwright browser installs", () => {
    const log = "⚙ Bash npx playwright install --with-deps chromium\nok";
    const found = detectInstalls(log);
    expect(found.map((d) => d.key)).toEqual(["playwright-browsers"]);
    expect(found[0]!.line).toContain("playwright install");
  });

  it("detects system package managers", () => {
    const log = [
      "sudo apt-get install -y libnss3",
      "apk add chromium",
      "sudo dnf install jq",
    ].join("\n");
    expect(detectInstalls(log).map((d) => d.key)).toEqual([
      "apt-packages",
      "apk-packages",
      "dnf-yum-packages",
    ]);
  });

  it("detects global npm installs but NOT worktree installs", () => {
    expect(detectInstalls("npm install -g tsx").map((d) => d.key)).toEqual([
      "npm-global",
    ]);
    expect(detectInstalls("npm install")).toEqual([]);
    expect(detectInstalls("npm install --save-dev vitest")).toEqual([]);
    expect(detectInstalls("yarn install && pnpm install")).toEqual([]);
  });

  it("reports each signature once per scan", () => {
    const log = "npx playwright install\nnpx playwright install chromium";
    expect(detectInstalls(log)).toHaveLength(1);
  });
});

describe("updateTally", () => {
  const detection = {
    key: "playwright-browsers",
    label: "Playwright browsers",
    line: "npx playwright install",
  };

  it("increments run counts across updates for the same image", () => {
    const first = updateTally(undefined, "img-1", [detection]);
    expect(first.entries["playwright-browsers"]!.runs).toBe(1);
    const second = updateTally(first, "img-1", [detection]);
    expect(second.entries["playwright-browsers"]!.runs).toBe(2);
  });

  it("resets when the image id changes (owner rebuilt the image)", () => {
    const first = updateTally(undefined, "img-1", [detection]);
    const afterRebuild = updateTally(first, "img-2", []);
    expect(afterRebuild.entries).toEqual({});
    expect(afterRebuild.imageId).toBe("img-2");
  });

  it("a run with no detections leaves existing counts unchanged", () => {
    const first = updateTally(undefined, "img-1", [detection]);
    const second = updateTally(first, "img-1", []);
    expect(second.entries["playwright-browsers"]!.runs).toBe(1);
  });
});

describe("formatNudges", () => {
  it("names the install, the repeat count, and the Dockerfile fix", () => {
    const detection = {
      key: "playwright-browsers",
      label: "Playwright browsers (`npx playwright install`)",
      line: "npx playwright install",
    };
    const tally: InstallTally = {
      imageId: "img-1",
      entries: { "playwright-browsers": { runs: 3, lastExample: "x" } },
    };
    const [nudge] = formatNudges(tally, [detection]);
    expect(nudge).toContain("Playwright browsers");
    expect(nudge).toContain("seen in 3 runs");
    expect(nudge).toContain(".sandcastle/Dockerfile");
    expect(nudge).toContain("npx sandcastle docker build-image");
  });

  it("omits the repeat clause on first sighting", () => {
    const detection = { key: "apt-packages", label: "apt", line: "apt" };
    const tally: InstallTally = {
      imageId: "img-1",
      entries: { "apt-packages": { runs: 1, lastExample: "x" } },
    };
    expect(formatNudges(tally, [detection])[0]).not.toContain("seen in");
  });
});
