/**
 * Probing a target for benchmark mode by querying its `stats` endpoint.
 *
 * A valid `stats` response means the target advertises benchmark mode, which is
 * the operator's assertion that the target is not production.  The probe also
 * reads the target's Fedify version from the metric scope, for the report.
 * @since 2.3.0
 * @module
 */

/** The result of probing a target for benchmark mode. */
export interface BenchmarkProbe {
  /** Whether the target advertises benchmark mode. */
  readonly benchmarkMode: boolean;
  /** The target's Fedify version, if discoverable. */
  readonly fedifyVersion: string | null;
}

/** The path of the cooperative benchmark stats endpoint. */
export const STATS_PATH = "/.well-known/fedify/bench/stats";

/**
 * Probes a target for benchmark mode.
 * @param target The target base URL.
 * @param fetchImpl The fetch implementation (overridable for tests).
 * @returns Whether benchmark mode is advertised and the target's Fedify
 *          version.  Never throws; a failed probe reports `benchmarkMode:
 *          false`.
 */
export async function probeBenchmarkMode(
  target: URL,
  fetchImpl: typeof fetch = fetch,
): Promise<BenchmarkProbe> {
  try {
    const response = await fetchImpl(new URL(STATS_PATH, target), {
      headers: { accept: "application/json" },
    });
    if (!response.ok) return notAdvertised();
    const json = await response.json() as {
      version?: unknown;
      source?: unknown;
      scopeMetrics?: unknown;
    };
    if (json?.version === 1 && json?.source === "server") {
      return { benchmarkMode: true, fedifyVersion: extractFedifyVersion(json) };
    }
    return notAdvertised();
  } catch {
    return notAdvertised();
  }
}

function notAdvertised(): BenchmarkProbe {
  return { benchmarkMode: false, fedifyVersion: null };
}

function extractFedifyVersion(json: { scopeMetrics?: unknown }): string | null {
  try {
    const scopes = Array.isArray(json.scopeMetrics) ? json.scopeMetrics : [];
    for (const entry of scopes) {
      if (entry == null || typeof entry !== "object") continue;
      const descriptor = (entry as { scope?: unknown }).scope;
      if (descriptor == null || typeof descriptor !== "object") continue;
      const { name, version } = descriptor as {
        name?: unknown;
        version?: unknown;
      };
      if (name === "@fedify/fedify") {
        return typeof version === "string" ? version : null;
      }
    }
  } catch {
    // Version extraction must never affect benchmark-mode detection.
  }
  return null;
}
