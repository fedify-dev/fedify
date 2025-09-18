import { map, peek, pipeLazy, tap, toArray, unless, when } from "@fxts/core";
import { notEmpty } from "../../utils.ts";
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
  toArray,
  when(notEmpty<[string, string][]>, tap(noticeDepsIfExist)),
  peek(noticeDeps),
);

const recommendDevDeps: InitCommandIo = pipeLazy(
  getDevDependencies,
  Object.entries<string>,
  toArray,
  when(notEmpty<[string, string][]>, tap(noticeDevDepsIfExist)),
  map(noticeDeps),
);

const recommendDependencies: InitCommandIo = pipeLazy(
  tap(recommendDeps),
  unless(isDeno, tap(recommendDevDeps)),
);

export default recommendDependencies;
