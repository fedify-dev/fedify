<!-- deno-fmt-ignore-file -->

@fedify/express: Integrate Fedify with Express
==============================================

[![npm][npm badge]][npm]
[![Matrix][Matrix badge]][Matrix]
[![Follow @fedify@hollo.social][@fedify@hollo.social badge]][@fedify@hollo.social]

This package provides a simple way to integrate [Fedify] with [Express].

The integration code looks like this:

~~~~ typescript
import express from "express";
import { integrateFederation } from "@fedify/express";
import { federation } from "./federation.ts";  // Your `Federation` instance

export const app = express();

app.set("trust proxy", true);

app.use(integrateFederation(federation, (req) => "context data goes here"));
~~~~

[npm badge]: https://img.shields.io/npm/v/@fedify/express?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/express
[Matrix badge]: https://img.shields.io/matrix/fedify%3Amatrix.org
[Matrix]: https://matrix.to/#/#fedify:matrix.org
[@fedify@hollo.social badge]: https://fedi-badge.deno.dev/@fedify@hollo.social/followers.svg
[@fedify@hollo.social]: https://hollo.social/@fedify
[Fedify]: https://fedify.dev/
[Express]: https://expressjs.com/

### Reverse proxy with Express 4.x

If your application uses Express 4.x behind a reverse proxy with a non-standard
port (e.g., `Host: example.com:8080`), the reconstructed request URL may lose
the port number.  This is because Express 4.x's `req.host` (which respects
[`trust proxy`][trust proxy]) strips the port from the `Host` header.

This issue does not occur with Express 5.x, where `req.host` retains the port.
If you rely on `trust proxy` and your origin includes a non-standard port, we
recommend upgrading to Express 5.

[trust proxy]: https://expressjs.com/en/guide/behind-proxies.html
