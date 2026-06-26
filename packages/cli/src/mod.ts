#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import process from "node:process";
import { parseCliProgram } from "./runner.ts";

async function main() {
  const program = await parseCliProgram(process.argv.slice(2));
  await program.run();
}

await main();
