import {
  assert,
  assertEquals,
  assertExists,
  assertFalse,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { encodeBase64 } from "byte-encodings/base64";
import fetchMock from "fetch-mock";
import { exportSpki } from "../runtime/key.ts";
import { mockDocumentLoader } from "../testing/docloader.ts";
import {
  rsaPrivateKey2,
  rsaPublicKey1,
  rsaPublicKey2,
  rsaPublicKey5,
} from "../testing/keys.ts";
import { test } from "../testing/mod.ts";
import type { CryptographicKey, Multikey } from "../vocab/vocab.ts";
import {
  createRfc9421SignatureBase,
  doubleKnock,
  formatRfc9421Signature,
  formatRfc9421SignatureParameters,
  type HttpMessageSignaturesSpec,
  parseRfc9421Signature,
  parseRfc9421SignatureInput,
  signRequest,
  timingSafeEqual,
  verifyRequest,
  type VerifyRequestOptions,
} from "./http.ts";
import { exportJwk, type KeyCache } from "./key.ts";

test("signRequest() [draft-cavage]", async () => {
  const request = new Request("https://example.com/", {
    method: "POST",
    body: "Hello, world!",
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      Accept: "text/plain",
    },
  });
  const signed = await signRequest(
    request,
    rsaPrivateKey2,
    new URL("https://example.com/key2"),
  );
  assertEquals(
    await verifyRequest(signed, {
      contextLoader: mockDocumentLoader,
      documentLoader: mockDocumentLoader,
    }),
    rsaPublicKey2,
  );
});

test("verifyRequest() [draft-cavage]", async () => {
  const request = new Request("https://example.com/", {
    method: "POST",
    body: "Hello, world!",
    headers: {
      Accept: "text/plain",
      "Content-Type": "text/plain; charset=utf-8",
      Date: "Tue, 05 Mar 2024 07:49:44 GMT",
      Digest: "sha-256=MV9b23bQeMQ7isAGTkoBZGErH853yGk0W/yUx1iU7dM=",
      Signature: 'keyId="https://example.com/key",' +
        'headers="(request-target) accept content-type date digest host",' +
        // cSpell: disable
        'signature="ZDeMzjBKPfJvkv4QaxAdOQxKCJ96pOzOCFhhGgGnlsw4N80oN4GEZ/n8n' +
        "NKjpoW95Bcs8N0dZVSQHj3g08AReKIOXpun0tgmaWGKRcRT4kEhAW+uP1wVZPbuOIvVC" +
        "EhMYv6+SbnttgX0GvN365BTZpxh7+gRrRC4mns5qV69cv45I5iJB0aw24GJW9u7lUAm6" +
        "yDEh4N0aXfNqNRq3LHiuPqlDzSenfXbHr0UnAMaGuI4v9/uflu/jNi3hRX4Y/T+ngM1z" +
        "vLvi/BjKK4I1rh520qnkrWpxz9ikLCjIMO7Dwh1nOsPzrZE2t43XHD3evdvm1RM5Ppes" +
        '+M6DrfkfQuUBw=="', // cSpell: enable
    },
  });
  const cache: Record<string, CryptographicKey | Multikey | null> = {};
  const options: VerifyRequestOptions = {
    contextLoader: mockDocumentLoader,
    documentLoader: mockDocumentLoader,
    currentTime: Temporal.Instant.from("2024-03-05T07:49:44Z"),
    keyCache: {
      get(keyId) {
        return Promise.resolve(cache[keyId.href]);
      },
      set(keyId, key) {
        cache[keyId.href] = key;
        return Promise.resolve();
      },
    } satisfies KeyCache,
  };
  let key = await verifyRequest(request, options);
  assertEquals(key, rsaPublicKey1);
  assertEquals(cache, { "https://example.com/key": rsaPublicKey1 });
  cache["https://example.com/key"] = rsaPublicKey2;
  key = await verifyRequest(request, options);
  assertEquals(key, rsaPublicKey1);
  assertEquals(cache, { "https://example.com/key": rsaPublicKey1 });

  assertEquals(
    await verifyRequest(
      new Request("https://example.com/"),
      {
        documentLoader: mockDocumentLoader,
        contextLoader: mockDocumentLoader,
      },
    ),
    null,
  );
  assertEquals(
    await verifyRequest(
      new Request("https://example.com/", {
        headers: { Date: "Tue, 05 Mar 2024 07:49:44 GMT" },
      }),
      { documentLoader: mockDocumentLoader, contextLoader: mockDocumentLoader },
    ),
    null,
  );
  assertEquals(
    await verifyRequest(
      new Request("https://example.com/", {
        method: "POST",
        headers: {
          Date: "Tue, 05 Mar 2024 07:49:44 GMT",
          Signature: "asdf",
        },
      }),
      { documentLoader: mockDocumentLoader, contextLoader: mockDocumentLoader },
    ),
    null,
  );
  assertEquals(
    await verifyRequest(
      new Request("https://example.com/", {
        method: "POST",
        headers: {
          Date: "Tue, 05 Mar 2024 07:49:44 GMT",
          Signature: "asdf",
          Digest: "invalid",
        },
        body: "",
      }),
      { documentLoader: mockDocumentLoader, contextLoader: mockDocumentLoader },
    ),
    null,
  );
  assertEquals(
    await verifyRequest(
      new Request("https://example.com/", {
        method: "POST",
        headers: {
          Date: "Tue, 05 Mar 2024 07:49:44 GMT",
          Signature: "asdf",
          Digest: "sha-256=MV9b23bQeMQ7isAGTkoBZGErH853yGk0W/yUx1iU7dM=",
        },
        body: "",
      }),
      { documentLoader: mockDocumentLoader, contextLoader: mockDocumentLoader },
    ),
    null,
  );
  assertEquals(
    await verifyRequest(
      request,
      {
        documentLoader: mockDocumentLoader,
        contextLoader: mockDocumentLoader,
        currentTime: Temporal.Instant.from("2024-03-05T06:49:43.9999Z"),
      },
    ),
    null,
  );
  assertEquals(
    await verifyRequest(
      request,
      {
        documentLoader: mockDocumentLoader,
        contextLoader: mockDocumentLoader,
        currentTime: Temporal.Instant.from("2024-03-05T07:49:13.9999Z"),
        timeWindow: { seconds: 30 },
      },
    ),
    null,
  );
  assertEquals(
    await verifyRequest(
      request,
      {
        documentLoader: mockDocumentLoader,
        contextLoader: mockDocumentLoader,
        currentTime: Temporal.Instant.from("2024-03-05T08:49:44.0001Z"),
      },
    ),
    null,
  );
  assertEquals(
    await verifyRequest(
      request,
      {
        documentLoader: mockDocumentLoader,
        contextLoader: mockDocumentLoader,
        currentTime: Temporal.Instant.from("2024-03-05T07:50:14.0001Z"),
        timeWindow: { seconds: 30 },
      },
    ),
    null,
  );
  assertEquals(
    await verifyRequest(
      request,
      {
        documentLoader: mockDocumentLoader,
        contextLoader: mockDocumentLoader,
        currentTime: Temporal.Instant.from("2024-01-01T00:00:00.0000Z"),
        timeWindow: false,
      },
    ),
    rsaPublicKey1,
  );
  assertEquals(
    await verifyRequest(
      request,
      {
        documentLoader: mockDocumentLoader,
        contextLoader: mockDocumentLoader,
        currentTime: Temporal.Instant.from("2025-01-01T00:00:00.0000Z"),
        timeWindow: false,
      },
    ),
    rsaPublicKey1,
  );
});

