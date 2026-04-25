import { Note, Person } from "@fedify/vocab";

declare global {
  var keyPairsStore: Map<string, Array<CryptoKeyPair>>;
  var relationStore: Map<string, Person>;
  var postStore: PostStore;
  var followingStore: Map<string, Person>;
}

class PostStore {
  #map: Map<string, Note> = new Map();
  #timeline: URL[] = [];
  constructor() {}
  append(posts: Note[]) {
    for (const p of posts) {
      if (!p.id) continue;
      const key = p.id.toString();
      if (this.#map.has(key)) continue;
      this.#map.set(key, p);
      this.#timeline.push(p.id);
    }
  }
  get(id: URL) {
    return this.#map.get(id.toString());
  }
  getAll() {
    return this.#timeline.toReversed()
      .map((id) => id.toString())
      .map((id) => this.#map.get(id)!)
      .filter((p) => p);
  }
  delete(id: URL) {
    const existed = this.#map.delete(id.toString());
    if (existed) {
      this.#timeline = this.#timeline.filter((i) => i.href !== id.href);
    }
  }
}

const keyPairsStore = globalThis.keyPairsStore ?? new Map();
const relationStore = globalThis.relationStore ?? new Map();
const postStore = globalThis.postStore ?? new PostStore();
const followingStore = globalThis.followingStore ?? new Map();

// this is just a hack for the demo
// never do this in production, use safe and secure storage
globalThis.keyPairsStore = keyPairsStore;
globalThis.relationStore = relationStore;
globalThis.postStore = postStore;
globalThis.followingStore = followingStore;

export { followingStore, keyPairsStore, postStore, relationStore };
