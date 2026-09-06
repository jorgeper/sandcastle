import { describe, expect, it } from "vitest";
import {
  ARTIFACTS_APPENDED_MARKER,
  AWAITING_PUBLISH_MARKER,
  buildDraftReport,
  buildMalformedComment,
  buildOutOfOrderComment,
  CI_GREEN_MARKER,
  classifyReleaseIssue,
  compareVersions,
  CUT_FAILED_MARKER,
  DRAFT_REPORT_MARKER,
  DRAFT_VERIFIED_MARKER,
  GATE_PASSED_MARKER,
  MALFORMED_MARKER,
  newestReleaseTag,
  OUT_OF_ORDER_MARKER,
  parseBlockedBy,
  parseDraftTags,
  parseMarkerPresent,
  parseReleaseIssueBody,
  parseTagNames,
  PREFLIGHT_ACK_MARKER,
  PRETAG_CI_GREEN_MARKER,
  releaseOutcome,
  TAG_PUSHED_MARKER,
} from "./release-lane.mts";

/** A well-formed release-issue body per the release-lane.mts contract. */
const body = (
  version = "0.5.0",
  extra = "",
  changelog = "- Added things.",
) => `**Version:** ${version}\n${extra}\n## Changelog\n\n${changelog}\n`;

// A tag list with a rolling `latest` tag that must never win "newest".
const TAGS = [
  "latest",
  "v0.2.0-beta.6",
  "v0.3.0-beta.1",
  "v0.4.0-beta.1",
  "v0.4.0-beta.3",
  "v0.4.0-beta.4",
  "v0.4.0-beta.5",
];

/** Classifier input with no phase markers posted yet. */
const fresh = (b: string) => ({
  body: b,
  tagNames: TAGS,
  draftTags: [] as string[],
  draftReportPosted: false,
  awaitingPublishPosted: false,
  tagPushedPosted: false,
  cutFailedActive: false,
  blockedByBug: null as number | null,
  blockingBugOpen: null as boolean | null,
});

describe("parseReleaseIssueBody (prd/009 R3)", () => {
  it("parses a well-formed body — pre-release id kept, targets split, changelog verbatim", () => {
    const parsed = parseReleaseIssueBody(
      body("0.4.0-beta.6", "**Targets:** mac, windows\n", "- Fixed the sidebar.\n- Faster startup."),
    );
    expect(parsed).toEqual({
      ok: true,
      spec: {
        version: "0.4.0-beta.6",
        targets: ["mac", "windows"],
        mode: "cut",
        changelog: "- Fixed the sidebar.\n- Faster startup.",
      },
    });
  });

  it("targets and mode are optional: absent means no targets, mode cut", () => {
    const parsed = parseReleaseIssueBody(body("1.0.0"));
    expect(parsed.ok && parsed.spec.targets).toEqual([]);
    expect(parsed.ok && parsed.spec.mode).toBe("cut");
  });

  it("the changelog section ends at the next ## heading and must be non-empty", () => {
    const parsed = parseReleaseIssueBody(
      `${body("1.0.0", "", "- Entry.")}\n## Notes\n\nnot changelog\n`,
    );
    expect(parsed.ok && parsed.spec.changelog).toBe("- Entry.");

    const empty = parseReleaseIssueBody("**Version:** 1.0.0\n\n## Changelog\n\n");
    expect(empty.ok).toBe(false);
    expect(!empty.ok && empty.problems.join(" ")).toMatch(/Changelog.*empty/);
  });

  it("malformed bodies collect every problem — missing version, leading v, unknown mode, missing changelog", () => {
    const missingAll = parseReleaseIssueBody("please release something");
    expect(missingAll.ok).toBe(false);
    expect(!missingAll.ok && missingAll.problems).toHaveLength(2);

    const leadingV = parseReleaseIssueBody(body("v0.5.0"));
    expect(!leadingV.ok && leadingV.problems.join(" ")).toMatch(/leading `v`/);

    const junkVersion = parseReleaseIssueBody(body("0.5"));
    expect(!junkVersion.ok && junkVersion.problems.join(" ")).toMatch(/not strict semver/);

    const badMode = parseReleaseIssueBody(body("0.5.0", "**Mode:** redo\n"));
    expect(!badMode.ok && badMode.problems.join(" ")).toMatch(/unknown mode `redo`/);
  });

  it("append mode needs targets", () => {
    const noTargets = parseReleaseIssueBody(body("0.5.0", "**Mode:** append\n"));
    expect(!noTargets.ok && noTargets.problems.join(" ")).toMatch(/append.*Targets/);
    const ok = parseReleaseIssueBody(body("0.5.0", "**Targets:** windows\n**Mode:** append\n"));
    expect(ok.ok && ok.spec.mode).toBe("append");
  });
});

