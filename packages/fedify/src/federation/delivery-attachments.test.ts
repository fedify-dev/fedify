import { mockDocumentLoader, test } from "@fedify/fixture";
import {
  Create,
  Image,
  Note,
  Person,
  PropertyValue,
  Update,
} from "@fedify/vocab";
import { decodeMultibase } from "@fedify/vocab-runtime";
import { assert, assertEquals } from "@std/assert";
import fetchMock from "fetch-mock";
import serialize from "json-canon";
import { detachSignature, verifySignature } from "../sig/ld.ts";
import { signObject } from "../sig/proof.ts";
import { prepareActivityJsonLd } from "../compat/delivery-jsonld.ts";
import {
  ed25519PrivateKey,
  ed25519PublicKey,
  rsaPrivateKey2,
  rsaPublicKey2,
} from "../testing/keys.ts";
import { MemoryKvStore } from "./kv.ts";
import { ContextImpl, FederationImpl } from "./middleware.ts";
import type { MessageQueue } from "./mq.ts";
import type { Message } from "./queue.ts";

type JsonMap = Record<string, unknown>;

// Verify the received JCS bytes directly, independently of Fedify's verifier.
async function assertRawProof(
  document: JsonMap,
  proof: JsonMap,
  publicKey: CryptoKey,
): Promise<void> {
  const unsigned = { ...document };
  delete unsigned.proof;
  delete unsigned.signature;
  const encoder = new TextEncoder();
  const config = {
    "@context": document["@context"],
    type: "DataIntegrityProof",
    cryptosuite: proof.cryptosuite,
    verificationMethod: proof.verificationMethod,
    proofPurpose: proof.proofPurpose,
    created: proof.created,
  };
  const configDigest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(serialize(config)),
  );
  const messageDigest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(serialize(unsigned)),
  );
  const bytes = new Uint8Array(
    configDigest.byteLength + messageDigest.byteLength,
  );
  bytes.set(new Uint8Array(configDigest));
  bytes.set(new Uint8Array(messageDigest), configDigest.byteLength);
  assert(
    await crypto.subtle.verify(
      "Ed25519",
      publicKey,
      decodeMultibase(proof.proofValue as string).slice(),
      bytes,
    ),
    "The proof must cover the exact received JSON representation.",
  );
}

