@fedify/fastify: Integrate Fedify with Fastify
==============================================

This package provides a simple way to integrate Fedify with Fastify.

~~~ typescript
import { fedifyPlugin } from "@fedify/fastify";
import { federation } from "./federation"; // Your `Federation` instance
import Fastify from "fastify";

const fastify = Fastify({ logger: true });

// Register the fedify plugin.
await fastify.register(fedifyPlugin, { federation });

// Your Fastify codes
~~~
