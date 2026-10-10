 -  Fixed `getDocumentLoader()` skipping URL scheme validation when
    `allowPrivateAddress` was enabled.  Unsupported schemes are now rejected
    before fetching, including redirect and alternate document targets.
    [[#1291], [#1292]]
