/**
 * The canonical JSON renderer.  This is the machine form pinned by the
 * published report schema; the other renderers are derived from the same model.
 * @since 2.3.0
 * @module
 */

import type { BenchReport } from "../result/model.ts";

/**
 * Renders a report as pretty-printed canonical JSON.
 * @param report The report to render.
 * @returns The JSON text, with a trailing newline.
 */
export function renderJson(report: BenchReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
