import type { PageServerLoad } from "./$types";
import fedi from "$lib/federation";
import { error } from "@sveltejs/kit";
import { getPost, getUser } from "$lib/fetch";

export const load: PageServerLoad = async ({ request, params }) => {
  try {
    const ctx = fedi.createContext(request, undefined);
    const { identifier, id } = params;

    const user = await getUser(ctx, identifier);
    const post = await getPost(ctx, identifier, id);
    return { user, post };
  } catch {
    error(404, { message: "Not Found" });
  }
};
