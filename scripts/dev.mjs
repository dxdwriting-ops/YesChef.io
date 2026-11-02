// Starts the Colyseus game server and the Vite client together. Ctrl+C stops both.
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Always run from the project folder, wherever this script was started from.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const procs = [
  ["server", "npm run server", { GAME_PORT: "2567" }],
  ["client", "npm run client", {}],
].map(([name, cmd, env]) => {
  const child = spawn(cmd, { shell: true, stdio: "inherit", cwd: root, env: { ...process.env, ...env } });
  child.on("exit", (code) => {
    console.log(`[${name}] exited with code ${code}`);
    shutdown();
  });
  return child;
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const child of procs) child.kill();
  process.exit();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
