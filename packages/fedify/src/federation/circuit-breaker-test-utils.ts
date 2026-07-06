import type { KvStore } from "./kv.ts";

export function markCircuitBreakerLegacySweepDone(
  kv: Pick<KvStore, "set">,
): Promise<void> {
  return kv.set([
    "_fedify",
    "circuit",
    "__fedify_meta",
    "circuit_breaker_state_ttl_sweep_v1",
  ], { state: "final" });
}
