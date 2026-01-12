/**
 * Regular expression to match a fediverse handle in the format `@user@server`
 * or `user@server`.  The `user` part can contain alphanumeric characters and
 * some special characters except `@`.  The `server` part is all characters
 * after the `@` symbol in the middle.
 */
const handleRegexp =
  /^@?((?:[-A-Za-z0-9._~!$&'()*+,;=]|%[A-Fa-f0-9]{2})+)@([^@]+)$/;

/**
 * Represents a fediverse handle, which consists of a username and a host.
 * The username can be alphanumeric and may include special characters,
 * while the host is typically a domain name.
 * @since 1.8.0
 */
export interface FediverseHandle {
  /**
   * The username part of the fediverse handle.
   * It can include alphanumeric characters and some special characters.
   */
  readonly username: string;
  /**
   * The host part of the fediverse handle, typically a domain name.
   * It is the part after the `@` symbol in the handle.
   */
  readonly host: string;
}

/**
 * Parses a fediverse handle in the format `@user@server` or `user@server`.
 * The `user` part can contain alphanumeric characters and some special
 * characters except `@`.  The `server` part is all characters after the `@`
 * symbol in the middle.
 *
 * @example
 * ```typescript
 * const handle = parseFediverseHandle("@username@example.com");
 * console.log(handle?.username); // "username"
 * console.log(handle?.host);     // "example.com"
 * ```
 *
 * @param handle - The fediverse handle string to parse.
 * @returns A {@link FediverseHandle} object with `username` and `host`
 *          if the input is valid; otherwise `null`.
 * @since 1.8.0
 */
export function parseFediverseHandle(
  handle: string,
): FediverseHandle | null {
  const match = handleRegexp.exec(handle);
  if (match) {
    return {
      username: match[1],
      host: match[2],
    };
  }
  return null;
}

/**
 * Checks if a string is a valid fediverse handle in the format `@user@server`
 * or `user@server`.  The `user` part can contain alphanumeric characters and
 * some special characters except `@`.  The `server` part is all characters
 * after the `@` symbol in the middle.
 *
 * @example
 * ```typescript
 * console.log(isFediverseHandle("@username@example.com")); // true
 * console.log(isFediverseHandle("username@example.com"));  // true
 * console.log(isFediverseHandle("@username@"));            // false
 * ```
 *
 * @param handle - The string to test as a fediverse handle.
 * @returns `true` if the string matches the fediverse handle pattern;
 *          otherwise `false`.
 * @since 1.8.0
 */
export function isFediverseHandle(
  handle: string,
): handle is `${string}@${string}` {
  return handleRegexp.test(handle);
}

/**
 * Converts a fediverse handle in the format `@user@server` or `user@server`
 * to an `acct:` URI, which is a URL-like identifier for ActivityPub actors.
 *
 * @example
 * ```typescript
 * const identifier = toAcctUrl("@username@example.com");
 * console.log(identifier?.href); // "acct:username@example.com"
 * ```
 *
 * @param handle - The fediverse handle string to convert.
 * @returns A `URL` object representing the `acct:` URI if conversion succeeds;
 *          otherwise `null`.
 * @since 1.8.0
 */
export function toAcctUrl(handle: string): URL | null {
  const parsed = parseFediverseHandle(handle);
  if (!parsed) return null;
  const identifier = new URL(`acct:${parsed.username}@${parsed.host}`);
  return identifier;
}
