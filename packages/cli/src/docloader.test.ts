import assert from "node:assert/strict";
import test from "node:test";
import { getDocumentLoaderCachePrefix } from "./docloader.ts";

test("getDocumentLoaderCachePrefix - isolates strict and permissive policies", () => {
  const strictPrefix = getDocumentLoaderCachePrefix("fedify-cli", false);
  const permissivePrefix = getDocumentLoaderCachePrefix("fedify-cli", true);
  assert.notDeepEqual(strictPrefix, permissivePrefix);
});

test("getDocumentLoaderCachePrefix - includes user agent namespace", () => {
  const prefixA = getDocumentLoaderCachePrefix("agent-a", false);
  const prefixB = getDocumentLoaderCachePrefix("agent-b", false);
  assert.notDeepEqual(prefixA, prefixB);
});
