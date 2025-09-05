import type { PageServerLoad } from "./$types";
import { relationStore } from "$lib/store";

export const load: PageServerLoad = ({ request, url }) => {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost || request.headers.get("host") || url.host;

  const addresses = Array.from(relationStore.keys());

  return {
    host,
    addresses,
  };
};
