 -  Fixed DNS rebinding bypassing the SSRF protection on Node.js and Bun.
    Deno requires a separate deployment mitigation, described below, and
    remains vulnerable without it.  `getAuthenticatedDocumentLoader()`,
    outbound activity delivery (`sendActivity()`), and the NodeInfo client
    (`getNodeInfo()`) resolved a hostname once to check that it was public,
    and then let `fetch()` resolve it again to connect, so a hostname
    answering with a public address for the check and a private one for
    the connection could reach internal services.  On Node.js and Bun,
    connections are now made only to the addresses that passed the check.
    Bun deployments that set the `HTTP_PROXY`, `HTTPS_PROXY`, or `ALL_PROXY`
    environment variables should use Bun 1.4.3 or later, since earlier
    versions ignore the option to connect directly and send the requests
    through the proxy; see [*Bun behind an HTTP proxy*] for mitigations.
    On Bun versions before 1.3.11, requests to HTTPS servers on non-default
    ports now fail, since those versions cannot verify the certificate of
    a pinned connection against the original hostname; see
    [*HTTPS servers on non-default ports with Bun*].  [[GHSA-r48c-xx2h-fv4g]]
 -  On Deno, `fetch()` offers no way to choose the addresses it connects to,
    so Fedify cannot close the gap above.  Run Deno 2.8.1 or later with
    `--deny-net` listing private IPv4 ranges, and listen on a Unix domain
    socket or on `[::]`.  IPv6 private ranges cannot be listed in
    `--deny-net` and need to be blocked at the network layer.  See
    [*Restricting outbound connections on Deno*] for details.  For new and
    long-lived deployments, we recommend Node.js or Bun instead of Deno,
    since the Deno team has announced that it will end its development of
    the Deno runtime after a year of bug-fix and security releases.
    [[GHSA-r48c-xx2h-fv4g]]

[*Bun behind an HTTP proxy*]: https://fedify.dev/manual/deploy#bun-behind-an-http-proxy
[*HTTPS servers on non-default ports with Bun*]: https://fedify.dev/manual/deploy#https-servers-on-non-default-ports-with-bun
[GHSA-r48c-xx2h-fv4g]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-r48c-xx2h-fv4g
[*Restricting outbound connections on Deno*]: https://fedify.dev/manual/deploy#restricting-outbound-connections-on-deno
