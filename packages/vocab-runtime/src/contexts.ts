// Preloaded context documents
// https://github.com/fedify-dev/fedify/issues/74
// cSpell: disable

import activitystreams from "./contexts/activitystreams.json" with {
  type: "json",
};
import didV1 from "./contexts/did-v1.json" with { type: "json" };
import fep5711 from "./contexts/fep-5711.json" with { type: "json" };
import gotosocial from "./contexts/gotosocial.json" with { type: "json" };
import identityV1 from "./contexts/identity-v1.json" with { type: "json" };
import joinLemmyContext from "./contexts/join-lemmy.json" with { type: "json" };
import joinmastodon from "./contexts/joinmastodon.json" with { type: "json" };
import schemaorg from "./contexts/schemaorg.json" with { type: "json" };
import securityDataIntegrityV1 from "./contexts/security-data-integrity-v1.json" with {
  type: "json",
};
import securityDataIntegrityV2 from "./contexts/security-data-integrity-v2.json" with {
  type: "json",
};
import securityMultikeyV1 from "./contexts/security-multikey-v1.json" with {
  type: "json",
};
import securityV1 from "./contexts/security-v1.json" with { type: "json" };
import webfinger from "./contexts/webfinger.json" with { type: "json" };
const preloadedContexts: Record<string, unknown> = {
  "https://www.w3.org/ns/activitystreams": activitystreams,
  "https://w3id.org/security/v1": securityV1,
  "https://w3id.org/security/data-integrity/v1": securityDataIntegrityV1,
  "https://w3id.org/security/data-integrity/v2": securityDataIntegrityV2,
  "https://www.w3.org/ns/did/v1": didV1,
  "https://w3id.org/security/multikey/v1": securityMultikeyV1,
  "https://w3id.org/identity/v1": identityV1,
  "https://purl.archive.org/socialweb/webfinger": webfinger,
  "http://schema.org/": schemaorg,
  "https://gotosocial.org/ns": gotosocial,
  "https://w3id.org/fep/5711": fep5711,

  // Lemmy's context document is served as application/json without the JSON-LD
  // context Link header.  The default document loader treats that as a regular
  // JSON response instead of a JSON-LD context, so every Lemmy activity that
  // references this URL fails before application handlers run.  We ship a
  // built-in copy here so Fedify can parse Lemmy-originated activities without
  // application-level document loader workarounds.
  // See: https://github.com/fedify-dev/fedify/issues/714
  "https://join-lemmy.org/context.json": joinLemmyContext,

  // Mastodon's "toot:" namespace.  The URL http://joinmastodon.org/ns has
  // *never* served a real JSON-LD context document—Mastodon has always inlined
  // these term definitions directly in every outgoing @context array.  However,
  // some ActivityPub implementations (e.g., Bonfire) put the bare URL in their
  // @context, which causes JSON-LD processors to try to dereference it and fail
  // with a 404.  We ship a built-in copy here so that Fedify can parse such
  // documents without a network round-trip to a URL that will never resolve.
  // See: https://github.com/mastodon/joinmastodon/issues/148
  //      https://github.com/fedify-dev/fedify/issues/630
  "http://joinmastodon.org/ns": joinmastodon,
};

export default preloadedContexts;
