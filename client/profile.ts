// Your chef career, saved in this browser: character, XP and levels, coins and collection,
// career and challenge records, the daily login streak and daily quests.
import { CHEF_COLORS, TIERS, type TierId } from "../shared/game";
import { FREE_ITEMS, SHOP, STREAK_REWARDS, dayKey, questsFor, shopItem, type Perks, type Quest, type ShopItem } from "../shared/meta";
import { CAREER_LEVELS, goalsMet, type CareerLevel, type Mode } from "../shared/modes";

export interface Profile {
  created: boolean;
  name: string;
  skin: number;
  apron: number;
  hat: string;
  jacket: string;
  decor: string[];
  xp: number;
  coins: number;
  owned: string[];
  trained: boolean;
  best: Partial<Record<TierId, number>>;
  stars: Partial<Record<TierId, number>>;
  career: Record<string, { cleared: boolean; stars: number }>;
  challengeBest: Record<string, number>;
  services: number;
  streak: number;
  lastLogin: string;
  questDay: string;
  quests: Quest[];
}

const KEY = "chefio.profile";

export function loadProfile(): Profile {
  const fresh: Profile = {
    created: false,
    name: "",
    skin: 1,
    apron: 0,
    hat: "hat-toque",
    jacket: "jacket-white",
    decor: [],
    xp: 0,
    coins: 100,
    owned: [...FREE_ITEMS],
    trained: false,
    best: {},
    stars: {},
    career: {},
    challengeBest: {},
    services: 0,
    streak: 0,
    lastLogin: "",
    questDay: "",
    quests: [],
  };
  try {
    const raw = localStorage.getItem(KEY);
    const p = raw ? { ...fresh, ...JSON.parse(raw) } : fresh;
    for (const id of FREE_ITEMS) if (!p.owned.includes(id)) p.owned.push(id);
    return p;
  } catch {
    return fresh;
  }
}

export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Storage blocked: progress lasts for this visit only.
  }
}

// ----- Levels -----

// Level n needs 120 * n * (n - 1) / 2 total XP: quick early levels, a steady climb after.
export function levelFor(xp: number): number {
  let level = 1;
  while (xp >= (120 * (level + 1) * level) / 2) level++;
  return level;
}

export function levelProgress(xp: number): { level: number; into: number; span: number } {
  const level = levelFor(xp);
  const start = (120 * level * (level - 1)) / 2;
  const end = (120 * (level + 1) * level) / 2;
  return { level, into: xp - start, span: end - start };
}

// ----- Unlocks -----

// Quick play restaurants unlock with stars from any mode, or by clearing that chapter's finale.
const UNLOCK_RULES: Partial<Record<TierId, { after: TierId; stars: number; finale: string }>> = {
  diner: { after: "foodtruck", stars: 1, finale: "1-3" },
  bistro: { after: "diner", stars: 1, finale: "2-3" },
};

export function isUnlocked(p: Profile, tier: TierId): boolean {
  if (TIERS[tier].locked) return false;
  const rule = UNLOCK_RULES[tier];
  return !rule || (p.stars[rule.after] ?? 0) >= rule.stars || !!p.career[rule.finale]?.cleared;
}

export function unlockHint(tier: TierId): string {
  const rule = UNLOCK_RULES[tier];
  return rule ? `Earn ${rule.stars}★ at ${TIERS[rule.after].name}` : "";
}

export function careerUnlocked(p: Profile, level: CareerLevel): boolean {
  const i = CAREER_LEVELS.indexOf(level);
  return i <= 0 || !!p.career[CAREER_LEVELS[i - 1].id]?.cleared;
}

export const APRON_LEVELS = [1, 1, 2, 3, 5, 8];
export function apronUnlocked(p: Profile, i: number) {
  return levelFor(p.xp) >= (APRON_LEVELS[i] ?? 99);
}

// ----- Shop -----

export function canBuy(p: Profile, item: ShopItem): "owned" | "level" | "coins" | "ok" {
  if (p.owned.includes(item.id)) return "owned";
  if (item.level && levelFor(p.xp) < item.level) return "level";
  if (p.coins < item.price) return "coins";
  return "ok";
}

export function buy(p: Profile, id: string): boolean {
  const item = shopItem(id);
  if (!item || canBuy(p, item) !== "ok") return false;
  p.coins -= item.price;
  p.owned.push(id);
  if (item.kind === "decor") p.decor.push(id); // show it off straight away
  saveProfile(p);
  return true;
}

export function has(p: Profile, id: string) {
  return p.owned.includes(id);
}

export function perksOf(p: Profile): Perks {
  return { fryer: has(p, "fryer"), cart: has(p, "cart"), printer: has(p, "printer"), tray: has(p, "tray") };
}

// ----- Daily login streak and quests -----

export interface DailyLogin {
  day: number; // 1-7 position in the weekly cycle
  coins: number;
  crate: ShopItem | null;
}