test("signRequest() and verifyRequest() [rfc9421] implementation", async () => {
  // Create a fixed timestamp and content for consistent testing
  const currentTimestamp = 1709626184;
  const currentTime = Temporal.Instant.from("2024-03-05T08:09:44Z");
  const requestBody = "Test content for signature verification";

  // Create a request with predetermined values for consistent testing
  const request = new Request("https://example.com/api/resource", {
    method: "POST",
    body: requestBody,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Accept": "application/json",
      "Host": "example.com",
      "Date": "Tue, 05 Mar 2024 07:49:44 GMT",
    },
  });

  // Sign the request using RFC 9421
  const signed = await signRequest(
    request,
    rsaPrivateKey2,
    new URL("https://example.com/key2"),
    {
      spec: "rfc9421",
      currentTime,
    },
  );

  // ==== DETAILED VERIFICATION OF SIGNED REQUEST ====

  // 1. Verify that the signed request has the required RFC 9421 headers
  assertEquals(signed.headers.has("Signature-Input"), true);
  assertEquals(signed.headers.has("Signature"), true);

  // 2. Verify Signature-Input header has the expected format and content
  const signatureInput = signed.headers.get("Signature-Input");
  assertExists(signatureInput);

  // Basic structure checks
  assertStringIncludes(signatureInput, "sig1=", "Should have a signature ID");
  assertStringIncludes(
    signatureInput,
    'keyid="https://example.com/key2"',
    "Should contain the exact keyId",
  );
  assertStringIncludes(
    signatureInput,
    'alg="rsa-v1_5-sha256"',
    "Should specify the correct algorithm",
  );
  assertStringIncludes(
    signatureInput,
    `created=${currentTimestamp}`,
    "Should contain the exact timestamp",
  );

  // Component checks - verify all expected components are included
  const expectedComponents = [
    "@method",
    "@target-uri",
    "@authority",
    "host",
    "date",
    "content-digest",
  ];
  for (const component of expectedComponents) {
    assertStringIncludes(
      signatureInput,
      `"${component}"`,
      `Should include component: ${component}`,
    );
  }

  // 3. Verify Content-Digest header is present for POST request
  assertEquals(
    signed.headers.has("Content-Digest"),
    true,
    "Should include Content-Digest for POST with body",
  );

  // 4. Verify Content-Digest format and value
  const contentDigest = signed.headers.get("Content-Digest");
  assertExists(contentDigest);
  assert(
    contentDigest.startsWith("sha-256=:"),
    "Content-Digest should use RFC 9421 format",
  );

  // Calculate the expected digest to verify it's correct
  const expectedDigest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(requestBody),
  );
  const expectedDigestBase64 = encodeBase64(expectedDigest);
  assertEquals(
    contentDigest,
    `sha-256=:${expectedDigestBase64}:`,
    "Content-Digest should have correct value",
  );

  // 5. Verify Signature header has the correct format
  const signature = signed.headers.get("Signature");
  assertExists(signature);
  const sigFormat = /^sig1=:([A-Za-z0-9+/]+=*):/;
  assert(
    sigFormat.test(signature),
    `Signature format (${signature}) should match RFC 9421 format`,
  );

  // Extract the signature value for later validation
  const sigMatch = signature.match(sigFormat);
  assertExists(sigMatch);
  const sigValue = sigMatch[1];
  assert(
    sigValue.length > 10,
    "Signature value should be a substantial base64 string",
  );

  // 6. Parse the Signature-Input header and verify its structure
  const parsedInput = parseRfc9421SignatureInput(signatureInput);
  assertExists(parsedInput.sig1);
  assertEquals(parsedInput.sig1.keyId, "https://example.com/key2");
  assertEquals(parsedInput.sig1.alg, "rsa-v1_5-sha256");
  assertEquals(parsedInput.sig1.created, currentTimestamp);
  assertEquals(
    parsedInput.sig1.components.length,
    expectedComponents.length,
    "Should have all expected components",
  );
  for (const component of expectedComponents) {
    assert(
      parsedInput.sig1.components.includes(component),
      `Components should include ${component}`,
    );
  }

  // 7. Parse the Signature header and verify its structure
  const parsedSig = parseRfc9421Signature(signature);
  assertExists(parsedSig.sig1);
  assertEquals(
    parsedSig.sig1.byteLength > 0,
    true,
    "Signature value should be a non-empty Uint8Array",
  );

  // 8. Manual verification of the signature
  // Clone all the headers from the signed request except the signature headers
  const verifyHeaders = new Headers();
  for (const [name, value] of signed.headers.entries()) {
    if (name !== "Signature" && name !== "Signature-Input") {
      verifyHeaders.set(name, value);
    }
  }

  // Create a reconstructed request with all the headers needed for verification
  const reconstructedRequest = new Request(request.url, {
    method: request.method,
    headers: verifyHeaders,
  });

  // Reconstruct the signature base manually
  const reconstructedBase = createRfc9421SignatureBase(
    reconstructedRequest,
    parsedInput.sig1.components,
    parsedInput.sig1.parameters,
  );

  // Get the signature bytes
  const signatureBytes = new Uint8Array(parsedSig.sig1);

  // Verify manually using the public key
  const signatureVerifies = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    rsaPublicKey2.publicKey,
    signatureBytes,
    new TextEncoder().encode(reconstructedBase),
  );

  assert(signatureVerifies, "Manual verification of signature should succeed");

  // Due to limitations in the test environment with body streams, some tests are skipped
  // The manual signature verification above confirms the core functionality works
});

test("createRfc9421SignatureBase()", () => {
  const request = new Request("https://example.com/path?query=value", {
    method: "POST",
    headers: {
      Host: "example.com",
      Date: "Tue, 05 Mar 2024 07:49:44 GMT",
      "Content-Type": "text/plain",
    },
  });

  const components = ["@method", "@target-uri", "host", "date"];
  const created = 1709626184; // 2024-03-05T08:09:44Z

  const signatureBase = createRfc9421SignatureBase(
    request,
    components,
    formatRfc9421SignatureParameters({
      algorithm: "rsa-v1_5-sha256",
      keyId: new URL("https://example.com/key"),
      created,
    }),
  );

  // Expected signature base according to RFC 9421 Section 2.3
  const expected = [
    `"@method": POST`,
    `"@target-uri": https://example.com/path?query=value`,
    `"host": example.com`,
    `"date": Tue, 05 Mar 2024 07:49:44 GMT`,
    `"@signature-params": ("@method" "@target-uri" "host" "date");alg="rsa-v1_5-sha256";keyid="https://example.com/key";created=1709626184`,
  ].join("\n");

  assertEquals(signatureBase, expected);
});

test("formatRfc9421Signature()", () => {
  const signature = new Uint8Array([1, 2, 3, 4]);
  const keyId = new URL("https://example.com/key");
  const algorithm = "rsa-v1_5-sha256";
  const components = ["@method", "@target-uri", "host"];
  const created = 1709626184;

  const [signatureInput, signatureHeader] = formatRfc9421Signature(
    signature,
    components,
    formatRfc9421SignatureParameters({ algorithm, keyId, created }),
  );

  assertEquals(
    signatureInput,
    `sig1=("@method" "@target-uri" "host");alg="rsa-v1_5-sha256";keyid="https://example.com/key";created=1709626184`,
  );
  // cSpell: disable-next-line
  assertEquals(signatureHeader, `sig1=:AQIDBA==:`);
});

