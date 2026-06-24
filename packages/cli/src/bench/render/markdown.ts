/**
 * The Markdown renderer, suited to a GitHub Actions job summary or a PR
 * comment.  It is derived from the same report model as the text and JSON
 * forms.
 * @since 2.3.0
 * @module
 */

import { metricDisplayUnit } from "../result/expect/metrics.ts";
import type { BenchReport, ScenarioResult } from "../result/model.ts";
import {
  formatActual,
  formatNumber,
  formatPercent,
  formatThreshold,
  opSymbol,
} from "./format.ts";

/**
 * Renders a report as Markdown.
 * @param report The report to render.
 * @returns The Markdown text.
 */
export function renderMarkdown(report: BenchReport): string {
  const lines: string[] = [];
  lines.push("# Fedify benchmark report", "");
  lines.push(`**Result:** ${report.passed ? "✅ PASS" : "❌ FAIL"}`, "");
  lines.push(
    `- **Target:** \`${report.target.url}\` ` +
      `(${report.target.statsAvailable ? "stats available" : "no stats"})`,
  );
  lines.push(
    `- **Environment:** ${report.environment.runtime} ` +
      `${report.environment.runtimeVersion}, ${report.environment.os}, ` +
      `${report.environment.cpuCount} CPUs`,
  );
  lines.push(`- **Config:** \`${report.suite.configHash}\``, "");

  for (const scenario of report.scenarios) {
    lines.push(...renderScenario(scenario), "");
  }
  return lines.join("\n");
}

function renderScenario(scenario: ScenarioResult): string[] {
  const lines: string[] = [];
  lines.push(
    `## ${scenario.name} (${scenario.type}) ` +
      `${scenario.passed ? "✅" : "❌"}`,
    "",
  );
  lines.push("| Metric | Value |", "| --- | --- |");
  const r = scenario.requests;
  lines.push(`| Requests | ${formatNumber(r.total)} |`);
  lines.push(`| Success rate | ${formatPercent(r.successRate)} |`);
  lines.push(`| Throughput | ${formatNumber(scenario.throughputPerSec)}/s |`);
  if (scenario.deliveryThroughputPerSec != null) {
    lines.push(
      `| Delivery throughput | ${
        formatNumber(scenario.deliveryThroughputPerSec)
      }/s |`,
    );
  }
  const l = scenario.client.latencyMs;
  lines.push(`| Latency p50 | ${formatNumber(l.p50)}ms |`);
  lines.push(`| Latency p95 | ${formatNumber(l.p95)}ms |`);
  lines.push(`| Latency p99 | ${formatNumber(l.p99)}ms |`);
  const sig = scenario.server?.signatureVerificationMs?.overall;
  if (sig?.p95 != null) {
    lines.push(
      `| Signature verification p95 (server) | ${formatNumber(sig.p95)}ms |`,
    );
  }
  const queue = scenario.server?.queue;
  if (queue?.drainMs?.p95 != null) {
    lines.push(
      `| Queue drain p95 (server) | ${formatNumber(queue.drainMs.p95)}ms |`,
    );
  }
  if (queue?.depthMax != null) {
    lines.push(
      `| Queue depth max (server) | ${formatNumber(queue.depthMax)} |`,
    );
  }

  if (scenario.errors.length > 0) {
    lines.push("", "| Error | Count |", "| --- | --- |");
    for (const error of scenario.errors) {
      const code = error.status == null ? error.kind : String(error.status);
      lines.push(`| ${code} ${error.reason} | ${formatNumber(error.count)} |`);
    }
  }

  if (scenario.expectations.length > 0) {
    lines.push("", "| Expectation | Actual | Result |", "| --- | --- | --- |");
    for (const e of scenario.expectations) {
      const tag = e.pass ? "✅" : e.severity === "warn" ? "⚠️" : "❌";
      const unit = metricDisplayUnit(e.metric);
      lines.push(
        `| \`${e.metric} ${opSymbol(e.op)} ${
          formatThreshold(e.threshold, e.unit ?? unit)
        }\` | ${formatActual(e.actual, unit)} | ${tag} |`,
      );
    }
  }
  return lines;
}
