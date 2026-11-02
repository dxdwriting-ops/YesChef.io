// The collection: equipment that changes how you play, outfits, and decorations for your kitchen.
// Plus the reasons to come back: a daily login streak and daily quests.

export type ItemKind = "equipment" | "hat" | "jacket" | "decor";

export interface ShopItem {
  id: string;
  kind: ItemKind;
  name: string;
  blurb: string;
  price: number;
  level?: number; // also needs this chef level
  color?: string; // outfits
}

export const SHOP: ShopItem[] = [
  // Equipment: real perks. Your own mini-games always get them; shared-kitchen perks apply in solo modes.
  { id: "knife", kind: "equipment", name: "Santoku Knife", blurb: "Prep: cut marks are 40% wider.", price: 150 },
  { id: "plancha", kind: "equipment", name: "Cast-Iron Plancha", blurb: "Grill: the sear window is 35% wider.", price: 250 },
  { id: "clogs", kind: "equipment", name: "Kitchen Clogs", blurb: "Walk and sprint 10% faster.", price: 200 },
  { id: "fryer", kind: "equipment", name: "Turbo Fryer", blurb: "Solo: fries are ready at 4.5s and burn later.", price: 300, level: 2 },
  { id: "cart", kind: "equipment", name: "Bus Cart", blurb: "Solo: plates come back after 3s, not 7.", price: 350, level: 3 },
  { id: "printer", kind: "equipment", name: "Ticket Printer", blurb: "Tickets flip 3s later and you get +1 peek.", price: 400, level: 4 },

  // Chef hats.
  { id: "hat-toque", kind: "hat", name: "Classic Toque", blurb: "Where every chef starts.", price: 0, color: "#f4f1ea" },
  { id: "hat-tall", kind: "hat", name: "Tall Toque", blurb: "The taller the hat, the bigger the chef.", price: 120, color: "#f4f1ea" },
  { id: "hat-bandana", kind: "hat", name: "Line Bandana", blurb: "Street-food energy.", price: 150, color: "#e04f3f" },
  { id: "hat-beret", kind: "hat", name: "Bistro Beret", blurb: "Très chic.", price: 220, color: "#2b2730", level: 3 },
  { id: "hat-hachimaki", kind: "hat", name: "Hachimaki", blurb: "Headband of focus.", price: 260, color: "#f4f1ea", level: 4 },
  { id: "hat-gold", kind: "hat", name: "Golden Toque", blurb: "For legends only.", price: 1500, color: "#f2c94c", level: 10 },

  // Chef jackets.
  { id: "jacket-white", kind: "jacket", name: "Whites", blurb: "Crisp and classic.", price: 0, color: "#f4f1ea" },
  { id: "jacket-black", kind: "jacket", name: "Night Shift", blurb: "Hides every stain.", price: 160, color: "#2d2a33" },
  { id: "jacket-denim", kind: "jacket", name: "Denim Jacket", blurb: "Food-truck cool.", price: 200, color: "#4a6fa8" },
  { id: "jacket-sakura", kind: "jacket", name: "Sakura", blurb: "Cherry-blossom pink.", price: 260, color: "#f2a7c3", level: 3 },
  { id: "jacket-matcha", kind: "jacket", name: "Matcha", blurb: "Calm, green, focused.", price: 260, color: "#8fb36a", level: 4 },
  { id: "jacket-gold", kind: "jacket", name: "Gold Trim", blurb: "Head chef energy.", price: 900, color: "#e3b54a", level: 8 },

  // Decorations: they appear in your kitchen.
  { id: "decor-rug", kind: "decor", name: "Welcome Rug", blurb: "In front of the pass.", price: 70 },
  { id: "decor-plant", kind: "decor", name: "Potted Monstera", blurb: "A little green in the corner.", price: 90 },
  { id: "decor-poster", kind: "decor", name: "Retro Poster", blurb: "A vintage food poster.", price: 100 },
  { id: "decor-lights", kind: "decor", name: "String Lights", blurb: "Warm bulbs along the line.", price: 160 },
  { id: "decor-lanterns", kind: "decor", name: "Paper Lanterns", blurb: "Red lanterns over the island.", price: 240, level: 2 },
  { id: "decor-neon", kind: "decor", name: "Neon Ramen Sign", blurb: "Glows pink on the wall.", price: 280, level: 3 },
  { id: "decor-cat", kind: "decor", name: "Lucky Cat", blurb: "A maneki-neko waving on the pass.", price: 350, level: 5 },
];

export const FREE_ITEMS = SHOP.filter((i) => i.price === 0).map((i) => i.id);

export function shopItem(id: string): ShopItem | undefined {
  return SHOP.find((i) => i.id === id);
}

export const SKIN_TONES = ["#f2d0b0", "#e8b48f", "#c98e64", "#9c6a43", "#6b4a32"];

// Perks that change the shared kitchen (applied in solo modes only, so co-op stays even).
export interface Perks {
  fryer?: boolean;
  cart?: boolean;
  printer?: boolean;
}

// ----- Daily login streak -----

export const STREAK_REWARDS = [50, 75, 100, 125, 150, 200, 300]; // day 7 also drops a crate

export function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ----- Daily quests -----

export type QuestKind = "serve" | "serveRecipe" | "score" | "combo" | "challenge" | "career" | "scrub" | "stars";

export interface Quest {
  id: string;
  kind: QuestKind;
  text: string;
  target: number;
  recipe?: string;
  reward: number;
  progress: number;
  done: boolean;
}

const QUEST_POOL: Omit<Quest, "progress" | "done">[] = [
  { id: "serve10", kind: "serve", text: "Serve 10 orders", target: 10, reward: 80 },
  { id: "serve20", kind: "serve", text: "Serve 20 orders", target: 20, reward: 140 },
  { id: "burgers", kind: "serveRecipe", recipe: "burger", text: "Serve 6 Smash Burgers", target: 6, reward: 90 },
  { id: "fries", kind: "serveRecipe", recipe: "fries", text: "Serve 6 Fries", target: 6, reward: 90 },
  { id: "salads", kind: "serveRecipe", recipe: "salad", text: "Serve 4 Garden Salads", target: 4, reward: 100 },
  { id: "score200", kind: "score", text: "Score 200 in a single shift", target: 200, reward: 110 },
  { id: "combo4", kind: "combo", text: "Hit a x4 combo streak", target: 4, reward: 100 },
  { id: "challenge", kind: "challenge", text: "Finish any challenge", target: 1, reward: 90 },
  { id: "career", kind: "career", text: "Clear a career shift", target: 1, reward: 90 },
  { id: "scrub3", kind: "scrub", text: "Scrub 3 plates", target: 3, reward: 70 },
  { id: "stars2", kind: "stars", text: "Earn 2 stars in a shift", target: 2, reward: 120 },
];

/** Three quests for the day, the same for everyone on the same date. */
export function questsFor(date = new Date()): Quest[] {
  const seed = date.getFullYear() * 400 + date.getMonth() * 32 + date.getDate();
  const pool = [...QUEST_POOL];
  const picked: Quest[] = [];
  for (let i = 0; i < 3; i++) {
    const idx = (seed * 7 + i * 13) % pool.length;
    const q = pool.splice(idx, 1)[0];
    picked.push({ ...q, progress: 0, done: false });
  }
  return picked;
}
