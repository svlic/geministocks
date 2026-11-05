import type { ScreeningResult } from "../shared/screening-schema";

// Recursive structured export intentionally includes every DTO field, including
// future optional report metadata. It never receives session or admin settings.
export function screeningMarkdown(result: ScreeningResult): string {
  const scalar = (value: unknown) =>
    value === null
      ? "Not disclosed / 未披露"
      : String(value).replace(/([\\`*_[\]<>#])/g, "\\$1");
  function render(value: unknown, depth = 2): string {
    if (Array.isArray(value))
      return value.length
        ? value
            .map((item) =>
              typeof item === "object" && item !== null
                ? render(item, depth)
                : `- ${scalar(item)}\n`,
            )
            .join("\n")
        : "_None / 无_\n";
    if (value && typeof value === "object")
      return Object.entries(value)
        .map(([key, item]) => {
          if (
            key === "url" &&
            typeof item === "string" &&
            /^https?:\/\//i.test(item)
          )
            return `**url:** <${item.replace(/[<>\n\r]/g, "")}>\n`;
          if (key === "page" && item !== null)
            return `**PDF page ${scalar(item)}**\n`;
          return typeof item === "object" && item !== null
            ? `${"#".repeat(Math.min(depth, 6))} ${key}\n\n${render(item, depth + 1)}`
            : `**${key}:** ${scalar(item)}\n`;
        })
        .join("\n");
    return scalar(value);
  }
  return `# Project screening / 项目初筛\n\nResearch prioritization only. Not an investment decision.\n\n${render(result)}\n`;
}
export function downloadScreeningMarkdown(result: ScreeningResult) {
  const url = URL.createObjectURL(
    new Blob(["\uFEFF", screeningMarkdown(result)], {
      type: "text/markdown;charset=utf-8",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `screening-${result.jobId.replace(/[^a-zA-Z0-9_-]/g, "")}.md`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
