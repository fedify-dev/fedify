---
links:
  '#810': https://github.com/fedify-dev/fedify/issues/810
  '#912': https://github.com/fedify-dev/fedify/issues/912
  '#913': https://github.com/fedify-dev/fedify/pull/913
  '#914': https://github.com/fedify-dev/fedify/pull/914
---
 -  Added the [FEP-7aa9] JSON-LD context to the preloaded context registry so
    FEP-7aa9 documents can be compacted and expanded without fetching the
    context remotely.
    [[#810], [#914]]

 -  Changed `getDocumentLoader()` to reject HTML and XHTML responses that do
    not advertise an ActivityPub alternate document with a `FetchError`
    instead of attempting to parse the HTML as JSON.  This makes remote HTML
    error pages surface as document loading failures with the response URL and
    content type, rather than generic JSON parser crashes.
    [[#912], [#913]]

[FEP-7aa9]: https://w3id.org/fep/7aa9
