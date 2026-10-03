#!/usr/bin/env node
/**
 * scripts/demo-reset.mjs
 *
 * Single-command demo reset: wipes the local Supabase DB, re-applies all migrations,
 * re-seeds demo accounts, and prints the demo credentials.
 *
 * Usage: node scripts/demo-reset.mjs
 *   or:  pnpm demo:reset
 *
 * What it does:
 *   1. supabase db reset  (drops + recreates, runs migrations + seed.sql)
 *   2. Prints the three demo logins with OTP code.
 *   3. Optionally triggers the AI service data-sync endpoint so forecasts are warm.
 *
 * Exits 0 on success, 1 on failure.
 */

import { execSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// "Today" in Asia/Dhaka, so the banner always matches the data the seed just wrote.
const DEMO_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());

function run(cmd, opts = {}) {
  console.log(`\n  → ${cmd}`);
  const result = spawnSync(cmd, { shell: true, cwd: root, stdio: "inherit", ...opts });
  if (result.status !== 0) {
    console.error(`\n  ✗ Command failed: ${cmd}`);
    process.exit(1);
  }
}

function tryRun(cmd) {
  // Best-effort — used for optional steps like AI warm-up
  spawnSync(cmd, { shell: true, cwd: root, stdio: "pipe" });
}

console.log(`
╔══════════════════════════════════════════════════════╗
║   upay BizFlow — Demo Reset                         ║
║   This wipes all local data and re-seeds demo data. ║
╚══════════════════════════════════════════════════════╝
`);

// ── Step 1: DB reset ──────────────────────────────────────────────────────────
console.log("  [1/4] Resetting database (migrations + seed)…");
run("npx supabase db reset");

// ── Step 2: Verify pgTAP tests still pass ─────────────────────────────────────
console.log("\n  [2/4] Running pgTAP tests to confirm integrity…");
run("npx supabase test db");

// ── Step 3: Security checklist ────────────────────────────────────────────────
console.log("\n  [3/4] Running security checklist…");
run("node scripts/security-check.mjs");

// ── Step 4: Warm up AI service (best-effort) ──────────────────────────────────
console.log("\n  [4/4] Warming AI service forecasts (optional)…");
try {
  await fetch("http://localhost:8000/v1/internal/refresh-forecasts", {
    method: "POST",
    signal: AbortSignal.timeout(3000),
  });
} catch {
  // Service may not be running yet; optional
}

// ── Print demo credentials ────────────────────────────────────────────────────
console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║   ✅  Demo Ready — ${DEMO_DATE}                                  ║
╠══════════════════════════════════════════════════════════════════════════╣
║                                                                          ║
║  MERCHANT (Karim Store)                                                  ║
║    Phone:   01700000001                                                  ║
║    OTP:     123456                                                       ║
║    Role:    merchant_owner                                               ║
║                                                                          ║
║  AGENT (Rahim Agent Point)                                               ║
║    Phone:   01700000002                                                  ║
║    OTP:     123456                                                       ║
║    Role:    agent_owner                                                  ║
║                                                                          ║
║  STAFF (Karim Store — restricted)                                        ║
║    Phone:   01700000003                                                  ║
║    OTP:     123456                                                       ║
║    Role:    staff (can_add_entries only)                                 ║
║                                                                          ║
║  ADMIN CONSOLE                                                           ║
║    URL:     http://localhost:8081/admin                                  ║
║    Supabase Studio: http://localhost:54323                               ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝
`);
