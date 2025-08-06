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

[npm]: https://www.npmjs.com/package/@fedify/express
[npm badge]: https://img.shields.io/npm/v/@fedify/express?logo=npm
[Matrix]: https://matrix.to/#/#fedify:matrix.org
[Matrix badge]: https://img.shields.io/matrix/fedify%3Amatrix.org
[@fedify@hollo.social badge]: https://fedi-badge.deno.dev/@fedify@hollo.social/followers.svg
[@fedify@hollo.social]: https://hollo.social/@fedify
[Fedify]: https://fedify.dev/
[Express]: https://expressjs.com/
