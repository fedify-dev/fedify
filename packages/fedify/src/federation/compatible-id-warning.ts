import type { Actor } from "@fedify/vocab";
import { isGatewayUrl, parseIri } from "@fedify/vocab-runtime";
import { isCompatibleEf61Iri } from "@fedify/vocab-runtime/internal/portable-dereference";
import { getLogger } from "@logtape/logtape";
import {
  getCanonicalPortableId,
  getPortableDid,
} from "../sig/portable-key-id.ts";
import type { RequestContext } from "./context.ts";

/** Returns a verified first gateway, without dereferencing the actor. */
export async function getLocalFirstGateway<TContextData>(
  context: RequestContext<TContextData>,
  ownerId: URL,
  did: string,
): Promise<URL | null> {
  try {
    const parsed = context.parseUri(ownerId, { portable: true });
    if (parsed?.type !== "actor" || parsed.authority !== did) return null;
    const actor = await context.getActor(parsed.identifier);
    return firstGateway(actor, did);
  } catch (error) {
    // A warning must not change whether the object can be published.
    getLogger(["fedify", "federation", "object"]).debug(
      "Could not check the first gateway of {ownerId}: {error}",
      { ownerId: ownerId.href, error },
    );
    return null;
  }
}

function firstGateway(actor: Actor | null, did: string): URL | null {
  if (actor?.id == null || getPortableDid(actor.id) !== did) return null;
  const gateway = actor.gateway;
  return gateway != null && isGatewayUrl(gateway) ? gateway : null;
}

