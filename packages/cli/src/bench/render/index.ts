/**
 * Output-format selection over the single report model.
 * @since 2.3.0
 * @module
 */

import type { BenchReport } from "../result/model.ts";
import { renderJson } from "./json.ts";
import { renderMarkdown } from "./markdown.ts";
import { renderText } from "./text.ts";

/** A report output format. */
export type ReportFormat = "text" | "json" | "markdown";

/**
 * Renders a report in the requested format.
 * @param report The report to render.
 * @param format The output format.
 * @returns The rendered text.
 */
export function renderReport(
  report: BenchReport,
  format: ReportFormat,
): string {
  switch (format) {
    case "json":
      return renderJson(report);
    case "markdown":
      return renderMarkdown(report);
    case "text":
      return renderText(report);
  }
}
