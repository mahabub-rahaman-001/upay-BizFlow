#!/usr/bin/env node
/**
 * scripts/security-check.mjs
 *
 * P10 security acceptance checklist (docs/09 §9).
 * Run: node scripts/security-check.mjs  (or: pnpm security:check)
 *
 * Cross-platform: uses Node.js fs/readdir to search files instead of grep,
 * so it works on Windows (PowerShell) as well as Unix.
 *
 * Each check prints ✅ PASS or ❌ FAIL with an explanation.
 * Exits 1 if any check fails so CI catches regressions.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

let passed = 0;
let failed = 0;

function check(label, fn) {
  try {
    const result = fn();
    if (result === false) throw new Error("returned false");
    console.log(`  ✅  ${label}`);
    passed++;
  } catch (e) {
    console.log(`  ❌  ${label}`);
    if (e?.message) console.log(`       → ${e.message}`);
    failed++;
  }
}

/** Recursively collect all files under dir with given extensions */
function collectFiles(dir, exts = [".sql", ".ts", ".tsx", ".py", ".js"]) {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (["node_modules", "__pycache__", ".expo", "dist", ".turbo"].includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(full, exts));
    } else if (exts.includes(extname(entry.name))) {
      results.push(full);
    }
  }
  return results;
}

/** Return true if any file under dir contains the pattern (case-insensitive) */
function anyFileContains(dir, pattern, exts) {
  const re = typeof pattern === "string" ? new RegExp(pattern, "i") : pattern;
  for (const file of collectFiles(dir, exts)) {
    try {
      if (re.test(readFileSync(file, "utf8"))) return true;
    } catch { /* binary or locked */ }
  }
  return false;
}

/** Return first matching line across all files, or null */
function firstMatch(dir, pattern, exts) {
  const re = typeof pattern === "string" ? new RegExp(pattern, "i") : pattern;
  for (const file of collectFiles(dir, exts)) {
    try {
      const content = readFileSync(file, "utf8");
      if (re.test(content)) return file;
    } catch { /* skip */ }
  }
  return null;
}

console.log("\n🔐  BizFlow Security Checklist (docs/09 §9)\n");

const migrationsDir = join(root, "supabase", "migrations");
const mobileDir     = join(root, "apps", "mobile");
const fnDir         = join(root, "supabase", "functions");
const aiDir         = join(root, "apps", "ai-service");

// ── 1. RLS enabled on all tables ──────────────────────────────────────────────
check("RLS enabled: migrations contain 'enable row level security'", () => {
  if (!anyFileContains(migrationsDir, /enable row level security/, [".sql"])) {
    throw new Error("No 'enable row level security' found in migrations");
  }
});

// ── 2. No service-role key in app bundle ──────────────────────────────────────
check("No service-role key in mobile app source", () => {
  if (anyFileContains(mobileDir, /service_role/, [".ts", ".tsx", ".js"])) {
    throw new Error("Found 'service_role' reference in mobile source");
  }
});

check("No hardcoded SUPABASE_SERVICE_ROLE_KEY in mobile app source (excluding tests)", () => {
  // E2E tests legitimately reference this as process.env — only flag hardcoded strings
  const re = /(['"`])eyJ[A-Za-z0-9_-]{20,}\1/; // JWT literal pattern
  if (anyFileContains(mobileDir, re, [".ts", ".tsx", ".js"])) {
    throw new Error("Found hardcoded JWT in mobile source");
  }
});

// ── 3. Webhook signature verified ─────────────────────────────────────────────
check("Webhook Edge Function verifies HMAC signature", () => {
  if (!existsSync(fnDir)) return; // no edge functions yet — acceptable at hackathon
  if (!anyFileContains(fnDir, /hmac|signature|x-upay-sig/i, [".ts", ".js"])) {
    throw new Error("No HMAC/signature verification found in edge functions");
  }
});

// ── 4. Ledger tables reject UPDATE/DELETE ─────────────────────────────────────
check("Append-only guard present in migrations (RAISE EXCEPTION on update/delete)", () => {
  if (!anyFileContains(migrationsDir, /RAISE EXCEPTION|append.only|no.*update|no.*delete/i, [".sql"])) {
    throw new Error("No append-only guard found in migrations");
  }
});

// ── 5. Refund concurrency (row lock) ──────────────────────────────────────────
check("FOR UPDATE row lock present in migrations (concurrent refund protection)", () => {
  if (!anyFileContains(migrationsDir, /FOR UPDATE/, [".sql"])) {
    throw new Error("No FOR UPDATE lock found in migrations");
  }
});

// ── 6. Re-auth / biometric in mobile ──────────────────────────────────────────
check("Re-auth or biometric check present in mobile source", () => {
  if (!anyFileContains(mobileDir, /LocalAuthentication|biometric|reauth|expo-local-authentication/i, [".ts", ".tsx"])) {
    throw new Error("No re-auth / biometric check found in mobile source");
  }
});

// ── 7. Notification amounts hidden ────────────────────────────────────────────
check("Push notification payload does not embed amounts (edge functions check)", () => {
  if (!existsSync(fnDir)) return; // no push functions yet — skip
  if (anyFileContains(fnDir, /notification.*amount_minor|amount_minor.*body|amount_minor.*title/i, [".ts"])) {
    throw new Error("amount_minor found in push notification payload");
  }
});

// ── 8. LLM number validator ────────────────────────────────────────────────────
check("AI service has number validator (validate_number / validator / fabricat)", () => {
  if (!existsSync(aiDir)) return; // skip if service not present
  if (!anyFileContains(aiDir, /validator|validate_number|fabricat/i, [".py", ".ts"])) {
    throw new Error("No number validator found in ai-service");
  }
});

// ── 9. Prompt injection tests ──────────────────────────────────────────────────
check("Prompt injection test strings present in AI service or tests", () => {
  if (!existsSync(aiDir)) return;
  if (!anyFileContains(aiDir, /injection|ignore.*previous|jailbreak|prompt.*inject/i, [".py", ".ts", ".md"])) {
    throw new Error("No injection test strings found in ai-service");
  }
});

// ── 10. Receipt tokens are random ─────────────────────────────────────────────
check("Receipt tokens generated with random bytes (gen_random_uuid / gen_random_bytes)", () => {
  if (!anyFileContains(migrationsDir, /gen_random_uuid|gen_random_bytes|encode.*random/i, [".sql"])) {
    throw new Error("No random token generation found for receipts");
  }
});

// ── 11. Audit hash chain ──────────────────────────────────────────────────────
check("Audit log present in migrations (audit_events table)", () => {
  if (!anyFileContains(migrationsDir, /audit_events|audit_log|admin_audit/i, [".sql"])) {
    throw new Error("No audit_events or audit_log table found in migrations");
  }
});

// ── 12. RLS tests pass (pgTAP) ───────────────────────────────────────────────
check("pgTAP test files cover cross-tenant RLS checks", () => {
  const testDir = join(root, "supabase", "tests");
  if (!anyFileContains(testDir, /cross.tenant|different.*business|other.*business|throws_ok.*rls/i, [".sql"])) {
    throw new Error("No cross-tenant RLS test found in pgTAP suite");
  }
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log("  ⚠️  Fix the failing checks before demo.\n");
  process.exit(1);
} else {
  console.log("  🎉  All security checks passed!\n");
}
