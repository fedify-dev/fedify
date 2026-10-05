---
links:
  '#1206': https://github.com/fedify-dev/fedify/issues/1206
  '#1245': https://github.com/fedify-dev/fedify/pull/1245
---
 -  Changed the interaction control helpers to tell transient verification
    failures from rejections, so that inbox listeners can retry instead of
    rejecting a valid request.  [[#1206], [#1245]]

     -  `verifyRequest()` now reports a failed fetch of the request's `object`
        or `instrument` as `notDereferenceable` with the failed URL and the
        loader's error as `cause`, instead of `missingObject` or
        `missingInstrument`.  Those two failures now mean that the request
        really lacks the property.
     -  A remote JSON-LD context that cannot be loaded is now reported as
        `notDereferenceable` with the context's URL instead of
        `invalidJsonLd`.
     -  Added a `transient` property to `unverifiable` failures of
        `verifyRequest()` and `verifyAuthorization()`.  It is `true` for
        network errors, timeouts, DNS failures, and HTTP 5xx, 408, and 429
        responses.
     -  The `unverifiableCollection` denial reason of `evaluatePolicy()` now
        has the error thrown by `matchesApprovalCollection` as its `cause`.
        Added a `collectionErrors` option; pass `"throw"` to let the error
        propagate instead of denying the interaction.

 -  Added options to the interaction control helpers so that applications
    with their own compatibility rules can use them without adapters.
    [[#1206], [#1245]]

     -  Added `fallbackRule` and `precedence` options to `evaluatePolicy()`.
        `fallbackRule` is evaluated when the subject has no rule for the
        interaction, and `precedence: "automatic"` matches every
        `automaticApproval` entry before any `manualApproval` entry.
     -  Added `resolvedInteractionTarget` and `resolvedInteractingObject`
        options to `verifyRequest()`, which take already resolved objects
        instead of dereferencing the request's `object` and `instrument`, and
        leave the request untouched.
     -  Added `quoteReference`, `attribution`, and `missingAttribution`
        options to `quoteInteraction.verifyRequest()` for quote posts whose
        `quote` and `quoteUrl` disagree, that have several attributions, or
        that have no attribution.  The new `QuoteRequestValidationOptions`
        type describes them.
     -  Added `authorizationId` and `allowOffOrigin` options to
        `verifyAuthorization()`.  `authorizationId` checks the ID of an
        authorization given as an object, and `allowOffOrigin` lets
        `verifyAuthenticity` approve an authorization whose ID is on another
        origin than its attributed actor.
     -  Added a `contextLoader` option to `verifyRequest()` and
        `verifyAuthorization()` for loading remote JSON-LD contexts
        separately from objects.
     -  The `id` and `to` options of `createAccept()`, `createReject()`, and
        `createRevocation()` are now optional.
     -  Added an `embedAuthorization` option to `createRevocation()`, which
        embeds the authorization in the `Delete` activity with only the IDs of
        its interacting object and interaction target.