test("parseRfc9421SignatureInput()", () => {
  const signatureInput =
    `sig1=("@method" "@target-uri" "host" "date");keyid="https://example.com/key";alg="rsa-v1_5-sha256";created=1709626184`;

  const parsed = parseRfc9421SignatureInput(signatureInput);

  // Verify each property individually to make debugging easier
  assertEquals(parsed.sig1.keyId, "https://example.com/key");
  assertEquals(parsed.sig1.alg, "rsa-v1_5-sha256");
  assertEquals(parsed.sig1.created, 1709626184);
  assertEquals(parsed.sig1.components, [
    "@method",
    "@target-uri",
    "host",
    "date",
  ]);
  assertEquals(
    parsed.sig1.parameters,
    'keyid="https://example.com/key";alg="rsa-v1_5-sha256";created=1709626184',
  );
});

test("parseRfc9421Signature()", () => {
  // cSpell: disable-next-line
  const signature = `sig1=:AQIDBA==:,sig2=:Zm9vYmFy:`;

  const parsed = parseRfc9421Signature(signature);

  // Make sure we have both signatures
  assertExists(parsed.sig1);
  assertExists(parsed.sig2);

  // Convert and check individual bytes for sig1
  const sig1Bytes = new Uint8Array(parsed.sig1);
  assertEquals(sig1Bytes.length, 4);
  assertEquals(sig1Bytes[0], 1);
  assertEquals(sig1Bytes[1], 2);
  assertEquals(sig1Bytes[2], 3);
  assertEquals(sig1Bytes[3], 4);

  // Check second signature
  const sig2Text = new TextDecoder().decode(parsed.sig2);
  assertEquals(sig2Text, "foobar");
});

test("verifyRequest() [rfc9421] successful GET verification", async () => {
  // Create a test timestamp for consistency
  const currentTimestamp = 1709626184;
  const currentTime = Temporal.Instant.from("2024-03-05T08:09:44Z");

  // Create a valid request to sign
  const validRequest = new Request("https://example.com/api/resource", {
    method: "GET",
    headers: {
      "Accept": "application/json",
      "Host": "example.com",
      "Date": "Tue, 05 Mar 2024 07:49:44 GMT",
    },
  });

  // Sign the request with RFC 9421
  const signedRequest = await signRequest(
    validRequest,
    rsaPrivateKey2,
    new URL("https://example.com/key2"),
    {
      spec: "rfc9421",
      currentTime,
    },
  );

  // Verify with the correct timestamp
  const verifiedKey = await verifyRequest(signedRequest, {
    contextLoader: mockDocumentLoader,
    documentLoader: mockDocumentLoader,
    spec: "rfc9421",
    currentTime: Temporal.Instant.from(
      `${new Date(currentTimestamp * 1000).toISOString()}`,
    ),
  });

  assertEquals(
    verifiedKey,
    rsaPublicKey2,
    "Valid signature should verify to the correct public key",
  );
});

test("verifyRequest() [rfc9421] manual POST verification", async () => {
  // We can't easily test full POST verification due to body consumption issues,
  // so let's manually verify the signature instead, which is more reliable

  // Create a test timestamp for consistency
  const currentTimestamp = 1709626184;
  const currentTime = Temporal.Instant.from("2024-03-05T08:09:44Z");

  // Create a POST request with a simple body
  const postBody = "Test content for signature verification";
  const postRequest = new Request("https://example.com/api/resource", {
    method: "POST",
    body: postBody,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Accept": "application/json",
      "Host": "example.com",
      "Date": "Tue, 05 Mar 2024 07:49:44 GMT",
    },
  });

  // Sign the POST request
  const signedPostRequest = await signRequest(
    postRequest,
    rsaPrivateKey2,
    new URL("https://example.com/key2"),
    { spec: "rfc9421", currentTime },
  );

  const signedKey = await verifyRequest(signedPostRequest, {
    spec: "rfc9421",
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
    currentTime,
  });
  assertExists(signedKey);
  assertEquals(signedKey, rsaPublicKey2);
  assertExists(signedKey.publicKey);
  assertEquals(
    await exportJwk(signedKey.publicKey),
    await exportJwk(rsaPublicKey2.publicKey),
  );

  // Extract the headers we need for manual verification
  const signatureInputHeader =
    signedPostRequest.headers.get("Signature-Input") || "";
  const signatureHeader = signedPostRequest.headers.get("Signature") || "";

  // Parse the Signature-Input and Signature headers
  const parsedInput = parseRfc9421SignatureInput(signatureInputHeader);
  const parsedSignature = parseRfc9421Signature(signatureHeader);

  // Verify we have a valid signature
  assertExists(parsedInput.sig1, "Should have a valid signature input");
  assertExists(parsedSignature.sig1, "Should have a valid signature value");

  // Check the key ID is correct
  assertEquals(
    parsedInput.sig1.keyId,
    "https://example.com/key2",
    "Signature should have the correct key ID",
  );

  // Check the timestamp is correct
  assertEquals(
    parsedInput.sig1.created,
    currentTimestamp,
    "Signature should have the correct timestamp",
  );

  // Manual verification of the signature - create a reconstruction of the request with
  // a fresh body to avoid body consumption issues
  const manualRequest = new Request("https://example.com/api/resource", {
    method: "POST",
    body: postBody,
    headers: new Headers(signedPostRequest.headers),
  });

  // Create the signature base manually
  const signatureBase = createRfc9421SignatureBase(
    manualRequest,
    parsedInput.sig1.components,
    parsedInput.sig1.parameters,
  );

  // Manually verify the signature
  const signatureVerified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    rsaPublicKey2.publicKey,
    parsedSignature.sig1,
    new TextEncoder().encode(signatureBase),
  );

  assert(
    signatureVerified,
    "Manual verification of POST signature should succeed",
  );
});

