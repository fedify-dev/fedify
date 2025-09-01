/**
 * Describes a resource.  See also
 * [RFC 7033 section 4.4](https://datatracker.ietf.org/doc/html/rfc7033#section-4.4).
 */
export interface ResourceDescriptor {
  /**
   * A URI that identifies the entity that this descriptor describes.
   */
  subject?: string;

  /**
   * URIs that identify the same entity as the `subject`.
   */
  aliases?: string[];

  /**
   * Conveys additional information about the `subject` of this descriptor.
   */
  properties?: Record<string, string>;

  /**
   * Links to other resources.
   */
  links?: Array<Link | OStatusSubscribeLink>;
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
  rel: string;

  /**
   * The media type of the target resource (see
   * [RFC 6838](https://datatracker.ietf.org/doc/html/rfc6838)).
   */
  type?: string;

  /**
   * A URI pointing to the target resource.
   */
  href?: string;

  /**
   * Human-readable titles describing the link relation.  If the language is
   * unknown or unspecified, the key is `"und"`.
   */
  titles?: Record<string, string>;

  /**
   * Conveys additional information about the link relation.
   */
  properties?: Record<string, string>;
}

/**
 * References a link. See also
 * [OStatus 1.0 Draft 2](https://www.w3.org/community/ostatus/wiki/images/9/93/OStatus_1.0_Draft_2.pdf)
 */
export interface OStatusSubscribeLink {
  rel: "http://ostatus.org/schema/1.0/subscribe";
  /**
   * A URI template (RFC 6570) that can be used to construct URIs by
   * substituting variables. Used primarily for subscription endpoints
   * where parameters like account URIs need to be dynamically inserted.
   */
  template: string;
}
