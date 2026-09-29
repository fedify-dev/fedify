---
links:
  '#1131': https://github.com/fedify-dev/fedify/issues/1131
  '#1169': https://github.com/fedify-dev/fedify/pull/1169
---
 -  Changed `getDocumentLoader()` to time out each call after 10 seconds by
    default.  The time limit covers the whole call, including every redirect
    and alternate document it follows and reading the response body.
    A call that times out throws a `FetchError` without a response, whose
    `cause` is a `DOMException` named `"TimeoutError"`.  An `AbortSignal`
    passed as the `signal` option still cancels a call as before.
    [[#1131], [#1169]]

     -  Added `DocumentLoaderFactoryOptions.timeout` option, in milliseconds,
        to change the time limit, or to turn it off with `null`.

 -  Changed `getDocumentLoader()` to read the body of an error response
    before it throws a `FetchError`, at most 1 MiB, so that the time limit
    also bounds reading it.  `FetchError.response` keeps the body byte for
    byte, or only the status and headers if the body is larger than that.
    [[#1131], [#1169]]