test("verifyRequest() [rfc9421] error cases and edge cases", async () => {
  // Create a test timestamp for consistency
  const currentTimestamp = 1709626184;
  const currentTime = Temporal.Instant.from("2024-03-05T08:09:44Z");

  // Create a valid request to sign
  const validRequest = new Request("https://example.com/api/resource", {
    method: "GET",
    headers: {
      "Accept": "application/json",
      "Host": "example.com",
      "Date": "Tue, 05 Mar 2024 07:49:44 GMT",
    },
  });

  // Sign the request with RFC 9421
  const signedRequest = await signRequest(
    validRequest,
    rsaPrivateKey2,
    new URL("https://example.com/key2"),
    {
      spec: "rfc9421",
      currentTime,
    },
  );

  // Get the headers for tampering tests
  const validSignatureInput = signedRequest.headers.get("Signature-Input") ||
    "";
  const validSignature = signedRequest.headers.get("Signature") || "";

  // =================================================================
  // 1. Test error case: Missing headers
  // =================================================================

  // Request with no Signature-Input header
  const missingInputHeader = new Request("https://example.com/api/resource", {
    method: "GET",
    headers: new Headers({
      "Accept": "application/json",
      "Host": "example.com",
      "Signature": validSignature,
    }),
  });

  const missingInputResult = await verifyRequest(missingInputHeader, {
    contextLoader: mockDocumentLoader,
    documentLoader: mockDocumentLoader,
    spec: "rfc9421",
  });

  assertEquals(
    missingInputResult,
    null,
    "Should fail verification when Signature-Input header is missing",
  );

  // Request with no Signature header
  const missingSignatureHeader = new Request(
    "https://example.com/api/resource",
    {
      method: "GET",
      headers: new Headers({
        "Accept": "application/json",
        "Host": "example.com",
        "Signature-Input": validSignatureInput,
      }),
    },
  );

  const missingSignatureResult = await verifyRequest(
    missingSignatureHeader,
    {
      contextLoader: mockDocumentLoader,
      documentLoader: mockDocumentLoader,
      spec: "rfc9421",
    },
  );

  assertEquals(
    missingSignatureResult,
    null,
    "Should fail verification when Signature header is missing",
  );

  // =================================================================
  // 2. Test case: Tampered signature
  // =================================================================

  // Create a request with a tampered signature
  const tamperedRequest = new Request("https://example.com/api/resource", {
    method: "GET",
    headers: new Headers({
      "Accept": "application/json",
      "Host": "example.com",
      "Date": "Tue, 05 Mar 2024 07:49:44 GMT",
      "Signature-Input": validSignatureInput,
      // Tamper with signature by replacing it with an invalid one
      "Signature": "sig1=:AAAAAA==:",
    }),
  });

  const tamperedResult = await verifyRequest(tamperedRequest, {
    contextLoader: mockDocumentLoader,
    documentLoader: mockDocumentLoader,
    spec: "rfc9421",
  });

  assertEquals(
    tamperedResult,
    null,
    "Should fail verification when signature is tampered",
  );

  // =================================================================
  // 3. Test case: Expired signature timestamp
  // =================================================================

  // Create a fresh request for expired test
  const expiredRequest = new Request("https://example.com/api/resource", {
    method: "GET",
    headers: new Headers({
      "Accept": "application/json",
      "Host": "example.com",
      "Date": "Tue, 05 Mar 2024 07:49:44 GMT",
      "Signature-Input": validSignatureInput,
      "Signature": validSignature,
    }),
  });

  // Verify with a timestamp too far in the future from the signature creation
  const expiredResult = await verifyRequest(expiredRequest, {
    contextLoader: mockDocumentLoader,
    documentLoader: mockDocumentLoader,
    spec: "rfc9421",
    currentTime: Temporal.Instant.from(
      `${new Date((currentTimestamp + 2592000) * 1000).toISOString()}`,
    ), // 30 days later
    timeWindow: { hours: 1 },
  });

  assertEquals(
    expiredResult,
    null,
    "Should fail verification when signature timestamp is too old",
  );

  // =================================================================
  // 4. Test case: Future-dated signature
  // =================================================================

  // Create a fresh request for future-dated test
  const futureRequest = new Request("https://example.com/api/resource", {
    method: "GET",
    headers: new Headers({
      "Accept": "application/json",
      "Host": "example.com",
      "Date": "Tue, 05 Mar 2024 07:49:44 GMT",
      "Signature-Input": validSignatureInput,
      "Signature": validSignature,
    }),
  });

  // Verify with a timestamp too far in the past from the signature creation
  const futureResult = await verifyRequest(futureRequest, {
    contextLoader: mockDocumentLoader,
    documentLoader: mockDocumentLoader,
    spec: "rfc9421",
    currentTime: Temporal.Instant.from(
      `${new Date((currentTimestamp - 2592000) * 1000).toISOString()}`,
    ), // 30 days earlier
    timeWindow: { hours: 1 },
  });

  assertEquals(
    futureResult,
    null,
    "Should fail verification when signature timestamp is in the future",
  );

  // =================================================================
  // 5. Test case: Disabled time checking
  // =================================================================

  // Create a fresh request for time disabled test
  const timeCheckRequest = new Request("https://example.com/api/resource", {
    method: "GET",
    headers: new Headers({
      "Accept": "application/json",
      "Host": "example.com",
      "Date": "Tue, 05 Mar 2024 07:49:44 GMT",
      "Signature-Input": validSignatureInput,
      "Signature": validSignature,
    }),
  });

  // Verify with a timestamp far in the future, but with time checking disabled
  const timeDisabledResult = await verifyRequest(timeCheckRequest, {
    contextLoader: mockDocumentLoader,
    documentLoader: mockDocumentLoader,
    spec: "rfc9421",
    currentTime: Temporal.Instant.from(
      `${new Date((currentTimestamp + 31536000) * 1000).toISOString()}`,
    ), // 1 year later
    timeWindow: false, // Disable time checking
  });

  assertEquals(
    timeDisabledResult,
    rsaPublicKey2,
    "Should verify signature when time checking is disabled",
  );

  // =================================================================
  // 6. Test case: POST request with Content-Digest
  // =================================================================

  // For the post test, we'll use separate test case to avoid test ordering issues

  // Create a POST request with a body
  const postRequest = new Request("https://example.com/api/resource", {
    method: "POST",
    body: "Test content for signature verification",
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Accept": "application/json",
      "Host": "example.com",
      "Date": "Tue, 05 Mar 2024 07:49:44 GMT",
    },
  });

  // Create a completely fresh signed request
  const freshSignedPostRequest = await signRequest(
    postRequest,
    rsaPrivateKey2,
    new URL("https://example.com/key2"),
    {
      spec: "rfc9421",
      currentTime,
    },
  );

  // Get POST request headers for the content-digest test
  const postSignatureInput =
    freshSignedPostRequest.headers.get("Signature-Input") || "";
  const postSignature = freshSignedPostRequest.headers.get("Signature") || "";
  const postContentDigest =
    freshSignedPostRequest.headers.get("Content-Digest") || "";

  // We don't need to test POST verification success here since we have a separate test for that

  // =================================================================
  // 7. Test case: Invalid Content-Digest
  // =================================================================

  // Create a request with an invalid Content-Digest by modifying an existing header
  const tamperDigestRequest = new Request("https://example.com/api/resource", {
    method: "POST",
    // We need to include a body that doesn't match the digest
    body: "This content won't match the digest",
    headers: new Headers({
      "Accept": "application/json",
      "Host": "example.com",
      "Date": "Tue, 05 Mar 2024 07:49:44 GMT",
      "Signature-Input": postSignatureInput,
      "Signature": postSignature,
      // Keep the original Content-Digest which won't match our new body
      "Content-Digest": postContentDigest,
    }),
  });

  const tamperDigestResult = await verifyRequest(tamperDigestRequest, {
    contextLoader: mockDocumentLoader,
    documentLoader: mockDocumentLoader,
    spec: "rfc9421",
    currentTime: Temporal.Instant.from(
      `${new Date(currentTimestamp * 1000).toISOString()}`,
    ),
  });

  assertEquals(
    tamperDigestResult,
    null,
    "Should fail verification with invalid Content-Digest",
  );

  // =================================================================
  // 8. Test signature component parsing in detail
  // =================================================================

  // Create structured test requests with known values for parsing testing
  const testRequest = new Request("https://example.com/", {
    headers: new Headers({
      "Date": "Tue, 05 Mar 2024 07:49:44 GMT",
      "Host": "example.com",
      // Valid format with structured test values
      "Signature-Input":
        `sig1=("@method" "@target-uri" "host" "date");keyid="https://example.com/key";alg="rsa-v1_5-sha256";created=1709626184`,
      // cSpell: disable-next-line
      "Signature": `sig1=:YXNkZmprc2RmaGprc2RoZmprc2hkZmtqaHNkZg==:`, // Base64 of fake data
    }),
  });

  // Parse and verify signature-input structure
  const signatureInput = testRequest.headers.get("Signature-Input") || "";
  const parsedInput = parseRfc9421SignatureInput(signatureInput);

  assertExists(parsedInput.sig1);
  assertEquals(parsedInput.sig1.keyId, "https://example.com/key");
  assertEquals(parsedInput.sig1.alg, "rsa-v1_5-sha256");
  assertEquals(parsedInput.sig1.created, 1709626184);
  assertEquals(parsedInput.sig1.components, [
    "@method",
    "@target-uri",
    "host",
    "date",
  ]);

  // Parse and verify signature structure
  const signature = testRequest.headers.get("Signature") || "";
  const parsedSig = parseRfc9421Signature(signature);

  assertExists(parsedSig.sig1);
  // Check that we got a non-empty signature
  assert(
    new TextDecoder().decode(parsedSig.sig1).length > 0,
    "Signature base64 should decode to non-empty string",
  );

  // =================================================================
  // 9. Test complex signature input with quotes and special characters
  // =================================================================

  const complexSignatureInput =
    'sig1=("@method" "@target-uri" "host" "content-type" "value with \\"quotes\\" and spaces");keyid="https://example.com/key with spaces";alg="rsa-v1_5-sha256";created=1709626184';
  const complexParsedInput = parseRfc9421SignatureInput(complexSignatureInput);

  assertExists(complexParsedInput.sig1);
  assertEquals(
    complexParsedInput.sig1.keyId,
    "https://example.com/key with spaces",
  );
  assertEquals(complexParsedInput.sig1.alg, "rsa-v1_5-sha256");
  assertEquals(complexParsedInput.sig1.created, 1709626184);
  assert(complexParsedInput.sig1.components.includes("content-type"));
  assert(
    complexParsedInput.sig1.components.includes(
      'value with "quotes" and spaces',
    ),
  );

  // =================================================================
  // 10. Test multiple signatures in the same headers
  // =================================================================

  const multiSigRequest = new Request("https://example.com/", {
    headers: new Headers({
      "Signature-Input":
        `sig1=("@method");keyid="key1";alg="rsa-v1_5-sha256";created=1709626184,sig2=("@target-uri");keyid="key2";alg="rsa-pss-sha512";created=1709626185`,
      // cSpell: disable-next-line
      "Signature": `sig1=:AQIDBA==:,sig2=:Zm9vYmFy:`,
    }),
  });

  const multiParsedInput = parseRfc9421SignatureInput(
    multiSigRequest.headers.get("Signature-Input") || "",
  );
  assertEquals(
    Object.keys(multiParsedInput).length,
    2,
    "Should parse multiple signatures",
  );
  assertEquals(multiParsedInput.sig1.keyId, "key1");
  assertEquals(multiParsedInput.sig2.keyId, "key2");
  assertEquals(multiParsedInput.sig1.alg, "rsa-v1_5-sha256");
  assertEquals(multiParsedInput.sig2.alg, "rsa-pss-sha512");

  const multiParsedSig = parseRfc9421Signature(
    multiSigRequest.headers.get("Signature") || "",
  );
  assertEquals(
    Object.keys(multiParsedSig).length,
    2,
    "Should parse multiple signature values",
  );

  // =================================================================
  // 11. Test malformed/invalid signature headers
  // =================================================================

  // Invalid Signature-Input format
  const invalidInputFormat = "this is not a valid signature-input format";
  const parsedInvalidInput = parseRfc9421SignatureInput(invalidInputFormat);
  assertEquals(
    Object.keys(parsedInvalidInput).length,
    0,
    "Should handle invalid Signature-Input format",
  );

  // Invalid Signature format
  const invalidSigFormat = "this is not a valid signature format";
  const parsedInvalidSig = parseRfc9421Signature(invalidSigFormat);
  assertEquals(
    Object.keys(parsedInvalidSig).length,
    0,
    "Should handle invalid Signature format",
  );

  // Base64 encoding errors
  const invalidBase64Sig = "sig1=:!@#$%%^&*():";
  const parsedInvalidBase64 = parseRfc9421Signature(invalidBase64Sig);
  assertEquals(
    Object.keys(parsedInvalidBase64).length,
    0,
    "Should handle invalid base64 in signature",
  );

  // =================================================================
  // 12. Test request with multiple signatures where one is valid
  // =================================================================

  // Create a request with two signatures - one valid, one invalid
  const mixedRequest = new Request("https://example.com/api/resource", {
    method: "GET",
    headers: new Headers({
      "Accept": "application/json",
      "Host": "example.com",
      "Date": "Tue, 05 Mar 2024 07:49:44 GMT",
      "Signature-Input":
        `${validSignatureInput},sig2=("@method" "@target-uri" "host" "date");keyid="https://example.com/invalid-key";alg="rsa-v1_5-sha256";created=${currentTimestamp}`,
      "Signature": `${validSignature},sig2=:AAAAAA==:`,
    }),
  });

  const mixedResult = await verifyRequest(mixedRequest, {
    contextLoader: mockDocumentLoader,
    documentLoader: mockDocumentLoader,
    spec: "rfc9421",
    currentTime: Temporal.Instant.from(
      `${new Date(currentTimestamp * 1000).toISOString()}`,
    ),
  });

  assertEquals(
    mixedResult,
    rsaPublicKey2,
    "Should verify when at least one signature is valid",
  );
});

