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

// Run the proxy for federation media types and NodeInfo paths, including
// NodeInfo documents fetched with "Accept: application/json" or "*/*".
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
    { source: "/nodeinfo/:path*" },
  ],
};
