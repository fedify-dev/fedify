import { maintainers } from "./team.mts";

export interface Contributor {
  id: number;
  login: string;
  type: string;
}

// Keep explicit agent IDs here as well as filtering GitHub's Bot account type.
// Do not match names such as "claude": those can belong to human contributors.
const excludedIds = new Set<number>([
  ...maintainers.map((member) => member.id),
  209825114, // claude[bot]
]);

export function parseContributors(value: unknown): Contributor[] {
  if (!Array.isArray(value)) throw new Error("Invalid contributors response");
  return value.map((item) => {
    if (
      item == null || !Number.isSafeInteger(item.id) || item.id <= 0 ||
      typeof item.login !== "string" ||
      !/^[a-z\d-]+(?:\[bot\])?$/i.test(item.login) ||
      typeof item.type !== "string"
    ) throw new Error("Invalid contributor");
    return { id: item.id, login: item.login, type: item.type };
  });
}

export function visibleContributors(people: Contributor[]): Contributor[] {
  return [...new Map(
    people
      .filter((person) => person.type === "User" && !excludedIds.has(person.id))
      .map((person) => [person.id, person]),
  ).values()]
    .sort((a, b) =>
      a.login.toLowerCase().localeCompare(b.login.toLowerCase(), "en")
    );
}

/** Fetch every page before returning, so failures never publish a partial list. */
export async function fetchContributors(
  options: { token?: string; signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<Contributor[]> {
  const request = options.fetch ?? fetch;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const people: Contributor[] = [];
  for (let page = 1; page <= 100; page++) {
    const response = await request(
      `https://api.github.com/repos/fedify-dev/fedify/contributors?per_page=100&page=${page}`,
      { headers, signal: options.signal },
    );
    if (!response.ok) {
      throw new Error(`Contributors request failed: ${response.status}`);
    }
    const batch = parseContributors(await response.json());
    people.push(...batch);
    if (batch.length < 100) return visibleContributors(people);
  }
  throw new Error("Too many contributor pages");
}
