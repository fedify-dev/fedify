/**
 * Discovery helpers for actor and object benchmark scenarios.
 * @since 2.3.0
 * @module
 */

import { convertUrlIfHandle } from "../../webfinger/lib.ts";
import { asList } from "../scenario/coerce.ts";
import type { ObjectSource } from "../scenario/types.ts";

const ACTIVITY_JSON_ACCEPT = "application/activity+json, application/ld+json";
const WEBFINGER_ACCEPT = "application/jrd+json, application/json";
const MAX_COLLECTION_CRAWL_PAGES = 100;
const MAX_ACTIVITY_UNWRAP_DEPTH = 10;
const ACTIVITY_WRAPPER_TYPES = new Set([
  "Accept",
  "Add",
  "Announce",
  "Create",
  "Delete",
  "Dislike",
  "Flag",
  "Ignore",
  "Invite",
  "Join",
  "Leave",
  "Like",
  "Listen",
  "Move",
  "Offer",
  "Question",
  "Read",
  "Reject",
  "Remove",
  "TentativeAccept",
  "TentativeReject",
  "Travel",
  "Undo",
  "Update",
  "View",
]);

/**
 * Options for resolving actor URLs from recipients.
 * @property target The benchmark target base URL.
 * @property fetch Fetch implementation used for WebFinger discovery.
 * @property assertReadDestinationAllowed Optional gate for discovered read URLs.
 */
export interface ActorUrlOptions {
  readonly target: URL;
  readonly fetch?: typeof fetch;
  readonly assertReadDestinationAllowed?: (url: URL) => void | Promise<void>;
}

/**
 * Options for resolving object URLs from source definitions.
 * @property source The explicit object URL list or crawl source to resolve.
 */
export interface ObjectUrlOptions extends ActorUrlOptions {
  readonly source: ObjectSource | undefined;
}

/** Resolves scenario recipients into actor document URLs. */
export async function actorUrlsFromRecipients(
  recipients: readonly string[],
  options: ActorUrlOptions,
): Promise<URL[]> {
  const urls: URL[] = [];
  for (const recipient of recipients) {
    urls.push(await actorUrlFromRecipient(recipient, options));
  }
  return urls;
}

/** Resolves object scenario sources into object URLs. */
export async function objectUrlsFromSource(
  options: ObjectUrlOptions,
): Promise<URL[]> {
  const { source } = options;
  if (source == null) return [];
  if (typeof source === "string" || Array.isArray(source)) {
    return asList(source).map((url) => new URL(url));
  }
  const limit = source.limit ?? 100;
  const types = new Set(asList(source.type));
  const urls: URL[] = [];
  for (const seed of asList(source.seed)) {
    const actorUrl = await actorUrlFromRecipient(seed, options);
    await options.assertReadDestinationAllowed?.(actorUrl);
    const actor = await fetchJson(actorUrl, options.fetch);
    for (const collectionName of asList(source.collection ?? "outbox")) {
      const collectionUrl = propertyUrl(actor, collectionName, actorUrl);
      if (collectionUrl == null) continue;
      for await (
        const objectUrl of crawlCollection(collectionUrl, {
          fetch: options.fetch,
          assertReadDestinationAllowed: options.assertReadDestinationAllowed,
          types,
          limit: limit - urls.length,
        })
      ) {
        urls.push(objectUrl);
        if (urls.length >= limit) return urls;
      }
    }
  }
  return urls;
}

async function actorUrlFromRecipient(
  recipient: string,
  options: ActorUrlOptions,
): Promise<URL> {
  const identifier = convertUrlIfHandle(recipient);
  if (identifier.protocol !== "acct:") return identifier;
  const url = new URL("/.well-known/webfinger", options.target);
  url.searchParams.set("resource", identifier.href);
  const jrd = await fetchJson(url, options.fetch, WEBFINGER_ACCEPT);
  const links = Array.isArray(jrd.links) ? jrd.links : [];
  const self = links.find((link) =>
    isRecord(link) && link.rel === "self" && typeof link.href === "string"
  );
  if (!isRecord(self) || typeof self.href !== "string") {
    throw new Error(`WebFinger response for ${recipient} has no self link.`);
  }
  return new URL(self.href);
}

async function* crawlCollection(
  start: URL,
  options: {
    readonly fetch?: typeof fetch;
    readonly assertReadDestinationAllowed?: (url: URL) => void | Promise<void>;
    readonly types: ReadonlySet<string>;
    readonly limit: number;
  },
): AsyncGenerator<URL> {
  let next: URL | null = start;
  let remaining = options.limit;
  let pages = 0;
  const visited = new Set<string>();
  while (next != null && remaining > 0 && pages < MAX_COLLECTION_CRAWL_PAGES) {
    if (visited.has(next.href)) return;
    visited.add(next.href);
    await options.assertReadDestinationAllowed?.(next);
    const page = await fetchJson(next, options.fetch);
    pages++;
    const items = arrayProperty(page, "orderedItems") ??
      arrayProperty(page, "items") ?? [];
    for (const item of items) {
      const url = await objectUrl(item, {
        base: next,
        fetch: options.fetch,
        assertReadDestinationAllowed: options.assertReadDestinationAllowed,
        types: options.types,
      });
      if (url == null) continue;
      yield url;
      remaining--;
      if (remaining <= 0) return;
    }
    const first = propertyUrl(page, "first", next);
    const following = propertyUrl(page, "next", next);
    next = following ?? (next.href === start.href ? first : null);
  }
}