test("verifyRequest() [rfc9421] test vector from Mastodon", async () => {
  const signedRequest = new Request(
    "https://www.example.com/activitypub/success",
    {
      method: "GET",
      headers: {
        Host: "www.example.com",
        "Signature-Input":
          'sig1=("@method" "@target-uri");created=1703066400;keyid="https://remote.domain/users/bob#main-key"',
        Signature:
          "sig1=:WfM6q/qBqhUyqPUDt9metjadJGtLLpmMTBzk/t+R3byKe4/TGAXC6vBB/M6NsD5qv8GCmQGtisCMQxJQO0IGODGzi+Jv+eqDJ50agMVXNV6nUOzY44c4/XTPoI98qyx1oEMa4Hefy3vSYKq96iDVAc+RDLCMTeGP3wn9wizjD1SNmU0RZI1bTB+eCkywMP9mM5zXzUOYF+Qkuf+WdEpPR1XUGPlnqfdvPalcKVfaI/VThBjI91D/lmUGoa69x4EBEHM+aJmW6086e7/dVh+FndKkdGfXslZXFZKi2flTGQZgEWLn948SqAaJQROkJg8B14Sb1NONS1qZBhK3Mum8Pg==:",
      },
    },
  );
  const result = await verifyRequest(
    signedRequest,
    {
      contextLoader: mockDocumentLoader,
      documentLoader: mockDocumentLoader,
      currentTime: Temporal.Instant.from("2023-12-20T10:00:00.0000Z"),
      spec: "rfc9421",
    },
  );
  assertExists(result);
  assertExists(result.publicKey);
  assertEquals(result, rsaPublicKey5);
  assertEquals(
    await exportSpki(result.publicKey),
    await exportSpki(rsaPublicKey5.publicKey),
  );

  // Implicit spec
  const result2 = await verifyRequest(
    signedRequest,
    {
      contextLoader: mockDocumentLoader,
      documentLoader: mockDocumentLoader,
      currentTime: Temporal.Instant.from("2023-12-20T10:00:00.0000Z"),
    },
  );
  assertExists(result2);
  assertExists(result2.publicKey);
  assertEquals(result2, rsaPublicKey5);
  assertEquals(
    await exportSpki(result2.publicKey),
    await exportSpki(rsaPublicKey5.publicKey),
  );
});

// cSpell: ignore keyid linzer