describe("ordering guard (prd/009 R6)", () => {
  it("newest tag is prerelease-aware and skips unparseable tags like a rolling `latest`", () => {
    expect(newestReleaseTag(TAGS)).toBe("v0.4.0-beta.5");
    expect(newestReleaseTag(["latest", "nonsense"])).toBeNull();
    // beta.10 outranks beta.9 numerically, and a full release outranks its pre-releases.
    expect(compareVersions("0.4.0-beta.10", "0.4.0-beta.9")).toBe(1);
    expect(compareVersions("0.4.0", "v0.4.0-beta.5")).toBe(1);
  });

  it("cutting a version behind the newest tag is refused", () => {
    expect(classifyReleaseIssue(fresh(body("0.4.0-beta.4")))).toEqual({
      kind: "out-of-order",
      version: "0.4.0-beta.4",
      newestTag: "v0.4.0-beta.5",
    });
  });

  it("equal to the newest tag is refused too; strictly newer proceeds", () => {
    expect(classifyReleaseIssue(fresh(body("0.4.0-beta.5"))).kind).toBe("out-of-order");
    expect(classifyReleaseIssue(fresh(body("0.4.0-beta.6"))).kind).toBe("proceed");
  });
});

describe("abandoned-draft report (prd/009 R7)", () => {
  const DRAFTS = ["v0.3.0-beta.1", "v0.2.0-beta.3"];

  it("the report lists the exact gh release delete command per draft and carries its marker line", () => {
    const report = buildDraftReport(DRAFTS);
    expect(report.startsWith(DRAFT_REPORT_MARKER)).toBe(true);
    expect(report).toContain("`gh release delete v0.3.0-beta.1`");
    expect(report).toContain("`gh release delete v0.2.0-beta.3`");
    expect(report).toContain("never deletes a release");
  });

  it("drafts classify to drafts-to-report only until the report is posted, then the issue proceeds", () => {
    const input = { ...fresh(body("0.4.0-beta.6")), draftTags: DRAFTS };
    const first = classifyReleaseIssue(input);
    expect(first.kind).toBe("drafts-to-report");
    expect(first.kind === "drafts-to-report" && first.drafts).toEqual(DRAFTS);

    const second = classifyReleaseIssue({ ...input, draftReportPosted: true });
    expect(second.kind).toBe("proceed");
  });

  it("guards dominate the draft report — a malformed body stays malformed with drafts pending", () => {
    const action = classifyReleaseIssue({ ...fresh("no structure at all"), draftTags: DRAFTS });
    expect(action.kind).toBe("malformed");
  });
});

