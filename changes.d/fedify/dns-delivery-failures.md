---
links:
  '#1055': https://github.com/fedify-dev/fedify/issues/1055
  '#1060': https://github.com/fedify-dev/fedify/pull/1060
---
 -  Fixed outbound delivery raising `UrlError` instead of `FetchError` when
    resolving an inbox or redirect hostname fails or returns no usable IP
    addresses.  Applications can now distinguish these network failures from
    disallowed destinations; the original error is preserved in `cause`.
    [[#1055], [#1060] by Jiwon Kwon]
