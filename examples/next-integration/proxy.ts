import { fedifyWith } from "@fedify/next";
import federation from "@/federation";
import { replaceHost } from "./lib/utils";

export default replaceHost(
  fedifyWith(federation)(
    /*
      function(request: Request){
        // Add any additional middleware here
        return NextResponse.next()
      }
    */
  ),
);

// This config makes the proxy run only for requests that may be
// federation requests: requests whose "Accept" or "Content-Type" header
// has a federation media type, NodeInfo requests, and FEP-ef61 gateway
// requests such as hashlink media, which clients fetch with, e.g.,
// "Accept: image/*".  fedifyWith() then decides which of them Fedify
// handles.
// More details: https://nextjs.org/docs/app/api-reference/file-conventions/proxy#matcher.
export const config = {
  matcher: [
    {
      source: "/:path*",
      has: [
        {
          type: "header",
          key: "Accept",
          value: ".*application\\/((jrd|activity|ld)\\+json|xrd\\+xml).*",
        },
      ],
    },
    {
      source: "/:path*",
      has: [
        {
          type: "header",
          key: "content-type",
          value: ".*application\\/((jrd|activity|ld)\\+json|xrd\\+xml).*",
        },
      ],
    },
    { source: "/.well-known/nodeinfo" },
    { source: "/.well-known/x-nodeinfo2" },
    { source: "/.well-known/apgateway/:path*" },
  ],
};
