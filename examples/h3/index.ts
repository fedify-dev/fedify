import {
  createApp,
  createRouter,
  defineEventHandler,
  setResponseHeader,
  toWebHandler,
} from "h3";
import { integrateFederation, onError } from "../src";
import { federation } from "./federation";

export const app = createApp({
  onError,
});

app.use(integrateFederation(federation, () => undefined));

const router = createRouter();
app.use(router);

router.get(
  "/users/:identifier",
  defineEventHandler((event) => {
    setResponseHeader(event, "Content-Type", "text/html");
    return `<h1>Hello ${event.context.params?.["identifier"]}</h1>`;
  }),
);

export default {
  fetch: toWebHandler(app),
};
