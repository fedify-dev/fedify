import type { Note, Person } from "@fedify/vocab";

declare global {
  var keyPairsStore: Map<string, Array<CryptoKeyPair>>;
  var relationStore: Map<string, Person>;
  var postStore: PostStore;
}

class PostStore {
  #map: Map<string, Note> = new Map();
  #timeline: URL[] = [];
  constructor() {}
  #append(posts: Note[]) {
    posts.filter((p) => p.id && !this.#map.has(p.id.toString()))
      .forEach((p) => {
        this.#map.set(p.id!.toString(), p);
        this.#timeline.push(p.id!);
      });
  }
  append = this.#append.bind(this);
  #get(id: URL) {
    return this.#map.get(id.toString());
  }
  get = this.#get.bind(this);
  #getAll() {
    return this.#timeline.toReversed()
      .map((id) => id.toString())
      .map((id) => this.#map.get(id)!)
      .filter((p) => p);
  }
  getAll = this.#getAll.bind(this);
  #delete(id: URL) {
    const existed = this.#map.delete(id.toString());
    if (existed) {
      this.#timeline = this.#timeline.filter((i) => i !== id);
    }
  }
  delete = this.#delete.bind(this);
}

export const keyPairsStore = globalThis.keyPairsStore ?? new Map();
export const relationStore = globalThis.relationStore ?? new Map();
export const postStore = globalThis.postStore ?? new PostStore();

// this is just a hack to demo svelte
// never do this in production, use safe and secure storage
globalThis.keyPairsStore = keyPairsStore;
globalThis.relationStore = relationStore;
globalThis.postStore = postStore;
