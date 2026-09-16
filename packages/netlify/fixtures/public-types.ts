import { getStore } from "@netlify/blobs";
import { NetlifyBlobsKvStore } from "../dist/mod.js";

new NetlifyBlobsKvStore(getStore({
  name: "fedify",
  consistency: "strong",
}));
