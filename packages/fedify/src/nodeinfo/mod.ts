/**
 * This module implements the [NodeInfo](https://nodeinfo.diaspora.software/)
 * protocol.
 *
 * @module
 * @since 0.2.0
 */
export {
  getNodeInfo,
  type GetNodeInfoOptions,
  parseNodeInfo,
  type ParseNodeInfoOptions,
} from "./client.ts";
export * from "./types.ts";
