import noDeprecatedHandleProperty from "./rules/no-deprecated-handle-property.ts";
import noDeprecatedHandleVariable from "./rules/no-deprecated-handle-variable.ts";
import noDuplicateDispatcher from "./rules/no-duplicate-dispatcher.ts";
import noDuplicateInboxListeners from "./rules/no-duplicate-inbox-listeners.ts";
import noMemoryKvStoreInProduction from "./rules/no-memory-kv-store-in-production.ts";
import noRecursiveContextMethodCalls from "./rules/no-recursive-context-method-calls.ts";
import requireActivityActor from "./rules/require-activity-actor.ts";
import requireActivityId from "./rules/require-activity-id.ts";
import requireActivityTo from "./rules/require-activity-to.ts";
import requireActorDispatcher from "./rules/require-actor-dispatcher.ts";
import requireActorId from "./rules/require-actor-id.ts";
import requireActorReturnValue from "./rules/require-actor-return-value.ts";
import requireCollectionPropertyWhenDispatcherSet from "./rules/require-collection-property-when-dispatcher-set.ts";
import requireFollowersCounter from "./rules/require-followers-counter.ts";
import requireInboxListeners from "./rules/require-inbox-listeners.ts";
import requireInboxUri from "./rules/require-inbox-uri.ts";
import requireIntegerTimestamp from "./rules/require-integer-timestamp.ts";
import requireKeyPublicKey from "./rules/require-key-public-key.ts";
import requireMatchingActorId from "./rules/require-matching-actor-id.ts";
import requireMatchingCollectionIds from "./rules/require-matching-collection-ids.ts";
import requireMatchingInboxPaths from "./rules/require-matching-inbox-paths.ts";
import requireMessageQueueForInbox from "./rules/require-message-queue-for-inbox.ts";
import requirePaginationForCollections from "./rules/require-pagination-for-collections.ts";
import requirePersistentKvStore from "./rules/require-persistent-kv-store.ts";
import requireSignatureFields from "./rules/require-signature-fields.ts";
import requireSignatureVerification from "./rules/require-signature-verification.ts";
import requireTypeGuardForActivityListeners from "./rules/require-type-guard-for-activity-listeners.ts";
import requireValidUriTemplateVariables from "./rules/require-valid-uri-template-variables.ts";

const plugin: Deno.lint.Plugin = {
  name: "@fedify/lint",
  rules: {
    "require-actor-dispatcher": requireActorDispatcher,
    "require-inbox-listeners": requireInboxListeners,
    "require-signature-verification": requireSignatureVerification,
    "require-integer-timestamp": requireIntegerTimestamp,
    "require-signature-fields": requireSignatureFields,
    "require-key-public-key": requireKeyPublicKey,
    "require-matching-actor-id": requireMatchingActorId,
    "require-matching-collection-ids": requireMatchingCollectionIds,
    "no-deprecated-handle-variable": noDeprecatedHandleVariable,
    "no-deprecated-handle-property": noDeprecatedHandleProperty,
    "no-duplicate-dispatcher": noDuplicateDispatcher,
    "no-duplicate-inbox-listeners": noDuplicateInboxListeners,
    "require-valid-uri-template-variables": requireValidUriTemplateVariables,
    "require-matching-inbox-paths": requireMatchingInboxPaths,
    "require-actor-return-value": requireActorReturnValue,
    "no-recursive-context-method-calls": noRecursiveContextMethodCalls,
    "require-type-guard-for-activity-listeners":
      requireTypeGuardForActivityListeners,
    "require-collection-property-when-dispatcher-set":
      requireCollectionPropertyWhenDispatcherSet,
    "require-actor-id": requireActorId,
    "require-activity-actor": requireActivityActor,
    "require-activity-id": requireActivityId,
    "require-activity-to": requireActivityTo,
    "require-inbox-uri": requireInboxUri,
    "no-memory-kv-store-in-production": noMemoryKvStoreInProduction,
    "require-message-queue-for-inbox": requireMessageQueueForInbox,
    "require-persistent-kv-store": requirePersistentKvStore,
    "require-pagination-for-collections": requirePaginationForCollections,
    "require-followers-counter": requireFollowersCounter,
  },
};

export default plugin;
