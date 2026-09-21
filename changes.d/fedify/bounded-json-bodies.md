 -  Fixed unbounded reads of authenticated documents, NodeInfo responses, and
    inbox bodies that could exhaust memory.  JSON bodies are now limited to 16
    MiB.  Oversized inbox requests receive HTTP 413.  [[GHSA-mc44-6cfg-2v6w]]

[GHSA-mc44-6cfg-2v6w]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-mc44-6cfg-2v6w
