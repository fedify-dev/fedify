 -  Added `UrlError.reason` to distinguish DNS resolution failures (`"dns"`)
    from disallowed URLs (`"disallowed"`) without inspecting error messages
    or `cause`.  Existing constructor calls default to `"disallowed"`.
    [[#1055] by Jiwon Kwon]

[#1055]: https://github.com/fedify-dev/fedify/issues/1055
