/**
 * Authentication types and helpers for the debug dashboard.
 *
 * @module
 */
import { timingSafeEqual } from "node:crypto";

/**
 * Authentication configuration for the debug dashboard.
 *
 * The debug dashboard can be protected using one of three authentication modes:
 *
 * - `"password"` — Shows a password-only login form.
 * - `"usernamePassword"` — Shows a username + password login form.
 * - `"request"` — Authenticates based on the incoming request (e.g., IP
 *   address).  No login form is shown; unauthenticated requests receive a
 *   403 response.
 *
 * Each mode supports either a static credential check or a callback function.
 */
export type FederationDebuggerAuth =
  | {
    readonly type: "password";
    authenticate(password: string): boolean | Promise<boolean>;
  }
  | {
    readonly type: "password";
    readonly password: string;
  }
  | {
    readonly type: "usernamePassword";
    authenticate(
      username: string,
      password: string,
    ): boolean | Promise<boolean>;
  }
  | {
    readonly type: "usernamePassword";
    readonly username: string;
    readonly password: string;
  }
  | {
    readonly type: "request";
    authenticate(request: Request): boolean | Promise<boolean>;
  };

export const SESSION_COOKIE_NAME = "__fedify_debug_session";
const SESSION_TOKEN = "authenticated";

export async function generateHmacKey(): Promise<CryptoKey> {
  return await crypto.subtle.generateKey(
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes.buffer as ArrayBuffer;
}

export async function signSession(key: CryptoKey): Promise<string> {
  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(SESSION_TOKEN),
  );
  return toHex(signature);
}

export async function verifySession(
  key: CryptoKey,
  signature: string,
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    return await crypto.subtle.verify(
      "HMAC",
      key,
      fromHex(signature),
      encoder.encode(SESSION_TOKEN),
    );
  } catch {
    return false;
  }
}

/**
 * Constant-time string comparison to prevent timing attacks on credential
 * checks.  Uses {@link timingSafeEqual} from `node:crypto` under the hood.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  if (bufA.byteLength !== bufB.byteLength) {
    // Still compare to burn the same amount of time regardless, but
    // the result is always false when lengths differ.
    timingSafeEqual(bufA, new Uint8Array(bufA.byteLength));
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export async function checkAuth(
  auth: FederationDebuggerAuth,
  formData: { username?: string; password: string },
): Promise<boolean> {
  if (auth.type === "password") {
    if ("authenticate" in auth) {
      return await auth.authenticate(formData.password);
    }
    return constantTimeEqual(formData.password, auth.password);
  }
  if (auth.type === "usernamePassword") {
    if ("authenticate" in auth) {
      return await auth.authenticate(
        formData.username ?? "",
        formData.password,
      );
    }
    // Check both fields in constant time (don't short-circuit)
    const usernameMatch = constantTimeEqual(
      formData.username ?? "",
      auth.username,
    );
    const passwordMatch = constantTimeEqual(formData.password, auth.password);
    return usernameMatch && passwordMatch;
  }
  return false;
}
