import * as THREE from "three";
import { Client, type Room } from "@colyseus/sdk";
import {
  CHEF_COLORS,
  INTERACT_RANGE,
  ITEM_NAMES,
  PINGS,
  PREP_RESULT,
  RECIPES,
  comboMultiplier,
  distanceToStation,
  isItem,
  modLabel,
  type RecipeId,
  type StationDef,
} from "../shared/game";
import { LAYOUTS } from "../shared/layouts";
import { CAREER_LEVELS, challenges, goalText, rulesFor, type Rules } from "../shared/modes";
import { adsEnabled, initAds, interstitial, rewarded, showBanner } from "./ads";
import { Avatars } from "./avatars";
import { FirstPersonControls } from "./controls";
import { nextStep } from "./guide";
import { Hud } from "./hud";
import { itemSprite, setIcon } from "./icons";
import { initMenu, type PlayRequest } from "./menu";
import { Minigames } from "./minigames";
import { Music } from "./music";
import { award, has, loadProfile, perksOf, saveProfile, type ShiftEvents } from "./profile";
import { PixelRenderer, QUALITY_LABEL, isQuality, nextQuality, type Quality } from "./render";
import { Sfx } from "./sfx";
import { TRAINING_DONE, TRAINING_INTRO, coachFor } from "./tutorial";
import type { KitchenView } from "./types";
import { KitchenWorld } from "./world";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// Where the kitchen server lives:
// - an explicit VITE_SERVER_URL (the itch.io build points at the Render server),
// - local dev (Vite on :5173) talks to the game server on :2567,
// - otherwise the game is served by the game server itself, so use the same origin.
const SERVER_URL =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ??
  (location.port === "5173"
    ? `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:2567`
    : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);

function load(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the game works without remembering.
  }
}

// ---------- Menus ----------

const profile = loadProfile();
const menu = initMenu(profile, (req) => void play(req));
let playing = false;
initAds(); // no-op unless an ad network is configured, and always off on itch.io
showBanner($("ad-banner"));

// "Next shift" and "Main menu" reload the page; a queued request picks up where we left off.
try {
  const next = sessionStorage.getItem("chefio.next");
  if (next) {
    sessionStorage.removeItem("chefio.next");
    void play(JSON.parse(next) as PlayRequest);
  }
} catch {
  // No session storage: start from the menu.
}

async function backToMenu(next?: PlayRequest) {
  try {
    if (next) sessionStorage.setItem("chefio.next", JSON.stringify(next));
  } catch {
    // Can't queue it; the menu is fine.
  }
  await interstitial("between-shifts"); // ad break only between shifts, never mid-service
  location.reload();
}

async function play(req: PlayRequest) {
  if (playing) return;
  playing = true;
  const opts = {
    mode: req.mode,
    tier: req.tier,
    level: req.level,
    challenge: req.challenge,
    perks: perksOf(profile),
    name: profile.name || "Chef",
    color: profile.apron,
    skin: profile.skin,
    hat: profile.hat,
    jacket: profile.jacket,
  };
  try {
    const client = new Client(SERVER_URL);
    // Quick play matchmakes into a shared kitchen; everything else gets a private one.
    const room = req.mode === "quick" ? await client.joinOrCreate("kitchen", opts) : await client.create("kitchen", opts);
    await document.fonts.ready; // labels and the menu board are drawn with the pixel font
    $("title").hidden = true;
    $("hud").hidden = false;
    startGame(room, rulesFor(opts), req);
  } catch (err) {
    console.error(err);
    playing = false;
    $("title").hidden = false;
    menu.error(`Couldn't reach the kitchen server at ${SERVER_URL}. Is it running? (npm run dev)`);
  }
}

// ---------- Game ----------

