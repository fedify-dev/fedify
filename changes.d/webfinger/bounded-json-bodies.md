 -  Fixed unbounded reads of WebFinger descriptors that could exhaust memory.
    Responses are now limited to 16 MiB after decompression; oversized
    responses return `null`.  [[GHSA-mc44-6cfg-2v6w]]

[GHSA-mc44-6cfg-2v6w]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-mc44-6cfg-2v6w
