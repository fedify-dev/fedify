---
description: >-
  Interaction controls let servers ask for, grant, deny, and revoke
  permission for likes, replies, announces, quotes, and featured actors.
---

Interaction controls
====================

Interaction controls let an object owner publish policy and exchange explicit
request and authorization objects before another actor interacts with that
object.  They are useful when an application wants automatic or manual approval
for interactions such as likes, replies, announces, quotes, and featuring an
actor in a public collection.

Fedify provides the `@fedify/interaction-controls` package for the helper logic
around the vocabulary terms defined by [GoToSocial interaction controls],
[FEP-044f], and [FEP-7aa9].  The package does not install inbox listeners for
you.  It gives you typed helpers that you can call from your own outbox,
inbox, storage, moderation, and UI code.

[GoToSocial interaction controls]: https://docs.gotosocial.org/en/v0.21.1/federation/interaction_controls/
[FEP-044f]: https://codeberg.org/fediverse/fep/src/branch/main/fep/044f/fep-044f.md
[FEP-7aa9]: https://codeberg.org/fediverse/fep/src/branch/main/fep/7aa9/fep-7aa9.md


Supported interactions
----------------------

The package exports one helper per interaction:

`likeInteraction`
:   Works with `LikeRequest`, `LikeAuthorization`, and `Like`.
    It evaluates `canLike`.

`replyInteraction`
:   Works with `ReplyRequest`, `ReplyAuthorization`, and reply objects such as
    `Note`, `Article`, `Question`, and `ChatMessage`.
    It evaluates `canReply`.

`announceInteraction`
:   Works with `AnnounceRequest`, `AnnounceAuthorization`, and `Announce`.
    It evaluates `canAnnounce`.

`quoteInteraction`
:   Works with `QuoteRequest`, `QuoteAuthorization`, and quote objects.
    It evaluates `canQuote` and accepts both the FEP-044f `quote` property and
    compatible `quoteUrl` values.

`featureInteraction`
:   Works with `FeatureRequest`, `FeatureAuthorization`, `FeaturedCollection`,
    and ActivityPub actor objects.
    It evaluates `canFeature` on the actor being featured.


Policy evaluation
-----------------

Each helper can evaluate an object's `InteractionPolicy` and report whether
the interaction should be accepted automatically, queued for manual approval,
or denied:

~~~~ typescript twoslash
import { likeInteraction } from "@fedify/interaction-controls";
import { InteractionPolicy, InteractionRule, Note, PUBLIC_COLLECTION } from "@fedify/vocab";
import type { Context } from "@fedify/fedify";

const context = {} as Context<void>;
// ---cut-before---
const target = new Note({
  id: new URL("https://example.com/notes/1"),
  attribution: new URL("https://example.com/users/alice"),
  interactionPolicy: new InteractionPolicy({
    canLike: new InteractionRule({
      automaticApproval: PUBLIC_COLLECTION,
    }),
  }),
});

const decision = await likeInteraction.evaluatePolicy(context, {
  subject: target,
  requester: new URL("https://remote.example/users/bob"),
});
~~~~

A decision with `result: "automatic"` means the interaction can be accepted
without a moderation step.  A decision with `result: "manual"` means the
application should store the request for review and create the authorization
only after approval.  A decision with `result: "denied"` means the request
does not match the policy.

Missing policy is handled conservatively for feature and quote requests, and
permissively for legacy-compatible interactions:

 -  Like, reply, and announce helpers treat missing policy as automatic
    approval for compatibility with existing ActivityPub objects.
 -  The quote helper treats missing `canQuote` policy as denied, because
    FEP-044f quote authorization is consent-based unless the object owner
    explicitly advertises automatic approval.
 -  The feature helper treats missing `canFeature` policy as denied, because
    featuring another actor is a profile/discovery action.

### Fallback rules

*This API is available since Fedify 2.5.0.*

If your application has its own default policy, pass it as `fallbackRule`.
It is evaluated in place of the subject's rule when the subject has no
interaction policy, no rule for the interaction, or a rule without any
approval entries:

~~~~ typescript twoslash
import { quoteInteraction } from "@fedify/interaction-controls";
import { InteractionRule, Note, PUBLIC_COLLECTION } from "@fedify/vocab";
import type { Context } from "@fedify/fedify";

const context = {} as Context<void>;
const target = new Note({});
const requester = new URL("https://remote.example/users/bob");
// ---cut-before---
const decision = await quoteInteraction.evaluatePolicy(context, {
  subject: target,
  requester,
  // Quotes are public by default in this application:
  fallbackRule: new InteractionRule({ automaticApproval: PUBLIC_COLLECTION }),
});
~~~~

### Precedence

*This API is available since Fedify 2.5.0.*

