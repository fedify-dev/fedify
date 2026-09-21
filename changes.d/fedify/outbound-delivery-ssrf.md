 -  Fixed an SSRF vulnerability in outbound activity delivery that allowed inbox
    URLs and redirects to target private network addresses.  Delivery now checks
    each destination unless `allowPrivateAddress` is explicitly enabled for
    local testing.  [[GHSA-f59r-8gcj-68f2]]

[GHSA-f59r-8gcj-68f2]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-f59r-8gcj-68f2
