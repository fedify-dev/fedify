 -  Fixed unbounded reads of remote JSON-LD and HTML documents that could
    exhaust memory.  JSON responses are now limited to 16 MiB after
    decompression; HTML discovery is limited to 1 MiB.  [[GHSA-mc44-6cfg-2v6w]]

[GHSA-mc44-6cfg-2v6w]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-mc44-6cfg-2v6w