By default, actors listed explicitly in `automaticApproval` or
`manualApproval` are matched before the public collection and other
collections.  So an actor listed in `manualApproval` gets a manual decision
even when `automaticApproval` contains the public collection.  Pass
`precedence: "automatic"` to match every `automaticApproval` entry before any
`manualApproval` entry instead.

### Approval collections

To match collections such as the owner's followers, pass
a `matchesApprovalCollection` callback, which usually queries your database.
By default, an error thrown by the callback makes that collection count as not
matching; if nothing else decides, the decision is `denied` with an
`unverifiableCollection` reason whose `cause` is the error.

Sending a `Reject` for such a decision would refuse a request only because of
a temporary database failure.  *Since Fedify 2.5.0*, you can pass
`collectionErrors: "throw"` to let the first error propagate instead, e.g., so
that the inbox listener fails and the activity is retried later:

~~~~ typescript twoslash
import { likeInteraction } from "@fedify/interaction-controls";
import { Note } from "@fedify/vocab";
import type { Context } from "@fedify/fedify";

const context = {} as Context<void>;
const target = new Note({});
const requester = new URL("https://remote.example/users/bob");
declare function isFollower(collection: URL, actor: URL): Promise<boolean>;
// ---cut-before---
const decision = await likeInteraction.evaluatePolicy(context, {
  subject: target,
  requester,
  matchesApprovalCollection: (collection, actor) =>
    isFollower(collection, actor),
  collectionErrors: "throw",
});
~~~~


End-to-end flow
---------------

The helpers cover the request, authorization, and final interaction checks.
Your application still owns delivery, persistence, and moderation:

~~~~ mermaid
sequenceDiagram
    participant Requester
    participant Owner as Object owner
    participant Moderator

    Requester->>Owner: createRequest() activity
    Owner->>Owner: verifyRequest() and evaluatePolicy()

    alt denied
        Owner-->>Requester: Reject or ignore
    else manual approval
        Owner->>Moderator: Queue request
        Moderator-->>Owner: Approve
        Owner-->>Requester: Accept with createAuthorization()
    else automatic approval
        Owner-->>Requester: Accept with createAuthorization()
    end

    opt accepted authorization
        Requester->>Owner: Interaction with authorization
        Owner->>Owner: verifyAuthorization()
        alt authorization valid
            Owner->>Owner: Accept interaction
        else invalid authorization
            Owner-->>Requester: Reject or ignore
        end
    end
~~~~


Request flow
------------

When your actor wants to perform an interaction, create a request activity and
send it to the object owner.  The request `actor` is the actor asking for
permission, the `object` is the interaction target, and the `instrument` is the
object or collection that would perform the interaction:

~~~~ typescript twoslash
import { likeInteraction } from "@fedify/interaction-controls";
import { Like, Note } from "@fedify/vocab";

const actor = new URL("https://remote.example/users/bob");
const target = new Note({
  id: new URL("https://example.com/notes/1"),
  attribution: new URL("https://example.com/users/alice"),
});
const like = new Like({
  id: new URL("https://remote.example/likes/1"),
  actor,
  object: target.id,
});

const request = likeInteraction.createRequest({
  id: new URL("https://remote.example/requests/1"),
  actor,
  object: target,
  instrument: like,
});
~~~~

On the receiving side, verify that the request is dereferenceable, has the
expected type, and that the instrument matches both the requester and target:

~~~~ typescript twoslash
import type { Context } from "@fedify/fedify";
import { likeInteraction } from "@fedify/interaction-controls";
import { LikeRequest } from "@fedify/vocab";

const context = {} as Context<void>;
const request = null as unknown as LikeRequest;
// ---cut-before---

const verified = await likeInteraction.verifyRequest(context, { request });
if (!verified.verified) {
  throw new Error(`Invalid interaction request: ${verified.failure.type}`);
}
~~~~

For `replyInteraction`, `quoteInteraction`, and `featureInteraction`, the
request `instrument` has this meaning:

 -  Reply: the reply object whose `inReplyTo` target is being requested.
 -  Quote: the post object whose FEP-044f `quote` or compatible `quoteUrl`
    target is being requested.
 -  Feature: the `FeaturedCollection` owned by the requester.  The request
    `object` is the actor being featured.

`verifyRequest()` dereferences the request's `object` and `instrument` when
they are given as IRIs, and caches the dereferenced objects in the request
object, as other property accessors do.  If you need to send the request back
in an `Accept` or `Reject` with its references intact, clone it before
verification and pass the clone to `createAccept()` or `createReject()`.
The clone keeps the request's vocabulary values and references, though not
necessarily its exact original JSON-LD representation.

### Already resolved objects

*This API is available since Fedify 2.5.0.*

