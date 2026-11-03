// Game rules shared by the server and the browser client.

export type ItemId =
  | "bun"
  | "bun_toasted"
  | "beef"
  | "patty_raw"
  | "patty_cooked"
  | "lettuce"
  | "lettuce_chopped"
  | "tomato"
  | "tomato_sliced"
  | "cheese"
  | "cheese_sliced"
  | "potato"
  | "potato_cut"
  | "fries"
  | "onion"
  | "onion_sliced"
  | "onion_rings"
  | "chicken"
  | "chicken_breaded"
  | "chicken_fried"
  | "burnt";

export const ITEM_NAMES: Record<ItemId, string> = {
  bun: "Bun",
  bun_toasted: "Toasted bun",
  beef: "Ground beef",
  patty_raw: "Raw patty",
  patty_cooked: "Seared patty",
  lettuce: "Lettuce",
  lettuce_chopped: "Chopped lettuce",
  tomato: "Tomato",
  tomato_sliced: "Sliced tomato",
  cheese: "Cheese block",
  cheese_sliced: "Cheese slice",
  potato: "Potato",
  potato_cut: "Cut potato",
  fries: "Fries",
  onion: "Onion",
  onion_sliced: "Raw onion rings",
  onion_rings: "Onion rings",
  chicken: "Chicken breast",
  chicken_breaded: "Breaded chicken",
  chicken_fried: "Crispy chicken",
  burnt: "Charred mess",
};

export function isItem(value: unknown): value is ItemId {
  return typeof value === "string" && value in ITEM_NAMES;
}

// Every hand slot holds one item. Chefs start with three; the Sheet Tray adds a fourth.
export const BASE_SLOTS = 3;
export const MAX_SLOTS = 4;

// ----- How food moves through the kitchen -----
// Prep boards chop, slice, form and bread. Grills sear and toast. Fryers take a basket and cook on their own.

export const PREP: Partial<Record<ItemId, { result: ItemId; verb: string }>> = {
  beef: { result: "patty_raw", verb: "Form the patty" },
  lettuce: { result: "lettuce_chopped", verb: "Chop the lettuce" },
  tomato: { result: "tomato_sliced", verb: "Slice the tomato" },
  cheese: { result: "cheese_sliced", verb: "Slice the cheese" },
  potato: { result: "potato_cut", verb: "Cut the fries" },
  onion: { result: "onion_sliced", verb: "Ring the onion" },
  chicken: { result: "chicken_breaded", verb: "Bread the chicken" },
};

// speed: how fast the grill meter fills (a bun toasts quicker than a patty sears).
export const GRILL: Partial<Record<ItemId, { result: ItemId; verb: string; speed: number }>> = {
  patty_raw: { result: "patty_cooked", verb: "Smash & sear", speed: 1 },
  bun: { result: "bun_toasted", verb: "Toast the bun", speed: 1.8 },
};

// time: scales the kitchen's fry timings (chicken takes longer, rings are quick).
export const FRY: Partial<Record<ItemId, { result: ItemId; time: number }>> = {
  potato_cut: { result: "fries", time: 1 },
  onion_sliced: { result: "onion_rings", time: 0.8 },
  chicken_breaded: { result: "chicken_fried", time: 1.35 },
};

export function fryTimes(ready: number, burnt: number, item: string) {
  const k = FRY[item as ItemId]?.time ?? 1;
  return { ready: ready * k, burnt: burnt * k };
}

export type RecipeId = "burger" | "fries" | "salad" | "rings" | "chicken";

export interface Recipe {
  name: string;
  needs: ItemId[];
  base: number;
}

export const RECIPES: Record<RecipeId, Recipe> = {
  burger: { name: "Smash Burger", needs: ["bun_toasted", "patty_cooked", "lettuce_chopped"], base: 40 },
  fries: { name: "Fries", needs: ["fries"], base: 16 },
  salad: { name: "Garden Salad", needs: ["lettuce_chopped", "tomato_sliced"], base: 22 },
  rings: { name: "Onion Rings", needs: ["onion_rings"], base: 18 },
  chicken: { name: "Crispy Chicken", needs: ["bun_toasted", "chicken_fried", "lettuce_chopped"], base: 46 },
};

// Order modifiers change what a ticket needs. They're what you have to remember once a ticket flips.
export interface Mod {
  id: string;
  label: string;
  add?: ItemId;
  remove?: ItemId;
  bonus: number;
}

