// Headless smoke test: a scripted chef plays Career 1-1 against the local server
// (npm run dev) until the shift ends, cooking every ticket through walk-in → prep → grill → pass.
// Run: node scripts/smoke.mjs
import { Client } from "@colyseus/sdk";

const URL = process.env.SERVER ?? "ws://localhost:2567";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PREP = { beef: "patty_raw", lettuce: "lettuce_chopped", tomato: "tomato_sliced", cheese: "cheese_sliced", potato: "potato_cut", onion: "onion_sliced", chicken: "chicken_breaded" };
const GRILL = { patty_raw: "patty_cooked", bun: "bun_toasted" };
const RAW = { bun_toasted: "bun", patty_cooked: "beef", lettuce_chopped: "lettuce", tomato_sliced: "tomato", cheese_sliced: "cheese", fries: "potato" };

const room = await new Client(URL).create("kitchen", { mode: "career", level: "1-1", name: "Smoke" });
const me = () => room.state.players.get(room.sessionId);
const hands = () => [...me().hands];
const log = [];
room.onMessage("*", (type, msg) => log.push(type === "toast" ? `toast: ${msg}` : type));
await sleep(300);

// Stand right in front of a station (the server only checks distance).
const at = async (station, x, z) => {
  room.send("move", { x, z, yaw: 0 });
  await sleep(120);
  return station;
};
const use = async (station, msg) => {
  room.send("use", { station, ...msg });
  await sleep(150);
};

room.send("start");
await sleep(300);
let cooked = 0;
for (let guard = 0; guard < 400 && room.state.phase === "service"; guard++) {
  if (room.state.cleanPlates === 0 && room.state.dirtyPlates > 0) {
    await use(await at("dishpit", -2.8, 1.2), { action: "scrub" });
    continue;
  }
  const tk = [...room.state.tickets].sort((a, b) => a.id - b.id).find((t) => t.have.length < t.need.length);
  if (!tk) {
    await sleep(500);
    continue;
  }
  const left = [...tk.need].filter((n, i, all) => [...tk.have].filter((h) => h === n).length < all.slice(0, i + 1).filter((x) => x === n).length);
  const items = left.map((n) => RAW[n]).slice(0, me().slots);
  await use(await at("walkin", -3.0, -1.0), { action: "take", items });
  for (const h of hands()) if (PREP[h]) await use(await at("prep1", -1.2, -1.2), { action: "chop", item: h, quality: 1 });
  for (const h of hands()) if (GRILL[h]) await use(await at("grill1", 0.6, -1.2), { action: "sear", item: h, result: "cooked", quality: 0.9 });
  const before = hands().join(",");
  await use(await at("pass", 0.2, 1.2), { action: "serve" });
  console.log(`ticket #${tk.id} ${tk.recipe}: took ${items.join("+")} → carried ${before} → hands after pass [${hands()}]`);
  cooked++;
  await sleep(400);
}
await sleep(500);
const s = room.state;
console.log(`phase=${s.phase} served=${s.served} missed=${s.missed} score=${s.score} stars=${s.stars} lastCall=${s.lastCall} elapsed=${s.elapsed.toFixed(1)}s`);
console.log("messages:", [...new Set(log)].join(" | "));
room.leave();
process.exit(s.phase === "results" && s.served >= 4 ? 0 : 1);
