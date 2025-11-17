import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
export default define.page(function Home(ctx) {
  console.log("Shared value " + ctx.state.shared);

  return (
    <div class="px-4 py-8 mx-auto fresh-gradient min-h-screen">
      <Head>
        <title>Fresh counter</title>
      </Head>
      <div class="max-w-screen-md mx-auto flex flex-col items-center justify-center">
        <img
          class="my-6"
          src="/logo.svg"
          width="128"
          height="128"
          alt="the Fedify logo"
        />
        <h1 class="text-4xl font-bold">Welcome to Fresh & Fedify</h1>
        <p class="my-4">
          Hello, Fediverse!
        </p>
      </div>
    </div>
  );
});
