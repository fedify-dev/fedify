import env from "#start/env";
import { defineConfig, drivers } from "@adonisjs/core/encryption";
import type { InferEncryptors } from "@adonisjs/core/types";

/**
 * Encryption configuration.
 *
 * Required by AdonisJS's app provider even though this example neither signs
 * cookies nor holds a session; without it the application fails to boot.
 */
const encryptionConfig = defineConfig({
  default: "gcm",
  list: {
    gcm: drivers.aes256gcm({
      keys: [env.get("APP_KEY")],
      id: "gcm",
    }),
  },
});

export default encryptionConfig;

declare module "@adonisjs/core/types" {
  export interface EncryptorsList
    extends InferEncryptors<typeof encryptionConfig> {}
}
