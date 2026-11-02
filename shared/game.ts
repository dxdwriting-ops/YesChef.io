// Game rules shared by the server and the browser client.

export type ItemId =
  | "bun"
  | "patty_raw"
  | "patty_cooked"
  | "patty_burnt"
  | "lettuce"
  | "lettuce_chopped"
  | "tomato"
  | "tomato_sliced"
  | "potato"
  | "potato_cut"
  | "fries"
  | "fries_burnt";

export const ITEM_NAMES: Record<ItemId, string> = {
  bun: "Bun",
  patty_raw: "Raw patty",
  patty_cooked: "Seared patty",
  patty_burnt: "Burnt patty",
  lettuce: "Lettuce",
  lettuce_chopped: "Chopped lettuce",
  tomato: "Tomato",
  tomato_sliced: "Sliced tomato",
  potato: "Potato",
  potato_cut: "Cut potato",
  fries: "Fries",
  fries_burnt: "Burnt fries",
};

export const BURNT: ItemId[] = ["patty_burnt", "fries_burnt"];

export function isItem(value: unknown): value is ItemId {
  return typeof value === "string" && value in ITEM_NAMES;
}

// What the walk-in fridge hands out.
export const WALKIN_ITEMS: ItemId[] = ["bun", "patty_raw", "lettuce", "tomato", "potato"];

// What the prep board turns things into.
export const PREP_RESULT: Partial<Record<ItemId, ItemId>> = {
  lettuce: "lettuce_chopped",
  tomato: "tomato_sliced",
  potato: "potato_cut",
};

export type RecipeId = "burger" | "fries" | "salad";

export interface Recipe {
  name: string;
  needs: ItemId[];
  base: number;
}

export const RECIPES: Record<RecipeId, Recipe> = {
  burger: { name: "Smash Burger", needs: ["bun", "patty_cooked", "lettuce_chopped"], base: 30 },
  fries: { name: "Fries", needs: ["fries"], base: 15 },
  salad: { name: "Garden Salad", needs: ["lettuce_chopped", "tomato_sliced"], base: 20 },
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
    { id: "double", label: "Double patty", add: "patty_cooked", bonus: 12 },
  ],
  fries: [{ id: "large", label: "Large", add: "fries", bonus: 10 }],
  salad: [
    { id: "add_patty", label: "+ Patty", add: "patty_cooked", bonus: 12 },
    { id: "no_tomato", label: "No tomato", remove: "tomato_sliced", bonus: 4 },
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

// Where each finished component starts, and which station turns it into what the pass wants.
export const SOURCE: Partial<Record<ItemId, { raw: ItemId; via: StationKind | null }>> = {
  bun: { raw: "bun", via: null },
  patty_cooked: { raw: "patty_raw", via: "grill" },
  lettuce_chopped: { raw: "lettuce", via: "prep" },
  tomato_sliced: { raw: "tomato", via: "prep" },
  fries: { raw: "potato", via: "prep" }, // then the fryer
};

// Serving tickets back to back builds a combo that multiplies points.
export const COMBO_WINDOW = 25; // seconds to land the next serve
export function comboMultiplier(combo: number) {
  return 1 + 0.25 * Math.min(combo, 4);
}

export const RUSH_LENGTH = 25; // seconds of rush hour, starting just past the halfway mark

// Every real service opens gently: orders trickle in before the pace picks up.
export const WARMUP_SHARE = 0.3; // first 30% of the service
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

export const FRY_READY = 6; // seconds
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
  duration: number; // seconds of service
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
  stars: [number, number, number]; // score needed for 1, 2, 3 stars
}

const LOCKED: Omit<Tier, "name" | "blurb"> = {
  locked: true,
  duration: 0,
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
    duration: 180,
    orderEvery: [16, 22],
    ticketTime: 90,
    maxTickets: 3,
    maxStrikes: 5,
    grillWindow: 0.2,
    recipes: ["burger", "fries"],
    modChance: 0.15,
    flipAfter: 0,
    peeks: 0,
    helperDefault: true,
    stars: [60, 160, 280],
  },
  diner: {
    name: "Diner",
    blurb: "Faster tickets and salads. Tickets flip after 10s: remember them!",
    locked: false,
    duration: 210,
    orderEvery: [10, 15],
    ticketTime: 62,
    maxTickets: 5,
    maxStrikes: 4,
    grillWindow: 0.15,
    recipes: ["burger", "fries", "salad"],
    modChance: 0.4,
    flipAfter: 10,
    peeks: 4,
    helperDefault: false,
    stars: [90, 230, 380],
  },
  bistro: {
    name: "Bistro",
    blurb: "Lots of mods, tickets flip after 6s, thin grill window, 3 strikes.",
    locked: false,
    duration: 240,
    orderEvery: [7, 11],
    ticketTime: 55,
    maxTickets: 6,
    maxStrikes: 3,
    grillWindow: 0.1,
    recipes: ["burger", "fries", "salad"],
    modChance: 0.65,
    flipAfter: 6,
    peeks: 3,
    helperDefault: false,
    stars: [130, 320, 520],
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
