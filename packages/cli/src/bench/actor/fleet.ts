/**
 * Building the fleet of synthetic actors a benchmark run signs as.
 *
 * A fixed actor set keeps the target's key dereferencing on a cold path that a
 * warm-up window excludes, so the synthetic key server adds no steady-state
 * measurement noise.
 * @since 2.3.0
 * @module
 */

import type { ActorGroup, SignatureStandard } from "../scenario/types.ts";
import { type ActorKeys, generateActorKeys } from "./keys.ts";

/** The HTTP request signature standard used by an actor. */
export type HttpSignatureStandard =
  | "draft-cavage-http-signatures-12"
  | "rfc9421";

/** A synthetic actor before its URLs are known (no server yet). */
export interface FleetMember {
  /** The actor's index across the whole fleet. */
  readonly index: number;
  /** The display name template the actor came from, if any. */
  readonly name?: string;
  /** The signature standards the actor signs with. */
  readonly standards: SignatureStandard[];
  /** The actor's key pairs. */
  readonly keys: ActorKeys;
  /** The single HTTP request signature standard the actor uses. */
  readonly httpStandard: HttpSignatureStandard;
}

function httpStandardOf(
  standards: readonly SignatureStandard[],
): HttpSignatureStandard {
  const http = standards.find((s) =>
    s === "draft-cavage-http-signatures-12" || s === "rfc9421"
  );
  if (http == null) {
    throw new TypeError(
      "Every actor group must declare exactly one HTTP request signature " +
        "standard.",
    );
  }
  return http as HttpSignatureStandard;
}

/**
 * Builds the fleet from the suite's actor groups, generating each actor's keys.
 * When no groups are declared, a single default actor using
 * `draft-cavage-http-signatures-12` is created.
 * @param groups The suite's actor groups.
 * @returns The fleet members, with keys generated.
 */
export async function buildFleet(
  groups: readonly ActorGroup[],
): Promise<FleetMember[]> {
  const effective: readonly ActorGroup[] = groups.length > 0 ? groups : [{
    signatureStandards: ["draft-cavage-http-signatures-12"],
  }];
  const members: FleetMember[] = [];
  let index = 0;
  for (const group of effective) {
    const count = group.count ?? 1;
    const standards = group.signatureStandards;
    const httpStandard = httpStandardOf(standards);
    for (let i = 0; i < count; i++) {
      members.push({
        index,
        name: group.name,
        standards,
        keys: await generateActorKeys(standards),
        httpStandard,
      });
      index++;
    }
  }
  return members;
}
