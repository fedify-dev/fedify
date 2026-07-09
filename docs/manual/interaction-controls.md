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

Missing policy is handled conservatively for feature requests and permissively
for the other interactions:

 -  Like, reply, announce, and quote helpers treat missing policy as automatic
    approval for compatibility with existing ActivityPub objects.
 -  The feature helper treats missing `canFeature` policy as denied, because
    featuring another actor is a profile/discovery action.


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
authorization still refers to the same interaction object and target:

~~~~ typescript twoslash
import type { Context } from "@fedify/fedify";
import { likeInteraction } from "@fedify/interaction-controls";
import { Like, LikeAuthorization, Note } from "@fedify/vocab";

const context = {} as Context<void>;
const authorization = null as unknown as LikeAuthorization;
const like = null as unknown as Like;
const target = null as unknown as Note;

const verified = await likeInteraction.verifyAuthorization(context, {
  authorization,
  interactingObject: like,
  interactionTarget: target,
  attributedTo: target.attributionId ?? undefined,
});
if (!verified.verified) {
  throw new Error(`Invalid authorization: ${verified.failure.type}`);
}
~~~~

You can also create `Accept`, `Reject`, and revocation activities from the same
helper.  Store authorization IDs with the interaction object so that later
revocation checks can reject stale approvals.


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
import { formatAuthorizationKey, formatInteractionKey } from "@fedify/interaction-controls";

const target = new URL("https://example.com/notes/1");
const interaction = new URL("https://remote.example/likes/1");
const authorization = new URL("https://example.com/authorizations/1");

const interactionKey = formatInteractionKey("like", target, interaction);
const authorizationKey = formatAuthorizationKey("like", authorization);
~~~~

The keys are plain strings.  Use them with your existing database or key–value
store to record pending requests, accepted authorizations, and revoked
authorizations.


References
----------

 -  [GoToSocial interaction controls]
 -  [FEP-044f]
 -  [FEP-7aa9]
