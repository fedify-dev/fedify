import { colors } from "@cliffy/ansi";
import { Command, EnumType } from "@cliffy/command";
import {
  Application,
  Collection,
  CryptographicKey,
  type DocumentLoader,
  generateCryptoKeyPair,
  getAuthenticatedDocumentLoader,
  type Link,
  lookupObject,
  type Object,
  type ResourceDescriptor,
  respondWithObject,
  traverseCollection,
} from "@fedify/fedify";
import { getLogger } from "@logtape/logtape";
import { dirname, isAbsolute, resolve } from "@std/path";
import ora from "ora";
import { getContextLoader, getDocumentLoader } from "./docloader.ts";
import { spawnTemporaryServer, type TemporaryServer } from "./tempserver.ts";

const logger = getLogger(["fedify", "cli", "lookup"]);

const sigSpec = new EnumType(["draft-cavage-http-signatures-12", "rfc9421"]);

interface CommandOptions {
  authorizedFetch?: boolean;
  firstKnock: "draft-cavage-http-signatures-12" | "rfc9421";
  traverse?: boolean;
  suppressErrors?: boolean;
  raw?: boolean;
  compact?: boolean;
  expand?: boolean;
  userAgent?: string;
  separator: string;
  output?: string;
}

export async function createFileStream(
  outputPath: string,
): Promise<WritableStream> {
  try {
    const filepath = isAbsolute(outputPath)
      ? outputPath
      : resolve(Deno.env.get("PWD") || Deno.cwd(), outputPath);

    const parentDir = dirname(filepath);
    await Deno.mkdir(parentDir, { recursive: true });

    const file = await Deno.open(filepath, {
      write: true,
      create: true,
      truncate: true,
    });

    return new WritableStream({
      write: (chunk) => file.write(chunk).then(() => {}),
      close: () => file.close(),
      abort: (reason) => {
        file.close();
        throw reason;
      },
    });
  } catch (err) {
    const spinner = ora({
      text: `Failed to write output to ${colors.red(outputPath)}.`,
      discardStdin: false,
    });
    spinner.fail();
    console.error(`Error: ${String(err)}`);

    if (err instanceof Deno.errors.PermissionDenied) {
      console.error(
        "Permission denied. Try running with proper permissions.",
      );
    } else if (err instanceof Deno.errors.NotFound) {
      console.error("Path does not exist or is invalid.");
    } else if (err instanceof Deno.errors.IsADirectory) {
      console.error("The specified path is a directory, not a file.");
    }
    Deno.exit(1);
  }
}

export async function writeObjectToStream(
  object: Object | Link,
  options: CommandOptions,
  contextLoader: DocumentLoader,
): Promise<void> {
  const stream = options.output
    ? await createFileStream(options.output)
    : Deno.stdout.writable;

  const writer = stream.getWriter();

  try {
    let content;

    if (options.raw) {
      content = await object.toJsonLd({ contextLoader });
    } else if (options.compact) {
      content = await object.toJsonLd({ format: "compact", contextLoader });
    } else if (options.expand) {
      content = await object.toJsonLd({ format: "expand", contextLoader });
    } else {
      content = object;
    }

    content = Deno.inspect(content, {
      colors: !(options.output),
    });

    const encoder = new TextEncoder();
    const bytes = encoder.encode(content + "\n");

    await writer.write(bytes);
  } finally {
    writer.releaseLock();
    if (options.output) {
      await stream.close();
    }
  }
}

