import { deepStrictEqual, equal, rejects } from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import type { Document, Image, Link } from "@fedify/vocab";
import { computeDigestMultibase, createHashlink } from "./digest.ts";
import { fetchPortableMedia, type PortableMedia } from "./portable-media.ts";

const bytes = new TextEncoder().encode("portable image");
const digest = "zQmU2Jds4B2J83K7CrYC34CEJdB6vCLyqkM2cgBxYeaNWTA";
const hashlink = createHashlink(digest);

const networkTest = (name: string, run: () => Promise<void>) =>
  test(name, async (t) => {
    if (
      "Deno" in globalThis &&
      (await Deno.permissions.query({ name: "net" })).state !== "granted"
    ) {
      t.skip("Requires network permission for a local test server.");
      return;
    }
    await run();
  });

type Handler = (path: string) => Response | undefined;

async function withServers(
  handlers: Handler[],
  run: (origins: string[]) => Promise<void>,
): Promise<void> {
  const servers = handlers.map((handler) =>
    createServer(async (request, reply) => {
      const result = handler(request.url ?? "/");
      if (result == null) return;
      reply.writeHead(result.status, Object.fromEntries(result.headers));
      reply.end(new Uint8Array(await result.arrayBuffer()));
    })
  );
  try {
    const origins: string[] = [];
    for (const server of servers) {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (address == null || typeof address === "string") {
        throw new Error("Server did not bind a TCP port.");
      }
      origins.push(`http://127.0.0.1:${address.port}`);
    }
    await run(origins);
  } finally {
    await Promise.all(servers.map(async (server) => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }));
  }
}

networkTest(
  "fetchPortableMedia() accepts Link, Image, and Document",
  async () => {
    const accepts = <T extends PortableMedia>() => {};
    accepts<Link>();
    accepts<Image>();
    accepts<Document>();
    const link: PortableMedia = {
      href: new URL(hashlink),
      digestMultibase: digest,
    };
    const image: PortableMedia = {
      url: new URL(hashlink),
      digestMultibase: digest,
    };
    const document: PortableMedia = {
      url: { href: new URL(hashlink), digestMultibase: digest },
    };
    const requested: string[] = [];
    await withServers([(path) => {
      requested.push(path);
      return new Response(bytes);
    }], async ([gateway]) => {
      for (const media of [link, image, document]) {
        equal(
          await (await fetchPortableMedia(media, {
            gateways: [gateway],
            allowPrivateAddress: true,
          })).text(),
          "portable image",
        );
      }
    });
    deepStrictEqual(
      requested,
      Array(3).fill(
        `/.well-known/apgateway/${hashlink}`,
      ),
    );
  },
);

networkTest(
  "fetchPortableMedia() falls back on status and digest mismatch",
  async () => {
    const requested: string[] = [];
    await withServers([
      (path) => {
        requested.push(`first:${path}`);
        return new Response(null, { status: 503 });
      },
      (path) => {
        requested.push(`second:${path}`);
        return new Response("wrong bytes");
      },
      (path) => {
        requested.push(`third:${path}`);
        return new Response(bytes, {
          headers: { "Content-Type": "image/png", "Set-Cookie": "secret=1" },
        });
      },
    ], async (gateways) => {
      const result = await fetchPortableMedia(
        { url: new URL(hashlink), digestMultibase: digest },
        { gateways, allowPrivateAddress: true },
      );
      equal(await result.text(), "portable image");
      equal(result.headers.get("Content-Type"), "image/png");
      equal(result.headers.get("Set-Cookie"), null);
    });
    deepStrictEqual(requested.map((r) => r.split(":")[0]), [
      "first",
      "second",
      "third",
    ]);
  },
);

networkTest("fetchPortableMedia() verifies direct HTTP media", async () => {
  const wrongDigest = await computeDigestMultibase(new Uint8Array());
  await withServers([() => new Response(bytes)], async ([origin]) => {
    const result = await fetchPortableMedia(`${origin}/a`, {
      digestMultibase: digest,
      allowPrivateAddress: true,
    });
    equal(await result.text(), "portable image");
    await rejects(() =>
      fetchPortableMedia(`${origin}/a`, {
        digestMultibase: wrongDigest,
        allowPrivateAddress: true,
      }), /digest does not match/);
  });
});

