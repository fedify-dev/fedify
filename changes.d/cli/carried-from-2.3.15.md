 -  Fixed `fedify nodeinfo` fetching remote page and favicon URLs that lead to
    private network addresses.  The command now skips the favicon when the
    page, icon, or a redirect points to a private address, while still showing
    the NodeInfo document.  Upgrade `@fedify/cli` to protect the machine
    running the command.  Reported by Zachariah Mithani.
    [[GHSA-cj5r-cw77-6gwp]]

[GHSA-cj5r-cw77-6gwp]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-cj5r-cw77-6gwp
