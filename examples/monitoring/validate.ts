import { dirname, fromFileUrl, join } from "@std/path";

const exampleDir = dirname(fromFileUrl(import.meta.url));
const composeFile = join(exampleDir, "compose.yaml");
const prometheusConfig = join(exampleDir, "prometheus.yaml");
const prometheusRules = join(exampleDir, "prometheus-rules.yaml");
const prometheusRuleTests = join(exampleDir, "prometheus-rules.test.yaml");
const collectorConfig = join(exampleDir, "otel-collector.yaml");
const dashboardFile = join(
  exampleDir,
  "grafana",
  "dashboards",
  "fedify-overview.json",
);
const sampleMetrics = join(exampleDir, "sample-metrics.ts");
const validateScript = join(exampleDir, "validate.ts");

const projectName = "fedify-monitoring-validate";
const smoke = Deno.args.includes("--smoke");
const requestTimeoutMs = 5_000;

interface RunOptions {
  cwd?: string;
  noThrow?: boolean;
  quiet?: boolean;
}

async function run(
  label: string,
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<string> {
  console.log(`\n> ${label}`);
  console.log(`  ${command} ${args.join(" ")}`);
  const output = await new Deno.Command(command, {
    args,
    cwd: options.cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);
  if (!output.success && !options.noThrow) {
    if (stdout.trim()) console.error(stdout.trim());
    if (stderr.trim()) console.error(stderr.trim());
    throw new Error(`${label} failed with exit code ${output.code}`);
  }
  if (!options.quiet) {
    if (stdout.trim()) console.log(stdout.trim());
    if (stderr.trim()) console.error(stderr.trim());
  }
  return stdout + stderr;
}

async function checkTools(): Promise<void> {
  await run("Check Docker", "docker", ["--version"]);
  await run("Check Docker Compose", "docker", ["compose", "version"]);
}

async function staticChecks(): Promise<void> {
  await run("Deno check sample metric generator", Deno.execPath(), [
    "check",
    "--config",
    join(exampleDir, "deno.json"),
    sampleMetrics,
  ]);
  await run("Deno check validation script", Deno.execPath(), [
    "check",
    validateScript,
  ]);
  await run("Docker Compose config", "docker", [
    "compose",
    "-f",
    composeFile,
    "config",
  ]);
  await run("Prometheus config", "docker", [
    "run",
    "--rm",
    "-v",
    `${prometheusConfig}:/etc/prometheus/prometheus.yaml:ro,z`,
    "-v",
    `${prometheusRules}:/etc/prometheus/prometheus-rules.yaml:ro,z`,
    "--entrypoint",
    "promtool",
    "docker.io/prom/prometheus:v3.5.4",
    "check",
    "config",
    "/etc/prometheus/prometheus.yaml",
  ]);
  await run("Prometheus rules", "docker", [
    "run",
    "--rm",
    "-v",
    `${prometheusRules}:/workspace/prometheus-rules.yaml:ro,z`,
    "--entrypoint",
    "promtool",
    "docker.io/prom/prometheus:v3.5.4",
    "check",
    "rules",
    "/workspace/prometheus-rules.yaml",
  ]);
  await run("Prometheus rule tests", "docker", [
    "run",
    "--rm",
    "-v",
    `${prometheusRules}:/workspace/prometheus-rules.yaml:ro,z`,
    "-v",
    `${prometheusRuleTests}:/workspace/prometheus-rules.test.yaml:ro,z`,
    "--entrypoint",
    "promtool",
    "docker.io/prom/prometheus:v3.5.4",
    "test",
    "rules",
    "/workspace/prometheus-rules.test.yaml",
  ]);
  await run("OpenTelemetry Collector config", "docker", [
    "run",
    "--rm",
    "-v",
    `${collectorConfig}:/etc/otelcol-contrib/config.yaml:ro,z`,
    "docker.io/otel/opentelemetry-collector-contrib:0.154.0",
    "validate",
    "--config=/etc/otelcol-contrib/config.yaml",
  ]);
}

async function waitFor(
  label: string,
  check: () => Promise<boolean>,
  timeoutMs = 120_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (await check()) {
        console.log(`${label}: ready`);
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `${label} did not become ready within ${timeoutMs} ms` +
      (lastError == null ? "" : `: ${lastError}`),
  );
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return await response.json();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null;
}

async function prometheusQuery(expression: string): Promise<boolean> {
  const result = await evaluatePrometheusExpression(expression);
  return Array.isArray(result) && result.length > 0;
}

async function evaluatePrometheusExpression(
  expression: string,
): Promise<unknown> {
  const url = new URL("http://localhost:9090/api/v1/query");
  url.searchParams.set("query", expression);
  const json = await fetchJson(url.href);
  if (!isRecord(json) || json.status !== "success" || !isRecord(json.data)) {
    throw new Error(`Prometheus rejected query: ${expression}`);
  }
  return json.data.result;
}

function collectDashboardExpressions(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectDashboardExpressions);
  if (!isRecord(value)) return [];
  const expressions: string[] = [];
  if (typeof value.expr === "string" && value.expr.trim() !== "") {
    expressions.push(value.expr);
  }
  for (const child of Object.values(value)) {
    expressions.push(...collectDashboardExpressions(child));
  }
  return expressions;
}

async function checkDashboardQueries(): Promise<void> {
  const dashboard = JSON.parse(await Deno.readTextFile(dashboardFile));
  const expressions = [...new Set(collectDashboardExpressions(dashboard))];
  if (expressions.length < 1) {
    throw new Error("No Prometheus expressions found in the Grafana dashboard");
  }
  for (const expression of expressions) {
    await evaluatePrometheusExpression(expression);
  }
  console.log(`Grafana dashboard queries: ${expressions.length} valid`);
}

async function smokeChecks(): Promise<void> {
  let cleanedUp = false;
  const stopSmokeStack = async (options: RunOptions = {}) => {
    if (cleanedUp) return;
    cleanedUp = true;
    await run("Stop smoke stack", "docker", [
      "compose",
      "-p",
      projectName,
      "-f",
      composeFile,
      "down",
      "--remove-orphans",
      "--volumes",
    ], { noThrow: true, ...options });
  };
  const cleanupAfterSignal = (signal: "SIGINT" | "SIGTERM", code: number) => {
    void (async () => {
      console.error(`\nReceived ${signal}; cleaning up smoke stack.`);
      await stopSmokeStack();
      Deno.exit(code);
    })();
  };
  const onSigint = () => cleanupAfterSignal("SIGINT", 130);
  const onSigterm = () => cleanupAfterSignal("SIGTERM", 143);

  await stopSmokeStack({ quiet: true });
  cleanedUp = false;

  Deno.addSignalListener("SIGINT", onSigint);
  Deno.addSignalListener("SIGTERM", onSigterm);

  try {
    await run("Start smoke stack", "docker", [
      "compose",
      "-p",
      projectName,
      "-f",
      composeFile,
      "up",
      "-d",
    ]);

    await waitFor("Prometheus", async () => {
      const response = await fetch("http://localhost:9090/-/ready", {
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      await response.body?.cancel();
      return response.ok;
    });
    await waitFor("Grafana", async () => {
      const json = await fetchJson("http://localhost:3000/api/health");
      return isRecord(json) && json.database === "ok";
    });
    await waitFor("OpenTelemetry Collector scrape target", async () => {
      const json = await fetchJson("http://localhost:9090/api/v1/targets");
      if (!isRecord(json) || !isRecord(json.data)) return false;
      const targets = json.data.activeTargets;
      if (!Array.isArray(targets)) return false;
      return targets.some((target) =>
        isRecord(target) &&
        target.health === "up" &&
        isRecord(target.labels) &&
        target.labels.job === "otel-collector"
      );
    });
    await waitFor(
      "Fedify sample metrics",
      () => prometheusQuery("fedify_http_server_request_count_total"),
    );
    await checkDashboardQueries();
    await waitFor("Fedify dashboard provisioning", async () => {
      const json = await fetchJson(
        "http://localhost:3000/api/search?query=Fedify",
      );
      return Array.isArray(json) &&
        json.some((entry) =>
          isRecord(entry) && entry.uid === "fedify-overview"
        );
    });
  } finally {
    Deno.removeSignalListener("SIGINT", onSigint);
    Deno.removeSignalListener("SIGTERM", onSigterm);
    await stopSmokeStack();
  }
}

try {
  await checkTools();
  await staticChecks();
  if (smoke) await smokeChecks();
  console.log("\nMonitoring example validation passed.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  Deno.exit(1);
}