async function fetchJson(
  url: URL,
  fetchImpl: typeof fetch = fetch,
  accept = ACTIVITY_JSON_ACCEPT,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(
    new Request(url, {
      headers: { accept },
      redirect: "manual",
    }),
  );
  if (!response.ok) {
    await response.arrayBuffer().catch(() => {});
    throw new Error(`Failed to fetch ${url.href}: HTTP ${response.status}.`);
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch (error) {
    throw new Error(`Failed to parse JSON from ${url.href}: ${error}`);
  }
  if (!isRecord(json)) {
    throw new Error(`Expected ${url.href} to return a JSON object.`);
  }
  return json;
}

async function objectUrl(
  item: unknown,
  options: {
    readonly base: URL;
    readonly fetch?: typeof fetch;
    readonly assertReadDestinationAllowed?: (url: URL) => void | Promise<void>;
    readonly types: ReadonlySet<string>;
  },
): Promise<URL | null> {
  for (const candidate of objectCandidates(item)) {
    if (typeof candidate === "string") {
      const url = safeUrl(candidate, options.base);
      if (url == null) continue;
      if (options.types.size < 1) return url;
      const typedUrl = await typedReferencedObjectUrl(url, options);
      if (typedUrl != null) return typedUrl;
      continue;
    }
    if (!isRecord(candidate)) continue;
    if (
      options.types.size > 0 &&
      !matchesType(candidate.type, options.types)
    ) {
      continue;
    }
    const url = propertyUrl(candidate, "id", options.base);
    if (url != null) return url;
  }
  return null;
}

async function typedReferencedObjectUrl(
  url: URL,
  options: {
    readonly fetch?: typeof fetch;
    readonly assertReadDestinationAllowed?: (url: URL) => void | Promise<void>;
    readonly types: ReadonlySet<string>;
  },
  seen: Set<string> = new Set(),
  depth = 0,
): Promise<URL | null> {
  if (depth > MAX_ACTIVITY_UNWRAP_DEPTH) return null;
  if (seen.has(url.href)) return null;
  seen.add(url.href);
  await options.assertReadDestinationAllowed?.(url);
  let object: Record<string, unknown>;
  try {
    object = await fetchJson(url, options.fetch);
  } catch {
    return null;
  }
  for (const candidate of objectCandidates(object)) {
    if (typeof candidate === "string") {
      const candidateUrl = safeUrl(candidate, url);
      if (candidateUrl == null) continue;
      const typedUrl = await typedReferencedObjectUrl(
        candidateUrl,
        options,
        seen,
        depth + 1,
      );
      if (typedUrl != null) return typedUrl;
      continue;
    }
    if (!isRecord(candidate)) continue;
    if (!matchesType(candidate.type, options.types)) continue;
    return propertyUrl(candidate, "id", url) ?? url;
  }
  return null;
}

function objectCandidates(
  item: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): unknown[] {
  if (depth > MAX_ACTIVITY_UNWRAP_DEPTH) return [];
  if (!isRecord(item) || !matchesType(item.type, ACTIVITY_WRAPPER_TYPES)) {
    return [item];
  }
  if (seen.has(item)) return [];
  seen.add(item);
  const object = item.object;
  if (object == null) return [];
  if (Array.isArray(object)) {
    return object.flatMap((entry) =>
      entry == null ? [] : objectCandidates(entry, depth + 1, seen)
    );
  }
  return objectCandidates(object, depth + 1, seen);
}

function matchesType(
  type: unknown,
  expected: ReadonlySet<string>,
): boolean {
  if (typeof type === "string") return expected.has(type);
  return Array.isArray(type) &&
    type.some((item) => typeof item === "string" && expected.has(item));
}

function propertyUrl(
  object: Record<string, unknown>,
  key: string,
  base?: URL,
): URL | null {
  const value = object[key];
  if (typeof value === "string") return safeUrl(value, base);
  if (isRecord(value)) {
    if (typeof value.href === "string") return safeUrl(value.href, base);
    if (typeof value.id === "string") return safeUrl(value.id, base);
  }
  return null;
}

function arrayProperty(
  object: Record<string, unknown>,
  key: string,
): unknown[] | null {
  const value = object[key];
  return Array.isArray(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function safeUrl(value: string, base?: URL): URL | null {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}