export const command = new Command()
  .type("sig-spec", sigSpec)
  .arguments("<...urls:string>")
  .description(
    "Lookup an Activity Streams object by URL or the actor handle.  " +
      "The argument can be either a URL or an actor handle " +
      "(e.g., @username@domain), and it can be multiple.",
  )
  .option("-a, --authorized-fetch", "Sign the request with an one-time key.")
  .option(
    "--first-knock <spec:sig-spec>",
    "The first-knock spec for -a/--authorized-fetch.  It is used for " +
      "the double-knocking technique.",
    { depends: ["authorized-fetch"], default: "rfc9421" },
  )
  .option(
    "-t, --traverse",
    "Traverse the given collection to fetch all items.  If it is turned on, " +
      "the argument cannot be multiple.",
  )
  .option(
    "-S, --suppress-errors",
    "Suppress partial errors while traversing the collection.",
    { depends: ["traverse"] },
  )
  .option("-r, --raw", "Print the fetched JSON-LD document as is.", {
    conflicts: ["compact", "expand"],
  })
  .option("-C, --compact", "Compact the fetched JSON-LD document.", {
    conflicts: ["raw", "expand"],
  })
  .option("-e, --expand", "Expand the fetched JSON-LD document.", {
    conflicts: ["raw", "compact"],
  })
  .option("-u, --user-agent <string>", "The custom User-Agent header value.")
  .option(
    "-s, --separator <string>",
    "Specify the separator between adjacent output objects or " +
      "collection items.",
    { default: "----" },
  )
  .option(
    "-o, --output <file>",
    "Specify the output file path.",
  )
  .action(async (options, ...urls: string[]) => {
    if (urls.length < 1) {
      console.error("At least one URL or actor handle must be provided.");
      Deno.exit(1);
    } else if (options.traverse && urls.length > 1) {
      console.error(
        "The -t/--traverse option cannot be used with multiple arguments.",
      );
      Deno.exit(1);
    }

    const spinner = ora({
      text: `Looking up the ${
        options.traverse ? "collection" : urls.length > 1 ? "objects" : "object"
      }...`,
      discardStdin: false,
    }).start();
    let server: TemporaryServer | undefined = undefined;
    const documentLoader = await getDocumentLoader({
      userAgent: options.userAgent,
    });
    const contextLoader = await getContextLoader({
      userAgent: options.userAgent,
    });
    let authLoader: DocumentLoader | undefined = undefined;
    if (options.authorizedFetch) {
      spinner.text = "Generating a one-time key pair...";
      const key = await generateCryptoKeyPair();
      spinner.text = "Spinning up a temporary ActivityPub server...";
      server = await spawnTemporaryServer((req) => {
        const serverUrl = server?.url ?? new URL("http://localhost/");
        if (new URL(req.url).pathname == "/.well-known/webfinger") {
          const jrd: ResourceDescriptor = {
            subject: `acct:${serverUrl.hostname}@${serverUrl.hostname}`,
            aliases: [serverUrl.href],
            links: [
              {
                rel: "self",
                href: serverUrl.href,
                type: "application/activity+json",
              },
            ],
          };
          return new Response(JSON.stringify(jrd), {
            headers: { "Content-Type": "application/jrd+json" },
          });
        }
        return respondWithObject(
          new Application({
            id: serverUrl,
            preferredUsername: serverUrl?.hostname,
            publicKey: new CryptographicKey({
              id: new URL("#main-key", serverUrl),
              owner: serverUrl,
              publicKey: key.publicKey,
            }),
            manuallyApprovesFollowers: true,
            inbox: new URL("/inbox", serverUrl),
            outbox: new URL("/outbox", serverUrl),
          }),
          { contextLoader },
        );
      });
      authLoader = getAuthenticatedDocumentLoader(
        {
          keyId: new URL("#main-key", server.url),
          privateKey: key.privateKey,
        },
        {
          specDeterminer: {
            determineSpec() {
              return options.firstKnock;
            },
            rememberSpec() {
            },
          },
        },
      );
    }

    spinner.text = `Looking up the ${
      options.traverse ? "collection" : urls.length > 1 ? "objects" : "object"
    }...`;

    if (options.traverse) {
      const url = urls[0];
      const collection = await lookupObject(url, {
        documentLoader: authLoader ?? documentLoader,
        contextLoader,
        userAgent: options.userAgent,
      });
      if (collection == null) {
        spinner.fail(`Failed to fetch object: ${colors.red(url)}.`);
        if (authLoader == null) {
          console.error(
            "It may be a private object.  Try with -a/--authorized-fetch.",
          );
        }
        await server?.close();
        Deno.exit(1);
      }
      if (!(collection instanceof Collection)) {
        spinner.fail(
          `Not a collection: ${colors.red(url)}.  ` +
            "The -t/--traverse option requires a collection.",
        );
        await server?.close();
        Deno.exit(1);
      }
      spinner.succeed(`Fetched collection: ${colors.green(url)}.`);
      try {
        let i = 0;
        for await (
          const item of traverseCollection(collection, {
            documentLoader: authLoader ?? documentLoader,
            contextLoader,
            suppressError: options.suppressErrors,
          })
        ) {
          if (!options.output && i > 0) console.log(options.separator);
          await writeObjectToStream(item, options, contextLoader);
          i++;
        }
      } catch (error) {
        logger.error("Failed to complete the traversal: {error}", { error });
        spinner.fail("Failed to complete the traversal.");
        if (authLoader == null) {
          console.error(
            "It may be a private object.  Try with -a/--authorized-fetch.",
          );
        } else {
          console.error(
            "Use the -S/--suppress-errors option to suppress partial errors.",
          );
        }
        await server?.close();
        Deno.exit(1);
      }
      spinner.succeed("Successfully fetched all items in the collection.");

      await server?.close();
      Deno.exit(0);
    }

    const promises: Promise<Object | null>[] = [];
    for (const url of urls) {
      promises.push(
        lookupObject(
          url,
          {
            documentLoader: authLoader ?? documentLoader,
            contextLoader,
            userAgent: options.userAgent,
          },
        ),
      );
    }

    const objects = await Promise.all(promises);
    let success = true;
    let i = 0;
    for (const object of objects) {
      const url = urls[i];
      if (i > 0) console.log(options.separator);
      i++;
      try {
        if (object == null) {
          spinner.fail(`Failed to fetch object: ${colors.red(url)}.`);
          if (authLoader == null) {
            console.error(
              "It may be a private object.  Try with -a/--authorized-fetch.",
            );
          }
          success = false;
        } else {
          spinner.succeed(`Fetched object: ${colors.green(url)}.`);
          await writeObjectToStream(object, options, contextLoader);
          if (i < urls.length - 1) {
            console.log(options.separator);
          }
        }
      } catch (_) {
        success = false;
      }
    }
    if (success) {
      spinner.succeed(
        urls.length > 1
          ? "Successfully fetched all objects."
          : "Successfully fetched the object.",
      );
    }
    await server?.close();
    if (!success) {
      Deno.exit(1);
    }
    if (success && options.output) {
      spinner.succeed(
        `Successfully wrote output to ${colors.green(options.output)}.`,
      );
    }
  });

// cSpell: ignore sigspec
