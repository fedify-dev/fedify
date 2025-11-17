import { integrateHandler } from "@fedify/fresh";
import { App, staticFiles } from "fresh";
import { federation } from "./federation.ts";
import { define, type State } from "./utils.ts";

export const app = new App<State>();

app.use(staticFiles());

// Include file-system based routes here
app.fsRoutes();

// Fedify Integration Example

const fedifyMiddleware = define.middleware(
  integrateHandler<void, State>(federation, () => undefined),
);

app.use(fedifyMiddleware);
