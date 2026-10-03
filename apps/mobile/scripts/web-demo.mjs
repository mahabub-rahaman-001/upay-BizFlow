// Starts the web app on sample data with no backend (docs/16 section 5).
import { spawn } from "node:child_process";

const port = process.env.PORT ?? "8082";
const child = spawn("npx", ["expo", "start", "--web", "--port", port], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, EXPO_PUBLIC_DATA_SOURCE: "demo", BROWSER: "none", CI: "1" },
});
child.on("exit", (code) => process.exit(code ?? 0));
