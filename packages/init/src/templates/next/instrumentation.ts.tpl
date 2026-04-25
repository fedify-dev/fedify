export async function register() {
  if (globalThis.process?.env.NEXT_RUNTIME === "nodejs") {
    await import("./logging");
  }
}