describe("gh JSON parsers and guard comments", () => {
  it("parseTagNames and parseDraftTags read gh output; drafts filter on isDraft", () => {
    expect(parseTagNames(JSON.stringify([{ name: "v0.4.0-beta.5" }, { name: "latest" }]))).toEqual([
      "v0.4.0-beta.5",
      "latest",
    ]);
    expect(
      parseDraftTags(
        JSON.stringify([
          { tagName: "v0.4.0-beta.5", isDraft: false },
          { tagName: "v0.3.0-beta.1", isDraft: true },
        ]),
      ),
    ).toEqual(["v0.3.0-beta.1"]);
  });

  it("guard comments carry their marker line, so parseMarkerPresent suppresses duplicates on later passes", () => {
    const malformed = buildMalformedComment(["missing a `**Version:** <semver>` line"]);
    const refusal = buildOutOfOrderComment("0.4.0-beta.4", "v0.4.0-beta.5");
    expect(malformed.startsWith(MALFORMED_MARKER)).toBe(true);
    expect(refusal.startsWith(OUT_OF_ORDER_MARKER)).toBe(true);

    const comments = JSON.stringify({ comments: [{ body: refusal }] });
    expect(parseMarkerPresent(comments, OUT_OF_ORDER_MARKER)).toBe(true);
    expect(parseMarkerPresent(comments, MALFORMED_MARKER)).toBe(false);
    expect(parseMarkerPresent(JSON.stringify({}), OUT_OF_ORDER_MARKER)).toBe(false);
  });
});

describe("cut-phase classification (prd/009 R10–R13)", () => {
  it("an append request for an existing tag classifies append; a cut for the same version stays refused", () => {
    const append = classifyReleaseIssue(
      fresh(body("0.4.0-beta.5", "**Targets:** windows\n**Mode:** append\n")),
    );
    expect(append.kind).toBe("append");
    expect(append.kind === "append" && append.spec.targets).toEqual(["windows"]);

    expect(classifyReleaseIssue(fresh(body("0.4.0-beta.5"))).kind).toBe("out-of-order");
  });

  it("an append request whose tag does not exist takes the full-cut path, ordering guard included", () => {
    const extra = "**Targets:** windows\n**Mode:** append\n";
    expect(classifyReleaseIssue(fresh(body("0.4.0-beta.6", extra))).kind).toBe("proceed");
    expect(classifyReleaseIssue(fresh(body("0.4.0-beta.2", extra))).kind).toBe("out-of-order");
  });

  it("the awaiting-publish marker ends the lane, even though the cut's own tag now trips the ordering guard", () => {
    const done = classifyReleaseIssue({ ...fresh(body("0.4.0-beta.5")), awaitingPublishPosted: true });
    expect(done.kind).toBe("awaiting-publish");
    expect(
      classifyReleaseIssue({ ...fresh("no structure"), awaitingPublishPosted: true }).kind,
    ).toBe("malformed");
  });

  it("a posted tag-pushed marker means mid-flight resume — proceed despite the cut's own tag and own draft", () => {
    const resumed = classifyReleaseIssue({
      ...fresh(body("0.4.0-beta.5")),
      draftTags: ["v0.4.0-beta.5"],
      tagPushedPosted: true,
    });
    expect(resumed.kind).toBe("proceed");

    // A mid-flight append cut whose tag it pushed itself resumes as a full cut.
    const appendMidFlight = classifyReleaseIssue({
      ...fresh(body("0.4.0-beta.5", "**Targets:** windows\n**Mode:** append\n")),
      tagPushedPosted: true,
    });
    expect(appendMidFlight.kind).toBe("proceed");
  });

  it("phase markers are pairwise distinct and none contains another, so parseMarkerPresent cannot misfire", () => {
    const markers = [
      MALFORMED_MARKER,
      OUT_OF_ORDER_MARKER,
      DRAFT_REPORT_MARKER,
      PREFLIGHT_ACK_MARKER,
      GATE_PASSED_MARKER,
      PRETAG_CI_GREEN_MARKER,
      CUT_FAILED_MARKER,
      TAG_PUSHED_MARKER,
      CI_GREEN_MARKER,
      DRAFT_VERIFIED_MARKER,
      ARTIFACTS_APPENDED_MARKER,
      AWAITING_PUBLISH_MARKER,
    ];
    expect(new Set(markers).size).toBe(markers.length);
    for (const a of markers) {
      for (const b of markers) {
        if (a !== b) expect(a.includes(b)).toBe(false);
      }
    }
  });

  it("an active cut-failed parks the release while its bug is open, unknown, or unlinked", () => {
    expect(
      classifyReleaseIssue({
        ...fresh(body("0.5.0-beta.1")),
        tagPushedPosted: true,
        cutFailedActive: true,
        blockedByBug: 67,
        blockingBugOpen: true,
      }),
    ).toEqual({ kind: "parked", bug: 67 });
    expect(
      classifyReleaseIssue({
        ...fresh(body("0.5.0-beta.1")),
        cutFailedActive: true,
        blockedByBug: 67,
        blockingBugOpen: null,
      }).kind,
    ).toBe("parked");
    expect(
      classifyReleaseIssue({
        ...fresh(body("0.5.0-beta.1")),
        tagPushedPosted: true,
        cutFailedActive: true,
      }),
    ).toEqual({ kind: "parked", bug: null });
  });

  it("a closed blocking bug un-parks — the cut resumes, and terminal/guard states still dominate", () => {
    expect(
      classifyReleaseIssue({
        ...fresh(body("0.5.0-beta.1")),
        tagPushedPosted: true,
        cutFailedActive: true,
        blockedByBug: 67,
        blockingBugOpen: false,
      }).kind,
    ).toBe("proceed");
    // Pre-tag failure (no tag pushed): closed bug resumes through the
    // ordering guard as a fresh cut of the same, still-unspent version.
    expect(
      classifyReleaseIssue({
        ...fresh(body("0.5.0-beta.1")),
        cutFailedActive: true,
        blockedByBug: 67,
        blockingBugOpen: false,
      }).kind,
    ).toBe("proceed");
    expect(
      classifyReleaseIssue({
        ...fresh(body("0.5.0-beta.1")),
        awaitingPublishPosted: true,
        cutFailedActive: true,
        blockedByBug: 67,
        blockingBugOpen: true,
      }).kind,
    ).toBe("awaiting-publish");
    expect(classifyReleaseIssue({ ...fresh("no structure"), cutFailedActive: true }).kind).toBe(
      "malformed",
    );
  });
});

