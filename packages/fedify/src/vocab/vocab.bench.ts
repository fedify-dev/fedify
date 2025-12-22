import { Collection, Object } from "@fedify/vocab";

const jsonLd = {
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    "https://w3id.org/security/v1",
    {
      "manuallyApprovesFollowers": "as:manuallyApprovesFollowers",
      "toot": "http://joinmastodon.org/ns#",
      "featured": {
        "@id": "toot:featured",
        "@type": "@id",
      },
      "featuredTags": {
        "@id": "toot:featuredTags",
        "@type": "@id",
      },
      "alsoKnownAs": {
        "@id": "as:alsoKnownAs",
        "@type": "@id",
      },
      "movedTo": {
        "@id": "as:movedTo",
        "@type": "@id",
      },
      "schema": "http://schema.org#",
      "PropertyValue": "schema:PropertyValue",
      "value": "schema:value",
      "discoverable": "toot:discoverable",
      "Device": "toot:Device",
      "Ed25519Signature": "toot:Ed25519Signature",
      "Ed25519Key": "toot:Ed25519Key",
      "Curve25519Key": "toot:Curve25519Key",
      "EncryptedMessage": "toot:EncryptedMessage",
      "publicKeyBase64": "toot:publicKeyBase64",
      "deviceId": "toot:deviceId",
      "claim": {
        "@type": "@id",
        "@id": "toot:claim",
      },
      "fingerprintKey": {
        "@type": "@id",
        "@id": "toot:fingerprintKey",
      },
      "identityKey": {
        "@type": "@id",
        "@id": "toot:identityKey",
      },
      "devices": {
        "@type": "@id",
        "@id": "toot:devices",
      },
      "messageFranking": "toot:messageFranking",
      "messageType": "toot:messageType",
      "cipherText": "toot:cipherText",
      "suspended": "toot:suspended",
      "memorial": "toot:memorial",
      "indexable": "toot:indexable",
      "Hashtag": "as:Hashtag",
      "focalPoint": {
        "@container": "@list",
        "@id": "toot:focalPoint",
      },
    },
  ],
  "id": "https://fosstodon.org/users/hongminhee",
  "type": "Person",
  "following": "https://fosstodon.org/users/hongminhee/following",
  "followers": "https://fosstodon.org/users/hongminhee/followers",
  "inbox": "https://fosstodon.org/users/hongminhee/inbox",
  "outbox": "https://fosstodon.org/users/hongminhee/outbox",
  "featured": "https://fosstodon.org/users/hongminhee/collections/featured",
  "featuredTags": "https://fosstodon.org/users/hongminhee/collections/tags",
  "preferredUsername": "hongminhee",
  "name": "洪 民憙 (Hong Minhee)",
  "summary":
    '<p>An intersectionalist, feminist, and socialist guy living in Seoul (UTC+09:00).  Who&#39;s behind <span class="h-card" translate="no"><a href="https://hollo.social/@fedify" class="u-url mention">@<span>fedify</span></a></span> and <span class="h-card" translate="no"><a href="https://hollo.social/@hollo" class="u-url mention">@<span>hollo</span></a></span>.  Write some free software in <a href="https://fosstodon.org/tags/Haskell" class="mention hashtag" rel="tag">#<span>Haskell</span></a>, <a href="https://fosstodon.org/tags/Rust" class="mention hashtag" rel="tag">#<span>Rust</span></a>, <a href="https://fosstodon.org/tags/TypeScript" class="mention hashtag" rel="tag">#<span>TypeScript</span></a>, &amp; <a href="https://fosstodon.org/tags/Python" class="mention hashtag" rel="tag">#<span>Python</span></a>.  They/them.</p><p><a href="https://fosstodon.org/tags/%E5%9C%8B%E6%BC%A2%E6%96%87%E6%B7%B7%E7%94%A8" class="mention hashtag" rel="tag">#<span>國漢文混用</span></a> <a href="https://fosstodon.org/tags/%ED%95%9C%EA%B5%AD%EC%96%B4" class="mention hashtag" rel="tag">#<span>한국어</span></a> (<a href="https://fosstodon.org/tags/%E6%9C%9D%E9%AE%AE%E8%AA%9E" class="mention hashtag" rel="tag">#<span>朝鮮語</span></a>) <a href="https://fosstodon.org/tags/English" class="mention hashtag" rel="tag">#<span>English</span></a> <a href="https://fosstodon.org/tags/%E6%97%A5%E6%9C%AC%E8%AA%9E" class="mention hashtag" rel="tag">#<span>日本語</span></a></p>',
  "url": "https://fosstodon.org/@hongminhee",
  "manuallyApprovesFollowers": false,
  "discoverable": true,
  "indexable": true,
  "published": "2024-06-19T00:00:00Z",
  "memorial": false,
  "devices": "https://fosstodon.org/users/hongminhee/collections/devices",
  "alsoKnownAs": [
    "https://todon.eu/users/hongminhee",
    "https://mastodon.social/users/hongminhee",
  ],
  "publicKey": {
    "id": "https://fosstodon.org/users/hongminhee#main-key",
    "owner": "https://fosstodon.org/users/hongminhee",
    "publicKeyPem":
      "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArvxgF3bUeGeoat8MMKH2\nRsWrQGuaZ1VyZ5Eo55urrcii96TX47Xqznv7YHXSYf/W0b647wYWzkh1vb0jzfS+\nJ9sh1MmniiBSqb46FII6Ou7R/QJaBbSFKStdHlrlbTQZNzmUqE0y29mxxlP7Sqdd\nJjiPKrcQEMkG5TRNxwkR4pPSP0oj/4++aEApcM+qqk56bs5c3sHaQKMdh0qFtMAb\npcTpD9CooEDzeQoaxlsvNuWFu7WjDuLAdARFingfDfUy42d0OSW5yy9PhSmWdfYX\nrTzfB2aekQIAczbrxZ82PrSzB3pR0LDR4ZRu22nWsU57jyHjNdbwwTGRNrhRdBzK\nOwIDAQAB\n-----END PUBLIC KEY-----\n",
  },
  "tag": [
    {
      "type": "Hashtag",
      "href": "https://fosstodon.org/tags/haskell",
      "name": "#haskell",
    },
    {
      "type": "Hashtag",
      "href": "https://fosstodon.org/tags/python",
      "name": "#python",
    },
    {
      "type": "Hashtag",
      "href": "https://fosstodon.org/tags/rust",
      "name": "#rust",
    },
    {
      "type": "Hashtag",
      "href": "https://fosstodon.org/tags/english",
      "name": "#english",
    },
    {
      "type": "Hashtag",
      "href": "https://fosstodon.org/tags/%E6%97%A5%E6%9C%AC%E8%AA%9E",
      "name": "#日本語",
    },
    {
      "type": "Hashtag",
      "href": "https://fosstodon.org/tags/typescript",
      "name": "#typescript",
    },
    {
      "type": "Hashtag",
      "href": "https://fosstodon.org/tags/%ED%95%9C%EA%B5%AD%EC%96%B4",
      "name": "#한국어",
    },
    {
      "type": "Hashtag",
      "href":
        "https://fosstodon.org/tags/%E5%9C%8B%E6%BC%A2%E6%96%87%E6%B7%B7%E7%94%A8",
      "name": "#國漢文混用",
    },
    {
      "type": "Hashtag",
      "href": "https://fosstodon.org/tags/%E6%9C%9D%E9%AE%AE%E8%AA%9E",
      "name": "#朝鮮語",
    },
  ],
  "attachment": [
    {
      "type": "PropertyValue",
      "name": "Website",
      "value":
        '<a href="https://hongminhee.org/" target="_blank" rel="nofollow noopener noreferrer me" translate="no"><span class="invisible">https://</span><span class="">hongminhee.org/</span><span class="invisible"></span></a>',
    },
    {
      "type": "PropertyValue",
      "name": "GitHub",
      "value":
        '<a href="https://github.com/dahlia" target="_blank" rel="nofollow noopener noreferrer me" translate="no"><span class="invisible">https://</span><span class="">github.com/dahlia</span><span class="invisible"></span></a>',
    },
    {
      "type": "PropertyValue",
      "name": "Keyoxide",
      "value":
        '<a href="https://keyoxide.org/374B15AF323796A62AB1BCE3C429ECD57EED6CCA" target="_blank" rel="nofollow noopener noreferrer me" translate="no"><span class="invisible">https://</span><span class="ellipsis">keyoxide.org/374B15AF323796A62</span><span class="invisible">AB1BCE3C429ECD57EED6CCA</span></a>',
    },
    {
      "type": "PropertyValue",
      "name": "Matrix",
      "value":
        '<span class="h-card" translate="no"><a href="https://fosstodon.org/@hongminhee" class="u-url mention">@<span>hongminhee</span></a></span>:matrix.org',
    },
  ],
  "endpoints": {
    "sharedInbox": "https://fosstodon.org/inbox",
  },
  "icon": {
    "type": "Image",
    "mediaType": "image/jpeg",
    "url":
      "https://cdn.fosstodon.org/accounts/avatars/112/643/523/844/583/361/original/de4e086cad8412c6.jpg",
  },
  "image": {
    "type": "Image",
    "mediaType": "image/jpeg",
    "url":
      "https://cdn.fosstodon.org/accounts/headers/112/643/523/844/583/361/original/d7fd4c4f9e73502f.jpg",
  },
};

Deno.bench("Object.toJsonLd()", async (b) => {
  const object = await Object.fromJsonLd(jsonLd);

  b.start();
  await object.toJsonLd();
  b.end();
});

const person = await Object.fromJsonLd(jsonLd);
const people: Object[] = [];
for (let i = 0; i < 2500; i++) people.push(person);

Deno.bench("Collection.toJsonLd()", async (b) => {
  const collection = new Collection({ items: people });

  b.start();
  await collection.toJsonLd();
  b.end();
});