test("attachment delivery keeps fetched profiles, proofs, and queued bytes consistent", async (t) => {
  const secondEdKey = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]) as CryptoKeyPair;
  const inbox = "https://example.com/attachment-inbox";
  const received: JsonMap[] = [];
  let responseStatus = 202;
  fetchMock.spyGlobal();
  fetchMock.post(inbox, async ({ request }) => {
    received.push(await request!.json() as JsonMap);
    return new Response(null, { status: responseStatus });
  });
  try {
    for (
      const scenario of [
        "rsa",
        "immediate",
        "outbox",
        "fanout",
        "raw-fanout",
        "raw-immediate",
        "raw-outbox",
        "rsa-fanout",
        "retry",
      ] as const
    ) {
      await t.step(scenario, async () => {
        const messages: Message[] = [];
        const queue: MessageQueue = {
          enqueue(message) {
            messages.push(message);
            return Promise.resolve();
          },
          async listen() {},
        };
        const federation = new FederationImpl<void>({
          kv: new MemoryKvStore(),
          queue,
          manuallyStartQueue: true,
          allowPrivateAddress: true,
        });
        federation.setActorDispatcher(
          "/users/{identifier}",
          (ctx, identifier) =>
            new Person({
              id: ctx.getActorUri(identifier),
              preferredUsername: identifier,
              attachments: [
                new PropertyValue({
                  name: "Website",
                  value: "https://example.com/",
                }),
              ],
            }),
        ).setKeyPairsDispatcher(() => [
          { privateKey: rsaPrivateKey2, publicKey: rsaPublicKey2.publicKey! },
          ...(scenario.startsWith("rsa") ? [] : [
            {
              privateKey: ed25519PrivateKey,
              publicKey: ed25519PublicKey.publicKey!,
            },
            {
              privateKey: secondEdKey.privateKey,
              publicKey: secondEdKey.publicKey,
            },
          ]),
        ]);
        const ctx = new ContextImpl({
          data: undefined,
          federation,
          url: new URL("https://example.com/"),
          documentLoader: mockDocumentLoader,
          contextLoader: mockDocumentLoader,
        });
        const actor = new Person({
          id: ctx.getActorUri("alice"),
          preferredUsername: "alice",
          attachments: [
            new PropertyValue({
              name: "Website",
              value: "https://example.com/",
            }),
          ],
        });
        const response = await federation.fetch(
          new Request(ctx.getActorUri("alice"), {
            headers: { Accept: "application/activity+json" },
          }),
          { contextData: undefined },
        );
        const fetched = await response.json() as JsonMap;
        assert(Array.isArray(fetched.attachment));
        const keyPairs = await ctx.getActorKeyPairs("alice");
        const start = received.length;
        await ctx.sendActivity(
          scenario.startsWith("raw-")
            ? keyPairs.map((kp) => ({
              privateKey: kp.privateKey,
              keyId: kp.keyId,
            }))
            : { identifier: "alice" },
          {
            id: new URL("https://example.com/recipient"),
            inboxId: new URL(inbox),
          },
          new Update({
            id: new URL(`https://example.com/updates/${scenario}`),
            actor: actor.id!,
            object: actor,
          }),
          scenario === "immediate" || scenario === "raw-immediate" ||
            scenario === "rsa"
            ? { immediate: true }
            : scenario === "fanout" || scenario === "raw-fanout" ||
                scenario === "rsa-fanout"
            ? { fanout: "force" }
            : {},
        );
        if (scenario === "retry") {
          const first = messages.shift();
          assert(first?.type === "outbox");
          const original = structuredClone(first.activity);
          responseStatus = 503;
          await federation.processQueuedTask(undefined, first);
          responseStatus = 202;
          const retried = messages[0];
          assert(retried?.type === "outbox");
          assertEquals(retried.attempt, 1);
          assertEquals(retried.activity, original);
        }
        for (let count = 0; messages.length > 0; count++) {
          assert(count < 10, "The delivery queue must drain.");
          await federation.processQueuedTask(undefined, messages.shift()!);
        }
        assert(received.length > start);
        const delivered = received.at(-1)!;
        assertEquals(
          (delivered.object as JsonMap).attachment,
          fetched.attachment,
        );
        assert(
          await verifySignature(delivered, {
            contextLoader: mockDocumentLoader,
            keyCache: {
              get(id) {
                return Promise.resolve(
                  keyPairs.find((kp) =>
                    kp.cryptographicKey.id?.href === id.href
                  )?.cryptographicKey ?? null,
                );
              },
              async set() {},
            },
          }),
        );
        const wire = detachSignature(delivered) as JsonMap;
        const proofs = wire.proof == null
          ? []
          : Array.isArray(wire.proof)
          ? wire.proof
          : [wire.proof];
        assertEquals(proofs.length, scenario.startsWith("rsa") ? 0 : 2);
        for (const proof of proofs as JsonMap[]) {
          const key = keyPairs.find((kp) =>
            kp.multikey.id?.href === proof.verificationMethod ||
            kp.keyId.href === proof.verificationMethod
          );
          assert(key != null);
          await assertRawProof(wire, proof, key.publicKey);
        }
        if (scenario === "retry") {
          assertEquals(received.at(-2), received.at(-1));
        }
      });
    }
  } finally {
    fetchMock.unmockGlobal();
    fetchMock.removeRoutes();
    fetchMock.clearHistory();
  }
});

test("public attachment proof serialization remains unchanged", async () => {
  const activity = new Create({
    actor: new URL("https://example.com/actor"),
    object: new Note({
      attachments: [
        new Image({ url: new URL("https://example.com/image.png") }),
      ],
    }),
  });
  const signed = await signObject(
    activity,
    ed25519PrivateKey,
    ed25519PublicKey.id!,
    { contextLoader: mockDocumentLoader },
  );
  const raw = await signed.toJsonLd({
    format: "compact",
    contextLoader: mockDocumentLoader,
  }) as JsonMap;
  assert(!Array.isArray((raw.object as JsonMap).attachment));
  await assertRawProof(raw, raw.proof as JsonMap, ed25519PublicKey.publicKey!);
  const resigned = await signObject(
    signed,
    ed25519PrivateKey,
    ed25519PublicKey.id!,
    { contextLoader: mockDocumentLoader },
  );
  const resignedJson = await resigned.toJsonLd({
    format: "compact",
    contextLoader: mockDocumentLoader,
  }) as JsonMap;
  assert(!Array.isArray((resignedJson.object as JsonMap).attachment));
  assert(Array.isArray(resignedJson.proof));
  assertEquals(resignedJson.proof.length, 2);
  for (const proof of resignedJson.proof) {
    await assertRawProof(
      resignedJson,
      proof as JsonMap,
      ed25519PublicKey.publicKey!,
    );
  }
});

