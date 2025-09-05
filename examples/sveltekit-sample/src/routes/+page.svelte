<script lang="ts">
  import type { PageData } from "./$types";

  export let data: PageData;
  const { addresses, host } = data;

  const bannerText = `
 _______  _______  _______   __   ___________    ____ 
|   ____||   ____||       \\ |  | |   ____\\   \\  /   / 
|  |__   |  |__   |  .--.  ||  | |  |__   \\   \\/   /  
|   __|  |   __|  |  |  |  ||  | |   __|   \\_    _/   
|  |     |  |____ |  '--'  ||  | |  |        |  |     
|__|     |_______||_______/ |__| |__|        |__|     `;
</script>

<main class="mx-auto my-8 grid max-w-[780px] gap-4 p-4">
  <img
    src="/fedify-svelte-logo.svg"
    alt="@fedify/svelte Logo"
    class="m-auto h-32 w-32"
  />
  <div
    class="flex flex-wrap justify-center font-mono leading-tight whitespace-pre"
  >
    <span>{bannerText}</span>
    <span class="content-end">
      with
      <a href="https://svelte.dev/">
        <img
          src="/svelte-horizontal.svg"
          alt="Svelte"
          class="inline-block w-24"
        />
      </a>
    </span>
  </div>
  <p>
    This small federated server app is a demo of
    <a href="https://fedify.dev" class="fedify-anchor" target="_blank">Fedify</a
    >. The only one thing it does is to accept follow requests.
  </p>
  <p>
    You can follow this demo app via the below handle:{" "}
    <code class="pre rounded-md bg-gray-100 px-2 py-1 text-black select-all">
      @demo@{host}
    </code>
  </p>

  {#if addresses.length === 0}
    <p>
      No followers yet. Try to add a follower using{" "}
      <a
        href="https://activitypub.academy/"
        target="_blank"
        class="text-blue-600"
      >
        ActivityPub.Academy
      </a>.
    </p>
  {:else}
    <p>This account has the below {addresses.length} followers:</p>
    <ul class="flex w-max flex-col items-stretch gap-1 font-mono">
      {#each addresses as address}
        <li class="pre flex-1 rounded-md bg-gray-100 px-2 py-1 text-black">
          {address}
        </li>
      {/each}
    </ul>
  {/if}
</main>
