import { assert, assertEquals, assertFalse } from "@std/assert";
import { mockDocumentLoader } from "../testing/docloader.ts";
import { rsaPublicKey1, rsaPublicKey2 } from "../testing/keys.ts";
import { test } from "../testing/mod.ts";
import { lookupObject } from "../vocab/lookup.ts";
import { Create } from "../vocab/vocab.ts";
import { doesActorOwnKey, getKeyOwner } from "./owner.ts";

test("doesActorOwnKey()", async () => {
  const options = {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  };
  const activity = new Create({ actor: new URL("https://example.com/person") });
  assert(await doesActorOwnKey(activity, rsaPublicKey1, options));
  assert(await doesActorOwnKey(activity, rsaPublicKey2, options));

  const activity2 = new Create({
    actor: new URL("https://example.com/hong-gildong"),
  });
  assertFalse(await doesActorOwnKey(activity2, rsaPublicKey1, options));
  assertFalse(await doesActorOwnKey(activity2, rsaPublicKey2, options));
});

test("getKeyOwner()", async () => {
  const options = {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  };
  const owner = await getKeyOwner(
    new URL("https://example.com/users/handle#main-key"),
    options,
  );
  assertEquals(
    owner,
    await lookupObject("https://example.com/users/handle", options),
  );

  const owner2 = await getKeyOwner(
    new URL("https://example.com/key"),
    options,
  );
  assertEquals(
    owner2,
    await lookupObject("https://example.com/person", options),
  );

  const owner3 = await getKeyOwner(rsaPublicKey1, options);
  assertEquals(owner3, owner2);

  const noOwner = await getKeyOwner(
    new URL("https://example.com/key2"),
    options,
  );
  assertEquals(noOwner, null);

  const noOwner2 = await getKeyOwner(
    new URL("https://example.com/object"),
    options,
  );
  assertEquals(noOwner2, null);
});