test("fetchPortableMedia() rejects invalid references before fetching", async () => {
  const wrongDigest = await computeDigestMultibase(new Uint8Array());
  await rejects(
    () => fetchPortableMedia({ url: new URL(hashlink) }),
    /requires digestMultibase/,
  );
  await rejects(() =>
    fetchPortableMedia({
      url: new URL(hashlink),
      digestMultibase: digest,
    }), /requires at least one gateway/);
  await rejects(() =>
    fetchPortableMedia({
      url: new URL(hashlink),
      digestMultibase: wrongDigest,
    }, { gateways: ["https://example.com"] }), /disagree/);
  await rejects(() =>
    fetchPortableMedia({
      url: new URL("hl:invalid"),
      digestMultibase: digest,
    }, { gateways: ["https://example.com"] }), TypeError);
  await rejects(() =>
    fetchPortableMedia({
      url: { href: new URL(hashlink), digestMultibase: wrongDigest },
      digestMultibase: digest,
    }, { gateways: ["https://example.com"] }), /digests disagree/);
  await rejects(() =>
    fetchPortableMedia("file:///tmp/media", {
      digestMultibase: digest,
    }), TypeError);
});

networkTest("fetchPortableMedia() bounds response bytes", async () => {
  await withServers([() => new Response(bytes)], async ([origin]) => {
    await rejects(() =>
      fetchPortableMedia(`${origin}/media`, {
        digestMultibase: digest,
        maxBytes: bytes.length - 1,
        allowPrivateAddress: true,
      }), /exceeds the limit/);
  });
  await rejects(() =>
    fetchPortableMedia("https://example.com/media", {
      digestMultibase: digest,
      maxBytes: 0,
    }), RangeError);
});

test("fetchPortableMedia() rejects private media and gateways", async () => {
  await rejects(() =>
    fetchPortableMedia("http://127.0.0.1/media", {
      digestMultibase: digest,
    }), /private address/);
  await rejects(
    () =>
      fetchPortableMedia({
        url: new URL(hashlink),
        digestMultibase: digest,
      }, { gateways: ["http://127.0.0.1"] }),
    /No gateway returned verified portable media/,
  );
});

test("fetchPortableMedia() propagates cancellation", async () => {
  const controller = new AbortController();
  const reason = new Error("cancelled");
  controller.abort(reason);
  await rejects(() =>
    fetchPortableMedia({
      url: new URL(hashlink),
      digestMultibase: digest,
    }, {
      gateways: ["https://example.com"],
      signal: controller.signal,
    }), (error) => error === reason);
});

networkTest(
  "fetchPortableMedia() falls back after a gateway timeout",
  async () => {
    await withServers([
      () => undefined,
      () => new Response(bytes),
    ], async (gateways) => {
      const response = await fetchPortableMedia({
        url: new URL(hashlink),
        digestMultibase: digest,
      }, {
        gateways,
        allowPrivateAddress: true,
        gatewayTimeout: 20,
        timeout: 500,
      });
      equal(await response.text(), "portable image");
    });
  },
);

networkTest("fetchPortableMedia() applies one overall timeout", async () => {
  await withServers(
    [() => undefined, () => new Response(bytes)],
    async (gateways) => {
      await rejects(
        () =>
          fetchPortableMedia({
            url: new URL(hashlink),
            digestMultibase: digest,
          }, {
            gateways,
            allowPrivateAddress: true,
            gatewayTimeout: 100,
            timeout: 20,
          }),
        (error) =>
          error instanceof DOMException && error.name === "TimeoutError",
      );
    },
  );
});

networkTest("fetchPortableMedia() follows a safe redirect", async () => {
  const requested: string[] = [];
  await withServers([(path) => {
    requested.push(path);
    return path === "/media" ? new Response(bytes) : new Response(null, {
      status: 302,
      headers: { Location: "/media" },
    });
  }], async ([gateway]) => {
    const response = await fetchPortableMedia({
      url: new URL(hashlink),
      digestMultibase: digest,
    }, { gateways: [gateway], allowPrivateAddress: true });
    equal(await response.text(), "portable image");
  });
  deepStrictEqual(requested, [
    `/.well-known/apgateway/${hashlink}`,
    "/media",
  ]);
});