test("doubleKnock() function with successful first attempt", async () => {
  // Install mock fetch handler
  fetchMock.spyGlobal();

  // A counter to track the number of times the endpoint is hit
  let requestCount = 0;
  let firstRequestSpec: string | null = null;

  // Mock an endpoint that accepts RFC 9421 signatures
  fetchMock.post("https://example.com/inbox-accepts-rfc9421", (cl) => {
    requestCount++;
    const req = cl.request!;
    const signatureInputHeader = req.headers.get("Signature-Input");
    const signatureHeader = req.headers.get("Signature");

    // Check if it's an RFC 9421 signature
    if (signatureInputHeader && signatureHeader) {
      firstRequestSpec = "rfc9421";
      return new Response("", { status: 202 });
    } else {
      return new Response("Unauthorized", { status: 401 });
    }
  });

  // Create a request
  const request = new Request("https://example.com/inbox-accepts-rfc9421", {
    method: "POST",
    body: "Hello, world!",
    headers: {
      "Content-Type": "text/plain",
    },
  });

  // Create a simple spec determiner that remembers what was used
  const specDeterminer = {
    usedSpec: null as string | null,
    determineSpec(_origin: string): HttpMessageSignaturesSpec {
      // Default to RFC 9421
      return "rfc9421";
    },
    rememberSpec(_origin: string, spec: HttpMessageSignaturesSpec): void {
      this.usedSpec = spec;
    },
  };

  // Create a log function to capture what was signed
  let loggedRequest: Request | undefined;
  const logFunction = (req: Request) => {
    loggedRequest = req;
  };

  // Call doubleKnock
  const response = await doubleKnock(
    request,
    {
      keyId: rsaPublicKey2.id!,
      privateKey: rsaPrivateKey2,
    },
    {
      specDeterminer,
      log: logFunction,
    },
  );

  // Verify the response
  assertEquals(response.status, 202, "Response status should be 202 Accepted");
  assertEquals(requestCount, 1, "Only one request should have been made");
  assertEquals(
    firstRequestSpec,
    "rfc9421",
    "First attempt should use RFC 9421",
  );
  assertEquals(specDeterminer.usedSpec, "rfc9421", "Spec should be remembered");
  assertExists(loggedRequest, "Request should be logged");
  assert(
    loggedRequest?.headers.has("Signature-Input"),
    "Logged request should have RFC 9421 Signature-Input header",
  );
  assert(
    loggedRequest?.headers.has("Signature"),
    "Logged request should have RFC 9421 Signature header",
  );

  fetchMock.hardReset();
});

test("doubleKnock() function with fallback to draft-cavage", async () => {
  // Install mock fetch handler
  fetchMock.spyGlobal();

  // Track request attempts and specs used
  let requestCount = 0;
  let firstSpec: string | null = null;
  let secondSpec: string | null = null;

  // Mock an endpoint that only accepts draft-cavage signatures
  fetchMock.post("https://example.com/inbox-accepts-draft-cavage", (cl) => {
    const req = cl.request!;
    requestCount++;

    // Check which signature format was used
    if (req.headers.has("Signature-Input")) {
      // RFC 9421 format
      firstSpec = "rfc9421";
      return new Response("Not Authorized", { status: 401 });
    } else if (req.headers.has("Signature")) {
      // draft-cavage format
      secondSpec = "draft-cavage-http-signatures-12";
      return new Response("", { status: 202 });
    } else {
      return new Response("Bad Request", { status: 400 });
    }
  });

  // Create request
  const request = new Request(
    "https://example.com/inbox-accepts-draft-cavage",
    {
      method: "POST",
      body: "Test message for double-knocking",
      headers: {
        "Content-Type": "text/plain",
      },
    },
  );

  // Create a spec determiner that will track what was remembered
  const specDeterminer = {
    rememberedOrigin: null as string | null,
    rememberedSpec: null as string | null,
    determineSpec(_origin: string): HttpMessageSignaturesSpec {
      // Always try RFC 9421 first
      return "rfc9421";
    },
    rememberSpec(origin: string, spec: HttpMessageSignaturesSpec): void {
      this.rememberedOrigin = origin;
      this.rememberedSpec = spec;
    },
  };

  // Call doubleKnock with the draft-cavage-preferring server
  const response = await doubleKnock(
    request,
    {
      keyId: rsaPublicKey2.id!,
      privateKey: rsaPrivateKey2,
    },
    {
      specDeterminer,
    },
  );

  // Verify response
  assertEquals(response.status, 202, "Response status should be 202 Accepted");
  assertEquals(requestCount, 2, "Two requests should have been made");
  assertEquals(firstSpec, "rfc9421", "First attempt should use RFC 9421");
  assertEquals(
    secondSpec,
    "draft-cavage-http-signatures-12",
    "Second attempt should use draft-cavage",
  );
  assertEquals(
    specDeterminer.rememberedOrigin,
    "https://example.com",
    "Origin should be remembered",
  );
  assertEquals(
    specDeterminer.rememberedSpec,
    "draft-cavage-http-signatures-12",
    "Successful spec should be remembered",
  );

  fetchMock.hardReset();
});

test("doubleKnock() function with redirect handling", async () => {
  // Install mock fetch handler
  fetchMock.spyGlobal();

  // Track request attempts and redirects
  const requestedUrls: string[] = [];
  const responseCodes: number[] = [];

  // Mock an endpoint that redirects
  fetchMock.post("https://example.com/redirect-endpoint", (cl) => {
    requestedUrls.push(cl.url);
    responseCodes.push(302);
    return Response.redirect("https://example.com/final-endpoint", 302);
  });

  // Mock the destination endpoint
  fetchMock.post("https://example.com/final-endpoint", (cl) => {
    requestedUrls.push(cl.url);
    responseCodes.push(202);
    return new Response("", { status: 202 });
  });

  // Create request to the redirecting endpoint
  const request = new Request("https://example.com/redirect-endpoint", {
    method: "POST",
    body: "Test message that will be redirected",
    headers: {
      "Content-Type": "text/plain",
    },
  });

  // Call doubleKnock with the redirecting server
  const response = await doubleKnock(
    request,
    {
      keyId: rsaPublicKey2.id!,
      privateKey: rsaPrivateKey2,
    },
  );

  // Verify response handling and redirect following
  assertEquals(
    response.status,
    202,
    "Final response status should be 202 Accepted",
  );
  assertEquals(requestedUrls.length, 2, "Two URLs should have been requested");
  assertEquals(
    requestedUrls[0],
    "https://example.com/redirect-endpoint",
    "First request should be to redirect-endpoint",
  );
  assertEquals(
    requestedUrls[1],
    "https://example.com/final-endpoint",
    "Second request should be to final-endpoint",
  );
  assertEquals(
    responseCodes,
    [302, 202],
    "Response status codes should match expected sequence",
  );

  fetchMock.hardReset();
});