describe("failure-flow parsing (prd/009 R10)", () => {
  const comments = (...bodies: string[]) =>
    JSON.stringify({ comments: bodies.map((body) => ({ body })) });

  it("parseBlockedBy reads the Blocked-by line of the newest cut-failed comment only", () => {
    expect(
      parseBlockedBy(
        comments(
          `${CUT_FAILED_MARKER}\n\nold failure\nBlocked-by: #41`,
          `${TAG_PUSHED_MARKER}\n\nretry got further`,
          `${CUT_FAILED_MARKER}\n\nnew failure\nBlocked-by: #67\nmore text`,
        ),
      ),
    ).toBe(67);
    expect(parseBlockedBy(comments(`${CUT_FAILED_MARKER}\n\nno link here`))).toBe(null);
    expect(parseBlockedBy(comments("owner chatter"))).toBe(null);
    expect(parseBlockedBy(JSON.stringify({}))).toBe(null);
  });

  it("releaseOutcome maps the newest phase marker — awaiting-publish ok, cut-failed failed, all else incomplete", () => {
    expect(releaseOutcome(comments(`${AWAITING_PUBLISH_MARKER}\n\ndraft url`)).level).toBe("ok");
    expect(
      releaseOutcome(comments(`${GATE_PASSED_MARKER}\n\n…`, `${CUT_FAILED_MARKER}\n\nfailed`)).level,
    ).toBe("failed");
    expect(
      releaseOutcome(comments(`${CUT_FAILED_MARKER}\n\nold`, `${PREFLIGHT_ACK_MARKER}\n\nretrying`))
        .level,
    ).toBe("incomplete");
    expect(releaseOutcome(comments("owner chatter")).level).toBe("incomplete");
    expect(releaseOutcome(JSON.stringify({})).level).toBe("incomplete");
  });
});
