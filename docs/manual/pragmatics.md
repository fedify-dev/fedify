---
description: >-
  This section explains the pragmatic aspects of using Fedify, such as
  how to utilize the vocabulary API and the de facto norms of ActivityPub
  implementations.
---

Pragmatics
==========

> [!NOTE]
> This section is a work in progress.  Contributions are welcome.

While Fedify provides [vocabulary API](./vocab.md), it does not inherently
define how to utilize those vocabularies.  ActivityPub implementations like
[Mastodon] and [Misskey] already have de facto norms for how to use them,
which you should follow to get the desired results.

For example, you need to know which properties on a `Person` object should be
populated with which values to display an avatar or header image, which property
represents a date joined, and so on.

In this section, we will explain the pragmatic aspects of using Fedify, such as
how to utilize the vocabulary API and the de facto norms of ActivityPub
implementations.

[Mastodon]: https://joinmastodon.org/
[Misskey]: https://misskey-hub.net/


Actors
------

The following five types of actors represent entities that can perform
activities in ActivityPub:

 -  `Application` describes a software application.
 -  `Group` represents a formal or informal collective of actors.
 -  `Organization` represents an organization.
 -  `Person` represents an individual person.
 -  `Service` represents a service of any kind.

The most common type of actor is `Person`, which represents an individual user.
When you register an [actor dispatcher], you should return an actor object of
an appropriate type of the account.

Those five types of actors have the same set of properties, e.g., `name`,
`preferredUsername`, `summary`, and `published`.

[actor dispatcher]: ./actor.md

### `Application`/`Service`: Automated/bot actors

If an actor is represented as an `Application` or `Service` object, it is
considered an automated actor by Mastodon and a bot actor by Misskey.

~~~~ typescript twoslash
import { Application } from "@fedify/vocab";
// ---cut-before---
new Application({  // [!code highlight]
  name: "Fedify Demo",
  preferredUsername: "demo",
  summary: "This is a Fedify Demo account",
  // Other properties...
})
~~~~

For example, the above actor object is displayed as an automated actor in
Mastodon like the following:

![Screenshot: An automated actor in Mastodon](pragmatics/mastodon-automated.png)

### `Group`

If an actor is represented as a `Group` object, it is considered a group actor
by Mastodon.

~~~~ typescript twoslash
import { Group } from "@fedify/vocab";
// ---cut-before---
new Group({  // [!code highlight]
  name: "Fedify Demo",
  preferredUsername: "demo",
  summary: "This is a Fedify Demo account",
  // Other properties...
})
~~~~

For example, the above actor object is displayed as a group actor in Mastodon
like the following:

![Screenshot: A group actor in Mastodon](pragmatics/mastodon-group.png)

> [!TIP]
> [Lemmy] communities and [Guppe] groups are also represented as `Group`
> objects.

[Lemmy]: https://join-lemmy.org/
[Guppe]: https://a.gup.pe/

### `name`: Display name

The `name` property is used as a display name in Mastodon and the most
ActivityPub implementations.  The display name is usually a full name or
a nickname of a person, or a title of a group or an organization.
It is displayed in the profile page of an actor and the timeline.

~~~~ typescript twoslash
import { Person } from "@fedify/vocab";
// ---cut-before---
new Person({
  name: "Fedify Demo",  // [!code highlight]
  preferredUsername: "demo",
  summary: "This is a Fedify Demo account",
  // Other properties...
})
~~~~

For example, the above actor object is displayed like the following in Mastodon:

![Screenshot: An actor profile with display name Fedify Demo in
Mastodon](pragmatics/mastodon-person.png)

### `summary`: Bio

The `summary` property is used as a bio in Mastodon and the most ActivityPub
implementations.  The bio is displayed in the profile page of the actor.

> [!NOTE]
> The `summary` property expects an HTML string, so you should escape HTML
> entities if it contains characters like `<`, `>`, and `&`.

~~~~ typescript twoslash
import { Person } from "@fedify/vocab";
// ---cut-before---
new Person({
  name: "Fedify Demo",
  preferredUsername: "demo",
  summary: "This is a Fedify Demo account",  // [!code highlight]
  // Other properties...
})
~~~~

For example, the above actor object is displayed like the following in Mastodon:

![Screenshot: An actor profile with a bio in
Mastodon](pragmatics/mastodon-person.png)

### `published`: Date joined

The `published` property is used as a date joined in Mastodon and Misskey.
The date joined is displayed in the profile page of the actor.

> [!NOTE]
> Although the `published` property contains a date and time, it is displayed
> as a date only in Mastodon and Misskey.  However, there may be ActivityPub
> implementations that display the date and time.

~~~~ typescript twoslash
import { Person } from "@fedify/vocab";
import { Temporal } from "@js-temporal/polyfill";
// ---cut-before---
new Person({
  name: "Fedify Demo",
  preferredUsername: "demo",
  summary: "This is a Fedify Demo account",
  published: Temporal.Instant.from("2024-03-31T00:00:00Z"), // [!code highlight]
  // Other properties...
})
~~~~

For example, the above actor object is displayed like the following in Mastodon:

![Screenshot: An actor profile with a date joined in
Mastodon](pragmatics/mastodon-person.png)

### `icon`: Avatar image

The `icon` property is used as an avatar image in Mastodon and the most
ActivityPub implementations.  The avatar image is displayed next to the name
of the actor in the profile page and the timeline.

~~~~ typescript{5-8} twoslash
import { Image, Person } from "@fedify/vocab";
// ---cut-before---
new Person({
  name: "Fedify Demo",
  preferredUsername: "demo",
  summary: "This is a Fedify Demo account",
  icon: new Image({
    url: new URL("https://i.imgur.com/CUBXuVX.jpeg"),
    mediaType: "image/jpeg",
  }),
  // Other properties...
})
~~~~

For example, the above actor object is displayed like the following in Mastodon:

![Screenshot: An actor profile with a cat avatar image in
Mastodon](pragmatics/mastodon-avatar.png)

### `image`: Header image

The `image` property is used as a header image in Mastodon and Misskey.
The header image is displayed on the top of the profile page.

~~~~ typescript{5-8} twoslash
import { Image, Person } from "@fedify/vocab";
// ---cut-before---
new Person({
  name: "Fedify Demo",
  preferredUsername: "demo",
  summary: "This is a Fedify Demo account",
  image: new Image({
    url: new URL("https://i.imgur.com/yEZ0EEw.jpeg"),
    mediaType: "image/jpeg",
  }),
  // Other properties...
})
~~~~

For example, the above actor object is displayed like the following in Mastodon:

![Screenshot: An actor profile with a cat header image in
Mastodon](pragmatics/mastodon-header.png)

### `attachments`: Custom fields

The `attachments` property is used as custom fields in Mastodon and Misskey.
The custom fields are displayed as a table in the profile page.

~~~~ typescript{5-18} twoslash
import { Person, PropertyValue } from "@fedify/vocab";
// ---cut-before---
new Person({
  name: "Fedify Demo",
  preferredUsername: "demo",
  summary: "This is a Fedify Demo account",
  attachments: [
    new PropertyValue({
      name: "Location",
      value: "Seoul, South Korea",
    }),
    new PropertyValue({
      name: "Pronoun",
      value: "they/them",
    }),
    new PropertyValue({
      name: "Website",
      value: '<a href="https://fedify.dev/">fedify.dev</a>'
    }),
  ],
  // Other properties...
})
~~~~

> [!NOTE]
> The `PropertyValue.value` property expects an HTML string, so you should
> escape HTML entities if it contains characters like `<`, `>`, and `&`.

For example, the above actor object is displayed like the following in Mastodon:

![Screenshot: An actor profile with custom fields in
Mastodon](pragmatics/mastodon-custom-fields.png)

### `manuallyApprovesFollowers`: Lock account

The `manuallyApprovesFollowers` property is used to *indicate* that the actor
manually approves followers.  In Mastodon and Misskey, the actor is displayed as
a locked account if the `manuallyApprovesFollowers` property is `true`.

> [!WARNING]
> The `manuallyApprovesFollowers` property only *indicates* that the actor
> manually approves followers.  The actual behavior of the actor is determined
> by the [inbox listener](./inbox.md) for `Follow` activities.
> If it automatically sends `Accept` activities right after receiving `Follow`,
> the actor behaves as an unlocked account.  If it sends `Accept` when the
> owner explicitly clicks the *Accept* button, the actor behaves as a locked
> account.

