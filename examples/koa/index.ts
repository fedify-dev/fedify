import { createMiddleware } from "@fedify/koa";
import Koa from "koa";
import { federation } from "./federation.ts";

export const app = new Koa();

app.proxy = true;

app.use(createMiddleware(federation, () => undefined));

app.use((ctx) => {
  if (ctx.path.startsWith("/users/")) {
    ctx.type = "html";
    ctx.body = `<p>Hello, ${ctx.path.split("/")[2]}!</p>`;
  }
});

app.listen(3000, () => {
  console.log("Listening on http://localhost:3000");
});
