import type { NodeInfoDispatcher } from "../federation/callback.ts";
import type { RequestContext } from "../federation/context.ts";
import { RouterError } from "../federation/router.ts";
import type { Link, ResourceDescriptor } from "../webfinger/jrd.ts";
import { nodeInfoToJson } from "./types.ts";

/**
 * Parameters for {@link handleNodeInfo}.
 */
export interface NodeInfoHandlerParameters<TContextData> {
  /**
   * The request context.
   */
  context: RequestContext<TContextData>;

  /**
   * The callback for dispatching the NodeInfo.
   */
  nodeInfoDispatcher: NodeInfoDispatcher<TContextData>;
}

/**
 * Handles a NodeInfo request.  You would not typically call this function
 * directly, but instead use {@link Federation.handle} method.
 * @param request The NodeInfo request to handle.
 * @param parameters The parameters for handling the request.
 * @returns The response to the request.
 */
export async function handleNodeInfo<TContextData>(
  _request: Request,
  { context, nodeInfoDispatcher }: NodeInfoHandlerParameters<TContextData>,
): Promise<Response> {
  const promise = nodeInfoDispatcher(context);
  const nodeInfo = promise instanceof Promise ? await promise : promise;
  const json = nodeInfoToJson(nodeInfo);
  return new Response(JSON.stringify(json), {
    headers: {
      "Content-Type": "application/json;" +
        ' profile="http://nodeinfo.diaspora.software/ns/schema/2.1#"',
    },
  });
}

/**
 * Handles a request to `/.well-known/nodeinfo`.  You would not typically call
 * this function directly, but instead use {@link Federation.handle} method.
 * @param request The request to handle.
 * @param context The request context.
 * @returns The response to the request.
 */
export function handleNodeInfoJrd<TContextData>(
  _request: Request,
  context: RequestContext<TContextData>,
): Promise<Response> {
  const links: Link[] = [];
  try {
    links.push({
      rel: "http://nodeinfo.diaspora.software/ns/schema/2.1",
      href: context.getNodeInfoUri().href,
      type: "application/json;" +
        ' profile="http://nodeinfo.diaspora.software/ns/schema/2.1#"',
    });
  } catch (e) {
    if (!(e instanceof RouterError)) throw e;
  }
  const jrd: ResourceDescriptor = { links };
  const response = new Response(JSON.stringify(jrd), {
    headers: {
      "Content-Type": "application/jrd+json",
    },
  });
  return Promise.resolve(response);
}
