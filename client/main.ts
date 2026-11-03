import * as THREE from "three";
import { Client, type Room } from "@colyseus/sdk";
import {
  CHEF_COLORS,
  FRY,
  GRILL,
  INTERACT_RANGE,
  ITEM_NAMES,
  PINGS,
  PREP,
  RECIPES,
  comboMultiplier,
  distanceToStation,
  finalForm,
  fryTimes,
  isItem,
  modLabel,
  remainingNeeds,
  walkinItems,
  type ItemId,
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
import { Minigames, type MinigameResult } from "./minigames";
import { Music } from "./music";
import { award, has, loadProfile, perksOf, saveProfile, type ShiftEvents } from "./profile";
import { PixelRenderer, QUALITY_LABEL, nextQuality } from "./render";
import { actionFor, keyName, loadSettings, saveSettings, type Settings } from "./settings";
import { controlsHTML, initSettingsUI } from "./settingsUI";
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

// ---------- Settings and menus ----------

const settings = loadSettings();
// The game installs its own handler once a shift starts; on the menu only the cheat-sheet changes.
let onSettingsChange: (what: keyof Settings) => void = () => renderControlsList();
let onSettingsClose = () => {};
const settingsUI = initSettingsUI(
  settings,
  (what) => onSettingsChange(what),
  () => onSettingsClose(),
);
function renderControlsList() {
  $("controls-list").innerHTML = controlsHTML(settings);
}
renderControlsList();
$("go-settings").addEventListener("click", () => settingsUI.open());

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
  const fry = { ready: rules.fryReady, burnt: rules.fryBurnt };
  const stock = walkinItems(rules.recipes);
  const canvas = $<HTMLCanvasElement>("game");
  const pixel = new PixelRenderer(canvas, settings.quality);
  const music = new Music();
  music.start(); // started from a click, so the browser allows audio
  const camera = pixel.camera;
  const world = new KitchenWorld(layout, rules.recipes, fry);
  world.addDecor(profile.decor);
  const merged = world.optimize();
  console.info(`Kitchen merged: ${merged.before} meshes → ${merged.after} draw calls`);
  world.scene.add(camera);
  const controls = new FirstPersonControls(camera, canvas, world.colliders, layout, settings);
  controls.speedMul = has(profile, "clogs") ? 1.1 : 1;
  if (import.meta.env.DEV) Object.assign(window, { __yc: { controls, room, pixel } }); // dev-only handle for playtesting
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

  // What's in your selected hand, floating in the lower right of your view.
  const held = itemSprite(0.15);
  (held.material as THREE.SpriteMaterial).depthTest = false;
  held.position.set(0.17, -0.12, -0.34);
  held.renderOrder = 10;
  camera.add(held);

  let state: KitchenView | null = null;
  let placed = false;
  let time = 0;
  let prevHands = "";
  let prevPhase = "";
  let helperOn = load("chefio.helper") === null ? rules.helperDefault : load("chefio.helper") === "1";
  let peeksLeft = rules.peeks;
  let trainingStartedAt = 0;
  let trainedAt = -Infinity;
  let walked = false;
  let lookedAround = false;
  let paused = false;
  let events: ShiftEvents = { servedByRecipe: {}, scrubbed: 0 };

  const myHands = (): ItemId[] => [...(state?.players.get(room.sessionId)?.hands ?? [])].filter(isItem);
  const selectedItem = (): ItemId | null => {
    const hands = myHands();
    return hands[Math.min(hud.selected, hands.length - 1)] ?? null;
  };
  const refreshHud = () => state && hud.update(state, room.sessionId);
  const updatePeeks = () => hud.setPeeks(state?.phase === "service" && rules.flipAfter > 0 ? peeksLeft : null);

  // ----- Settings, live -----

  function applyKeyLabels() {
    hud.slotKeys = (["slot1", "slot2", "slot3", "slot4"] as const).map((a) => keyName(settings.keys[a]));
    $("pings-help").innerHTML = controlsHTML(settings, true);
    renderControlsList();
    refreshHud();
  }
  applyKeyLabels();
  $("fps").hidden = !settings.showFps;
  onSettingsChange = (what) => {
    if (what === "look") controls.applyLookMode();
    if (what === "quality") pixel.setQuality(settings.quality, world.scene);
    if (what === "autoRes" && !settings.autoRes) pixel.setScale(1);
    if (what === "showFps") $("fps").hidden = !settings.showFps;
    if (what === "keys" || what === "look") applyKeyLabels();
  };

  // ----- Pause (Esc) -----

  function setPaused(on: boolean) {
    if (on === paused) return;
    paused = on;
    $("pause").hidden = !on;
    if (on) {
      minigames.close();
      controls.release();
      controls.enabled = false;
      $("pause-note").textContent = solo
        ? "The kitchen is on hold. Tickets won't tick down while you're here."
        : "Heads up: in multiplayer the kitchen keeps cooking without you!";
    } else {
      settingsUI.close();
      controls.enabled = !minigames.active;
    }
    if (solo) room.send("pause", on);
  }
  $("pause-resume").addEventListener("click", () => setPaused(false));
  $("pause-settings").addEventListener("click", () => settingsUI.open());
  onSettingsClose = () => {
    if (!paused) controls.enabled = !minigames.active;
  };
  // In mouse-lock mode the browser eats Esc to free the mouse: treat that as "pause" too.
  controls.onLockLost = () => {
    if (!minigames.active && state?.phase !== "results") setPaused(true);
  };

  // ----- State -----

  room.onStateChange((s: unknown) => {
    state = s as KitchenView;
    const me = state.players.get(room.sessionId);
    if (me && !placed) {
      controls.setPose(me.x, me.z, me.yaw);
      placed = true;
    }

    // Pick-up / put-down feedback and the practice checklist.
    const hands = [...(me?.hands ?? [])];
    const sig = hands.join(",");
    if (sig !== prevHands) {
      const before = prevHands ? prevHands.split(",") : [];
      if (hands.length > before.length) {
        sfx.pick();
        hud.check("grab");
        hud.selected = hands.length - 1; // the newest item is the one in your hand
      } else if (hands.length < before.length) {
        sfx.drop();
      }
      if (hands.some((h, i) => before[i] && before[i] !== h)) hud.check("station"); // something got prepped or cooked
      prevHands = sig;
    }
    const sel = selectedItem();
    setIcon(held, sel);

    if (state.phase !== prevPhase) {
      if (state.phase === "service") {
        peeksLeft = rules.peeks;
        events = { servedByRecipe: {}, scrubbed: 0 };
        hud.check("pass");
        hud.banner("Service!", `${rules.title} is open. Cook until the last ticket!`, "order");
        sfx.success();
      }
      if (state.phase === "training") {
        trainingStartedAt = time;
        hud.banner("Training shift", "No clock, no strikes. Follow the coach!", "order");
      }
      if (state.phase === "results") {
        setPaused(false);
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

    music.intensity = state.rushLeft > 0 || state.lastCall ? 1 : state.phase === "service" ? 0.3 : 0;
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
  room.onMessage("lastcall", () => {
    sfx.rush();
    hud.banner("Last call!", "That's the final ticket of the night. Bring it home!", "rush");
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
    const hands = myHands();
    const free = me.slots - hands.length;
    const E = `<kbd>${keyName(settings.keys.interact)}</kbd>`;
    const lower = (i: ItemId) => ITEM_NAMES[i].toLowerCase();
    switch (def.kind) {
      case "walkin":
        return free > 0 ? `${E} Grab ingredients (${free} free hand${free > 1 ? "s" : ""})` : "Walk-in: your hands are full";
      case "prep": {
        const todo = hands.filter((h) => PREP[h]);
        return todo.length ? `${E} ${PREP[todo[0]]!.verb}${todo.length > 1 ? ` (+${todo.length - 1} more)` : ""}` : "Prep: bring raw ingredients";
      }
      case "grill": {
        const todo = hands.filter((h) => GRILL[h]);
        return todo.length ? `${E} ${GRILL[todo[0]]!.verb}${todo.length > 1 ? ` (+${todo.length - 1} more)` : ""}` : "Grill: bring a raw patty or a bun";
      }
      case "fryer":
        if (st.item) {
          const t = fryTimes(fry.ready, fry.burnt, st.item);
          if (st.progress < t.ready) return `Frying... ${Math.ceil(t.ready - st.progress)}s`;
          return free > 0 ? `${E} Pull the basket` : "Fryer: free a hand to pull the basket";
        }
        return hands.some((h) => FRY[h]) ? `${E} Drop the basket` : "Fryer: bring cut potatoes, onion or breaded chicken";
      case "pass": {
        const wanted = new Set([...state.tickets].flatMap((t) => remainingNeeds(t.need, t.have)));
        const n = hands.filter((h) => wanted.has(h)).length;
        return n ? `${E} Send ${n > 1 ? `${n} items` : `the ${lower(hands.find((h) => wanted.has(h))!)}`} to the pass` : hands.length ? "Pass: nothing in hand is on a ticket yet" : "Pass: bring finished food";
      }
      case "dishpit":
        return state.dirtyPlates > 0 ? `${E} Scrub a plate` : "Dish pit: no dirty plates";
      case "trash": {
        const item = selectedItem();
        return item ? `${E} Toss the ${lower(item)}` : "Trash";
      }
    }
  }

  async function interact() {
    if (!state || minigames.active || paused) return;
    const def = focusedStation();
    const me = state.players.get(room.sessionId);
    const st = def ? state.stations.get(def.id) : undefined;
    if (!def || !me || !st) return;
    if (st.user && st.user !== room.sessionId) return hud.toast("Someone's already working there.");
    const hands = myHands();

    // Instant stations.
    if (def.kind === "fryer") return room.send("use", { station: def.id, action: "fry" });
    if (def.kind === "pass") return room.send("use", { station: def.id, action: "serve" });
    if (def.kind === "trash") return room.send("use", { station: def.id, action: "toss", item: selectedItem() });
    if (def.kind === "walkin" && hands.length >= me.slots) return hud.toast("Your hands are full. Use something or toss it.");
    if (def.kind === "dishpit" && state.dirtyPlates === 0) return hud.toast("No dirty plates right now.");

    // Mini-game stations: claim the station so nobody else can use it meanwhile.
    // Prep and grill work through everything you're holding for them, one after another.
    // What a ticket is waiting on goes first; spares after.
    const wanted = new Set([...state.tickets].flatMap((t) => remainingNeeds(t.need, t.have)));
    const ticketFirst = (items: ItemId[]) => [...items].sort((a, b) => Number(wanted.has(finalForm(b))) - Number(wanted.has(finalForm(a))));
    const queue: (ItemId | undefined)[] =
      def.kind === "prep" ? ticketFirst(hands.filter((h) => PREP[h])) : def.kind === "grill" ? ticketFirst(hands.filter((h) => GRILL[h])) : [undefined];
    if (!queue.length) return hud.toast(def.kind === "prep" ? "Nothing to prep. Bring raw ingredients." : "The grill takes raw patties and buns.");
    room.send("enter", { station: def.id });
    controls.release();
    controls.enabled = false;
    for (const item of queue) {
      const result: MinigameResult | null = await minigames.open(def.kind, {
        item,
        walkin: stock,
        free: me.slots - hands.length,
        grillWindow: rules.grillWindow * (has(profile, "plancha") ? 1.35 : 1),
        prepBonus: has(profile, "knife") ? 1.4 : 1,
        keys: settings.keys,
      });
      if (!result) break;
      if (result.action === "scrub") events.scrubbed++;
      room.send("use", { station: def.id, ...result });
      if (paused) break;
    }
    room.send("leave");
    controls.enabled = !paused;
  }

  // ----- Keys -----

  window.addEventListener("keydown", (e) => {
    if (!state || settingsUI.isOpen || paused) {
      if (paused && !settingsUI.isOpen && e.code === "Escape") setPaused(false);
      return; // menus keep normal keyboard focus (Tab) working
    }
    if (e.code === "Tab") e.preventDefault();
    if (e.code === "Escape") {
      if (!minigames.active && state.phase !== "results") setPaused(!paused);
      return;
    }
    if (e.repeat || minigames.active) return;
    const action = actionFor(settings, e.code);
    if (!action) return;
    if (action === "peek" || action === "work") e.preventDefault();
    switch (action) {
      case "interact":
        return void interact();
      case "ping1":
      case "ping2":
      case "ping3":
      case "ping4": {
        const i = Number(action.slice(4)) - 1;
        if (i < PINGS.length) room.send("ping", i);
        return;
      }
      case "slot1":
      case "slot2":
      case "slot3":
      case "slot4":
        hud.selected = Number(action.slice(4)) - 1;
        setIcon(held, selectedItem());
        return refreshHud();
      case "cycle": {
        const n = Math.max(1, myHands().length);
        hud.selected = (Math.min(hud.selected, n - 1) + 1) % n;
        setIcon(held, selectedItem());
        return refreshHud();
      }
      case "helper":
        helperOn = !helperOn;
        save("chefio.helper", helperOn ? "1" : "0");
        return hud.toast(helperOn ? "Helper on: follow the arrow." : "Helper off. You've got this.");
      case "sound": {
        const muted = sfx.toggle();
        return hud.toast(muted ? "Sound off." : "Sound on.");
      }
      case "music": {
        const off = music.toggle();
        return hud.toast(off ? "Music off." : "Music on: kitchen jazz.");
      }
      case "graphics":
        settings.quality = nextQuality(pixel.currentQuality);
        saveSettings(settings);
        pixel.setQuality(settings.quality, world.scene);
        return hud.toast(`Graphics: ${QUALITY_LABEL[settings.quality]}`);
      case "peek":
        if (state.phase !== "service" || rules.flipAfter <= 0) return;
        if (peeksLeft > 0) {
          peeksLeft--;
          hud.peeking = true;
          sfx.peek();
          refreshHud();
        } else {
          hud.toast("No peeks left. Trust your memory!");
        }
        return updatePeeks();
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === settings.keys.peek && hud.peeking) {
      hud.peeking = false;
      refreshHud();
    }
  });
  // The mouse wheel flips through your hands too.
  canvas.addEventListener(
    "wheel",
    (e) => {
      if (paused || minigames.active) return;
      const n = Math.max(1, myHands().length);
      hud.selected = (Math.min(hud.selected, n - 1) + (e.deltaY > 0 ? 1 : n - 1)) % n;
      setIcon(held, selectedItem());
      refreshHud();
    },
    { passive: true },
  );

  controls.onLooked = () => {
    lookedAround = true;
    hud.check("look");
  };
  controls.onWalked = () => {
    walked = true;
    hud.check("walk");
  };

  const lookHint = () => {
    const k = settings.keys;
    const move = `${keyName(k.forward)}${keyName(k.left)}${keyName(k.back)}${keyName(k.right)} to move · ${keyName(k.sprint)} to sprint`;
    const look = settings.look === "hold" ? "Hold the mouse and drag to look" : settings.look === "follow" ? "Move the mouse to look around" : "Click to grab the mouse and look";
    return `${look} · ${move}`;
  };

  // ----- Main loop -----

  let lastSent = { x: 0, z: 0, yaw: 0, at: 0 };
  let last = performance.now();
  // Frame-rate watch for the FPS readout and auto resolution.
  let fpsFrames = 0;
  let fpsSince = last;
  let smoothSeconds = 0;
  let fpsBeforeDrop: number | null = null;
  let autoResGaveUp = false;

  function watchFrameRate(now: number, rawDt: number) {
    fpsFrames++;
    if (rawDt > 0.25) {
      // A hitch from a hidden tab or a resize is not the GPU struggling: start the window over.
      fpsFrames = 0;
      fpsSince = now;
      return;
    }
    const span = (now - fpsSince) / 1000;
    if (span < 1) return;
    const fps = fpsFrames / span;
    fpsFrames = 0;
    fpsSince = now;
    if (settings.showFps) $("fps").textContent = `${Math.round(fps)} fps · ${Math.round(pixel.resolutionScale * 100)}% res`;
    if (!settings.autoRes || autoResGaveUp) return;
    if (fpsBeforeDrop !== null) {
      // Fewer pixels didn't buy frames (a capped display or a CPU-bound machine): put them back and stop trying.
      if (fps < fpsBeforeDrop + 4) {
        pixel.setScale(1);
        autoResGaveUp = true;
      }
      fpsBeforeDrop = null;
      return;
    }
    if (fps < 45) {
      smoothSeconds = 0;
      if (pixel.resolutionScale > 0.5) {
        if (pixel.resolutionScale === 1) fpsBeforeDrop = fps; // first drop: check that it helps
        pixel.setScale(pixel.resolutionScale - 0.1);
      }
    } else if (fps > 57 && ++smoothSeconds >= 4 && pixel.resolutionScale < 1) {
      smoothSeconds = 0;
      pixel.setScale(pixel.resolutionScale + 0.05);
    }
  }

  function frame(now: number) {
    requestAnimationFrame(frame);
    const rawDt = (now - last) / 1000;
    const dt = Math.min(0.05, rawDt);
    last = now;
    time += dt;
    watchFrameRate(now, rawDt);

    controls.update(dt);
    avatars.update(dt, time);
    world.animate(time, dt);

    const busy = minigames.active || paused;
    const focus = busy ? null : focusedStation();
    world.setFocus(focus?.id ?? null);
    hud.prompt(focus ? promptFor(focus) : null);

    const phase = state?.phase;
    const training = phase === "training";
    hud.hint(!lookedAround && !busy && !training && phase !== "results" ? lookHint() : null);

    // Training always guides; real services guide when the helper is on.
    const step =
      state && !busy && (training || (helperOn && phase === "service"))
        ? nextStep(state, layout, room.sessionId, controls.position.x, controls.position.z, fry)
        : null;
    if (training) {
      const intro = (!lookedAround || !walked) && time - trainingStartedAt < 12;
      hud.coach(busy ? null : intro ? TRAINING_INTRO : coachFor(step));
      hud.guide(null);
    } else {
      hud.coach(phase === "lobby" && time - trainedAt < 14 && !busy ? TRAINING_DONE : null);
      hud.guide(step ? `${step.html}<small>${keyName(settings.keys.helper)} hides the helper</small>` : null);
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
