---
description: >-
  You can register an object dispatcher so that Fedify can dispatch an
  appropriate object by its class and URL arguments.  This section explains
  how to register an object dispatcher.
---

Object dispatcher
=================

*This API is available since Fedify 0.7.0.*

In ActivityPub, [objects] are entities that can be attached to activities or
other objects.  Objects sometimes need to be resolved by their dereferenceable
URIs.  To let objects be resolved, you can register object dispatchers so that
Fedify can dispatch an appropriate object by its class and URL arguments.

An object dispatcher is a callback function that takes a `Context` object and
URL arguments, and returns an object.  Every object dispatcher has one or more
URL parameters that are used to dispatch the object.  The URL parameters are
specified in the path pattern of the object dispatcher, e.g., `/notes/{id}`,
`/users/{userId}/articles/{articleId}`.

The below example shows how to register an object dispatcher:

~~~~ typescript{7-19} twoslash
// @noErrors: 2345
const note: { id: string; content: string } = { id: "", content: "" };
// ---cut-before---
import { createFederation, Note } from "@fedify/fedify";

const federation = createFederation({
  // Omitted for brevity; see the related section for details.
});

federation.setObjectDispatcher(
  Note,
  "/users/{userId}/notes/{noteId}",
  async (ctx, { userId, noteId }) => {
    // Work with the database to find the note by the author ID and the note ID.
    if (note == null) return null;  // Return null if the note is not found.
    return new Note({
      id: ctx.getObjectUri(Note, { userId, noteId }),
      content: note.content,
      // Many more properties...
    });
  }
);
~~~~

In the above example, the `~Federatable.setObjectDispatcher()` method registers
an object dispatcher for the `Note` class and
the `/users/{userId}/notes/{noteId}` path.  This pattern syntax follows
the [URI Template] specification.

> [!NOTE]
> The URI Template syntax supports different expansion types like `{userId}`
> (simple expansion) and `{+userId}` (reserved expansion).  If your
> identifiers contain URIs or special characters, you may need to use
> `{+userId}` to avoid double-encoding issues.  See the
> [*URI Template* guide](./uri-template.md) for details.

[objects]: https://www.w3.org/TR/activitystreams-core/#object
[URI Template]: https://datatracker.ietf.org/doc/html/rfc6570


Constructing object URIs
------------------------

To construct an object URI, you can use the `Context.getObjectUri()` method.
This method takes a class and URL arguments, and returns a dereferenceable URI
of the object.

The below example shows how to construct an object URI:

~~~~ typescript twoslash
import { type Context, Note } from "@fedify/fedify";
const ctx = null as unknown as Context<void>;
// ---cut-before---
ctx.getObjectUri(Note, {
  userId: "2bd304f9-36b3-44f0-bf0b-29124aafcbb4",
  noteId: "9f60274d-f6c2-4e3f-8eae-447f4416c0fb",
})
~~~~

> [!NOTE]
>
> The `Context.getObjectUri()` method does not guarantee that the object
> actually exists.  It only constructs a URI based on the given class and URL
> arguments, which may respond with `404 Not Found`.  Make sure to check
> if the arguments are valid before calling the method.