export const MODS: Record<RecipeId, Mod[]> = {
  burger: [
    { id: "no_lettuce", label: "No lettuce", remove: "lettuce_chopped", bonus: 5 },
    { id: "add_tomato", label: "+ Tomato", add: "tomato_sliced", bonus: 8 },
    { id: "add_cheese", label: "+ Cheese", add: "cheese_sliced", bonus: 8 },
    { id: "double", label: "Double patty", add: "patty_cooked", bonus: 14 },
  ],
  fries: [{ id: "large", label: "Large", add: "fries", bonus: 10 }],
  salad: [
    { id: "add_patty", label: "+ Patty", add: "patty_cooked", bonus: 14 },
    { id: "add_cheese", label: "+ Cheese", add: "cheese_sliced", bonus: 8 },
    { id: "no_tomato", label: "No tomato", remove: "tomato_sliced", bonus: 4 },
  ],
  rings: [{ id: "large", label: "Large", add: "onion_rings", bonus: 10 }],
  chicken: [
    { id: "no_lettuce", label: "No lettuce", remove: "lettuce_chopped", bonus: 5 },
    { id: "add_cheese", label: "+ Cheese", add: "cheese_sliced", bonus: 8 },
    { id: "add_tomato", label: "+ Tomato", add: "tomato_sliced", bonus: 8 },
  ],
};

export function applyMods(recipe: RecipeId, modIds: Iterable<string>): ItemId[] {
  const needs = [...RECIPES[recipe].needs];
  for (const id of modIds) {
    const mod = MODS[recipe].find((m) => m.id === id);
    if (!mod) continue;
    if (mod.remove) {
      const i = needs.indexOf(mod.remove);
      if (i >= 0) needs.splice(i, 1);
    }
    if (mod.add) needs.push(mod.add);
  }
  return needs;
}

export function modLabel(recipe: string, id: string): string {
  return MODS[recipe as RecipeId]?.find((m) => m.id === id)?.label ?? id;
}

/** What a held item turns into next, and where (null once it's ready for the pass). */
export function nextStation(item: ItemId): "prep" | "grill" | "fryer" | null {
  if (PREP[item]) return "prep";
  if (GRILL[item]) return "grill";
  if (FRY[item]) return "fryer";
  return null;
}

export function processed(item: ItemId): ItemId | null {
  return PREP[item]?.result ?? GRILL[item]?.result ?? FRY[item]?.result ?? null;
}

/** Walk back from a finished component to its raw ingredient, collecting the stations on the way. */
export function routeOf(final: ItemId): { raw: ItemId; steps: ("prep" | "grill" | "fryer")[] } {
  const steps: ("prep" | "grill" | "fryer")[] = [];
  let item = final;
  for (let guard = 0; guard < 4; guard++) {
    const from = (Object.keys(ITEM_NAMES) as ItemId[]).find((k) => processed(k) === item);
    if (!from) break;
    steps.unshift(nextStation(from)!);
    item = from;
  }
  return { raw: item, steps };
}

/** What a held item will be by the time it reaches the pass. */
export function finalForm(item: ItemId): ItemId {
  let cur = item;
  for (let guard = 0; guard < 4; guard++) {
    const next = processed(cur);
    if (!next) break;
    cur = next;
  }
  return cur;
}

const ALL_RAW: ItemId[] = ["bun", "beef", "lettuce", "tomato", "cheese", "potato", "onion", "chicken"];

/** The ingredients this menu needs from the walk-in, in a stable order. */
export function walkinItems(recipes: readonly RecipeId[]): ItemId[] {
  const finals = new Set<ItemId>();
  for (const r of recipes) {
    RECIPES[r].needs.forEach((i) => finals.add(i));
    MODS[r].forEach((m) => m.add && finals.add(m.add));
  }
  const raws = new Set([...finals].map((f) => routeOf(f).raw));
  return ALL_RAW.filter((i) => raws.has(i));
}

// Serving tickets back to back builds a combo that multiplies points.
export const COMBO_WINDOW = 25; // seconds to land the next serve
export function comboMultiplier(combo: number) {
  return 1 + 0.25 * Math.min(combo, 4);
}

export const RUSH_LENGTH = 25; // seconds of rush hour, once about half the night's tickets are in
export const RUSH_AT = 0.5;

// Every real service opens gently: orders trickle in before the pace picks up.
export const WARMUP_SHARE = 0.3; // the first 30% of the night's tickets
export const WARMUP_SLOWDOWN = 1.7; // gaps between orders are this much longer

// The training shift: one dish at a time, no clock, no strikes.
export const TRAINING_ORDERS: RecipeId[] = ["burger", "fries"];

export type StationKind = "walkin" | "prep" | "grill" | "fryer" | "pass" | "dishpit" | "trash";

/** Which way a station's working side faces: +z for the back wall, -z for the front, +x left wall, -x right wall. */
export type Facing = "+z" | "-z" | "+x" | "-x";

export interface StationDef {
  id: string;
  kind: StationKind;
  label: string;
  // Footprint centre and size in world metres (w along x, d along z). Kitchens are centred on the origin.
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  face: Facing;
}

export const INTERACT_RANGE = 1.35; // metres from a station's edge: forgiving, no pixel-perfect positioning
export const PLAYER_RADIUS = 0.3;

export const FRY_READY = 6; // seconds for fries; FRY scales it for other baskets
export const FRY_BURNT = 11;

export const START_PLATES = 3;
export const PLATE_RETURN_DELAY = 7; // seconds until a served plate comes back dirty

