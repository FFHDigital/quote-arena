// Hosts with a single container run the job worker inside the web server.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.ARENA_EMBEDDED_WORKER === "1") {
    const { runWorker } = await import("./lib/worker");
    runWorker().catch((err) => console.error("Embedded worker stopped:", err));
  }
}
