// Ways to play: multiplayer quick play, a story career, challenges, and training.
// Every mode boils down to a Rules object the server runs.
import { BASE_SLOTS, FRY_BURNT, FRY_READY, MAX_SLOTS, PLATE_RETURN_DELAY, START_PLATES, TIERS, isPlayableTier, type RecipeId, type Tier, type TierId } from "./game";
import type { LayoutId } from "./layouts";
import type { Perks } from "./meta";

export type Mode = "quick" | "career" | "challenge" | "training";

export interface Rules extends Tier {
  mode: Mode;
  tier: TierId;
  layout: LayoutId;
  startPlates: number;
  title: string; // shown on the HUD
  fryReady: number;
  fryBurnt: number;
  plateDelay: number;
  slots: number; // hand slots for this chef
}

export const TIER_LAYOUT: Partial<Record<TierId, LayoutId>> = { foodtruck: "truck", diner: "diner", bistro: "bistro" };

export interface Goal {
  serve?: number; // serve at least this many tickets
  score?: number; // reach this score
  maxMissed?: number; // no more walk-outs than this
  combo?: number; // hit this combo at least once
  stars?: number; // finish with at least this many stars
}

export function goalText(g: Goal): string[] {
  const out: string[] = [];
  if (g.serve) out.push(`Serve ${g.serve} orders`);
  if (g.score) out.push(`Score ${g.score}+`);
  if (g.maxMissed !== undefined) out.push(g.maxMissed === 0 ? "No walk-outs" : `At most ${g.maxMissed} walk-outs`);
  if (g.combo) out.push(`Hit a x${g.combo} combo streak`);
  if (g.stars) out.push(`Earn ${"★".repeat(g.stars)}`);
  return out;
}

export function goalsMet(g: Goal, r: { served: number; score: number; missed: number; bestCombo: number; stars: number }): boolean[] {
  const met: boolean[] = [];
  if (g.serve) met.push(r.served >= g.serve);
  if (g.score) met.push(r.score >= g.score);
  if (g.maxMissed !== undefined) met.push(r.missed <= g.maxMissed);
  if (g.combo) met.push(r.bestCombo >= g.combo);
  if (g.stars) met.push(r.stars >= g.stars);
  return met;
}

export interface CareerLevel {
  id: string;
  name: string;
  tier: TierId;
  story: string;
  goal: Goal;
  rules: Partial<Tier> & { startPlates?: number };
}

export interface Chapter {
  title: string;
  tier: TierId;
  intro: string;
  levels: CareerLevel[];
}

