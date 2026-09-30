---
links:
  '#1131': https://github.com/fedify-dev/fedify/issues/1131
  '#1169': https://github.com/fedify-dev/fedify/pull/1169
---
 -  Changed the built-in document loader, context loader, and authenticated
    document loader to time out each call after 10 seconds by default.
    Previously, a remote server that responded slowly or never could hold
    a request for as long as the runtime and the network allowed, e.g.,
    an incoming activity whose signature key Fedify fetched, and the sender
    picks such key URLs.  The time limit covers the whole call, including
    every redirect and alternate document it follows, double-knocking
    retries, and reading the response body.  A call that times out throws
    a `FetchError` without a response, whose `cause` is a `DOMException`
    named `"TimeoutError"`, so a key fetch that times out is reported as
    a `keyFetchError` by `verifyRequestDetailed()` and is cached like other
    failures to fetch a key.  Custom document loaders are not affected.
    [[#1131], [#1169]]

     -  Added `FederationOptions.documentLoaderTimeout` option to change
        the time limit, or to turn it off with `null`.

     -  Added the `timeout` option to `getAuthenticatedDocumentLoader()`.

 -  Changed the built-in document loaders to read the body of an error
    response before they throw a `FetchError`, at most 1 MiB, so that
    the time limit also bounds reading it.  `FetchError.response` keeps
    the body byte for byte, or only the status and headers if the body is
    larger than that.  [[#1131], [#1169]]