If your application has already resolved the request's `object` or
`instrument`, for example by looking up a local post in its database, pass
them as `resolvedInteractionTarget` and `resolvedInteractingObject`.
The helper then uses them instead of dereferencing the references, and leaves
the request untouched:

~~~~ typescript twoslash
import type { Context } from "@fedify/fedify";
import { quoteInteraction } from "@fedify/interaction-controls";
import { Note, QuoteRequest } from "@fedify/vocab";

const context = {} as Context<void>;
const request = null as unknown as QuoteRequest;
declare function findLocalPost(id: URL): Promise<Note>;
declare function fetchQuotePost(id: URL): Promise<Note>;
// ---cut-before---
const verified = await quoteInteraction.verifyRequest(context, {
  request,
  resolvedInteractionTarget: await findLocalPost(request.objectId!),
  resolvedInteractingObject: await fetchQuotePost(request.instrumentId!),
});
~~~~

A resolved object is trusted as the resolution of the request's reference.
Its ID does not have to match the reference, and the helper does not check
where it came from, so make sure it is trustworthy, e.g., that the instrument
was fetched from the requester's origin.  The helper still checks its type,
its requester, and that it refers to the target.  Resolved objects are used
only when the request has the corresponding reference; they never fill in
a missing `object` or `instrument`.

### Relaxing quote request validation

*This API is available since Fedify 2.5.0.*

By default, `quoteInteraction` requires the quote post's `quote` and
`quoteUrl` to agree with each other and with the target, and its first
`attributedTo` to be the requester.  Some servers send quote posts that do not
meet these checks, so `quoteInteraction.verifyRequest()` takes options to
relax them:

`quoteReference`
:   `"preferQuote"` checks `quote` and ignores a conflicting `quoteUrl`.
    `"any"` accepts the request if either `quote` or `quoteUrl` refers to the
    target.  The default is `"strict"`.

`attribution`
:   `"any"` accepts the requester anywhere in `attributedTo`.  The default is
    `"first"`.

`missingAttribution`
:   `"requester"` treats a quote post without any attribution IRI as
    attributed to the requester.  An attribution embedded without an `id`
    counts as missing.  The default is `"reject"`.


Authorization flow
------------------

After a policy decision is automatic or a moderator approves a manual request,
create an authorization object and include it with the resulting interaction:

~~~~ typescript twoslash
import { likeInteraction } from "@fedify/interaction-controls";
import { Like, Note } from "@fedify/vocab";

const owner = new URL("https://example.com/users/alice");
const target = new Note({
  id: new URL("https://example.com/notes/1"),
  attribution: owner,
});
const like = new Like({
  id: new URL("https://remote.example/likes/1"),
  actor: new URL("https://remote.example/users/bob"),
  object: target.id,
});

const authorization = likeInteraction.createAuthorization({
  id: new URL("https://example.com/authorizations/1"),
  attributedTo: owner,
  interactingObject: like,
  interactionTarget: target,
});
~~~~

When a signed interaction arrives with an authorization, verify that the
authorization still refers to the same interaction object and target, and that
the grant came from the target owner.  If you pass an embedded authorization
object instead of a URL, provide `verifyAuthenticity` so your HTTP signature,
object proof, or transport-level trust decision is part of verification:

~~~~ typescript twoslash
import type { Context } from "@fedify/fedify";
import { likeInteraction } from "@fedify/interaction-controls";
import { Like, LikeAuthorization, Note } from "@fedify/vocab";

const context = {} as Context<void>;
const authorization = null as unknown as LikeAuthorization;
const like = null as unknown as Like;
const target = null as unknown as Note;
declare function isStoredAuthorization(
  authorization: LikeAuthorization,
): Promise<boolean>;
// ---cut-before---

const verified = await likeInteraction.verifyAuthorization(context, {
  authorization,
  interactingObject: like,
  interactionTarget: target,
  attributedTo: target.attributionId ?? undefined,
  // E.g., check that the authorization matches one stored when its signed
  // `Accept` was received from the target's owner:
  verifyAuthenticity: isStoredAuthorization,
});
if (!verified.verified) {
  throw new Error(`Invalid authorization: ${verified.failure.type}`);
}
~~~~

An origin check alone does not establish authenticity, since anyone can embed
an object claiming any ID.  Base `verifyAuthenticity` on actual evidence, such
as a signed `Accept` from the target's owner or a grant stored in your
database.

*Since Fedify 2.5.0*, the following options are also available:

`authorizationId`
:   The expected ID of the authorization.  An authorization object with
    a different ID fails with `idMismatch`.  This only checks identity; an
    authorization object still needs `verifyAuthenticity`.

`allowOffOrigin`
:   Accepts an authorization whose ID is on a different origin than the
    target's owner, if `verifyAuthenticity` approves it.  Without
    `verifyAuthenticity`, such authorizations still fail with
    `originMismatch`.

