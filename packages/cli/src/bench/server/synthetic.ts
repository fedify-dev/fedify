/**
 * The benchmark's own synthetic actor/key server.
 *
 * It serves the actor documents (with embedded keys) that the target
 * dereferences while verifying signatures, over plain loopback HTTP — which
 * works because `benchmarkMode` enables `allowPrivateAddress` on the target.
 * @since 2.3.0
 * @module
 */

import { serve } from "srvx";
import type { DocumentLoader } from "@fedify/vocab-runtime";
import { getContextLoader } from "../../docloader.ts";
import { actorDocument } from "../actor/documents.ts";
import type { FleetMember } from "../actor/fleet.ts";

/** A synthetic actor with its server-assigned URLs. */
export interface SyntheticActor extends FleetMember {
  /** The actor's URL on the synthetic server. */
  readonly id: URL;
  /** The RSA key's id (a fragment of the actor URL), if the actor has one. */
  readonly rsaKeyId?: URL;
  /** The Ed25519 key's id, if the actor has one. */
  readonly ed25519KeyId?: URL;
}

/** A running synthetic actor/key server. */
export interface SyntheticServer {
  /** The server's base URL. */
  readonly url: URL;
  /** The actors it serves, with their URLs and keys. */
  readonly actors: SyntheticActor[];
  /** Shuts the server down. */
  close(): Promise<void>;
}

/** Options for {@link spawnSyntheticServer}. */
export interface SyntheticServerOptions {
  /** The context loader used to render actor documents. */
  readonly contextLoader?: DocumentLoader;
}

/**
 * Starts the synthetic actor/key server and serves each fleet member's actor
 * document.
 * @param members The fleet members (with keys) to serve.
 * @param options Server options.
 * @returns The running server, including the actors with their assigned URLs.
 */
export async function spawnSyntheticServer(
  members: readonly FleetMember[],
  options: SyntheticServerOptions = {},
): Promise<SyntheticServer> {
  const routes = new Map<string, string>();
  const server = serve({
    port: 0,
    hostname: "127.0.0.1",
    silent: true,
    fetch(request: Request): Response {
      const { pathname } = new URL(request.url);
      const body = routes.get(pathname);
      if (body == null) return new Response("Not found", { status: 404 });
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/activity+json" },
      });
    },
  });
  await server.ready();
  const actors: SyntheticActor[] = [];
  try {
    const base = new URL(server.url!);
    const contextLoader = options.contextLoader ??
      await getContextLoader({ allowPrivateAddress: true });
    for (const member of members) {
      const id = new URL(`/actors/${member.index}`, base);
      const actor: SyntheticActor = {
        ...member,
        id,
        rsaKeyId: member.keys.rsa == null
          ? undefined
          : new URL("#main-key", id),
        ed25519KeyId: member.keys.ed25519 == null
          ? undefined
          : new URL("#ed25519-key", id),
      };
      const document = await actorDocument(actor, { contextLoader });
      routes.set(`/actors/${member.index}`, JSON.stringify(document));
      actors.push(actor);
    }
    return {
      url: new URL(server.url!),
      actors,
      async close() {
        await server.close(true);
      },
    };
  } catch (error) {
    // Don't leak the listener if rendering the actor documents fails.
    await server.close(true);
    throw error;
  }
}