~~~~ typescript twoslash
import { Person } from "@fedify/vocab";
// ---cut-before---
new Person({
  name: "Fedify Demo",
  preferredUsername: "demo",
  summary: "This is a Fedify Demo account",
  manuallyApprovesFollowers: true,  // [!code highlight]
  // Other properties...
})
~~~~

For example, the above actor object is displayed like the following in Mastodon:

![Screenshot: An actor profile with a lock icon next to the handle in
Mastodon](pragmatics/mastodon-lock.png)

### `suspended`

The `suspended` property is used to suspend an actor in Mastodon.
If the `suspended` property is `true`, the profile page of the actor is
displayed as suspended.

~~~~ typescript twoslash
import { Person } from "@fedify/vocab";
// ---cut-before---
new Person({
  name: "Fedify Demo",
  preferredUsername: "demo",
  summary: "This is a Fedify Demo account",
  suspended: true,  // [!code highlight]
  // Other properties...
})
~~~~

For example, the above actor object is displayed like the following in Mastodon:

![Screenshot: An actor profile with a suspended status in
Mastodon](pragmatics/mastodon-suspended.png)

### `memorial`

The `memorial` property is used to memorialize an actor in Mastodon.
If the `memorial` property is `true`, the profile page of the actor is
displayed as memorialized.

~~~~ typescript twoslash
import { Person } from "@fedify/vocab";
// ---cut-before---
new Person({
  name: "Fedify Demo",
  preferredUsername: "demo",
  summary: "This is a Fedify Demo account",
  memorial: true,  // [!code highlight]
  // Other properties...
})
~~~~

For example, the above actor object is displayed like the following in Mastodon:

![Screenshot: An actor profile with a memorialized status in
Mastodon](pragmatics/mastodon-memorial.png)

### `~Federatable.setFollowingDispatcher()`: Following collection

The `~Federatable.setFollowingDispatcher()` method registers a dispatcher for
the collection of actors that the actor follows.  The number of the collection
is displayed in the profile page of the actor.  Each item in the collection is
a URI of the actor that the actor follows, or an actor object itself.

~~~~ typescript twoslash
import type { Federation } from "@fedify/fedify";
const federation = null as unknown as Federation<void>;
// ---cut-before---
federation
  .setFollowingDispatcher(
    "/users/{identifier}/following", async (ctx, identifier, cursor) => {
      // Loads the list of actors that the actor follows...
      return {
        items: [
          new URL("..."),
          new URL("..."),
          // ...
        ]
      };
    }
  )
  .setCounter((ctx, identifier) => 123);
~~~~

For example, the above following collection is displayed like the below
in Mastodon:

![Screenshot: An actor profile with 123 following in
Mastodon](pragmatics/mastodon-following.png)

> [!NOTE]
> Mastodon does not display the following collection of a remote actor,
> but other ActivityPub implementations may display it.

### `~Federatable.setFollowersDispatcher()`: Followers collection

The `~Federatable.setFollowersDispatcher()` method registers a dispatcher for
the collection of actors that follow the actor.  The number of the collection
is displayed in the profile page of the actor.  Each item in the collection is
a `Recipient` or an `Actor` that follows the actor.

~~~~ typescript twoslash
import type { Federation } from "@fedify/fedify";
import type { Recipient } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
// ---cut-before---
federation
  .setFollowersDispatcher(
    "/users/{identifier}/followers", async (ctx, identifier, cursor) => {
      // Loads the list of actors that follow the actor...
      return {
        items: [
          {
            id: new URL("..."),
            inboxId: new URL("..."),
          } satisfies Recipient,
          // ...
        ]
      };
    }
  )
  .setCounter((ctx, identifier) => 456);
~~~~

For example, the above followers collection is displayed like the below
in Mastodon:

![Screenshot: An actor profile with 456 followers in
Mastodon](pragmatics/mastodon-followers.png)

> [!NOTE]
> Mastodon does not display the followers collection of a remote actor,
> but other ActivityPub implementations may display it.


Objects
-------

The following types of objects are commonly used to represent posts and other
public-facing content in the fediverse:

 -  `Article` represents a multi-paragraph written work.
 -  `Note` represents a short post.
 -  `Question` represents a poll.

