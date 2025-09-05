import type { PageServerLoad } from "./$types";
import fedi from "$lib/federation";
import { error } from "@sveltejs/kit";
import { getUser } from "$lib/fetch";

export const load: PageServerLoad = async ({ request, params }) => {
  try {
    const ctx = fedi.createContext(request, undefined);
    const { identifier } = params;

    const user = await getUser(ctx, identifier);

    return { user };
  } catch {
    error(404, { message: "Not Found" });
  }
};