test("delivery preparation only selects changed proof-free attachment JSON", async () => {
  const unchanged = new Create({
    actor: new URL("https://example.com/actor"),
    object: new Note({ content: "No attachments" }),
  });
  assertEquals(
    await prepareActivityJsonLd(unchanged, mockDocumentLoader),
    undefined,
  );
  const child = new Note({
    attachments: [new Image({ url: new URL("https://example.com/image.png") })],
  });
  const activity = new Create({
    actor: new URL("https://example.com/actor"),
    object: child,
  });
  const before = structuredClone(await activity.toJsonLd());
  const childBefore = structuredClone(await child.toJsonLd());
  const prepared = await prepareActivityJsonLd(activity, mockDocumentLoader);
  assert(prepared != null);
  assert(Array.isArray((prepared.object as JsonMap).attachment));
  assertEquals(await activity.toJsonLd(), before);
  assertEquals(await child.toJsonLd(), childBefore);
  const signedChild = await signObject(
    child,
    ed25519PrivateKey,
    ed25519PublicKey.id!,
    { contextLoader: mockDocumentLoader },
  );
  // Existing signed compositions keep baseline serialization and signing.
  assertEquals(
    await prepareActivityJsonLd(
      new Create({ actor: activity.actorId!, object: signedChild }),
      mockDocumentLoader,
    ),
    undefined,
  );
});

test("existing root proofs retain baseline delivery signing and scalar attachments", async (t) => {
  const inbox = "https://example.com/existing-proof-inbox";
  let delivered: JsonMap | undefined;
  fetchMock.spyGlobal();
  fetchMock.post(inbox, async ({ request }) => {
    delivered = await request!.json() as JsonMap;
    return new Response(null, { status: 202 });
  });
  try {
    for (const sender of ["actor", "raw"] as const) {
      await t.step(sender, async () => {
        const federation = new FederationImpl<void>({
          kv: new MemoryKvStore(),
          allowPrivateAddress: true,
        });
        federation.setActorDispatcher(
          "/users/{identifier}",
          (ctx, identifier) => new Person({ id: ctx.getActorUri(identifier) }),
        ).setKeyPairsDispatcher(() => [{
          privateKey: rsaPrivateKey2,
          publicKey: rsaPublicKey2.publicKey!,
        }, {
          privateKey: ed25519PrivateKey,
          publicKey: ed25519PublicKey.publicKey!,
        }]);
        const ctx = new ContextImpl({
          data: undefined,
          federation,
          url: new URL("https://example.com/"),
          documentLoader: mockDocumentLoader,
          contextLoader: mockDocumentLoader,
        });
        const activity = await signObject(
          new Update({
            id: new URL(`https://example.com/existing-proof/${sender}`),
            actor: ctx.getActorUri("alice"),
            object: new Person({
              id: ctx.getActorUri("alice"),
              attachments: [
                new PropertyValue({ name: "Site", value: "example" }),
              ],
            }),
          }),
          ed25519PrivateKey,
          ed25519PublicKey.id!,
          { contextLoader: mockDocumentLoader },
        );
        const before = structuredClone(await activity.toJsonLd());
        assertEquals(
          await prepareActivityJsonLd(activity, mockDocumentLoader),
          undefined,
        );
        await ctx.sendActivity(
          sender === "actor" ? { identifier: "alice" } : [{
            privateKey: rsaPrivateKey2,
            keyId: rsaPublicKey2.id!,
          }, {
            privateKey: ed25519PrivateKey,
            keyId: ed25519PublicKey.id!,
          }],
          {
            id: new URL("https://example.com/recipient"),
            inboxId: new URL(inbox),
          },
          activity,
          { immediate: true },
        );
        assert(delivered != null);
        assert(!Array.isArray((delivered.object as JsonMap).attachment));
        assert(
          await verifySignature(delivered, {
            contextLoader: mockDocumentLoader,
            keyCache: {
              get: () => Promise.resolve(rsaPublicKey2),
              async set() {},
            },
          }),
        );
        const wire = detachSignature(delivered) as JsonMap;
        const proofs = Array.isArray(wire.proof) ? wire.proof : [wire.proof];
        assertEquals(proofs.length, sender === "actor" ? 2 : 1);
        for (const proof of proofs) {
          await assertRawProof(
            wire,
            proof as JsonMap,
            ed25519PublicKey.publicKey!,
          );
        }
        assertEquals(await activity.toJsonLd(), before);
      });
    }
  } finally {
    fetchMock.unmockGlobal();
    fetchMock.removeRoutes();
    fetchMock.clearHistory();
  }
});
