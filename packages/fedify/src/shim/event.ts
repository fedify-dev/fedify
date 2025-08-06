import process from "node:process";

export function addEventListener(event: "unload", listener: () => void): void {
  if (event !== "unload") {
    throw new TypeError(`Unsupported event type: ${event}.`);
  }
  process.on("exit", listener);
}
