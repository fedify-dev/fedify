/**
 * Describes a resource.  See also
 * [RFC 7033 section 4.4](https://datatracker.ietf.org/doc/html/rfc7033#section-4.4).
 */
export interface ResourceDescriptor {
  /**
   * A URI that identifies the entity that this descriptor describes.
   */
  readonly subject?: string;

  /**
   * URIs that identify the same entity as the `subject`.
   */
  readonly aliases?: readonly string[];

  /**
   * Conveys additional information about the `subject` of this descriptor.
   */
  readonly properties?: Readonly<Record<string, string>>;

  /**
   * Links to other resources.
   */
  readonly links?: readonly Link[];
}

/**
 * Represents a link.  See also
 * [RFC 7033 section 4.4.4](https://datatracker.ietf.org/doc/html/rfc7033#section-4.4.4).
 */
export interface Link {
  /**
   * The link's relation type, which is either a URI or a registered relation
   * type (see [RFC 5988](https://datatracker.ietf.org/doc/html/rfc5988)).
   */
  readonly rel: string;

  /**
   * The media type of the target resource (see
   * [RFC 6838](https://datatracker.ietf.org/doc/html/rfc6838)).
   */
  readonly type?: string;

  /**
   * A URI pointing to the target resource.
   */
  readonly href?: string;

  /**
   * Human-readable titles describing the link relation.  If the language is
   * unknown or unspecified, the key is `"und"`.
   */
  readonly titles?: Readonly<Record<string, string>>;

  /**
   * Conveys additional information about the link relation.
   */
  readonly properties?: Readonly<Record<string, string>>;

  /**
   * A URI Template (RFC 6570) that can be used to construct URIs by
   * substituting variables. Used primarily for subscription endpoints
   * where parameters like account URIs need to be dynamically inserted.
   * @since 1.9.0
   */
  readonly template?: string;
}
