
import { integrateFederation } from "@fedify/h3";
import federation from "../federation"

export default integrateFederation(
  federation,
  (event, request) => undefined,
);