function startGame(room: Room, rules: Rules, req: PlayRequest) {
  const layout = LAYOUTS[rules.layout];
  const canvas = $<HTMLCanvasElement>("game");
  const savedQuality = load("chefio.quality");
  const pixel = new PixelRenderer(canvas, isQuality(savedQuality) ? savedQuality : "hd");
  const music = new Music();
  music.start(); // started from a click, so the browser allows audio
  const camera = pixel.camera;
  const world = new KitchenWorld(layout, rules.recipes, { ready: rules.fryReady, burnt: rules.fryBurnt });
  world.addDecor(profile.decor);
  world.scene.add(camera);
  const controls = new FirstPersonControls(camera, canvas, world.colliders, layout);
  controls.speedMul = has(profile, "clogs") ? 1.1 : 1;
  const avatars = new Avatars(world.scene);
  const sfx = new Sfx();
  const hud = new Hud(
    () => {
      // "Run it back" from the results screen is a natural ad break; starting from the lobby isn't.
      if (state?.phase === "results") void interstitial("run-it-back").then(() => room.send("start"));
      else room.send("start");
    },
    () => room.send("train"),
  );
  hud.flipAfter = rules.flipAfter;
  const minigames = new Minigames((text) => hud.toast(text), sfx);

  // The waiting room adapts to the mode.
  const career = req.mode === "career" ? CAREER_LEVELS.find((l) => l.id === req.level) : undefined;
  const challenge = req.mode === "challenge" ? challenges().find((c) => c.id === req.challenge) : undefined;
  const goals = career ? goalText(career.goal) : null;
  const solo = req.mode !== "quick";
  $("lobby-title").textContent = solo ? rules.title : `Multiplayer: ${rules.title}`;
  hud.lobbyText = career ? career.story : challenge ? challenge.blurb : `${layout.name} kitchen. Matching you with other chefs...`;
  $("checklist").hidden = solo;
  $("train").hidden = solo;
  $("start-service").textContent = solo ? "Start shift" : "Start now";
  if (goals) {
    $("lobby-goals").hidden = false;
    $("lobby-goals").innerHTML = goals.map((g) => `<li>${g}</li>`).join("");
  }

  document.querySelectorAll(".to-menu").forEach((b) => b.addEventListener("click", () => backToMenu()));
  const nextLevel = career ? CAREER_LEVELS[CAREER_LEVELS.indexOf(career) + 1] : undefined;
  $("next-level").addEventListener("click", () => nextLevel && backToMenu({ mode: "career", level: nextLevel.id }));

  // What you're carrying, floating in the lower right of your view.
  const held = itemSprite(0.15);
  (held.material as THREE.SpriteMaterial).depthTest = false;
  held.position.set(0.17, -0.12, -0.34);
  held.renderOrder = 10;
  camera.add(held);

  let state: KitchenView | null = null;
  let placed = false;
  let time = 0;
  let prevHolding = "";
  let prevPhase = "";
  let helperOn = load("chefio.helper") === null ? rules.helperDefault : load("chefio.helper") === "1";
  let peeksLeft = rules.peeks;
  let trainingStartedAt = 0;
  let trainedAt = -Infinity;
  let walked = false;
  let lookedAround = false;
  let events: ShiftEvents = { servedByRecipe: {}, scrubbed: 0 };

  const refreshHud = () => state && hud.update(state, room.sessionId);
  const updatePeeks = () => hud.setPeeks(state?.phase === "service" && rules.flipAfter > 0 ? peeksLeft : null);

  room.onStateChange((s: unknown) => {
    state = s as KitchenView;
    const me = state.players.get(room.sessionId);
    if (me && !placed) {
      controls.setPose(me.x, me.z, me.yaw);
      placed = true;
    }

    // Pick-up / put-down feedback and the practice checklist.
    const holding = me?.holding ?? "";
    if (holding !== prevHolding) {
      if (holding) {
        sfx.pick();
        hud.check("grab");
        if (["lettuce_chopped", "tomato_sliced", "potato_cut", "patty_cooked", "patty_burnt"].includes(holding)) hud.check("station");
      } else {
        sfx.drop();
      }
      prevHolding = holding;
    }
    setIcon(held, isItem(holding) ? holding : null);

    if (state.phase !== prevPhase) {
      if (state.phase === "service") {
        peeksLeft = rules.peeks;
        events = { servedByRecipe: {}, scrubbed: 0 };
        hud.check("pass");
        hud.banner("Service!", `${rules.title} is open`, "order");
        sfx.success();
      }
      if (state.phase === "training") {
        trainingStartedAt = time;
        hud.banner("Training shift", "No clock, no strikes. Follow the coach!", "order");
      }
      if (state.phase === "results") {
        controls.unlock(); // free the mouse for the results screen
        const result = award(
          profile,
          {
            mode: req.mode,
            tier: rules.tier,
            level: req.level,
            challenge: req.challenge,
            score: state.score,
            stars: state.stars,
            served: state.served,
            missed: state.missed,
            bestCombo: state.bestCombo,
          },
          events,
        );
        if ((result.cleared ?? state.stars >= 2) || result.levelAfter > result.levelBefore) sfx.success();
        else sfx.fail();
        hud.showAward(result, profile, goals);
        $("next-level").hidden = !(result.cleared && nextLevel);

        // Opt-in rewarded ad: double this shift's coins.
        const double = $<HTMLButtonElement>("double-coins");
        double.hidden = !adsEnabled || result.coins <= 0;
        double.disabled = false;
        double.onclick = async () => {
          double.disabled = true;
          if (await rewarded("double-coins")) {
            profile.coins += result.coins;
            saveProfile(profile);
            hud.toast(`Coins doubled! +${result.coins}`, "#f2b632");
            double.hidden = true;
          } else {
            double.disabled = false;
          }
        };
      }
      prevPhase = state.phase;
      updatePeeks();
    }

    // Quick play queue status.
    if (req.mode === "quick" && state.phase === "lobby") {
      const n = state.players.size;
      const q = $("lobby-queue");
      q.hidden = false;
      q.textContent =
        state.queueLeft > 0
          ? `${n} chefs in the kitchen. Service starts in ${Math.ceil(state.queueLeft)}s...`
          : `Waiting for another chef to join (${n}/6). Or press Start now to cook solo.`;
    }

    music.intensity = state.rushLeft > 0 ? 1 : state.phase === "service" ? 0.3 : 0;
    hud.update(state, room.sessionId);
    world.update(state);
    avatars.sync(state.players, room.sessionId);
  });

  room.onMessage("toast", (text: string) => hud.toast(text));
  room.onMessage("ping", (m: { name: string; color: number; text: string }) => {
    hud.toast(`${m.name}: ${m.text}`, CHEF_COLORS[m.color % CHEF_COLORS.length]);
    sfx.peek();
  });
  room.onMessage("order", (m: { recipe: RecipeId; mods: string[] }) => {
    sfx.bell();
    const mods = m.mods.map((id) => modLabel(m.recipe, id)).join(", ");
    hud.banner(`Order in: ${RECIPES[m.recipe]?.name ?? "Order"}`, mods, "order");
  });
  room.onMessage("served", (m: { id: number; recipe: RecipeId; points: number; combo: number }) => {
    hud.markLeaving(m.id, "served");
    sfx.ding();
    if (m.combo > 1) sfx.combo(m.combo);
    if (state?.phase === "service") events.servedByRecipe[m.recipe] = (events.servedByRecipe[m.recipe] ?? 0) + 1;
    const mult = comboMultiplier(m.combo - 1);
    hud.floatPoints(m.points ? `+${m.points}${mult > 1 ? ` x${mult}` : ""}` : "Order up!");
    hud.flash("good");
  });
  room.onMessage("missed", (m: { id: number; recipe: RecipeId }) => {
    hud.markLeaving(m.id, "missed");
    sfx.buzz();
    hud.flash("bad");
    hud.toast(`Walk-out! ${RECIPES[m.recipe]?.name ?? "A ticket"} expired.`, "#e04f3f");
  });
  room.onMessage("rush", () => {
    sfx.rush();
    hud.banner("Rush hour!", "Tickets are flying in. Keep that combo going!", "rush");
  });
  room.onMessage("trained", () => {
    profile.trained = true;
    saveProfile(profile);
    trainedAt = time;
    sfx.success();
    hud.banner("Training complete!", "You're ready for a real service", "order");
  });
  room.onLeave(() => {
    controls.unlock();
    backToMenu();
  });

  // ----- Looking at stations -----

  const fwd = new THREE.Vector3();
  function focusedStation(): StationDef | null {
    controls.forward(fwd);
    const { x, z } = controls.position;
    let best: StationDef | null = null;
    let bestScore = Infinity;
    for (const def of layout.stations) {
      const dist = distanceToStation(def, x, z);
      if (dist > INTERACT_RANGE) continue;
      // Aim at the nearest point of the counter, so long stations like the pass work end to end.
      const nx = Math.max(def.x - def.w / 2, Math.min(def.x + def.w / 2, x)) - x;
      const nz = Math.max(def.z - def.d / 2, Math.min(def.z + def.d / 2, z)) - z;
      const len = Math.hypot(nx, nz);
      const facing = len > 0.2 ? (nx * fwd.x + nz * fwd.z) / len : 1;
      if (facing < 0.2) continue;
      const score = dist - facing * 0.5; // prefer what you're looking at
      if (score < bestScore) {
        best = def;
        bestScore = score;
      }
    }
    return best;
  }

  function promptFor(def: StationDef): string {
    if (!state) return "";
    const me = state.players.get(room.sessionId);
    const st = state.stations.get(def.id);
    if (!me || !st) return "";
    if (st.user && st.user !== room.sessionId) {
      return `${state.players.get(st.user)?.name ?? "Someone"} is working the ${def.label.toLowerCase()}`;
    }
    const holding = isItem(me.holding) ? me.holding : null;
    const E = "<kbd>E</kbd>";
    switch (def.kind) {
      case "walkin":
        return holding ? "Walk-in: your hands are full" : `${E} Grab an ingredient`;
      case "prep":
        return holding && PREP_RESULT[holding] ? `${E} Chop the ${ITEM_NAMES[holding].toLowerCase()}` : "Prep: bring lettuce, tomato or potato";
      case "grill":
        return holding === "patty_raw" ? `${E} Smash & sear` : "Grill: bring a raw patty";
      case "fryer":
        if (st.item) {
          if (st.progress < rules.fryReady) return `Frying... ${Math.ceil(rules.fryReady - st.progress)}s`;
          return holding ? "Fryer: free your hands to pull the basket" : `${E} Pull the fries`;
        }
        return holding === "potato_cut" ? `${E} Drop the basket` : "Fryer: bring cut potatoes";
      case "pass":
        return holding ? `${E} Send ${ITEM_NAMES[holding].toLowerCase()} to the pass` : "Pass: bring finished food";
      case "dishpit":
        return state.dirtyPlates > 0 ? `${E} Scrub a plate` : "Dish pit: no dirty plates";
      case "trash":
        return holding ? `${E} Toss the ${ITEM_NAMES[holding].toLowerCase()}` : "Trash";
    }
  }

  async function interact() {
    if (!state || minigames.active) return;
    const def = focusedStation();
    const me = state.players.get(room.sessionId);
    const st = def ? state.stations.get(def.id) : undefined;
    if (!def || !me || !st) return;
    if (st.user && st.user !== room.sessionId) return hud.toast("Someone's already working there.");

    // Instant stations.
    if (def.kind === "fryer") return room.send("use", { station: def.id, action: "fry" });
    if (def.kind === "pass") return room.send("use", { station: def.id, action: "serve" });
    if (def.kind === "trash") return room.send("use", { station: def.id, action: "toss" });
    if (def.kind === "walkin" && me.holding) return hud.toast("Your hands are full. Use it or toss it.");
    if (def.kind === "dishpit" && state.dirtyPlates === 0) return hud.toast("No dirty plates right now.");

    // Mini-game stations: claim the station so nobody else can use it meanwhile.
    room.send("enter", { station: def.id });
    controls.enabled = false;
    controls.unlock();
    const result = await minigames.open(def.kind, {
      holding: me.holding,
      grillWindow: rules.grillWindow * (has(profile, "plancha") ? 1.35 : 1),
      prepBonus: has(profile, "knife") ? 1.4 : 1,
    });
    room.send("leave");
    controls.enabled = true;
    if (result) {
      if (result.action === "scrub") events.scrubbed++;
      room.send("use", { station: def.id, ...result });
    }
  }

  window.addEventListener("keydown", (e) => {
    if (e.code === "Tab") e.preventDefault();
    if (e.repeat || minigames.active || !state) return;
    if (e.code === "KeyE") void interact();
    const ping = ["Digit1", "Digit2", "Digit3", "Digit4"].indexOf(e.code);
    if (ping >= 0 && ping < PINGS.length) room.send("ping", ping);
    if (e.code === "KeyH") {
      helperOn = !helperOn;
      save("chefio.helper", helperOn ? "1" : "0");
      hud.toast(helperOn ? "Helper on: follow the arrow." : "Helper off. You've got this.");
    }
    if (e.code === "KeyM") {
      const muted = sfx.toggle();
      $("sound-state").textContent = muted ? "sound off" : "sound on";
    }
    if (e.code === "KeyN") {
      const off = music.toggle();
      $("music-state").textContent = off ? "music off" : "music on";
      hud.toast(off ? "Music off." : "Music on: kitchen jazz.");
    }
    if (e.code === "KeyG") {
      const q: Quality = nextQuality(pixel.currentQuality);
      pixel.setQuality(q, world.scene);
      save("chefio.quality", q);
      hud.toast(`Graphics: ${QUALITY_LABEL[q]}`);
    }
    if (e.code === "KeyL") {
      if (controls.locked) controls.unlock();
      else controls.lock();
    }
    if (e.code === "Tab" && state.phase === "service" && rules.flipAfter > 0) {
      if (peeksLeft > 0) {
        peeksLeft--;
        hud.peeking = true;
        sfx.peek();
        refreshHud();
      } else {
        hud.toast("No peeks left. Trust your memory!");
      }
      updatePeeks();
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Tab" && hud.peeking) {
      hud.peeking = false;
      refreshHud();
    }
  });
  $("sound-state").textContent = sfx.muted ? "sound off" : "sound on";
  $("music-state").textContent = music.muted ? "music off" : "music on";

  controls.onLooked = () => {
    lookedAround = true;
    hud.check("look");
  };
  controls.onWalked = () => {
    walked = true;
    hud.check("walk");
  };

  // ----- Main loop -----

  let lastSent = { x: 0, z: 0, yaw: 0, at: 0 };
  let last = performance.now();

  function frame(now: number) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    time += dt;

    controls.update(dt);
    avatars.update(dt, time);
    world.animate(time, dt);

    const focus = minigames.active ? null : focusedStation();
    world.setFocus(focus?.id ?? null);
    hud.prompt(focus ? promptFor(focus) : null);

    const phase = state?.phase;
    const training = phase === "training";
    hud.hint(
      !lookedAround && !minigames.active && !training && phase !== "results"
        ? "Move the mouse to look around · WASD to move · Shift to sprint"
        : null,
    );

    // Training always guides; real services guide when the helper is on.
    const step =
      state && !minigames.active && (training || (helperOn && phase === "service"))
        ? nextStep(state, layout, room.sessionId, controls.position.x, controls.position.z)
        : null;
    if (training) {
      const intro = (!lookedAround || !walked) && time - trainingStartedAt < 12;
      hud.coach(minigames.active ? null : intro ? TRAINING_INTRO : coachFor(step));
      hud.guide(null);
    } else {
      hud.coach(phase === "lobby" && time - trainedAt < 14 && !minigames.active ? TRAINING_DONE : null);
      hud.guide(step ? `${step.html}<small>H hides the helper</small>` : null);
    }
    world.setGuideTarget(step?.station ?? null);

    const { x, z } = controls.position;
    if (
      now - lastSent.at > 80 &&
      (Math.abs(x - lastSent.x) > 0.01 || Math.abs(z - lastSent.z) > 0.01 || Math.abs(controls.yaw - lastSent.yaw) > 0.02)
    ) {
      room.send("move", { x, z, yaw: controls.yaw });
      lastSent = { x, z, yaw: controls.yaw, at: now };
    }

    pixel.render(world.scene);
  }
  requestAnimationFrame(frame);
}