Link-like objects such as `Mention`, `Hashtag`, and `Emoji` are usually attached
to these objects through their `tags` property.  The exact way ActivityPub
implementations render these objects differs, but Mastodon and Misskey already
share a number of de facto conventions.

### `Note`: Short posts

The `Note` type is the most common object type for short posts.  In Mastodon,
the `content` property becomes the post body, the `summary` property becomes a
content warning, and `attachments` are rendered below the body.

~~~~ typescript twoslash
import { Hashtag, Image, Mention, Note } from "@fedify/vocab";
// ---cut-before---
new Note({
  content:  // [!code highlight]
    '<p>Hello <a class="mention" href="https://example.com/users/friend">' +
    '@friend@example.com</a>! This note demonstrates ' +
    '<a href="https://example.com/tags/fedify">#fedify</a>.</p>',
  summary: "CW: Rendering pragmatics demo",  // [!code highlight]
  attachments: [  // [!code highlight]
    new Image({
      url: new URL("https://picsum.photos/id/237/1200/800"),
      mediaType: "image/jpeg",
      name: "A placeholder dog photo",
    }),
  ],
  tags: [
    new Mention({
      href: new URL("https://example.com/users/friend"),
      name: "@friend@example.com",
    }),
    new Hashtag({
      href: new URL("https://example.com/tags/fedify"),
      name: "#fedify",
    }),
  ],
})
~~~~

> [!NOTE]
> The `content` and `summary` properties expect HTML strings.  If they contain
> characters like `<`, `>`, and `&`, you should escape HTML entities.

For example, the above `Note` object is displayed like the following in
Mastodon:

![Screenshot: A note with a content warning and an attached image in
Mastodon](pragmatics/mastodon-note.png)

### `Article`: Long-form posts

The `Article` type is commonly used for long-form posts such as blog entries.
In Mastodon, the `name` property is displayed as the title, the `url` property
is shown as the canonical link, and `tags` can still surface hashtags below the
post body.

~~~~ typescript twoslash
import { Article, Hashtag } from "@fedify/vocab";
// ---cut-before---
new Article({
  name: "Pragmatics of `Article` objects",  // [!code highlight]
  url: new URL("https://example.com/blog/pragmatics-article"),  // [!code highlight]
  content:  // [!code highlight]
    "<p>This article demonstrates how a long-form object can expose a title " +
    "and a canonical permalink.</p>",
  tags: [  // [!code highlight]
    new Hashtag({
      href: new URL("https://example.com/tags/activitypub"),
      name: "#activitypub",
    }),
  ],
})
~~~~

> [!NOTE]
> Many ActivityPub implementations render `Article` objects more compactly than
> `Note` objects.  If you want a title-like presentation, populate the `name`
> property instead of relying on the body alone.

For example, the above `Article` object is displayed like the following in
Mastodon:

![Screenshot: An article object with a title, canonical link, and hashtag in
Mastodon](pragmatics/mastodon-article.png)

### `Question`: Polls

The `Question` type is used for polls.  In Mastodon, the question body comes
from `content`, the poll choices come from `exclusiveOptions` or
`inclusiveOptions`, and metadata such as `voters` and `endTime` are displayed
below the choices.

~~~~ typescript twoslash
import { Collection, Note, Question } from "@fedify/vocab";
import { Temporal } from "@js-temporal/polyfill";
// ---cut-before---
new Question({
  content: "<p>Which pragmatics example should the manual explain first?</p>",  // [!code highlight]
  exclusiveOptions: [  // [!code highlight]
    new Note({ name: "A short note", replies: new Collection({ totalItems: 4 }) }),
    new Note({ name: "A long article", replies: new Collection({ totalItems: 2 }) }),
    new Note({
      name: "A poll question",
      replies: new Collection({ totalItems: 7 }),
    }),
  ],
  voters: 13,  // [!code highlight]
  endTime: Temporal.Instant.from("2026-04-28T12:00:00Z"),  // [!code highlight]
})
~~~~

> [!NOTE]
> Use `exclusiveOptions` for single-choice polls and `inclusiveOptions` for
> multiple-choice polls.  A `Question` object should not contain both.

For example, the above `Question` object is displayed like the following in
Mastodon:

![Screenshot: A question object rendered as a poll in
Mastodon](pragmatics/mastodon-question.png)
