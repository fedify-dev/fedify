---
links:
  '#1080': https://github.com/fedify-dev/fedify/pull/1080
  '#288': https://github.com/fedify-dev/fedify/issues/288
  '#838': https://github.com/fedify-dev/fedify/issues/838
---
 -  Added serving of resources addressed by [FEP-ef61] hashlinks, such as
    media attached to portable objects, through the gateway endpoint, e.g.,
    `GET /.well-known/apgateway/hl:zQmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n`.
    Register a dispatcher with the new
    `Federatable.setHashlinkMediaDispatcher()` method; it receives the parsed
    hashlink and its SHA-256 digest as a `HashlinkMediaRequest` object and
    returns a `Response`, which Fedify sends as is so that it can be streamed,
    or `null` for `404 Not Found`.  Fedify responds with `400 Bad Request` to
    malformed hashlinks without calling the dispatcher, and does not verify the
    response body, so the dispatcher must serve only the resource whose bytes
    hash to the requested digest.  Applications that do not register the
    dispatcher are unaffected.  [[#288], [#838]]

 -  Added `hashlink_media` to the values of the `fedify.endpoint` metric
    attribute, used for requests to the hashlink media endpoint.
    [[#288], [#838], [#1080]]

[FEP-ef61]: https://w3id.org/fep/ef61
