/**
 * RFC 9421 Interoperability Field Test Server
 *
 * A Fedify-based server for testing RFC 9421 HTTP Message Signatures
 * interoperability with Bonfire, Mastodon, and other fediverse implementations.
 *
 * Environment variables:
 *   CHALLENGE_ENABLED=0    Disable Accept-Signature challenge on 401 (enabled by default)
 *   CHALLENGE_NONCE=1      Enable one-time nonce in challenges
 *   NONCE_TTL=300          Nonce TTL in seconds (default: 300)
 *   FIRST_KNOCK=rfc9421    Initial signature spec (rfc9421 | draft-cavage)
 *   PORT=8000              Server port (default: 8000)
 *
 * Usage:
 *   deno run -A main.ts
 *   CHALLENGE_NONCE=1 deno run -A main.ts
 *   CHALLENGE_ENABLED=0 deno run -A main.ts
 */

import { type InboxChallengePolicy } from "@fedify/fedify";
import type { HttpMessageSignaturesSpec } from "@fedify/fedify/sig";
import { getLogger } from "@logtape/logtape";
import createApp from "./app.ts";
import { ACTOR_ID } from "./const.ts";
import createFedify from "./federation.ts";
import "./logging.ts";
import startTunnel from "./tunnel.ts";

const logger = getLogger(["fedify", "examples", "rfc-9421-test", "inbound"]);
const challengeEnabled = Deno.env.get("CHALLENGE_ENABLED") !== "0";
const challengeNonce = Deno.env.get("CHALLENGE_NONCE") === "1";
const nonceTtl = parseInt(Deno.env.get("NONCE_TTL") ?? "300", 10);
const firstKnock =
  (Deno.env.get("FIRST_KNOCK") ?? "rfc9421") as HttpMessageSignaturesSpec;
const port = parseInt(Deno.env.get("PORT") ?? "8000", 10);

const inboxChallengePolicy: InboxChallengePolicy | undefined = challengeEnabled
  ? {
    enabled: true,
    requestNonce: challengeNonce,
    nonceTtlSeconds: nonceTtl,
  }
  : undefined;

logger.info(
  "Configuration: firstKnock={firstKnock}, challenge={challenge}, nonce={nonce}, nonceTtl={nonceTtl}",
  {
    firstKnock,
    challenge: challengeEnabled,
    nonce: challengeNonce,
    nonceTtl,
  },
);

const fedi = createFedify(firstKnock, inboxChallengePolicy);

const app = createApp(fedi, {
  firstKnock,
  challengeEnabled,
  challengeNonce,
  nonceTtl,
});

if (import.meta.main) {
  logger.info("Starting RFC 9421 field test server on port {port}", { port });
  Deno.serve({ port }, app.fetch.bind(app));

  // When ORIGIN is set (e.g. by dev.ts), the tunnel is managed externally.
  const origin = Deno.env.get("ORIGIN");
  if (origin) {
    logger.info("Public URL (external tunnel): {url}", { url: origin });
    logger.info("Actor: {actor}", {
      actor: `@${ACTOR_ID}@${new URL(origin).hostname}`,
    });
  } else {
    const tunnel = await startTunnel(port);
    if (tunnel) {
      logger.info("Public URL: {url}", { url: tunnel.url.href });
      logger.info("Actor: {actor}", {
        actor: `@${ACTOR_ID}@${tunnel.url.hostname}`,
      });
      Deno.addSignalListener("SIGINT", async () => {
        await tunnel.close();
        Deno.exit(0);
      });
    } else {
      logger.warn(
        "Tunnel failed. Server is running locally on port {port}. " +
          "Run `fedify tunnel {port}` manually to expose publicly.",
        { port },
      );
    }
  }
}