export type TierId =
  | "foodtruck"
  | "diner"
  | "bistro"
  | "ramen"
  | "bakery"
  | "steakhouse"
  | "tasting";

export interface Tier {
  name: string;
  blurb: string;
  locked: boolean;
  // A shift ends after one of these many tickets, picked at random and never shown: like a real night,
  // you don't know when the last order is coming until it lands.
  orders: number[];
  orderEvery: [number, number]; // random gap between tickets, seconds
  ticketTime: number;
  maxTickets: number;
  maxStrikes: number;
  grillWindow: number; // width of the "seared" zone on the grill meter (0-1)
  recipes: RecipeId[];
  modChance: number; // chance a ticket comes with a modifier
  flipAfter: number; // seconds before a ticket flips face-down (0 = never)
  peeks: number; // Tab peeks per service at flipping tiers
  helperDefault: boolean; // step-by-step helper on by default
  stars: [number, number, number]; // average points per ticket for 1, 2, 3 stars (walk-outs count as 0)
}

/** Stars for a finished shift: the average per ticket, so short and long nights are judged alike. */
export function starsFor(score: number, tickets: number, stars: [number, number, number]): number {
  const avg = score / Math.max(1, tickets);
  return avg >= stars[2] ? 3 : avg >= stars[1] ? 2 : avg >= stars[0] ? 1 : 0;
}

const LOCKED: Omit<Tier, "name" | "blurb"> = {
  locked: true,
  orders: [0],
  orderEvery: [0, 0],
  ticketTime: 0,
  maxTickets: 0,
  maxStrikes: 0,
  grillWindow: 0,
  recipes: [],
  modChance: 0,
  flipAfter: 0,
  peeks: 0,
  helperDefault: false,
  stars: [0, 0, 0],
};

export const TIERS: Record<TierId, Tier> = {
  foodtruck: {
    name: "Food Truck",
    blurb: "Burgers and fries. Forgiving timers and a step-by-step helper.",
    locked: false,
    orders: [10, 12, 15],
    orderEvery: [18, 24],
    ticketTime: 100,
    maxTickets: 3,
    maxStrikes: 5,
    grillWindow: 0.2,
    recipes: ["burger", "fries"],
    modChance: 0.15,
    flipAfter: 0,
    peeks: 0,
    helperDefault: true,
    stars: [25, 45, 65],
  },
  diner: {
    name: "Diner",
    blurb: "Salads and onion rings join the menu. Tickets flip after 10s: remember them!",
    locked: false,
    orders: [15, 20, 25],
    orderEvery: [12, 17],
    ticketTime: 80,
    maxTickets: 5,
    maxStrikes: 4,
    grillWindow: 0.15,
    recipes: ["burger", "fries", "salad", "rings"],
    modChance: 0.4,
    flipAfter: 10,
    peeks: 4,
    helperDefault: false,
    stars: [25, 45, 65],
  },
  bistro: {
    name: "Bistro",
    blurb: "Crispy chicken, lots of mods, tickets flip after 6s, thin grill window, 3 strikes.",
    locked: false,
    orders: [20, 25, 30],
    orderEvery: [9, 13],
    ticketTime: 70,
    maxTickets: 6,
    maxStrikes: 3,
    grillWindow: 0.1,
    recipes: ["burger", "fries", "salad", "chicken"],
    modChance: 0.65,
    flipAfter: 6,
    peeks: 3,
    helperDefault: false,
    stars: [28, 50, 72],
  },
  ramen: { name: "Ramen Bar", blurb: "Long simmer timers.", ...LOCKED },
  bakery: { name: "Bakery", blurb: "Proofing windows.", ...LOCKED },
  steakhouse: { name: "Steakhouse", blurb: "Doneness precision.", ...LOCKED },
  tasting: { name: "Tasting Room", blurb: "Course pacing.", ...LOCKED },
};

export function isPlayableTier(value: unknown): value is TierId {
  return typeof value === "string" && value in TIERS && !TIERS[value as TierId].locked;
}

export const PINGS = ["Heard!", "Behind!", "Need plates!", "86 that!"];

export const CHEF_COLORS = ["#e04f3f", "#3f8de0", "#3fbf6a", "#e0b23f", "#a75fe0", "#3fd0d0"];

// Items still missing from a ticket (multiset difference).
export function remainingNeeds(needs: Iterable<string>, have: Iterable<string>): string[] {
  const left = [...needs];
  for (const item of have) {
    const i = left.indexOf(item);
    if (i >= 0) left.splice(i, 1);
  }
  return left;
}

// Shortest distance from a point to a station's footprint, in metres.
export function distanceToStation(def: { x: number; z: number; w: number; d: number }, x: number, z: number): number {
  const dx = Math.max(Math.abs(x - def.x) - def.w / 2, 0);
  const dz = Math.max(Math.abs(z - def.z) - def.d / 2, 0);
  return Math.hypot(dx, dz);
}
