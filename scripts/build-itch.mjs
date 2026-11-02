// Builds the game for itch.io and zips it, ready to upload as an HTML5 game.
// Usage: npm run build:itch -- wss://your-server.onrender.com
import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = process.argv[2] ?? process.env.VITE_SERVER_URL;

if (!server || !/^wss?:\/\//.test(server)) {
  console.error("Pass your game server's address, for example:\n  npm run build:itch -- wss://yeschef-io.onrender.com");
  process.exit(1);
}

console.log(`Building for itch.io, connecting to ${server} ...`);
execSync("npx vite build", { cwd: root, stdio: "inherit", env: { ...process.env, VITE_SERVER_URL: server } });

const zip = resolve(root, "yeschef-io-itch.zip");
if (existsSync(zip)) rmSync(zip);
const dist = resolve(root, "dist");
if (process.platform === "win32") {
  // Windows' built-in tar writes forward-slash paths; PowerShell's Compress-Archive writes
  // backslashes, which itch.io's servers can't resolve.
  execSync(`tar -a -c -f "${zip}" -C "${dist}" *`, { stdio: "inherit" });
} else {
  execSync(`cd "${dist}" && zip -r "${zip}" .`, { stdio: "inherit", shell: "/bin/sh" });
}
console.log(`\nDone: ${zip}\nUpload it on itch.io as an HTML game ("This file will be played in the browser").`);
