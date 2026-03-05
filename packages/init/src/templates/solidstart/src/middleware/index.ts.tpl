import { fedifyMiddleware } from "@fedify/solidstart";
import federation from "../federation.ts";

export default fedifyMiddleware(federation, (_event) => undefined);
