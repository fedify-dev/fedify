import federation from "./federation.ts";

async function fetchActivityJson(path: string): Promise<unknown> {
  const response = await federation.fetch(
    new Request(new URL(path, "https://example.com"), {
      headers: { Accept: "application/activity+json" },
    }),
    { contextData: undefined },
  );

  if (!response.ok) {
    throw new Error(`${path}: ${response.status} ${await response.text()}`);
  }
  return await response.json();
}

async function fetchStatus(path: string): Promise<number> {
  const response = await federation.fetch(
    new Request(new URL(path, "https://example.com"), {
      headers: { Accept: "application/activity+json" },
    }),
    { contextData: undefined },
  );

  const status = response.status;
  await response.body?.cancel();
  return status;
}

async function printActivityJson(label: string, path: string): Promise<void> {
  console.log(`\n## ${label}`);
  console.log(JSON.stringify(await fetchActivityJson(path), null, 2));
}

async function printActivityStatus(
  label: string,
  path: string,
): Promise<void> {
  console.log(`\n## ${label}`);
  console.log(await fetchStatus(path));
}

async function main(): Promise<void> {
  await printActivityJson("Actor with custom collection links", "/users/alice");
  await printActivityJson(
    "Public bookmarks collection",
    "/users/alice/collections/public",
  );
  await printActivityJson(
    "Public bookmarks first page",
    "/users/alice/collections/public?cursor=0",
  );
  await printActivityJson(
    "Tag-filtered ActivityPub bookmarks collection",
    "/users/alice/collections/tags/activitypub",
  );
  await printActivityJson(
    "Tag-filtered ActivityPub bookmarks first page",
    "/users/alice/collections/tags/activitypub?cursor=0",
  );
  await printActivityStatus(
    "Followers-only collection requested without a signature",
    "/users/alice/collections/followers-only",
  );
  await printActivityStatus(
    "Followers-only first page requested without a signature",
    "/users/alice/collections/followers-only?cursor=0",
  );
}

if (import.meta.main) {
  await main();
}