`contextLoader`
:   A separate document loader for remote JSON-LD contexts.  `verifyRequest()`
    takes it too.

You can also create `Accept`, `Reject`, and revocation activities from the same
helper.  Store authorization IDs with the interaction object so that later
revocation checks can reject stale approvals.

The `id` and `to` options of `createAccept()`, `createReject()`, and
`createRevocation()` are optional *since Fedify 2.5.0*, since
`Context.sendActivity()` assigns an ID when it is missing and takes the
recipients separately.  `createRevocation()` refers to the authorization by its
ID unless you pass `embedAuthorization: true` with an authorization object, in
which case it embeds a copy that contains only the authorization's ID,
attribution, and the IDs of its interacting object and interaction target.


Handling verification failures
------------------------------

When verification fails, `failure.category` tells what kind of failure it is:

`"invalid"`
:   The request is malformed, e.g., it lacks an `object` or refers to
    a different target than its instrument.

`"unauthorized"`
:   The request or authorization is well-formed but does not grant the
    interaction, e.g., the requester is not the instrument's author.

`"revoked"`
:   The authorization has been revoked.

`"unverifiable"`
:   The helper could not get the documents it needs to decide, e.g., because
    fetching one failed.

An inbox listener usually rejects or ignores the first three, but an
unverifiable failure may be temporary.  *Since Fedify 2.5.0*, unverifiable
failures have a `transient` flag that tells whether verifying again later could
succeed: network errors, timeouts, DNS failures, and HTTP 5xx, 408, and 429
responses are transient, while HTTP 404 and other 4xx responses, URLs blocked
by SSRF protection, and malformed documents are not.  The same classification
is available for any document loader error as `isTransientFetchError()` from
`@fedify/vocab-runtime`.

~~~~ typescript twoslash
import type { Context } from "@fedify/fedify";
import { quoteInteraction } from "@fedify/interaction-controls";
import { QuoteRequest } from "@fedify/vocab";

const context = {} as Context<void>;
const request = null as unknown as QuoteRequest;
// ---cut-before---
const verified = await quoteInteraction.verifyRequest(context, { request });
if (!verified.verified) {
  if (
    verified.failure.category === "unverifiable" && verified.failure.transient
  ) {
    // Throwing from an inbox listener makes Fedify retry the activity later:
    throw new Error("Failed to verify the quote request; retrying later.", {
      cause: verified.failure,
    });
  }
  // Otherwise, reject the request.
}
~~~~

When fetching the request's `object` or `instrument` fails, the failure is
`notDereferenceable` with the URL that failed and the loader's error as
`cause`; `missingObject` and `missingInstrument` mean that the request really
lacks them.  When a remote JSON-LD context cannot be loaded, the failure is
also `notDereferenceable`, with the context's URL, rather than `invalidJsonLd`.


Recognizing unrequested interactions
------------------------------------

Some remote servers will send a bare `Like`, reply, announce, or quote without
first sending a request.  The helpers expose `recognizeImpolite()` for
best-effort detection:

~~~~ typescript twoslash
import { likeInteraction } from "@fedify/interaction-controls";
import { Like } from "@fedify/vocab";

const activity = new Like({
  id: new URL("https://remote.example/likes/1"),
  actor: new URL("https://remote.example/users/bob"),
  object: new URL("https://example.com/notes/1"),
});

const recognized = likeInteraction.recognizeImpolite(activity);
~~~~

This method is synchronous and only recognizes objects whose interaction target
can be read without dereferencing.  In particular, `Create` activities wrapping
reply or quote objects are not recognized by this method; unwrap and verify the
created object in your inbox listener before passing it to the helper.


Stable storage keys
-------------------

Each helper provides stable keys for persistence:

~~~~ typescript twoslash
import {
  formatAuthorizationKey,
  formatInteractionKey,
  likeInteraction,
} from "@fedify/interaction-controls";
import { Like, LikeAuthorization, Note } from "@fedify/vocab";

const actor = new URL("https://remote.example/users/bob");
const target = new URL("https://example.com/notes/1");
const like = new Like({
  id: new URL("https://remote.example/likes/1"),
  actor,
  object: target,
});
const authorization = new URL("https://example.com/authorizations/1");

const interactionKey = formatInteractionKey(likeInteraction.getInteractionKey({
  requester: actor,
  interactingObject: like,
  interactionTarget: new Note({ id: target }),
}));
const authorizationKey = formatAuthorizationKey(
  likeInteraction.getAuthorizationKey({
    authorization: new LikeAuthorization({ id: authorization }),
  }),
);
~~~~

The keys are plain strings.  Use them with your existing database or key–value
store to record pending requests, accepted authorizations, and revoked
authorizations.
