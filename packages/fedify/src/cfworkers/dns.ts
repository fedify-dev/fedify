import type { LookupAddress } from "node:dns";

// Only the Workers test bundle aliases node:dns/promises to this module.
// Keep the default object mutable so DNS failure tests can replace lookup.
// These names are mocked by the tests; never consult the real network.
const publicHosts = new Set([
  "example.com",
  "example.org",
  "example.net",
  "example2.com",
  "example3.com",
  "example4.com",
  "example5.com",
  "ap.example.com",
  "www.example.com",
  "testing.example.org",
]);

export default {
  lookup(
    hostname: string,
    options: { all: true },
  ): Promise<LookupAddress[]> {
    if (!options.all || !publicHosts.has(hostname)) {
      return Promise.reject(new Error(`No DNS fixture for ${hostname}`));
    }
    return Promise.resolve([{ address: "8.8.8.8", family: 4 }]);
  },
};
