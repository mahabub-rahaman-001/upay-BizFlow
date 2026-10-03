#!/usr/bin/env node
/**
 * scripts/ai-start.mjs
 *
 * Starts the AI service on the host - no Docker, no Docker Hub. It creates the virtualenv
 * and installs dependencies the first time, then runs uvicorn in the foreground. Run it in
 * its own terminal; stop it with Ctrl+C.
 *
 * This is the reliable way to run the AI service when Docker Hub is unreachable (the host
 * already has Python). Docker remains available via `pnpm ai:up` when the network allows.
 *
 * Usage: pnpm ai
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svc = join(root, "apps", "ai-service");
const isWin = process.platform === "win32";
const venv = join(svc, ".venv");
const venvPy = isWin ? join(venv, "Scripts", "python.exe") : join(venv, "bin", "python");

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: svc, stdio: "inherit", ...opts });
  if (r.status !== 0) { console.error(`\n  x failed: ${cmd} ${args.join(" ")}`); process.exit(1); }
}

// Pick a Python to bootstrap the venv with: prefer the 3.x launcher on Windows.
function basePython() {
  for (const [c, a] of [["py", ["-3"]], ["python3", []], ["python", []]]) {
    const r = spawnSync(c, [...a, "--version"], { stdio: "pipe" });
    if (r.status === 0) return [c, a];
  }
  console.error("  x No Python found. Install Python 3.12+ and try again.");
  process.exit(1);
}

console.log("\n  BizFlow AI service (host)\n");

if (!existsSync(venvPy)) {
  const [py, pre] = basePython();
  console.log("  [1/3] Creating virtualenv...");
  run(py, [...pre, "-m", "venv", ".venv"]);
  console.log("  [2/3] Installing dependencies (first run, this takes a minute)...");
  run(venvPy, ["-m", "pip", "install", "--quiet", "--upgrade", "pip"]);
  run(venvPy, ["-m", "pip", "install", "--quiet", "-r", "requirements.txt"]);
} else {
  console.log("  [1/3] virtualenv found");
  console.log("  [2/3] dependencies assumed installed (delete apps/ai-service/.venv to rebuild)");
}

console.log("  [3/3] Starting uvicorn on http://localhost:8000 ...  (Ctrl+C to stop)\n");
run(venvPy, ["-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]);
