import { fedifyMiddleware } from "@fedify/solidstart";
import federation from "../lib/federation";

export default fedifyMiddleware(federation);
