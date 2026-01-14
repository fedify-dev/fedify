import { getUserAgent, type GetUserAgentOptions } from "@fedify/vocab-runtime";
import type { ResourceDescriptor } from "@fedify/webfinger";
import { getLogger } from "@logtape/logtape";
import type {
  InboundService,
  JsonValue,
  NodeInfo,
  OutboundService,
  Protocol,
  Services,
  Software,
  Usage,
} from "./types.ts";

const logger = getLogger(["fedify", "nodeinfo", "client"]);

/**
 * Options for {@link getNodeInfo} function.
 * @since 1.2.0
 */
export interface GetNodeInfoOptions {
  /**
   * Whether to directly fetch the NodeInfo document from the given URL.
   * Otherwise, the NodeInfo document will be fetched from the `.well-known`
   * location of the given URL.
   *
   * Turned off by default.
   */
  direct?: boolean;

  /**
   * How strictly to parse the NodeInfo document.
   *
   *  -  `"strict"`: Parse the NodeInfo document strictly.  If the document is
   *     invalid, `undefined` is returned.  This is the default.
   *  -  `"best-effort"`: Try to parse the NodeInfo document even if it is
   *     invalid.
   *  -  `"none"`: Do not parse the NodeInfo document.  The function will return
   *     the raw JSON value.
   */
  parse?: "strict" | "best-effort" | "none";

  /**
   * The options for making `User-Agent` header.
   * If a string is given, it is used as the `User-Agent` header value.
   * If an object is given, it is passed to {@link getUserAgent} to generate
   * the `User-Agent` header value.
   * @since 1.3.0
   */
  userAgent?: GetUserAgentOptions | string;
}

/**
 * Fetches a NodeInfo document from the given URL.
 * @param url The base URL of the server.  If `options.direct` is turned off
 *            (default), the NodeInfo document will be fetched from
 *            the `.well-known` location of this URL (hence the only origin
 *            of the URL is used).  If `options.direct` is turned on,
 *            the NodeInfo document will be fetched from the given URL.
 * @param options Options for fetching the NodeInfo document.
 * @returns The NodeInfo document if it could be fetched successfully.
 *          Otherwise, `undefined` is returned.
 * @since 1.2.0
 */
export async function getNodeInfo(
  url: URL | string,
  options?: GetNodeInfoOptions & { parse?: "strict" | "best-effort" },
): Promise<NodeInfo | undefined>;

/**
 * Fetches a NodeInfo document from the given URL.
 * @param url The base URL of the server.  If `options.direct` is turned off
 *            (default), the NodeInfo document will be fetched from
 *            the `.well-known` location of this URL (hence the only origin
 *            of the URL is used).  If `options.direct` is turned on,
 *            the NodeInfo document will be fetched from the given URL.
 * @param options Options for fetching the NodeInfo document.
 * @returns The NodeInfo document if it could be fetched successfully.
 *          Otherwise, `undefined` is returned.
 * @since 1.2.0
 */
export async function getNodeInfo(
  url: URL | string,
  options: GetNodeInfoOptions & { parse: "none" },
): Promise<JsonValue | undefined>;

export async function getNodeInfo(
  url: URL | string,
  options: GetNodeInfoOptions = {},
): Promise<NodeInfo | JsonValue | undefined> {
  try {
    let nodeInfoUrl: URL | string = url;
    if (!options.direct) {
      const wellKnownUrl = new URL("/.well-known/nodeinfo", url);
      const wellKnownResponse = await fetch(wellKnownUrl, {
        headers: {
          Accept: "application/json",
          "User-Agent": typeof options.userAgent === "string"
            ? options.userAgent
            : getUserAgent(options.userAgent),
        },
      });
      if (!wellKnownResponse.ok) {
        logger.error("Failed to fetch {url}: {status} {statusText}", {
          url: wellKnownUrl.href,
          status: wellKnownResponse.status,
          statusText: wellKnownResponse.statusText,
        });
        return undefined;
      }
      const wellKnownRd = await wellKnownResponse.json() as ResourceDescriptor;
      const link = wellKnownRd?.links?.find((link) =>
        link != null &&
        "rel" in link &&
        (link.rel === "http://nodeinfo.diaspora.software/ns/schema/2.0" ||
          link.rel === "http://nodeinfo.diaspora.software/ns/schema/2.1") &&
        "href" in link &&
        link.href != null
      );
      if (link == null || link.href == null) {
        logger.error(
          "Failed to find a NodeInfo document link from {url}: {resourceDescriptor}",
          { url: wellKnownUrl.href, resourceDescriptor: wellKnownRd },
        );
        return undefined;
      }
      nodeInfoUrl = link.href;
    }
    const response = await fetch(nodeInfoUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": typeof options.userAgent === "string"
          ? options.userAgent
          : getUserAgent(options.userAgent),
      },
    });
    if (!response.ok) {
      logger.error(
        "Failed to fetch NodeInfo document from {url}: {status} {statusText}",
        {
          url: nodeInfoUrl.toString(),
          status: response.status,
          statusText: response.statusText,
        },
      );
      return undefined;
    }
    const data = await response.json();
    if (options.parse === "none") return data as JsonValue;
    return parseNodeInfo(data, {
      tryBestEffort: options.parse === "best-effort",
    }) ?? undefined;
  } catch (error) {
    logger.error("Failed to fetch NodeInfo document from {url}: {error}", {
      url: url.toString(),
      error,
    });
    return undefined;
  }
}

