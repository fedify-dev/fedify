import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The root of the stub templates shipped with this package.
 *
 * Used by `configure.ts` and by `node ace eject <stub> --pkg=@fedify/adonisjs`
 * when an application wants to customise a generated file.
 */
export const stubsRoot: string = dirname(fileURLToPath(import.meta.url));
