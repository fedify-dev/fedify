import { mkdir } from "node:fs/promises";
import type { InitCommandData } from "../types.ts";

export const makeDirIfHyd = ({ dir }: InitCommandData) =>
  mkdir(dir, { recursive: true });
