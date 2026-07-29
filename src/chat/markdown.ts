import { styleText } from "node:util";

/**
 * Minimal markdown → ANSI renderer for `propose` bodies and agent messages
 * in the chat TUI. Deliberately dependency-free: headings, bullets, numbered
 * lists, inline code, bold, and fenced code blocks — the constructs PRD
 * drafts and issue breakdowns actually use.
 */
export const renderMarkdown = (markdown: string): string => {
  const out: string[] = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      out.push(styleText("dim", "│"));
      continue;
    }
    if (inFence) {
      out.push(styleText("dim", "│ ") + styleText("cyan", line));
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const text = renderInline(heading[2] ?? "");
      out.push(
        heading[1]!.length === 1
          ? styleText(["bold", "underline"], text)
          : styleText("bold", text),
      );
      continue;
    }
    const bullet = /^(\s*)[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      out.push(
        `${bullet[1] ?? ""}${styleText("dim", "•")} ${renderInline(bullet[2] ?? "")}`,
      );
      continue;
    }
    out.push(renderInline(line));
  }
  return out.join("\n");
};

const renderInline = (line: string): string =>
  line
    .replace(/\*\*([^*]+)\*\*/g, (_, text: string) => styleText("bold", text))
    .replace(/`([^`]+)`/g, (_, code: string) => styleText("cyan", code));