/** Looks for an actor already embedded in the document being published. */
export function getEmbeddedFirstGateway(
  json: unknown,
  ownerId: URL,
  did: string,
): URL | null {
  const owner = getCanonicalPortableId(ownerId);
  if (owner == null) return null;
  return visitJsonMaps(json, (map) => {
    const id = parseMapId(map, isJsonMap(json) ? json : null);
    if (id == null || getCanonicalPortableId(id) !== owner) return;
    const gateways = map.gateways ??
      map["https://w3id.org/fep/ef61/gateways"];
    const first = Array.isArray(gateways)
      ? gateways[0]
      : isJsonMap(gateways) && Array.isArray(gateways["@list"])
      ? gateways["@list"][0]
      : null;
    const address = typeof first === "string"
      ? first
      : isJsonMap(first)
      ? first.id ?? first["@id"]
      : null;
    if (typeof address !== "string") return;
    try {
      const gateway = new URL(address);
      if (getPortableDid(id) === did && isGatewayUrl(gateway)) return gateway;
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
  }) ?? null;
}

function isJsonMap(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/** Warns only when the publisher's actual first gateway is known. */
export function warnCompatibleId(
  id: URL,
  did: string,
  gateway: URL,
  kind: "object" | "activity",
): void {
  if (
    !isCompatibleEf61Iri(id) || getPortableDid(id) !== did ||
    id.origin === gateway.origin
  ) return;
  getLogger(["fedify", "federation", kind === "activity" ? "outbox" : "object"])
    .warn(
      "The {kind} {id} has an FEP-ef61 compatible identifier on another " +
        "gateway than its owner's first gateway, {gateway}.  FEP-ef61 " +
        "requires publishers to use the first gateway in the actor's gateways.",
      { kind, id: id.href, gateway: gateway.origin },
    );
}

/** Reads the root ID without dereferencing or expanding the document. */
export function getCompactRootId(json: unknown): URL | null {
  return isJsonMap(json) ? parseMapId(json, json) : null;
}

/** Checks an activity and its embedded objects against each one's owner. */
export async function warnCompatibleIdsInJson<TContextData>(
  json: unknown,
  context?: RequestContext<TContextData>,
): Promise<void> {
  const root = isJsonMap(json) ? json : null;
  const rootOwners = root == null ? [] : ownerIds(root, "actor", root);
  const gateways = new Map<string, URL | null>();
  const maps: Array<{ map: Record<string, unknown>; path: string }> = [];
  visitJsonMaps(json, (map, path) => {
    maps.push({ map, path });
  });
  for (const { map, path } of maps) {
    const id = parseMapId(map, root);
    if (id == null || !isCompatibleEf61Iri(id)) continue;
    const type = map.type ?? map["@type"];
    const types = Array.isArray(type) ? type : [type];
    if (
      types.some((t) =>
        typeof t === "string" &&
        /(?:^|[#/:])(CryptographicKey|Multikey|JsonWebKey|Key)$/.test(t)
      )
    ) continue;
    const did = getPortableDid(id);
    if (did == null) continue;
    const owners = path === "" ? rootOwners : [
      ...ownerIds(map, "actor", root),
      ...ownerIds(map, "attributedTo", root),
      ...rootOwners,
    ];
    for (const ownerId of owners) {
      if (getPortableDid(ownerId) !== did) continue;
      const key = getCanonicalPortableId(ownerId);
      if (key == null) continue;
      let gateway = gateways.get(key);
      if (gateway === undefined) {
        gateway = getEmbeddedFirstGateway(json, ownerId, did) ??
          (context == null
            ? null
            : await getLocalFirstGateway(context, ownerId, did));
        gateways.set(key, gateway);
      }
      if (gateway != null) {
        warnCompatibleId(id, did, gateway, path === "" ? "activity" : "object");
        break;
      }
    }
  }
}

function ownerIds(
  map: Record<string, unknown>,
  term: "actor" | "attributedTo",
  root: Record<string, unknown> | null,
): URL[] {
  const iri = `https://www.w3.org/ns/activitystreams#${term}`;
  const values = [map[term], map[iri]];
  for (const context of [map["@context"], root?.["@context"]]) {
    for (const [alias, definition] of localContextEntries(context)) {
      const mapped = typeof definition === "string"
        ? definition
        : isJsonMap(definition)
        ? definition["@id"]
        : null;
      if (mapped === iri || mapped === `as:${term}`) {
        values.push(map[alias]);
      }
    }
  }
  return values.flatMap((value) => parseOwnerIds(value, root));
}

function localContextEntries(context: unknown): [string, unknown][] {
  if (Array.isArray(context)) return context.flatMap(localContextEntries);
  return isJsonMap(context) ? Object.entries(context) : [];
}

function parseOwnerIds(
  value: unknown,
  root: Record<string, unknown> | null,
): URL[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => parseOwnerIds(item, root));
  }
  if (isJsonMap(value)) {
    const id = parseMapId(value, root);
    return id == null ? [] : [id];
  }
  if (typeof value !== "string") return [];
  try {
    return [parseIri(value)];
  } catch (error) {
    if (error instanceof TypeError) return [];
    throw error;
  }
}

function parseMapId(
  map: Record<string, unknown>,
  root: Record<string, unknown> | null,
): URL | null {
  let raw = map["@id"] ?? map.id;
  for (const context of [map["@context"], root?.["@context"]]) {
    for (const [alias, definition] of localContextEntries(context)) {
      const mapped = typeof definition === "string"
        ? definition
        : isJsonMap(definition)
        ? definition["@id"]
        : null;
      if (mapped === "@id" && typeof map[alias] === "string") {
        raw = map[alias];
        break;
      }
    }
  }
  if (typeof raw !== "string") return null;
  try {
    return parseIri(raw);
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

function visitJsonMaps<T>(
  json: unknown,
  visit: (map: Record<string, unknown>, path: string) => T | undefined,
): T | undefined {
  const seen = new Set<object>();
  const pending: Array<{ value: unknown; path: string }> = [{
    value: json,
    path: "",
  }];
  while (pending.length > 0) {
    const { value, path } = pending.pop()!;
    if (value == null || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) {
        pending.push({ value: value[i], path: `${path}/${i}` });
      }
      continue;
    }
    const map = value as Record<string, unknown>;
    const result = visit(map, path);
    if (result !== undefined) return result;
    for (const key of Object.keys(map).reverse()) {
      if (key === "proof" || key === "@context") continue;
      pending.push({ value: map[key], path: `${path}/${key}` });
    }
  }
  return undefined;
}