/**
 * Options for {@link parseNodeInfo} function.
 * @since 1.2.0
 */
export interface ParseNodeInfoOptions {
  /**
   * Whether to try to parse the NodeInfo document even if it is invalid.
   * If turned on, the function will return a best-effort result.
   *
   * Turned off by default.
   */
  tryBestEffort?: boolean;
}

/**
 * Parses a NodeInfo document.
 * @param data A JSON value that complies with the NodeInfo schema.
 * @param options Options for parsing the NodeInfo document.
 * @returns The parsed NodeInfo document if it is valid.  Otherwise, `null`
 *          is returned.
 * @since 1.2.0
 */
export function parseNodeInfo(
  data: unknown,
  options: ParseNodeInfoOptions = {},
): NodeInfo | null {
  if (typeof data !== "object" || data == null || !("software" in data)) {
    return null;
  }
  const software = parseSoftware(data.software, options);
  if (software == null) return null;
  let protocols: Protocol[] = [];
  if ("protocols" in data && Array.isArray(data.protocols)) {
    const ps = data.protocols.map(parseProtocol);
    protocols = ps.filter((p) => p != null) as Protocol[];
    if (ps.length != protocols.length && !options.tryBestEffort) return null;
  } else {
    if (!options.tryBestEffort) return null;
  }
  let services: Services | undefined;
  if ("services" in data) {
    if (typeof data.services === "object" && data.services != null) {
      const ss = parseServices(data.services, options);
      if (ss == null) {
        if (!options.tryBestEffort) return null;
      } else {
        services = ss;
      }
    } else if (!options.tryBestEffort) return null;
  }
  let openRegistrations: boolean | undefined;
  if ("openRegistrations" in data) {
    if (typeof data.openRegistrations === "boolean") {
      openRegistrations = data.openRegistrations;
    } else {
      if (!options.tryBestEffort) return null;
    }
  }
  let usage: Usage = {
    users: {},
    localPosts: 0,
    localComments: 0,
  };
  if ("usage" in data) {
    const u = parseUsage(data.usage, options);
    if (u == null) {
      if (!options.tryBestEffort) return null;
    } else {
      usage = u;
    }
  }
  let metadata: Record<string, JsonValue> | undefined;
  if ("metadata" in data) {
    if (typeof data.metadata === "object" && data.metadata != null) {
      metadata = Object.fromEntries(Object.entries(data.metadata));
    } else if (!options.tryBestEffort) return null;
  }
  return {
    software,
    protocols,
    usage,
    ...(services != null && { services }),
    ...(openRegistrations != null && { openRegistrations }),
    ...(metadata != null && { metadata }),
  };
}

export function parseSoftware(
  data: unknown,
  options: ParseNodeInfoOptions = {},
): Software | null {
  if (typeof data !== "object" || data == null) {
    if (!options.tryBestEffort) data = {};
    return null;
  }
  let name: string;
  if (
    "name" in data && typeof data.name === "string" &&
    data.name.match(/^\s*[A-Za-z0-9-]+\s*$/)
  ) {
    if (!data.name.match(/^[a-z0-9-]+$/) && !options.tryBestEffort) return null;
    name = data.name.trim().toLowerCase();
  } else {
    return null;
  }
  let version: string;
  if ("version" in data) {
    version = String(data.version);
  } else {
    if (!options.tryBestEffort) return null;
    version = "0.0.0";
  }
  let repository: URL | undefined;
  if ("repository" in data) {
    if (typeof data.repository === "string") {
      try {
        repository = new URL(data.repository);
      } catch {
        if (!options.tryBestEffort) return null;
      }
    } else {
      if (!options.tryBestEffort) return null;
    }
  }
  let homepage: URL | undefined;
  if ("homepage" in data) {
    if (typeof data.homepage === "string") {
      try {
        homepage = new URL(data.homepage);
      } catch {
        if (!options.tryBestEffort) return null;
      }
    } else {
      if (!options.tryBestEffort) return null;
    }
  }
  return {
    name,
    version,
    ...(repository != null && { repository }),
    ...(homepage != null && { homepage }),
  };
}