export const CAREER: Chapter[] = [
  {
    title: "Chapter 1: The Truck",
    tier: "foodtruck",
    intro: "Your aunt Mika hands you the keys to her battered old food truck. \"Feed the street, kiddo. Make me proud.\"",
    levels: [
      {
        id: "1-1",
        name: "Opening Night",
        tier: "foodtruck",
        story: "Just burgers tonight. Grab everything for one in a single trip, then work down the line.",
        goal: { serve: 3 },
        rules: { orders: [4, 5], recipes: ["burger"], modChance: 0, maxTickets: 2, orderEvery: [20, 26], ticketTime: 120, helperDefault: true },
      },
      {
        id: "1-2",
        name: "Fry Day",
        tier: "foodtruck",
        story: "Word's out. Folks want fries with that. Remember: the fryer cooks while you work.",
        goal: { serve: 5 },
        rules: { orders: [6, 7, 8], recipes: ["burger", "fries"], modChance: 0, maxTickets: 3, ticketTime: 110 },
      },
      {
        id: "1-3",
        name: "Street Festival",
        tier: "foodtruck",
        story: "The whole block turned up, and some of them want their burgers their way. Nobody knows when the line ends.",
        goal: { stars: 1, maxMissed: 2 },
        rules: {},
      },
    ],
  },
  {
    title: "Chapter 2: Mika's Diner",
    tier: "diner",
    intro: "The truck was a hit. Mika reopens her old diner and puts you on the line. Bigger kitchen, two grills, more mouths.",
    levels: [
      {
        id: "2-1",
        name: "Salad Days",
        tier: "diner",
        story: "The lunch crowd wants something green. Salads hit the menu.",
        goal: { serve: 6 },
        rules: { orders: [8, 10], recipes: ["burger", "fries", "salad"], flipAfter: 0, modChance: 0.1, orderEvery: [14, 18] },
      },
      {
        id: "2-2",
        name: "Hold the Lettuce",
        tier: "diner",
        story: "Regulars are picky. Read every ticket. Then it flips, so remember it!",
        goal: { serve: 8, maxMissed: 2 },
        rules: { orders: [10, 12], recipes: ["burger", "fries", "salad"], modChance: 0.6, flipAfter: 12, peeks: 4 },
      },
      {
        id: "2-3",
        name: "Breakfast Rush",
        tier: "diner",
        story: "Saturday morning, and onion rings are the new special. The line's out the door. Keep the combo alive.",
        goal: { stars: 2, combo: 3 },
        rules: {},
      },
    ],
  },
  {
    title: "Chapter 3: Le Petit Pixel",
    tier: "bistro",
    intro: "A famous chef saw what you did at the diner. Now you run the line at her bistro: two rooms, twin stations, zero mercy.",
    levels: [
      {
        id: "3-1",
        name: "Learning the Rooms",
        tier: "bistro",
        story: "Cold room in the back, dish room by the door. Learn the routes before the rush.",
        goal: { serve: 8 },
        rules: { orders: [10, 12], modChance: 0.3, flipAfter: 10, orderEvery: [11, 15], maxStrikes: 5 },
      },
      {
        id: "3-2",
        name: "Dish Room Blues",
        tier: "bistro",
        story: "The dishwasher called in sick. One clean plate to start. Don't forget the sink.",
        goal: { serve: 10, maxMissed: 2 },
        rules: { orders: [12, 15], startPlates: 1, flipAfter: 8, maxStrikes: 4 },
      },
      {
        id: "3-3",
        name: "The Critic",
        tier: "bistro",
        story: "A food critic is in the dining room tonight. One walk-out and it's in the paper.",
        goal: { stars: 2, maxMissed: 1 },
        rules: {},
      },
    ],
  },
];

export const CAREER_LEVELS = CAREER.flatMap((c) => c.levels);

export interface Challenge {
  id: string;
  name: string;
  blurb: string;
  tier: TierId;
  rules: Partial<Tier> & { startPlates?: number };
}

const BASE_CHALLENGES: Challenge[] = [
  {
    id: "blitz",
    name: "Burger Blitz",
    blurb: "Burgers only, lots of mods, tickets flying in until the crowd's fed.",
    tier: "diner",
    rules: { orders: [20, 25], recipes: ["burger"], modChance: 0.8, orderEvery: [7, 10], maxTickets: 5, flipAfter: 0, maxStrikes: 99, stars: [40, 62, 85] },
  },
  {
    id: "memory",
    name: "Memory Lane",
    blurb: "Tickets flip after 3 seconds and you get one peek. Pure recall.",
    tier: "diner",
    rules: { orders: [12, 15], recipes: ["burger", "fries", "salad"], modChance: 0.7, flipAfter: 3, peeks: 1, orderEvery: [12, 16] },
  },
  {
    id: "fry",
    name: "Fry Cook",
    blurb: "Two fryers, fries and onion rings. Juggle the baskets without burning a batch.",
    tier: "bistro",
    rules: { orders: [15, 20], recipes: ["fries", "rings"], modChance: 0.4, orderEvery: [6, 9], maxTickets: 5, flipAfter: 0, maxStrikes: 99, stars: [20, 32, 45] },
  },
  {
    id: "plates",
    name: "Plate Panic",
    blurb: "One clean plate, a sink across the kitchen, and a hungry crowd.",
    tier: "bistro",
    rules: { orders: [12, 15], startPlates: 1, flipAfter: 0, maxStrikes: 99 },
  },
];

