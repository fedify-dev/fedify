 -  Limited each outgoing activity delivery attempt to 30 seconds, including
    redirects and HTTP signature retries, so a slow remote inbox cannot hold a
    delivery worker indefinitely.  Timed-out attempts follow the configured
    retry schedule.  [[GHSA-fq5h-gjhp-g75x]]

[GHSA-fq5h-gjhp-g75x]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-fq5h-gjhp-g75x
