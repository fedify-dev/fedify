import { isActor, lookupObject } from "@fedify/vocab";
import { formatIri } from "@fedify/vocab-runtime";
import type { ResourceDescriptor } from "@fedify/webfinger";
import {
  lookupWebFinger,
  type LookupWebFingerOptions,
} from "@fedify/webfinger";
import { formatMessage, message } from "@optique/core/message";
import { print } from "@optique/run";
import ora from "ora";
import { getContextLoader, getDocumentLoader } from "../docloader.ts";
import {
  createPortableObjectVerifier,
  getIriKey,
  getPortableLookupProblem,
  isPortableReference,
} from "../portable.ts";
import { formatObject } from "../utils.ts";
import type { WebFingerCommand } from "./command.ts";
import {
  getErrorMessage,
  NotFoundError,
  PortableActorError,
  UnlinkedPortableActorError,
} from "./error.ts";
import { convertUrlIfHandle } from "./lib.ts";

/**
 * Options for looking up a single WebFinger resource.
 */
export interface LookupSingleWebFingerOptions {
  /** The resource to look up, e.g., a handle or a URI. */
  resource: string;
  /** The `User-Agent` header value. */
  userAgent?: string;
  /** Whether to allow private IP addresses. */
  allowPrivateAddresses?: boolean;
  /** The maximum number of redirections to follow for WebFinger requests. */
  maxRedirection?: number;
  /**
   * The [FEP-ef61] gateways to look up a portable actor from.
   *
   * [FEP-ef61]: https://w3id.org/fep/ef61
   */
  gateways?: readonly URL[];
}

/**
 * The result of looking up the WebFinger address of an [FEP-ef61] portable
 * actor.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
 */
export interface PortableWebFingerResult {
  /** The WebFinger resource descriptor. */
  readonly descriptor: ResourceDescriptor;
  /** The `acct:` URI that was looked up. */
  readonly address: string;
  /** The portable actor's ID. */
  readonly actorId: URL;
}

export default async function runWebFinger(
  {
    resources,
    userAgent,
    allowPrivateAddresses,
    maxRedirection,
    gateways,
  }: WebFingerCommand,
) {
  await Array.fromAsync(
    resources,
    (resource) =>
      lookupWithSpinner({
        resource,
        userAgent,
        allowPrivateAddresses,
        maxRedirection,
        gateways,
      }),
  );
}

function getLookupWebFingerOptions(
  options: LookupSingleWebFingerOptions,
): LookupWebFingerOptions {
  return {
    userAgent: options.userAgent,
    allowPrivateAddress: options.allowPrivateAddresses,
    maxRedirection: options.maxRedirection,
  };
}

export async function lookupSingleWebFinger(
  options: LookupSingleWebFingerOptions,
): Promise<ResourceDescriptor> {
  const url = convertUrlIfHandle(options.resource);
  const webFinger = await lookupWebFinger(
    url,
    getLookupWebFingerOptions(options),
  ) ?? new NotFoundError(options.resource).throw();
  return webFinger;
}

/**
 * Looks up the WebFinger address of an [FEP-ef61] portable actor by its ID,
 * i.e., an `ap:` or `ap+ef61:` URI or a compatible identifier.
 *
 * As a portable actor's ID does not belong to any server, its WebFinger
 * address is `acct:` followed by its `preferredUsername`, `@`, and the host
 * of the first gateway in its `gateways`.  The actor is looked up and its
 * proof is verified first.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
 * @param options The options.
 * @returns The resource descriptor, which may not link back to the actor;
 *          see {@link linksToActor}.
 * @throws {PortableActorError} If the actor cannot be looked up, or does
 *                              not have a WebFinger address.
 * @throws {NotFoundError} If the WebFinger address is not found.
 */
export async function lookupPortableWebFinger(
  options: LookupSingleWebFingerOptions,
): Promise<PortableWebFingerResult> {
  const { resource, gateways } = options;
  const problem = getPortableLookupProblem(resource, gateways);
  if (problem === "malformed") {
    throw new PortableActorError(resource, "it is not a valid portable ID");
  } else if (problem === "no-gateway") {
    throw new PortableActorError(
      resource,
      "it has no @gateway location hints; use the --gateway option",
    );
  }
  const documentLoader = await getDocumentLoader({
    userAgent: options.userAgent,
    allowPrivateAddress: options.allowPrivateAddresses,
  });
  const contextLoader = await getContextLoader({
    userAgent: options.userAgent,
    allowPrivateAddress: options.allowPrivateAddresses,
  });
  const actor = await lookupObject(resource, {
    documentLoader,
    contextLoader,
    verifyPortableObject: createPortableObjectVerifier(
      documentLoader,
      contextLoader,
    ),
    userAgent: options.userAgent,
    ...(gateways == null || gateways.length < 1 ? {} : { gateways }),
  });
  if (actor == null) {
    throw new PortableActorError(
      resource,
      "it could not be looked up or verified",
    );
  } else if (!isActor(actor) || actor.id == null) {
    throw new PortableActorError(resource, "it is not an actor");
  }
  const gateway = actor.gateway;
  const username = actor.preferredUsername?.toString();
  if (gateway == null || username == null) {
    throw new PortableActorError(
      resource,
      "it has no preferredUsername or gateways",
    );
  }
  const address = `acct:${username}@${gateway.host}`;
  const descriptor = await lookupWebFinger(
    address,
    getLookupWebFingerOptions(options),
  ) ?? new NotFoundError(address).throw();
  return { descriptor, address, actorId: actor.id };
}

/**
 * Checks if the first ActivityStreams `self` link of a WebFinger response
 * identifies the given portable actor, either by its portable ID or by
 * a compatible identifier.
 * @param descriptor The WebFinger resource descriptor.
 * @param actorId The portable actor's ID.
 * @returns `true` if the descriptor links back to the actor.
 */
export function linksToActor(
  descriptor: ResourceDescriptor,
  actorId: URL,
): boolean {
  const link = descriptor.links?.find((l) =>
    l.rel === "self" && l.href != null &&
    (l.type === "application/activity+json" ||
      l.type?.match(
          /application\/ld\+json;\s*profile="https:\/\/www.w3.org\/ns\/activitystreams"/,
        ) != null)
  );
  if (link?.href == null) return false;
  const key = getIriKey(link.href);
  return key != null && isPortableReference(link.href) &&
    key === getIriKey(actorId);
}

async function lookupWithSpinner(options: LookupSingleWebFingerOptions) {
  const { resource } = options;
  const spinner = ora({
    text: `Looking up WebFinger for ${resource}`,
    discardStdin: false,
  }).start();
  try {
    if (isPortableReference(resource)) {
      const { descriptor, address, actorId } = await lookupPortableWebFinger(
        options,
      );
      if (linksToActor(descriptor, actorId)) {
        spinner.succeed(
          formatMessage(
            message`WebFinger found for ${resource} (${address}):`,
          ),
        );
      } else {
        spinner.fail(
          formatMessage(
            getErrorMessage(
              resource,
              new UnlinkedPortableActorError(address, formatIri(actorId)),
            ),
          ),
        );
      }
      print([{ type: "text", text: formatObject(descriptor) }]);
      return;
    }
    const result = await lookupSingleWebFinger(options);
    spinner.succeed(
      formatMessage(message`WebFinger found for ${resource}:`),
    );
    print([{ type: "text", text: formatObject(result) }]);
  } catch (error) {
    spinner.fail(formatMessage(getErrorMessage(resource, error)));
  }
}