// The daily challenge: same rules for everyone today, different tomorrow.
export function dailyChallenge(date = new Date()): Challenge {
  const seed = date.getFullYear() * 1000 + date.getMonth() * 40 + date.getDate();
  const pick = <T,>(list: T[], salt: number) => list[(seed * 31 + salt * 17) % list.length];
  const tier = pick<TierId>(["foodtruck", "diner", "bistro"], 1);
  const recipes = pick<RecipeId[]>(
    [["burger"], ["burger", "fries"], ["burger", "salad"], ["burger", "fries", "salad"], ["burger", "rings"], ["chicken", "fries"]],
    2,
  );
  const flip = pick([0, 0, 6, 9], 3);
  const mods = pick([0.2, 0.5, 0.8], 4);
  return {
    id: `daily-${seed}`,
    name: "Daily Special",
    blurb: `${TIERS[tier].name} kitchen · ${recipes.join(" + ")} · ${flip ? `tickets flip at ${flip}s` : "no flips"} · ${Math.round(mods * 100)}% mods`,
    tier,
    rules: { orders: [12, 15, 18], recipes, flipAfter: flip, peeks: flip ? 3 : 0, modChance: mods, maxStrikes: 99, stars: [25, 45, 65] },
  };
}

export function challenges(): Challenge[] {
  return [dailyChallenge(), ...BASE_CHALLENGES];
}

export interface RoomOptions {
  mode?: Mode;
  tier?: string;
  level?: string;
  challenge?: string;
  perks?: Perks;
}

/** Turn whatever the client asked for into concrete rules. Unknown input falls back to Food Truck quick play. */
export function rulesFor(opts: RoomOptions): Rules {
  const mode: Mode = opts.mode === "career" || opts.mode === "challenge" || opts.mode === "training" ? opts.mode : "quick";
  let tier: TierId = isPlayableTier(opts.tier) ? opts.tier : "foodtruck";
  let overrides: Partial<Tier> & { startPlates?: number } = {};
  let title = TIERS[tier].name;

  if (mode === "career") {
    const level = CAREER_LEVELS.find((l) => l.id === opts.level) ?? CAREER_LEVELS[0];
    tier = level.tier;
    overrides = level.rules;
    title = `${level.id} ${level.name}`;
  } else if (mode === "challenge") {
    const ch = challenges().find((c) => c.id === opts.challenge) ?? BASE_CHALLENGES[0];
    tier = ch.tier;
    overrides = ch.rules;
    title = ch.name;
  } else if (mode === "training") {
    tier = "foodtruck";
    title = "Training";
  }

  const base = TIERS[tier];
  const perks = opts.perks ?? {};
  const { startPlates, ...tierOverrides } = overrides;
  const rules: Rules = {
    ...base,
    ...tierOverrides,
    mode,
    tier,
    layout: TIER_LAYOUT[tier] ?? "truck",
    startPlates: startPlates ?? START_PLATES,
    title,
    fryReady: FRY_READY,
    fryBurnt: FRY_BURNT,
    plateDelay: PLATE_RETURN_DELAY,
    slots: perks.tray ? MAX_SLOTS : BASE_SLOTS,
  };

  // Equipment perks. Ones that change the shared kitchen only apply in solo modes, so co-op stays even.
  const solo = mode !== "quick";
  if (solo && perks.fryer) {
    rules.fryReady = 4.5;
    rules.fryBurnt = 12;
  }
  if (solo && perks.cart) rules.plateDelay = 3;
  if (perks.printer && rules.flipAfter > 0) {
    rules.flipAfter += 3;
    rules.peeks += 1;
  }
  return rules;
}
