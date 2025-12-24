import type { Federation, FederationBuilder } from "@fedify/fedify";
import type { RelayOptions } from "./types.ts";

/**
 * Abstract base class for relay implementations.
 * Provides common infrastructure for both Mastodon and LitePub relays.
 *
 * @since 2.0.0
 */
export abstract class BaseRelay {
  protected federationBuilder: FederationBuilder<RelayOptions>;
  protected options: RelayOptions;
  protected federation?: Federation<RelayOptions>;

  constructor(
    options: RelayOptions,
    relayBuilder: FederationBuilder<RelayOptions>,
  ) {
    this.options = options;
    this.federationBuilder = relayBuilder;
  }

  async fetch(request: Request): Promise<Response> {
    if (this.federation == null) {
      this.federation = await this.federationBuilder.build(this.options);
      this.setupInboxListeners();
    }

    return await this.federation.fetch(request, {
      contextData: this.options,
    });
  }

  /**
   * Set up inbox listeners for handling ActivityPub activities.
   * Each relay type implements this method with protocol-specific logic.
   */
  protected abstract setupInboxListeners(): void;
}