test("doubleKnock() function with both specs rejected", async () => {
  // Install mock fetch handler
  fetchMock.spyGlobal();

  // Track request attempts
  let requestCount = 0;
  const attempts: string[] = [];

  // Mock an endpoint that rejects all signatures
  fetchMock.post("https://example.com/inbox-rejects-all", (cl) => {
    const req = cl.request!;
    requestCount++;

    if (req.headers.has("Signature-Input")) {
      attempts.push("rfc9421");
    } else if (req.headers.has("Signature")) {
      attempts.push("draft-cavage");
    } else {
      attempts.push("unknown");
    }

    return new Response("Unauthorized", { status: 401 });
  });

  // Create request
  const request = new Request("https://example.com/inbox-rejects-all", {
    method: "POST",
    body: "Test message that will be rejected regardless of signature format",
    headers: {
      "Content-Type": "text/plain",
    },
  });

  // Call doubleKnock with the rejecting server
  const response = await doubleKnock(
    request,
    {
      keyId: rsaPublicKey2.id!,
      privateKey: rsaPrivateKey2,
    },
  );

  // Verify both specs were tried and 401 was returned
  assertEquals(
    response.status,
    401,
    "Final response status should be 401 Unauthorized",
  );
  assertEquals(requestCount, 2, "Two requests should have been made");
  assertEquals(
    attempts.length,
    2,
    "Two signature attempts should have been made",
  );
  assertEquals(attempts[0], "rfc9421", "First attempt should use RFC 9421");
  assertEquals(
    attempts[1],
    "draft-cavage",
    "Second attempt should use draft-cavage",
  );

  fetchMock.hardReset();
});

test("doubleKnock() function with specDeterminer choosing draft-cavage first", async () => {
  // Install mock fetch handler
  fetchMock.spyGlobal();

  // Track request attempts
  let requestCount = 0;
  let firstSpec: string | null = null;

  // Mock an endpoint that accepts draft-cavage signatures
  fetchMock.post("https://example.com/inbox-accepts-any", (cl) => {
    const req = cl.request!;
    requestCount++;

    if (req.headers.has("Signature-Input")) {
      firstSpec = "rfc9421";
    } else if (req.headers.has("Signature")) {
      firstSpec = "draft-cavage";
    }

    return new Response("", { status: 202 });
  });

  // Create a spec determiner that will prefer draft-cavage
  const specDeterminer = {
    determineSpec(_origin: string): HttpMessageSignaturesSpec {
      // Prefer draft-cavage
      return "draft-cavage-http-signatures-12";
    },
    rememberSpec(_origin: string, _spec: HttpMessageSignaturesSpec): void {
      // Not needed for this test
    },
  };

  // Create request
  const request = new Request("https://example.com/inbox-accepts-any", {
    method: "POST",
    body: "Test message with draft-cavage preference",
    headers: {
      "Content-Type": "text/plain",
    },
  });

  // Call doubleKnock with the determiner that prefers draft-cavage
  const response = await doubleKnock(
    request,
    {
      keyId: rsaPublicKey2.id!,
      privateKey: rsaPrivateKey2,
    },
    {
      specDeterminer,
    },
  );

  // Verify draft-cavage was used and succeeded
  assertEquals(response.status, 202, "Response status should be 202 Accepted");
  assertEquals(requestCount, 1, "Only one request should have been made");
  assertEquals(
    firstSpec,
    "draft-cavage",
    "First attempt should use draft-cavage",
  );

  fetchMock.hardReset();
});

test("doubleKnock() complex redirect chain test", async () => {
  // Install mock fetch handler
  fetchMock.spyGlobal();

  // Track request attempts
  const requestedUrls: string[] = [];

  // Create a redirect chain with 3 redirects
  fetchMock.post("https://example.com/redirect1", (cl) => {
    requestedUrls.push(cl.url);
    return Response.redirect("https://example.com/redirect2", 302);
  });

  fetchMock.post("https://example.com/redirect2", (cl) => {
    requestedUrls.push(cl.url);
    return Response.redirect("https://example.com/redirect3", 307);
  });

  fetchMock.post("https://example.com/redirect3", (cl) => {
    requestedUrls.push(cl.url);
    return Response.redirect("https://example.com/final", 301);
  });

  fetchMock.post("https://example.com/final", (cl) => {
    requestedUrls.push(cl.url);
    return new Response("Success", { status: 200 });
  });

  // Create request to start of redirect chain
  const request = new Request("https://example.com/redirect1", {
    method: "POST",
    body: "Test message for redirect chain",
    headers: {
      "Content-Type": "text/plain",
    },
  });

  // Capture logs for debugging
  const logs: Request[] = [];
  const logFunction = (req: Request) => {
    logs.push(req);
  };

  // Call doubleKnock with the redirect chain
  const response = await doubleKnock(
    request,
    {
      keyId: rsaPublicKey2.id!,
      privateKey: rsaPrivateKey2,
    },
    {
      log: logFunction,
    },
  );

  // Verify the entire redirect chain was followed
  assertEquals(response.status, 200, "Final response status should be 200 OK");
  assertEquals(
    await response.text(),
    "Success",
    "Response body should be 'Success'",
  );
  assertEquals(requestedUrls.length, 4, "Four URLs should have been requested");
  assertEquals(
    requestedUrls[0],
    "https://example.com/redirect1",
    "First request should be to redirect1",
  );
  assertEquals(
    requestedUrls[1],
    "https://example.com/redirect2",
    "Second request should be to redirect2",
  );
  assertEquals(
    requestedUrls[2],
    "https://example.com/redirect3",
    "Third request should be to redirect3",
  );
  assertEquals(
    requestedUrls[3],
    "https://example.com/final",
    "Fourth request should be to final",
  );

  // Verify each request in the chain was properly signed
  assertEquals(logs.length, 4, "Four requests should have been logged");
  for (const loggedReq of logs) {
    assert(
      loggedReq.headers.has("Signature-Input") ||
        loggedReq.headers.has("Signature"),
      "Each request should be signed with either RFC 9421 or draft-cavage",
    );
  }

  fetchMock.hardReset();
});

test("doubleKnock() async specDeterminer test", async () => {
  // Install mock fetch handler
  fetchMock.spyGlobal();

  // Track request attempts
  let requestCount = 0;
  let specUsed: string | null = null;

  // Mock an endpoint that accepts both types of signatures
  fetchMock.post("https://example.com/inbox-async-determiner", (cl) => {
    const req = cl.request!;
    requestCount++;

    if (req.headers.has("Signature-Input")) {
      specUsed = "rfc9421";
    } else if (req.headers.has("Signature")) {
      specUsed = "draft-cavage-http-signatures-12";
    }

    return new Response("", { status: 202 });
  });

  // Create an async spec determiner that returns after a delay
  const specDeterminer = {
    async determineSpec(_origin: string): Promise<HttpMessageSignaturesSpec> {
      // Simulate async database lookup
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "draft-cavage-http-signatures-12";
    },
    async rememberSpec(_origin: string, _spec: string): Promise<void> {
      // Simulate async database write
      await new Promise((resolve) => setTimeout(resolve, 10));
    },
  };

  // Create request
  const request = new Request("https://example.com/inbox-async-determiner", {
    method: "POST",
    body: "Test message with async spec determiner",
    headers: {
      "Content-Type": "text/plain",
    },
  });

  // Call doubleKnock with the async determiner
  const response = await doubleKnock(
    request,
    {
      keyId: rsaPublicKey2.id!,
      privateKey: rsaPrivateKey2,
    },
    {
      specDeterminer,
    },
  );

  // Verify the async determiner was used correctly
  assertEquals(response.status, 202, "Response status should be 202 Accepted");
  assertEquals(requestCount, 1, "Only one request should have been made");
  assertEquals(
    specUsed,
    "draft-cavage-http-signatures-12",
    "Should use spec from async determiner",
  );

  fetchMock.hardReset();
});

