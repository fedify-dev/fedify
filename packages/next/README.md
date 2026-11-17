<!-- deno-fmt-ignore-file -->

@fedify/next: Integrate Fedify with Next.js
===========================================

[![@fedify@hackers.pub][@fedify@hackers.pub badge]][@fedify@hackers.pub]

This package provides a simple way to integrate [Fedify] with [Next.js].

> [!IMPORTANT]
> We recommend initializing your app using the `init` command of the
> [Fedify CLI] rather than installing this package directly.

> [!IMPORTANT]
> This package relies on Next.js request interception on the Node.js runtime.
> Therefore, you must use Next.js 15.4.6 or later.
> On Next.js 16, `proxy.ts` is preferred and `middleware.ts` is deprecated but
> still supported.  If you switch to `proxy.ts`, omit `runtime: "nodejs"` from
> the exported `config`, because Proxy always runs on the Node.js runtime.
> For more details, refer to the [official documentation of `proxy`].

[@fedify@hackers.pub badge]: https://fedi-badge.minhee.org/@fedify@hackers.pub/followers.svg
[@fedify@hackers.pub]: https://hackers.pub/@fedify
[Fedify]: https://fedify.dev/
[Next.js]: https://nextjs.org/
[Fedify CLI]: https://www.npmjs.com/package/@fedify/cli
[official documentation of `proxy`]: https://nextjs.org/docs/app/api-reference/file-conventions/proxy


Usage
-----

~~~~ typescript ignore
// --- middleware.ts ---
import { fedifyWith } from "@fedify/next";
import { federation } from "./federation";

export default fedifyWith(federation)();

// This config must be defined in the same file.
export const config = {
  runtime: "nodejs",
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
    // FEP-ef61 gateway requests such as hashlink media, which clients fetch
    // without the federation media types, e.g., with "Accept: image/*":
    { source: "/.well-known/apgateway/:path*" },
    { source: "/nodeinfo/:path*" },
  ],
};
~~~~

The `matcher` decides whether Next.js runs the middleware; `fedifyWith()` then
decides whether Fedify handles the request.  NodeInfo paths under `/nodeinfo/`
are forwarded regardless of their headers.  When upgrading an existing
application, add `{ source: "/nodeinfo/:path*" }` to its `matcher` as well as
upgrading this package.  Requests under this prefix go to Fedify even without
a dispatcher, returning `404 Not Found` by default.

For a NodeInfo dispatcher outside `/nodeinfo/`, add its path to `matcher` and
explicitly delegate requests for it to `integrateFederation()` with the same
context data factory and error handlers you use with `fedifyWith()`.
A `matcher` entry alone does not make `fedifyWith()` recognize a custom path.
