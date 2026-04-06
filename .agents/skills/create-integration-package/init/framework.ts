// packages/init/src/webframeworks/프레임워크.ts
// The import paths are written based on the files in
// `packages/init/src/webframeworks/` where the actual files must exist,
// so do not modify them unless necessary.

import deps from "../json/deps.json" with { type: "json" };
import { WebFrameworkDescription } from "../types.ts";
import { defaultDenoDependencies, defaultDevDependencies } from "./const.ts";
import { getInstruction } from "./utils.ts";

const frameworkDescription: WebFrameworkDescription = {
  name: "프레임워크", // Fill 프레임워크 with the official framework name
  packageManagers: [
    // List the package managers that support this framework,
    // the list should be a subset of `PACKAGE_MANAGER` from `../const.ts`.
    // If the framework is compatible with all package managers,
    // you can just use `packageManagers: PACKAGE_MANAGER`.
  ],
  defaultPort: 0, // Fill in the default port of the framework
  init: ({
    // Destructure necessary parameters from the argument
    packageManager: pm,
  }) => ({
    command: [
      // Optional shell command to run before scaffolding e.g., `create-next-app`.
      // Split the command into an array of command and arguments,
      // e.g., `["npx", "create-next-app@latest"]`.
    ],
    dependencies: pm === "deno"
      ? {
        // Use `deps.json` for version numbers,
        // e.g., `"@fedify/프레임워크": deps["@fedify/프레임워크"]`.
        ...defaultDenoDependencies,
      }
      : {
        // Use `deps.json` for version numbers,
        // e.g., `"@fedify/프레임워크": deps["@fedify/프레임워크"]`.
      },
    devDependencies: {
      // Use `deps.json` for version numbers,
      // e.g., `"@fedify/프레임워크": deps["@fedify/프레임워크"]`.
      ...defaultDevDependencies,
    },
    federationFile: "**/federation.ts",
    loggingFile: "**/logging.ts",
    tasks: {
      // If `command` create a project with `tasks` in `deno.json` (or `script`s in
      // `package.json`) to run application, this could be unnecessary.
      // In the tasks of the finally generated application, at least include
      // a `dev` task to run the development server. `dev` task is used by
      // `mise test:init` to run tests against the generated project.
      // For Node.js/Bun, `lint: "eslint ."` is needed.
    },
    instruction: getInstruction(pm, 0 /* Replace with default port */),
  }),
};

export default frameworkDescription;
