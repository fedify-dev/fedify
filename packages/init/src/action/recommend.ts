import { map, peek, pipeLazy, tap, unless, when } from "@fxts/core";
import { notEmpty } from "../utils.ts";
import type { InitCommandIo } from "../types.ts";
import { getDependencies, getDevDependencies } from "./deps.ts";
import {
  noticeDeps,
  noticeDepsIfExist,
  noticeDevDepsIfExist,
} from "./notice.ts";
import { isDeno } from "./utils.ts";

const recommendDeps: InitCommandIo = pipeLazy(
  getDependencies,
  Object.entries<string>,
  when(notEmpty<[string, string][]>, tap(noticeDepsIfExist)),
  peek(noticeDeps),
);

const recommendDevDeps: InitCommandIo = pipeLazy(
  getDevDependencies,
  Object.entries<string>,
  when(notEmpty<[string, string][]>, tap(noticeDevDepsIfExist)),
  map(noticeDeps),
);

/**
 * Recommends dependencies and devDependencies to be added to package.json.
 * Skips devDependencies recommendation if the package manager is Deno.
 *
 * @param data - The initialization command data
 * @returns An InitCommandIo function that performs the recommendation
 */
const recommendDependencies: InitCommandIo = pipeLazy(
  tap(recommendDeps),
  unless(isDeno, tap(recommendDevDeps)),
);

export default recommendDependencies;