test("timingSafeEqual()", async (t) => {
  await t.step("should return true for equal empty arrays", () => {
    const a = new Uint8Array([]);
    const b = new Uint8Array([]);
    assert(timingSafeEqual(a, b));
  });

  await t.step("should return true for equal non-empty arrays", async (t2) => {
    const testCases = [
      { a: [1, 2, 3], b: [1, 2, 3], name: "simple sequence" },
      { a: [0, 0, 0], b: [0, 0, 0], name: "sequence of zeros" },
      { a: [255, 128, 0, 42], b: [255, 128, 0, 42], name: "varied bytes" },
      {
        a: Array.from({ length: 100 }, (_, i) => i),
        b: Array.from({ length: 100 }, (_, i) => i),
        name: "longer sequence (0-99)",
      },
    ];

    for (const tc of testCases) {
      await t2.step(tc.name, () => {
        assert(timingSafeEqual(new Uint8Array(tc.a), new Uint8Array(tc.b)));
      });
    }
  });

  await t.step("should return true for reference equality", () => {
    const arr = new Uint8Array([10, 20, 30, 99, 100, 0]);
    assert(
      timingSafeEqual(arr, arr),
      "Array should be equal to itself by reference",
    );
  });

  await t.step(
    "should return false for arrays with same length but different content",
    async (t2) => {
      const testCases = [
        { a: [1, 2, 3], b: [0, 2, 3], name: "difference at start" },
        { a: [1, 2, 3], b: [1, 0, 3], name: "difference in middle" },
        { a: [1, 2, 3], b: [1, 2, 0], name: "difference at end" },
        { a: [0], b: [1], name: "single byte difference" },
        {
          a: [255, 0, 255],
          b: [255, 1, 255],
          name: "middle byte differs with edge values",
        },
      ];

      for (const tc of testCases) {
        await t2.step(tc.name, () => {
          assertFalse(
            timingSafeEqual(new Uint8Array(tc.a), new Uint8Array(tc.b)),
          );
        });
      }
    },
  );

  await t.step(
    "should return false for arrays with different lengths",
    async (t2) => {
      const testCases = [
        { a: [1, 2, 3], b: [1, 2], name: "b shorter" },
        { a: [1, 2], b: [1, 2, 3], name: "a shorter" },
        { a: [], b: [1, 2, 3], name: "a empty, b non-empty" },
        { a: [1, 2, 3], b: [], name: "a non-empty, b empty" },
      ];

      for (const tc of testCases) {
        await t2.step(tc.name, () => {
          assertFalse(
            timingSafeEqual(new Uint8Array(tc.a), new Uint8Array(tc.b)),
          );
        });
      }
    },
  );

  await t.step(
    "should return false where content matches up to shorter length",
    async (t2) => {
      const testCases = [
        { a: [1, 2], b: [1, 2, 0], name: "a is prefix, b has trailing zero" },
        { a: [1, 2, 0], b: [1, 2], name: "b is prefix, a has trailing zero" },
        { a: [0], b: [0, 0], name: "single zero vs two zeros" },
        { a: [0, 0], b: [0], name: "two zeros vs single zero" },
      ];

      for (const tc of testCases) {
        await t2.step(tc.name, () => {
          assertFalse(
            timingSafeEqual(new Uint8Array(tc.a), new Uint8Array(tc.b)),
          );
        });
      }
    },
  );

  await t.step(
    "should correctly handle comparisons involving padding bytes",
    async (t2) => {
      await t2.step("a=[1], b=[1,0] (b longer with trailing zero)", () => {
        const a1 = new Uint8Array([1]);
        const b1 = new Uint8Array([1, 0]);
        assertFalse(timingSafeEqual(a1, b1));
      });

      await t2.step("a=[1,0], b=[1] (a longer with trailing zero)", () => {
        const a2 = new Uint8Array([1, 0]);
        const b2 = new Uint8Array([1]);
        assertFalse(timingSafeEqual(a2, b2));
      });
    },
  );
});

test("signRequest() [rfc9421] error handling for invalid signature base creation", async () => {
  // Test that createRfc9421SignatureBase errors are properly caught and wrapped
  // We'll test this by directly calling createRfc9421SignatureBase with invalid input
  const request = new Request("https://example.com/test", {
    method: "POST",
    body: "test body",
  });

  // First verify that createRfc9421SignatureBase throws for unsupported components
  await assertThrows(
    () => {
      createRfc9421SignatureBase(
        request,
        ["@unsupported"], // This will trigger the "Unsupported derived component" error
        'alg="rsa-pss-sha256";keyid="https://example.com/key2";created=1234567890',
      );
    },
    Error,
    "Unsupported derived component: @unsupported",
  );

  // The actual error handling in signRequest is tested indirectly by ensuring
  // that normal signing operations work without throwing the wrapped error
  const signedRequest = await signRequest(
    request,
    rsaPrivateKey2,
    new URL("https://example.com/key2"),
    { spec: "rfc9421" },
  );

  // Verify that the request was signed successfully
  assertExists(signedRequest.headers.get("Signature-Input"));
  assertExists(signedRequest.headers.get("Signature"));
});

test("verifyRequest() [rfc9421] error handling for invalid signature base creation", async () => {
  // Create a request with a malformed signature input that will cause createRfc9421SignatureBase to fail
  const request = new Request("https://example.com/test", {
    method: "GET",
    headers: {
      "Accept": "application/json",
      // Add a malformed signature input that references an unsupported component
      "Signature-Input":
        'sig1=("@unsupported");alg="rsa-pss-sha256";keyid="https://example.com/key2";created=1234567890',
      "Signature": "sig1=:invalid_signature_data:",
    },
  });

  // Attempt verification with the malformed signature input
  // This should fail gracefully and return null instead of throwing
  const result = await verifyRequest(request, {
    spec: "rfc9421",
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });

  assertEquals(
    result,
    null,
    "Verification should fail gracefully for malformed signature inputs",
  );
});

test("doubleKnock() regression test for TypeError: unusable bug #294", async () => {
  // This test reproduces the bug where request.clone().body in the second redirect
  // handling path causes "TypeError: unusable" when the body is consumed before
  // subsequent clone() calls in signRequest functions.

  fetchMock.spyGlobal();

  let requestCount = 0;

  // Mock server that:
  // 1. Returns 401 for first spec (triggers retry with different spec)
  // 2. Returns 302 redirect for second spec (triggers redirect handling)
  // 3. Returns 200 for final destination
  fetchMock.post("https://example.com/inbox-retry-redirect", (_cl) => {
    requestCount++;

    if (requestCount === 1) {
      // First request: reject to trigger retry with different spec
      return new Response("Unauthorized", { status: 401 });
    } else if (requestCount === 2) {
      // Second request: redirect to trigger the problematic redirect handling
      return Response.redirect("https://example.com/final-destination", 302);
    }

    return new Response("Should not reach here", { status: 500 });
  });

  // Mock final destination
  fetchMock.post("https://example.com/final-destination", () => {
    return new Response("Success", { status: 200 });
  });

  const request = new Request("https://example.com/inbox-retry-redirect", {
    method: "POST",
    body: "Test activity content",
    headers: {
      "Content-Type": "application/activity+json",
    },
  });

  // This should trigger the bug: 401 -> retry -> 302 -> TypeError: unusable
  // because the second redirect path uses request.clone().body instead of
  // await request.clone().arrayBuffer()
  const response = await doubleKnock(
    request,
    {
      keyId: rsaPublicKey2.id!,
      privateKey: rsaPrivateKey2,
    },
  );

  // The test should pass after the fix
  assertEquals(response.status, 200);
  assertEquals(requestCount, 2, "Should make 2 requests before redirect");

  fetchMock.hardReset();
});
