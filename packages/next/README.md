<!-- deno-fmt-ignore-file -->

@fedify/next: Integrate Fedify with Next.js
===========================================

[![Follow @fedify@hollo.social][@fedify@hollo.social badge]][@fedify@hollo.social]

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

[@fedify@hollo.social badge]: https://fedi-badge.deno.dev/@fedify@hollo.social/followers.svg
[@fedify@hollo.social]: https://hollo.social/@fedify
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
  ],
};
~~~~
