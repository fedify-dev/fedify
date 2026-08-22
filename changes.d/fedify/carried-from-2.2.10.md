---
links:
  '#963': https://github.com/fedify-dev/fedify/issues/963
  '#980': https://github.com/fedify-dev/fedify/pull/980
---
 -  Fixed a server-side request forgery (SSRF) vulnerability in authenticated
    document loaders, where an otherwise public document URL could redirect a
    signed request to a loopback, link-local, or private address.  Redirect
    targets are now validated before they are fetched, while the explicit
    `allowPrivateAddress` option continues to permit private addresses.
    [[CVE-2026-77632] by Jace\]
 -  Standalone key documents whose `id` differs from the requested key URL are
    now rejected instead of being cached under the wrong URL.
    [[#963], [#980] by Junseok Oh\]

[CVE-2026-77632]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-cxc3-7q96-6cpx
