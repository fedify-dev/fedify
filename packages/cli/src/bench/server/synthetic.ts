/**
 * The benchmark's own synthetic actor/key server.
 *
 * It serves the actor documents (with embedded keys) that the target
 * dereferences while verifying signatures, over plain HTTP — which works
 * because `benchmarkMode` enables `allowPrivateAddress` on the target.  By
 * default it binds loopback and advertises a `127.0.0.1` base URL, which a
 * same-machine (loopback) target can reach.  For a non-loopback target, pass
 * `advertiseHost`: the server then binds every interface and advertises that
 * host in the actor/key URLs, so the remote target can dereference them.
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
  /**
   * A host (name or IP) reachable from the target.  When set, the server binds
   * every interface and advertises actor/key URLs at this host (with its chosen
   * port) instead of `127.0.0.1`, so a non-loopback target can dereference them.
   */
  readonly advertiseHost?: string;
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
  // Resolved before binding so a malformed --advertise-host fails fast.
  const advertised = options.advertiseHost == null
    ? null
    : resolveAdvertiseHost(options.advertiseHost);
  const routes = new Map<string, string>();
  const server = serve({
    port: 0,
    // Bind a reachable interface when advertising a host (every IPv6 or every
    // IPv4 interface, matching the advertised host's family), otherwise stay on
    // loopback.
    hostname: advertised?.bindHost ?? "127.0.0.1",
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
    const bound = new URL(server.url!);
    // Actor and key IDs must use an address the target can dereference; the
    // bound (loopback) URL works for a same-machine target, otherwise the
    // advertised host (with the bound port) is used.
    const base = advertised == null
      ? bound
      : new URL(`http://${advertised.urlHost}:${bound.port}/`);
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
      url: base,
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

/** A validated advertise host: where to bind and how to write it in a URL. */
export interface ResolvedAdvertiseHost {
  /** The address to bind the synthetic server to. */
  readonly bindHost: string;
  /** The host as it appears in a URL authority (IPv6 is bracketed). */
  readonly urlHost: string;
}

/** An error raised when `--advertise-host` is not a usable bare host. */
export class AdvertiseHostError extends Error {}

/**
 * Validates and normalizes an `--advertise-host` value into a bind address and a
 * URL-authority host.  It must be a bare host name, IPv4 address, or IPv6
 * literal (bracketed or not); a scheme, port, path, or other URL syntax is
 * rejected, since the synthetic server's chosen port is appended automatically.
 * An IPv6 host binds every IPv6 interface (`::`); anything else binds every IPv4
 * interface (`0.0.0.0`).
 * @param host The raw `--advertise-host` value.
 * @returns The bind address and the URL-authority host.
 * @throws {AdvertiseHostError} If the value is not a usable bare host.
 */
export function resolveAdvertiseHost(host: string): ResolvedAdvertiseHost {
  const trimmed = host.trim();
  if (trimmed === "") {
    throw new AdvertiseHostError("--advertise-host must not be empty.");
  }
  if (/[\s/\\@?#]/.test(trimmed) || trimmed.includes("://")) {
    throw new AdvertiseHostError(
      `Invalid --advertise-host ${JSON.stringify(host)}: give a bare host ` +
        "name or IP address, with no scheme, path, or whitespace.",
    );
  }
  let urlHost: string;
  let bindHost: string;
  if (trimmed.startsWith("[")) {
    if (!trimmed.endsWith("]")) {
      throw new AdvertiseHostError(
        `Invalid --advertise-host ${JSON.stringify(host)}: unbalanced ` +
          "brackets around the IPv6 address.",
      );
    }
    urlHost = trimmed;
    bindHost = "::";
  } else {
    const colons = (trimmed.match(/:/g) ?? []).length;
    if (colons === 1) {
      throw new AdvertiseHostError(
        `Invalid --advertise-host ${
          JSON.stringify(host)
        }: omit the port; the ` +
          "synthetic server's chosen port is appended automatically.",
      );
    }
    if (colons >= 2) {
      // A bare IPv6 literal; bracket it for the URL authority.
      urlHost = `[${trimmed}]`;
      bindHost = "::";
    } else {
      urlHost = trimmed;
      bindHost = "0.0.0.0";
    }
  }
  try {
    new URL(`http://${urlHost}/`);
  } catch {
    throw new AdvertiseHostError(
      `Invalid --advertise-host ${JSON.stringify(host)}: not a valid host ` +
        "name or IP address.",
    );
  }
  return { bindHost, urlHost };
}
