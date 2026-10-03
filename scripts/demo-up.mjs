#!/usr/bin/env node
/**
 * scripts/demo-up.mjs
 *
 * One command to bring the whole demo up:
 *   1. check Docker is running
 *   2. start Supabase (if not already up)
 *   3. reset + seed the database (pnpm demo:reset does migrations, pgTAP, security, seed)
 *   4. build + start the AI service container
 *   5. print how to open the app
 *
 * The mobile app still runs on the host (fast reload): the last line tells you the command.
 *
 * Usage: pnpm demo:up
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, opts = {}) => {
  console.log(`\n  -> ${cmd}`);
  const r = spawnSync(cmd, { shell: true, cwd: root, stdio: "inherit", ...opts });
  if (r.status !== 0) { console.error(`\n  x failed: ${cmd}`); process.exit(1); }
};
const quiet = (cmd) => spawnSync(cmd, { shell: true, cwd: root, stdio: "pipe" });

console.log("\n  BizFlow demo launcher\n");

// 1. Docker must be running.
if (quiet("docker info").status !== 0) {
  console.error("  x Docker is not running. Start Docker Desktop and try again.");
  process.exit(1);
}

// 2. Start Supabase if it is not already up (status exits non-zero when stopped).
console.log("  [1/3] Starting Supabase (if needed)...");
if (quiet("npx supabase status").status !== 0) {
  run("npx supabase start");
}

// 3. Reset + seed + verify.
console.log("\n  [2/3] Resetting and seeding the database...");
run("node scripts/demo-reset.mjs");

// 4. AI service in Docker — best-effort. The app demos fine without it (the forecast card
//    reads from the seed); only live voice parsing and fresh forecasts need it. So a build
//    failure (e.g. Docker Hub unreachable) warns but does not stop the demo.
console.log("\n  [3/3] Building and starting the AI service container...");
const ai = quiet("docker compose up -d --build ai");
const aiUp = ai.status === 0;
if (!aiUp) {
  console.warn("  ! AI service container could not start (often Docker Hub is unreachable).");
  console.warn("    The app still works - the forecast card uses seeded data.");
  console.warn("    Run the AI service on the host instead (no Docker needed):");
  console.warn("      pnpm ai    # in its own terminal");
}

console.log(`
  ==========================================================
   Database is up and seeded${aiUp ? ", AI service is running." : "."}

   Now start the app on the host:

       pnpm --filter mobile dev

   Then open http://localhost:8081 and tap a demo login.
   ${aiUp ? "AI service:  http://localhost:8000/v1/health" : ""}
   Studio:      http://localhost:54323
   ${aiUp ? "To stop the AI service later:  docker compose down" : ""}
  ==========================================================
`);