export function parseProtocol(data: unknown): Protocol | null {
  // cSpell: disable
  if (
    data === "activitypub" || data === "buddycloud" || data === "dfrn" ||
    data === "diaspora" || data === "libertree" || data === "ostatus" ||
    data === "pumpio" || data === "tent" || data === "xmpp" ||
    data === "zot"
  ) {
    // cSpell: enable
    return data;
  }
  return null;
}

export function parseServices(
  data: unknown,
  options: ParseNodeInfoOptions = {},
): Services | null {
  if (!(typeof data === "object") || data == null) {
    if (options.tryBestEffort) return {};
    return null;
  }
  let inbound: InboundService[] | undefined;
  if ("inbound" in data && Array.isArray(data.inbound)) {
    const is = data.inbound.map(parseInboundService);
    inbound = is.filter((i) => i != null) as InboundService[];
    if (is.length > inbound.length && !options.tryBestEffort) return null;
  }
  let outbound: OutboundService[] | undefined;
  if ("outbound" in data && Array.isArray(data.outbound)) {
    const os = data.outbound.map(parseOutboundService);
    outbound = os.filter((o) => o != null) as OutboundService[];
    if (os.length > outbound.length && !options.tryBestEffort) return null;
  }
  return {
    ...(inbound != null && { inbound }),
    ...(outbound != null && { outbound }),
  };
}

export function parseInboundService(data: unknown): InboundService | null {
  // cSpell: disable
  if (
    data === "atom1.0" || data === "gnusocial" || data === "imap" ||
    data === "pnut" || data === "pop3" || data === "pumpio" ||
    data === "rss2.0" || data === "twitter"
  ) {
    // cSpell: enable
    return data;
  }
  return null;
}

export function parseOutboundService(data: unknown): OutboundService | null {
  // cSpell: disable
  if (
    data === "atom1.0" || data === "blogger" || data === "buddycloud" ||
    data === "diaspora" || data === "dreamwidth" || data === "drupal" ||
    data === "facebook" || data === "friendica" || data === "gnusocial" ||
    data === "google" || data === "insanejournal" || data === "libertree" ||
    data === "linkedin" || data === "livejournal" || data === "mediagoblin" ||
    data === "myspace" || data === "pinterest" || data === "pnut" ||
    data === "posterous" || data === "pumpio" || data === "redmatrix" ||
    data === "rss2.0" || data === "smtp" || data === "tent" ||
    data === "tumblr" || data === "twitter" || data === "wordpress" ||
    data === "xmpp"
  ) {
    // cSpell: enable
    return data;
  }
  return null;
}

export function parseUsage(
  data: unknown,
  options: ParseNodeInfoOptions = {},
): Usage | null {
  if (typeof data !== "object" || data == null) return null;
  let total: number | undefined;
  let activeHalfyear: number | undefined;
  let activeMonth: number | undefined;
  if ("users" in data && typeof data.users === "object" && data.users != null) {
    if ("total" in data.users) {
      if (typeof data.users.total === "number") {
        total = data.users.total;
      } else {
        if (!options.tryBestEffort) return null;
        if (typeof data.users.total === "string") {
          const n = parseInt(data.users.total);
          if (!isNaN(n)) total = n;
        }
      }
    }
    if ("activeHalfyear" in data.users) {
      if (typeof data.users.activeHalfyear === "number") {
        activeHalfyear = data.users.activeHalfyear;
      } else {
        if (!options.tryBestEffort) return null;
        if (typeof data.users.activeHalfyear === "string") {
          const n = parseInt(data.users.activeHalfyear);
          if (!isNaN(n)) activeHalfyear = n;
        }
      }
    }
    if ("activeMonth" in data.users) {
      if (typeof data.users.activeMonth === "number") {
        activeMonth = data.users.activeMonth;
      } else {
        if (!options.tryBestEffort) return null;
        if (typeof data.users.activeMonth === "string") {
          const n = parseInt(data.users.activeMonth);
          if (!isNaN(n)) activeMonth = n;
        }
      }
    }
  } else {
    if (!options.tryBestEffort) return null;
  }
  const users: Usage["users"] = {
    ...(total != null && { total }),
    ...(activeHalfyear != null && { activeHalfyear }),
    ...(activeMonth != null && { activeMonth }),
  };
  let localPosts = 0;
  if ("localPosts" in data) {
    if (typeof data.localPosts === "number") {
      localPosts = data.localPosts;
    } else {
      if (!options.tryBestEffort) return null;
      if (typeof data.localPosts === "string") {
        const n = parseInt(data.localPosts);
        if (!isNaN(n)) localPosts = n;
      }
    }
  }
  let localComments = 0;
  if ("localComments" in data) {
    if (typeof data.localComments === "number") {
      localComments = data.localComments;
    } else {
      if (!options.tryBestEffort) return null;
      if (typeof data.localComments === "string") {
        const n = parseInt(data.localComments);
        if (!isNaN(n)) localComments = n;
      }
    }
  }
  return { users, localPosts, localComments };
}
