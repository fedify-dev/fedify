import { entries, forEach, pipeLazy, tap, toArray, when } from "@fxts/core";
import { notEmpty } from "../utils.ts";
import type { InitCommandIo } from "../types.ts";
import { noticeConfigEnv, noticeEnvKeyValue } from "./notice.ts";

const recommendConfigEnv: InitCommandIo = pipeLazy(
  (data) => data.env,
  entries,
  toArray<Iterable<[string, string]>>,
  when(notEmpty, tap<[string, string][], void>(noticeConfigEnv)),
  forEach(noticeEnvKeyValue),
);

export default recommendConfigEnv;