/** Call once on load. Returns today's login reward the first time you visit each day. */
export function checkIn(p: Profile, now = new Date()): DailyLogin | null {
  const today = dayKey(now);
  if (p.questDay !== today) {
    p.questDay = today;
    p.quests = questsFor(now);
  }
  if (p.lastLogin === today) {
    saveProfile(p);
    return null;
  }
  const yesterday = dayKey(new Date(now.getTime() - 86400000));
  p.streak = p.lastLogin === yesterday ? p.streak + 1 : 1;
  p.lastLogin = today;
  const day = ((p.streak - 1) % 7) + 1;
  const coins = STREAK_REWARDS[day - 1];
  p.coins += coins;
  // Day 7: a mystery crate with something you don't own yet.
  let crate: ShopItem | null = null;
  if (day === 7) {
    const pool = SHOP.filter((i) => i.price > 0 && !p.owned.includes(i.id) && i.kind !== "equipment");
    crate = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    if (crate) {
      p.owned.push(crate.id);
      if (crate.kind === "decor") p.decor.push(crate.id);
    }
  }
  saveProfile(p);
  return { day, coins, crate };
}

export interface ShiftEvents {
  servedByRecipe: Record<string, number>;
  scrubbed: number;
}

export interface ServiceResult {
  mode: Mode;
  tier: TierId;
  level?: string;
  challenge?: string;
  score: number;
  stars: number;
  served: number;
  missed: number;
  bestCombo: number;
}

export interface Award {
  xp: number;
  coins: number;
  levelBefore: number;
  levelAfter: number;
  newBest: boolean;
  newStars: boolean;
  unlocked: string[];
  goals: boolean[] | null; // career only
  cleared: boolean | null;
  questsDone: Quest[];
}

function advanceQuests(p: Profile, r: ServiceResult, ev: ShiftEvents, cleared: boolean | null): Quest[] {
  const done: Quest[] = [];
  for (const q of p.quests) {
    if (q.done) continue;
    switch (q.kind) {
      case "serve":
        q.progress += r.served;
        break;
      case "serveRecipe":
        q.progress += ev.servedByRecipe[q.recipe ?? ""] ?? 0;
        break;
      case "score":
        q.progress = Math.max(q.progress, r.score);
        break;
      case "combo":
        q.progress = Math.max(q.progress, r.bestCombo);
        break;
      case "challenge":
        if (r.mode === "challenge") q.progress += 1;
        break;
      case "career":
        if (cleared) q.progress += 1;
        break;
      case "scrub":
        q.progress += ev.scrubbed;
        break;
      case "stars":
        q.progress = Math.max(q.progress, r.stars);
        break;
    }
    if (q.progress >= q.target) {
      q.done = true;
      q.progress = q.target;
      p.coins += q.reward;
      done.push(q);
    }
  }
  return done;
}

export function award(p: Profile, r: ServiceResult, ev: ShiftEvents): Award {
  const levelBefore = levelFor(p.xp);
  const unlockedBefore = (Object.keys(TIERS) as TierId[]).filter((t) => isUnlocked(p, t));
  const apronsBefore = CHEF_COLORS.map((_, i) => apronUnlocked(p, i));

  const xp = Math.max(10, Math.round(r.score * 0.6 + r.stars * 60 + r.served * 8 + r.bestCombo * 10));
  const coins = Math.max(5, Math.round(r.score / 4 + r.stars * 20));
  const newBest = r.score > (p.best[r.tier] ?? 0);
  const newStars = r.stars > (p.stars[r.tier] ?? 0);
  p.xp += xp;
  p.coins += coins;
  p.services += 1;
  if (newBest) p.best[r.tier] = r.score;
  if (newStars) p.stars[r.tier] = r.stars;

  let goals: boolean[] | null = null;
  let cleared: boolean | null = null;
  if (r.mode === "career" && r.level) {
    const level = CAREER_LEVELS.find((l) => l.id === r.level);
    if (level) {
      goals = goalsMet(level.goal, r);
      cleared = goals.every(Boolean);
      const prev = p.career[level.id];
      p.career[level.id] = { cleared: cleared || !!prev?.cleared, stars: Math.max(prev?.stars ?? 0, cleared ? r.stars : 0) };
    }
  }
  if (r.mode === "challenge" && r.challenge) {
    p.challengeBest[r.challenge] = Math.max(p.challengeBest[r.challenge] ?? 0, r.score);
  }

  const questsDone = advanceQuests(p, r, ev, cleared);
  saveProfile(p);

  const unlocked: string[] = [];
  for (const t of Object.keys(TIERS) as TierId[]) {
    if (isUnlocked(p, t) && !unlockedBefore.includes(t)) unlocked.push(`${TIERS[t].name} unlocked for multiplayer!`);
  }
  CHEF_COLORS.forEach((_, i) => {
    if (apronUnlocked(p, i) && !apronsBefore[i]) unlocked.push("New apron colour!");
  });
  if (levelFor(p.xp) > levelBefore) {
    const fresh = SHOP.filter((i) => i.level && i.level > levelBefore && i.level <= levelFor(p.xp));
    if (fresh.length) unlocked.push(`New in the shop: ${fresh.map((i) => i.name).join(", ")}`);
  }
  return { xp, coins, levelBefore, levelAfter: levelFor(p.xp), newBest, newStars, unlocked: [...new Set(unlocked)], goals, cleared, questsDone };
}
