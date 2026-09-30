import { mockDocumentLoader, test } from "@fedify/fixture";
import { type Actor, Note, Person, PUBLIC_COLLECTION } from "@fedify/vocab";
import { parseIri, toCompatibleEf61Id } from "@fedify/vocab-runtime";
import jsonld from "@fedify/vocab-runtime/jsonld";
import { assertEquals } from "@std/assert";
import { isInAudience, isPubliclyAddressedNode } from "./audience.ts";

const did = "did:key:z6MkrJVnaZkeFzdQyMZu1cgjg7k1pZZ6pvBQ7XJPt4swbTQ2";

async function expand(
  document: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const [node] = await jsonld.expand(
    {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: "https://example.com/notes/1",
      type: "Note",
      ...document,
    },
    { documentLoader: mockDocumentLoader },
  );
  return node as Record<string, unknown>;
}

test("isPubliclyAddressedNode()", async (t) => {
  for (const property of ["to", "cc", "bto", "bcc", "audience"]) {
    for (
      const value of [
        PUBLIC_COLLECTION.href,
        "as:Public",
        "Public",
        ["https://example.com/person", "as:Public"],
      ]
    ) {
      await t.step(`${JSON.stringify(value)} in ${property}`, async () => {
        assertEquals(
          isPubliclyAddressedNode(await expand({ [property]: value })),
          true,
        );
      });
    }
  }

  await t.step("not addressed", async () => {
    assertEquals(isPubliclyAddressedNode(await expand({})), false);
  });

  await t.step("addressed to other recipients", async () => {
    assertEquals(
      isPubliclyAddressedNode(
        await expand({
          to: "https://example.com/person",
          cc: "https://example.com/person/followers",
        }),
      ),
      false,
    );
  });

  await t.step("Public in other properties", async () => {
    assertEquals(
      isPubliclyAddressedNode(await expand({ tag: PUBLIC_COLLECTION.href })),
      false,
    );
  });

  await t.step("a Public literal rather than an ID", async () => {
    assertEquals(
      isPubliclyAddressedNode(
        await expand({ to: { "@value": PUBLIC_COLLECTION.href } }),
      ),
      false,
    );
  });

  await t.step("Public that the context maps elsewhere", async () => {
    for (
      const [context, to] of [
        [{ as: "https://example.com/ns#" }, "as:Public"],
        [{ "@base": "https://example.com/" }, "Public"],
      ] as const
    ) {
      const [node] = await jsonld.expand(
        {
          "@context": ["https://www.w3.org/ns/activitystreams", context],
          id: "https://example.com/notes/1",
          type: "Note",
          to,
        },
        { documentLoader: mockDocumentLoader },
      );
      assertEquals(
        isPubliclyAddressedNode(node as Record<string, unknown>),
        false,
        JSON.stringify(context),
      );
    }
  });

  await t.step("only the node itself is checked", async () => {
    assertEquals(
      isPubliclyAddressedNode(
        await expand({
          type: "Create",
          actor: "https://example.com/person",
          object: {
            type: "Note",
            id: "https://example.com/notes/2",
            to: PUBLIC_COLLECTION.href,
          },
        }),
      ),
      false,
    );
  });
});

test("isInAudience()", async (t) => {
  const person = new Person({ id: new URL("https://example.com/person") });
  const portableId = parseIri(`ap+ef61://${did}/actor`);
  const portable = new Person({
    // A compatible identifier on another gateway than the one in the note:
    id: toCompatibleEf61Id(portableId, "https://other.example"),
  });
  const followers = new URL("https://example.com/person2/followers");

  await t.step("publicly addressed", async () => {
    for (const actor of [null, person]) {
      assertEquals(
        await isInAudience(new Note({ cc: PUBLIC_COLLECTION }), actor),
        true,
      );
    }
  });

  await t.step("no actor", async () => {
    assertEquals(
      await isInAudience(new Note({ to: person.id }), null),
      false,
    );
    assertEquals(await isInAudience(new Note({}), null), false);
  });

  await t.step("directly addressed", async () => {
    for (const property of ["to", "cc", "bto", "bcc", "audience"]) {
      assertEquals(
        await isInAudience(new Note({ [property]: person.id }), person),
        true,
        property,
      );
    }
  });

  await t.step("not addressed", async () => {
    assertEquals(
      await isInAudience(
        new Note({ to: new URL("https://example.com/other") }),
        person,
      ),
      false,
    );
    assertEquals(
      await isInAudience(new Note({ to: person.id }), new Person({})),
      false,
    );
  });

  await t.step("portable IDs are compared canonically", async () => {
    for (
      const addressee of [
        portableId,
        parseIri(`ap://${did}/actor`),
        parseIri(`ap+ef61://${did.replaceAll(":", "%3A")}/actor`),
        toCompatibleEf61Id(portableId, "https://example.com"),
      ]
    ) {
      assertEquals(
        await isInAudience(new Note({ to: addressee }), portable),
        true,
        addressee.href,
      );
    }
    assertEquals(
      await isInAudience(
        new Note({ to: parseIri(`ap+ef61://${did}/other`) }),
        portable,
      ),
      false,
    );
    // An ordinary URL does not match a portable ID even at the same path:
    assertEquals(
      await isInAudience(
        new Note({ to: new URL(`https://other.example/${did}/actor`) }),
        portable,
      ),
      false,
    );
  });

  await t.step("isMember()", async () => {
    const calls: string[] = [];
    const isMember = (addressee: URL, actor: Actor) => {
      calls.push(`${addressee.href} ${actor.id?.href}`);
      return addressee.href === followers.href;
    };
    const note = new Note({
      to: new URL("https://example.com/other"),
      cc: followers,
    });
    assertEquals(await isInAudience(note, person, { isMember }), true);
    assertEquals(calls, [
      `https://example.com/other ${person.id?.href}`,
      `${followers.href} ${person.id?.href}`,
    ]);
    calls.length = 0;
    // It is not called for the actor itself, nor without an actor:
    assertEquals(
      await isInAudience(new Note({ to: person.id }), person, { isMember }),
      true,
    );
    assertEquals(await isInAudience(note, null, { isMember }), false);
    assertEquals(calls, []);
    assertEquals(
      await isInAudience(note, person, { isMember: () => false }),
      false,
    );
  });
});
