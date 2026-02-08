import { message, object, option } from "@optique/core";

export const debugOption = object("Global options", {
  debug: option("-d", "--debug", {
    description: message`Enable debug mode.`,
  }),
});
