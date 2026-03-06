import { useParams } from "@solidjs/router";
import { createAsync, query } from "@solidjs/router";
import { Show } from "solid-js";

const getProfile = query(async (identifier: string) => {
  "use server";
  const { relationStore } = await import("~/lib/store");
  const followers = Array.from(relationStore.values());
  return {
    identifier,
    name: "Fedify Demo",
    summary: "This is a Fedify Demo account on SolidStart.",
    followersCount: followers.length,
  };
}, "profile");

export default function UserProfile() {
  const params = useParams<{ identifier: string }>();
  const profile = createAsync(() => getProfile(params.identifier));

  return (
    <main>
      <h1>Fedify + SolidStart</h1>
      <Show when={profile()} fallback={<p>Loading...</p>}>
        {(p) => (
          <div class="profile">
            <h2>{p().name}</h2>
            <p>
              <code>@{p().identifier}</code>
            </p>
            <p>{p().summary}</p>
            <div class="followers">
              <strong>Followers:</strong> {p().followersCount}
            </div>
          </div>
        )}
      </Show>
      <p>
        Try:{" "}
        <code>
          curl -H "Accept: application/activity+json"
          http://localhost:3000/users/{params.identifier}
        </code>
      </p>
    </main>
  );
}
