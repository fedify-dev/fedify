/**
 * The type of the result of parsing JSON.
 */
export type JsonValue =
  | { [key: string]: JsonValue | undefined }
  | JsonValue[]
  | string
  | number
  | boolean
  | null;

/**
 * A NodeInfo object as defined in the NodeInfo 2.1 schema.
 */
export interface NodeInfo {
  /**
   * Metadata about server software in use.
   */
  readonly software: Software;

  /**
   * The protocols supported on this server.  At least one protocol must be
   * supported.
   */
  readonly protocols: readonly Protocol[];

  /**
   * The third party sites this server can connect to via their application API.
   */
  readonly services?: Services;

  /**
   * Whether this server allows open self-registration.  Defaults to `false`.
   */
  readonly openRegistrations?: boolean;

  /**
   * Usage statistics for this server.
   */
  readonly usage: Usage;

  /**
   * Free form key value pairs for software specific values.
   * Clients should not rely on any specific key present.
   */
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

/**
 * Metadata about server software in use.
 */
export interface Software {
  /**
   * The canonical name of this server software.  This must comply with
   * pattern `/^[a-z0-9-]+$/`.
   */
  readonly name: string;

  /**
   * The version of this server software.
   */
  readonly version: string;

  /**
   * The URL of the source code repository of this server software.
   */
  readonly repository?: URL;

  /**
   * The URL of the homepage of this server software.
   */
  readonly homepage?: URL;
}

/**
 * The protocols supported on this server.
 */
export type Protocol =
  // cSpell: disable
  | "activitypub"
  | "buddycloud"
  | "dfrn"
  | "diaspora"
  | "libertree"
  | "ostatus"
  | "pumpio"
  | "tent"
  | "xmpp"
  | "zot"; // cSpell: enable

/**
 * The third party sites this server can connect to via their application API.
 */
export interface Services {
  /**
   * The third party sites this server can retrieve messages from for combined
   * display with regular traffic.
   */
  readonly inbound?: readonly InboundService[];

  /**
   * The third party sites this server can publish messages to on the behalf
   * of a user.
   */
  readonly outbound?: readonly OutboundService[];
}

/**
 * The third party sites this server can retrieve messages from for combined
 * display with regular traffic.
 */
export type InboundService =
  // cSpell: disable
  | "atom1.0"
  | "gnusocial"
  | "imap"
  | "pnut"
  | "pop3"
  | "pumpio"
  | "rss2.0"
  | "twitter"; // cSpell: enable

/**
 * The third party sites this server can publish messages to on the behalf
 * of a user.
 */
export type OutboundService =
  // cSpell: disable
  | "atom1.0"
  | "blogger"
  | "buddycloud"
  | "diaspora"
  | "dreamwidth"
  | "drupal"
  | "facebook"
  | "friendica"
  | "gnusocial"
  | "google"
  | "insanejournal"
  | "libertree"
  | "linkedin"
  | "livejournal"
  | "mediagoblin"
  | "myspace"
  | "pinterest"
  | "pnut"
  | "posterous"
  | "pumpio"
  | "redmatrix"
  | "rss2.0"
  | "smtp"
  | "tent"
  | "tumblr"
  | "twitter"
  | "wordpress"
  | "xmpp"; // cSpell: enable

/**
 * Usage statistics for this server.
 */
export interface Usage {
  /**
   * Statistics about the users of this server.
   */
  readonly users: {
    /**
     * The total amount of on this server registered users.  This number
     * has to be an integer greater than or equal to zero.
     */
    readonly total?: number;

    /**
     * The amount of users that signed in at least once in the last 180 days.
     * This number has to be an integer greater than or equal to zero.
     */
    readonly activeHalfyear?: number;

    /**
     * The amount of users that signed in at least once in the last 30 days.
     * This number has to be an integer greater than or equal to zero.
     */
    readonly activeMonth?: number;
  };

  /**
   * The amount of posts that were made by users that are registered on this
   * server.  This number has to be an integer greater than or equal to zero.
   */
  readonly localPosts: number;

  /**
   * The amount of comments that were made by users that are registered on this
   * server.  This number has to be an integer greater than or equal to zero.
   */
  readonly localComments: number;
}

/**
 * Converts a {@link NodeInfo} object to a JSON value.
 * @param nodeInfo The {@link NodeInfo} object to convert.
 * @returns The JSON value that complies with the NodeInfo schema.
 * @throws {TypeError} If the {@link NodeInfo} object is invalid.
 */
export function nodeInfoToJson(nodeInfo: NodeInfo): JsonValue {
  if (!nodeInfo.software.name.match(/^[a-z0-9-]+$/)) {
    throw new TypeError("Invalid software name.");
  }
  if (nodeInfo.protocols.length < 1) {
    throw new TypeError("At least one protocol must be supported.");
  }
  if (
    nodeInfo.usage.users.total != null &&
    (nodeInfo.usage.users.total < 0 ||
      !Number.isInteger(nodeInfo.usage.users.total))
  ) {
    throw new TypeError("Invalid total users.");
  }
  if (
    nodeInfo.usage.users.activeHalfyear != null &&
    (nodeInfo.usage.users.activeHalfyear < 0 ||
      !Number.isInteger(nodeInfo.usage.users.activeHalfyear))
  ) {
    throw new TypeError("Invalid active halfyear users.");
  }
  if (
    nodeInfo.usage.users.activeMonth != null &&
    (nodeInfo.usage.users.activeMonth < 0 ||
      !Number.isInteger(nodeInfo.usage.users.activeMonth))
  ) {
    throw new TypeError("Invalid active month users.");
  }
  if (
    nodeInfo.usage.localPosts < 0 ||
    !Number.isInteger(nodeInfo.usage.localPosts)
  ) {
    throw new TypeError("Invalid local posts.");
  }
  if (
    nodeInfo.usage.localComments < 0 ||
    !Number.isInteger(nodeInfo.usage.localComments)
  ) {
    throw new TypeError("Invalid local comments.");
  }
  return {
    "$schema": "http://nodeinfo.diaspora.software/ns/schema/2.1#",
    version: "2.1",
    software: {
      name: nodeInfo.software.name,
      version: nodeInfo.software.version,
      repository: nodeInfo.software.repository?.href,
      homepage: nodeInfo.software.homepage?.href,
    },
    protocols: nodeInfo.protocols,
    services: nodeInfo.services == null ? { inbound: [], outbound: [] } : {
      inbound: nodeInfo.services.inbound ?? [],
      outbound: nodeInfo.services.outbound ?? [],
    },
    openRegistrations: nodeInfo.openRegistrations ?? false,
    usage: {
      users: nodeInfo.usage.users,
      localPosts: nodeInfo.usage.localPosts,
      localComments: nodeInfo.usage.localComments,
    },
    metadata: nodeInfo.metadata ?? {},
  };
}
