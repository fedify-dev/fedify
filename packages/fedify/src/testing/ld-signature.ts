// Fixed RsaSignature2017 vector generated independently with rsaPrivateKey3.
// Canonicalize the options { "@context": "https://w3id.org/identity/v1",
// creator: "https://example.com/person2#key3" } and the document below without
// its signature, using jsonld.canonize's defaults, application/n-quads, and
// mockDocumentLoader. Concatenate their SHA-256 hex hashes (options first),
// UTF-8 encode, then sign with RSASSA-PKCS1-v1_5 and base64 encode the result.
// No created value was included in the signed options.
export const ldSignatureWithoutCreated = {
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    "https://w3id.org/security/v1",
  ],
  "id": "https://example.com/activities/1",
  "type": "Create",
  "actor": "https://example.com/person2",
  "object": {
    "id": "https://example.com/notes/1",
    "type": "Note",
    "attributedTo": "https://example.com/person2",
    "content": "hi",
  },
  "signature": {
    "type": "RsaSignature2017",
    "creator": "https://example.com/person2#key3",
    "signatureValue":
      "xUGTqQ94q+3bhvorwJx42sa7nCuR2ggtJYjwhqsueMCOLEmTEpeGGhG4mRKjFDt/ZegE9Icbxau6YL6WeQxWLMwYs7vucAE6948UlDFn1l3M+papmwgbNpOnk/baj9NMzChtqwOIQ1ka5bJAZjTo5FgG1YBmMibTHb6GN5ULzxjTlch93tcBx/LVwdPU1MyYHHz55hiMQZkw9AZ521PebCrm8eUjsXHwjijeh7/GIFWW3bmwk1dHRxJbUmmQlxBxmaLXQ8aVkFN3R00FBUjnn54Bp+nQJI/VXcKs3nFYGZ9EsMQcXlYCbOuOfPAPWiqdLSOhDZtuisIcZcvOiZ/tgA5RlXro0AXv0f3gKpkoxPBsUIIM0gBeb6+MTbSAk6IqPf0qy81V0XEjEMKSZNGDeULH+zMFodtw07EmfR/y/3i9ge3htd7vQQ0XKLLUfBddzMqS+8AAuSl4ObAlWAM2xuw/4yuQ3AIQy9RtsiEjDSO1NtUK5wRXCeXo++CkVpODDdxNtWdZD6GzfX9PAuIfHlWE+CLDaY/iH4fWxumLu15dD9vVDjlYAAS/ZNOyiPSCh4mLZ65sKIp8UkPstYRBKcjiRJhKUh1Br8TvTt/j/iC9SnFw/8uiCkLYd6yhdgXQafocPIa6eeb4m/EhF1HY0v+6qKR5JOBT6mTA/BPRmWg=",
  },
};
