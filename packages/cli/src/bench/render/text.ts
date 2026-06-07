/**
 * The terminal-text renderer: a readable per-scenario summary with the gate
 * result, derived from the same report model as the JSON and Markdown forms.
 * @since 2.3.0
 * @module
 */

import type {
  BenchReport,
  PartialLatencyMs,
  ScenarioResult,
} from "../result/model.ts";
import { metricDisplayUnit } from "../result/expect/metrics.ts";
import {
  formatActual,
  formatNumber,
  formatPercent,
  formatThreshold,
  opSymbol,
} from "./format.ts";

/**
 * Renders a report as a plain-text terminal summary.
 * @param report The report to render.
 * @returns The summary text.
 */
export function renderText(report: BenchReport): string {
  const lines: string[] = [];
  lines.push("Fedify benchmark report", "");
  const fedify = report.target.fedifyVersion == null
    ? "Fedify version unknown"
    : `Fedify ${report.target.fedifyVersion}`;
  const stats = report.target.statsAvailable
    ? "stats available"
    : "stats unavailable";
  lines.push(`Target: ${report.target.url}  (${fedify}, ${stats})`);
  const env = report.environment;
  lines.push(
    `Environment: ${env.runtime} ${env.runtimeVersion}, ${env.os}, ` +
      `${env.cpuCount} CPUs`,
  );
  lines.push(`Started: ${report.startedAt}  Finished: ${report.finishedAt}`);
  lines.push(`Config: ${report.suite.configHash}`, "");

  for (const scenario of report.scenarios) {
    lines.push(...renderScenario(scenario), "");
  }
  lines.push(`Overall: ${report.passed ? "PASS" : "FAIL"}`);
  return lines.join("\n");
}

function renderScenario(scenario: ScenarioResult): string[] {
  const lines: string[] = [];
  lines.push(
    `Scenario: ${scenario.name} (${scenario.type})  ` +
      `[${scenario.passed ? "PASS" : "FAIL"}]`,
  );
  lines.push(`  Load: ${describeLoad(scenario.load)}`);
  const r = scenario.requests;
  lines.push(
    `  Requests: ${formatNumber(r.total)}  (ok ${formatNumber(r.ok)}, ` +
      `failed ${formatNumber(r.failed)}, success ${
        formatPercent(r.successRate)
      })`,
  );
  lines.push(`  Throughput: ${formatNumber(scenario.throughputPerSec)} req/s`);
  const l = scenario.client.latencyMs;
  lines.push(
    `  Client latency (ms): p50 ${formatNumber(l.p50)}  p95 ${
      formatNumber(l.p95)
    }  p99 ${formatNumber(l.p99)}  mean ${formatNumber(l.mean)}  max ${
      formatNumber(l.max)
    }`,
  );
  if (scenario.server?.signatureVerificationMs != null) {
    lines.push(
      `  Server signature verification (ms): ${
        describePartial(scenario.server.signatureVerificationMs.overall)
      }`,
    );
  }
  const queue = scenario.server?.queue;
  if (queue?.drainMs != null && hasPartial(queue.drainMs)) {
    const depth = queue.depthMax;
    const suffix = depth == null ? "" : `  (depth max ${formatNumber(depth)})`;
    lines.push(
      `  Server queue drain (ms): ${describePartial(queue.drainMs)}${suffix}`,
    );
  } else if (queue?.depthMax != null) {
    // Queue depth is reported even when no drain-latency histogram is present
    // (the current stats reader supplies depth but not drain latency).
    lines.push(`  Server queue depth max: ${formatNumber(queue.depthMax)}`);
  }
  if (scenario.errors.length > 0) {
    lines.push("  Errors:");
    for (const error of scenario.errors) {
      const code = error.status == null ? error.kind : String(error.status);
      lines.push(`    ${code} ${error.reason}: ${formatNumber(error.count)}`);
    }
  }
  if (scenario.expectations.length > 0) {
    lines.push("  Expectations:");
    for (const e of scenario.expectations) {
      const tag = e.pass ? "PASS" : e.severity === "warn" ? "WARN" : "FAIL";
      const unit = metricDisplayUnit(e.metric);
      lines.push(
        `    [${tag}] ${e.metric} ${opSymbol(e.op)} ${
          formatThreshold(e.threshold, e.unit ?? unit)
        }  (actual ${formatActual(e.actual, unit)})`,
      );
    }
  }
  return lines;
}

function describeLoad(load: ScenarioResult["load"]): string {
  const tail = `duration ${formatNumber(load.durationMs)}ms, warmup ${
    formatNumber(load.warmupMs)
  }ms`;
  if (load.model === "closed") {
    return `closed, concurrency ${load.concurrency}, ${tail}`;
  }
  return `open, ${formatNumber(load.ratePerSec)}/s ${load.arrival}, ${tail}`;
}

function describePartial(latency: PartialLatencyMs): string {
  const parts: string[] = [];
  if (latency.p50 != null) parts.push(`p50 ${formatNumber(latency.p50)}`);
  if (latency.p95 != null) parts.push(`p95 ${formatNumber(latency.p95)}`);
  if (latency.p99 != null) parts.push(`p99 ${formatNumber(latency.p99)}`);
  return parts.join("  ");
}

/** Whether a partial latency carries at least one renderable percentile. */
function hasPartial(latency: PartialLatencyMs): boolean {
  return latency.p50 != null || latency.p95 != null || latency.p99 != null;
}
