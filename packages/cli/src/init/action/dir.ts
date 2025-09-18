import { mkdir } from "node:fs/promises";
import type { InitCommandData } from "../types.ts";

/**
 * Creates the target directory if it does not exist.
 *
 * @param data - The directory
 * @returns A promise that resolves when the directory is created
 */
export const makeDirIfHyd = ({ dir }: InitCommandData): //
Promise<string | undefined> => mkdir(dir, { recursive: true });
