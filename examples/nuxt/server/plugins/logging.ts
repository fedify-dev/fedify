import loggingConfigured from "../logging";

export default defineNitroPlugin(async () => {
  await loggingConfigured;
});
