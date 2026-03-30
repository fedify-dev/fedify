import { fedifyMiddleware } from "@fedify/solidstart";
import federation from "../federation";

export default fedifyMiddleware(federation, (_event) => undefined);
