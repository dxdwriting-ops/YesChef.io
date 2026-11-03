// DOM heads-up display layered over the pixel canvas.
// Elements are created once and updated in place: nothing re-renders (or re-animates) every tick.
import {
  CHEF_COLORS,
  COMBO_WINDOW,
  ITEM_NAMES,
  RECIPES,
  TIERS,
  comboMultiplier,
  isItem,
  modLabel,
  remainingNeeds,
  type RecipeId,
  type TierId,
} from "../shared/game";
import { iconURL } from "./icons";
import { levelProgress, type Award, type Profile } from "./profile";
import type { KitchenView, TicketView } from "./types";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function esc(text: string) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function clock(seconds: number) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Only touch the DOM when a value actually changes.
function setText(el: HTMLElement, text: string) {
  if (el.textContent !== text) el.textContent = text;
}
function setHTML(el: HTMLElement, html: string) {
  if (el.dataset.html !== html) {
    el.innerHTML = html;
    el.dataset.html = html;
  }
}

interface TicketEl {
  root: HTMLElement;
  bar: HTMLElement;
  items: HTMLElement;
  flag: HTMLElement;
  signature: string;
}

export const CHECKLIST = [
  { id: "look", text: "Look around (drag the mouse, or arrow keys)" },
  { id: "walk", text: "Walk with WASD" },
  { id: "grab", text: "Grab something at the Walk-in (E)" },
  { id: "station", text: "Use Prep or the Grill" },
  { id: "pass", text: "Ready? Press Start service" },
] as const;
export type ChecklistId = (typeof CHECKLIST)[number]["id"];

export class Hud {
  private readonly tickets = new Map<number, TicketEl>();
  private readonly leaving = new Map<number, "served" | "missed">();
  private readonly lastToast = new Map<string, number>();
  private readonly checked = new Set<string>();
  peeking = false;
  flipAfter = 0; // from this room's rules
  lobbyText = "";
  selected = 0; // active hand slot (what Trash throws away)
  slotKeys: string[] = ["1", "2", "3", "4"];

  constructor(onStart: () => void, onTrain: () => void) {
    $("start-service").addEventListener("click", onStart);
    $("play-again").addEventListener("click", onStart);
    $("train").addEventListener("click", onTrain);
    this.renderChecklist();
  }

  coach(c: { title: string; body: string } | null) {
    const el = $("coach");
    el.hidden = !c;
    if (!c) return;
    setText(el.querySelector("b")!, c.title);
    setText(el.querySelector("p")!, c.body);
  }

  showAward(a: Award, p: Profile, goals: string[] | null) {
    $("results-xp").hidden = false;
    setText($("xp-gain"), `+${a.xp} XP`);
    setText($("coin-gain"), `+${a.coins} coins`);
    const goalEl = $("results-goals");
    goalEl.hidden = !goals || !a.goals;
    if (goals && a.goals) {
      goalEl.innerHTML = goals.map((g, i) => `<li class="${a.goals![i] ? "met" : "miss"}">${esc(g)}</li>`).join("");
      setText($("results-title"), a.cleared ? "Shift cleared!" : "Not quite. Try again!");
    }
    const prog = levelProgress(p.xp);
    setText($("xp-level"), a.levelAfter > a.levelBefore ? `Level up! Lv ${prog.level}` : `Lv ${prog.level}`);
    const bar = $("xp-bar");
    bar.style.width = "0%";
    requestAnimationFrame(() => (bar.style.width = `${(prog.into / prog.span) * 100}%`));
    const news = [
      ...(a.newBest ? ["New best score!"] : []),
      ...(a.newStars ? ["New star record!"] : []),
      ...a.questsDone.map((q) => `Daily quest done: ${q.text} (+${q.reward} coins)`),
      ...a.unlocked,
    ];
    $("xp-news").innerHTML = news.map((n) => `<li>${esc(n)}</li>`).join("");
  }

  update(state: KitchenView, me: string) {
    const tier = TIERS[state.tier as TierId] ?? TIERS.foodtruck;
    const service = state.phase === "service";
    $("hud").classList.toggle("in-service", service);
    // No clock: the shift lasts as many orders as the night brings. Last call tells you it's nearly over.
    setText($("stat-time-label"), state.lastCall ? "Last call!" : "Served");
    setText($("stat-time"), state.phase === "training" ? "Train" : String(state.served));
    $("stat-time").classList.toggle("urgent", service && state.lastCall);
    setText($("stat-score"), String(state.score));
    setHTML(
      $("stat-strikes"),
      state.maxStrikes > 8 // challenges with no strike-out just count walk-outs
        ? `<i class="${state.strikes ? "on" : ""}">✕</i> ${state.strikes}`
        : Array.from({ length: state.maxStrikes }, (_, i) => `<i class="${i < state.strikes ? "on" : ""}">✕</i>`).join(""),
    );
    setText($("stat-plates"), `${state.cleanPlates} clean · ${state.dirtyPlates} dirty`);
    $("stat-plates").classList.toggle("urgent", service && state.cleanPlates === 0);
    setText($("stat-tier"), state.title || tier.name);

    // Combo meter.
    const combo = $("combo");
    combo.hidden = !service || state.combo < 1;
    if (!combo.hidden) {
      setText(combo.querySelector("b")!, `Combo x${comboMultiplier(state.combo).toFixed(2).replace(/0$/, "")}`);
      (combo.querySelector("i") as HTMLElement).style.width = `${(state.comboTime / COMBO_WINDOW) * 100}%`;
    }
    $("rush").hidden = !(service && state.rushLeft > 0);

    this.renderTickets(state, this.flipAfter);

    const crew: string[] = [];
    state.players.forEach((p, id) => {
      const color = CHEF_COLORS[p.color % CHEF_COLORS.length];
      const where = p.station ? ` · ${esc(p.station.replace(/\d/, ""))}` : "";
      crew.push(`<li style="--c:${color}">${esc(p.name)}${id === me ? " (you)" : ""}<small>${where}</small></li>`);
    });
    setHTML($("crew"), crew.join(""));
    setHTML($("lobby-crew"), crew.join(""));

    const mine = state.players.get(me);
    if (mine) this.renderHands(mine.hands, mine.slots);

    $("lobby").hidden = state.phase !== "lobby";
    setText($("lobby-tier"), this.lobbyText || `${tier.name}: ${tier.blurb}`);
    $("results").hidden = state.phase !== "results";
    if (state.phase === "results") {
      setHTML($("results-stars"), [1, 2, 3].map((n) => `<i class="${n <= state.stars ? "on" : ""}">★</i>`).join(""));
      setText($("results-score"), String(state.score));
      setText($("results-served"), String(state.served));
      setText($("results-missed"), String(state.missed));
      setText($("results-combo"), `x${state.bestCombo}`);
      setText($("results-time"), clock(state.elapsed));
      setText($("results-title"), ["Rough night", "Not bad, crew", "Great service!", "Chef's kiss!"][state.stars]);
    }
  }

  // The hotbar: one box per hand slot, the selected one raised. Rebuilt only when what you hold changes.
  private renderHands(hands: Iterable<string>, slots: number) {
    const items = [...hands];
    if (this.selected >= slots) this.selected = slots - 1;
    const sel = Math.min(this.selected, Math.max(0, items.length - 1));
    const html = Array.from({ length: slots }, (_, i) => {
      const item = items[i];
      const pic = isItem(item) ? `<img src="${iconURL(item)}" alt="" title="${ITEM_NAMES[item]}">` : "";
      return `<span class="slot ${item ? "full" : ""} ${i === sel && item ? "sel" : ""}"><kbd>${esc(this.slotKeys[i] ?? "")}</kbd>${pic}</span>`;
    }).join("");
    const label = isItem(items[sel]) ? ITEM_NAMES[items[sel] as keyof typeof ITEM_NAMES] : items.length ? "" : "Empty hands";
    setHTML($("hands"), `${html}<b>${esc(label)}</b>`);
  }

  private renderTickets(state: KitchenView, flipAfter: number) {
    const rail = $("tickets");
    const alive = new Set<number>();
    const sorted = [...state.tickets].sort((a, b) => a.id - b.id);

    for (const tk of sorted) {
      alive.add(tk.id);
      let el = this.tickets.get(tk.id);
      if (!el) {
        el = this.createTicket(tk);
        this.tickets.set(tk.id, el);
        rail.appendChild(el.root);
      }
      const left = remainingNeeds(tk.need, tk.have);
      const done = left.length === 0;
      const pct = Math.max(0, (tk.timeLeft / tk.timeMax) * 100);
      const age = tk.timeMax - tk.timeLeft;
      const flipped = flipAfter > 0 && age > flipAfter && !done && !this.peeking;

      el.bar.style.width = `${pct.toFixed(1)}%`;
      el.root.classList.toggle("urgent", pct < 30 && !done);
      el.root.classList.toggle("done", done);
      el.root.classList.toggle("flipped", flipped);
      el.root.classList.toggle("peek", this.peeking && flipAfter > 0 && age > flipAfter);
      // Memory hint: how long until a ticket flips.
      el.root.style.setProperty("--flip", flipAfter > 0 ? String(Math.max(0, Math.min(1, age / flipAfter))) : "0");

      // Items only change when something lands on the pass.
      const pool = [...tk.have];
      const signature = `${[...tk.need].join(",")}|${pool.join(",")}`;
      if (signature !== el.signature) {
        el.signature = signature;
        el.items.innerHTML = [...tk.need]
          .map((item) => {
            const i = pool.indexOf(item);
            const got = i >= 0;
            if (got) pool.splice(i, 1);
            return isItem(item) ? `<img class="${got ? "got" : ""}" src="${iconURL(item)}" title="${ITEM_NAMES[item]}" alt="">` : "";
          })
          .join("");
      }
      setText(el.root.querySelector(".t-count")!, `${tk.have.length}/${tk.need.length}`);
      setText(el.flag, done ? (state.cleanPlates > 0 ? "Plating..." : "Need a clean plate!") : "");
    }

    for (const [id, el] of this.tickets) {
      if (alive.has(id)) continue;
      this.tickets.delete(id);
      el.root.classList.add("leaving", this.leaving.get(id) ?? "missed");
      this.leaving.delete(id);
      setTimeout(() => el.root.remove(), 450);
    }

    $("rail-empty").hidden = !(state.phase === "service" && sorted.length === 0);
  }

  private createTicket(tk: TicketView): TicketEl {
    const recipe = RECIPES[tk.recipe as RecipeId];
    const root = document.createElement("div");
    root.className = "ticket";
    const mods = [...tk.mods].map((m) => `<span class="t-mod">${esc(modLabel(tk.recipe, m))}</span>`).join("");
    root.innerHTML = `
      <div class="t-head"><b>#${tk.id}</b> ${esc(recipe?.name ?? tk.recipe)}</div>
      <div class="t-face">
        ${mods ? `<div class="t-mods">${mods}</div>` : ""}
        <div class="t-items"></div>
      </div>
      <div class="t-back">?<span class="t-count"></span></div>
      <div class="t-bar"><i></i></div>
      <div class="t-flip"><i></i></div>
      <div class="t-flag"></div>`;
    return {
      root,
      bar: root.querySelector(".t-bar i")!,
      items: root.querySelector(".t-items")!,
      flag: root.querySelector(".t-flag")!,
      signature: "",
    };
  }

  markLeaving(id: number, how: "served" | "missed") {
    this.leaving.set(id, how);
  }

  setPeeks(left: number | null) {
    const el = $("peeks");
    el.hidden = left === null;
    if (left !== null) setHTML(el, `<kbd>Tab</kbd> Peek tickets <b>${"●".repeat(left)}${"○".repeat(Math.max(0, 4 - left))}</b>`);
  }

  prompt(html: string | null) {
    const el = $("prompt");
    el.hidden = !html;
    if (html) setHTML(el, html);
  }

  hint(text: string | null) {
    const el = $("hint");
    el.hidden = !text;
    if (text) setText(el, text);
  }

  guide(html: string | null) {
    const el = $("guide");
    el.hidden = !html;
    if (html) setHTML(el, html);
  }

  banner(title: string, sub = "", tone: "order" | "rush" | "bad" = "order") {
    const el = $("banner");
    el.className = `banner ${tone}`;
    el.innerHTML = `<b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}`;
    el.hidden = false;
    void el.offsetWidth; // restart the animation
    el.classList.add("show");
    clearTimeout(Number(el.dataset.timer));
    el.dataset.timer = String(setTimeout(() => (el.hidden = true), tone === "rush" ? 2600 : 2000));
  }

  floatPoints(text: string, good = true) {
    const el = document.createElement("div");
    el.className = `float-points ${good ? "good" : "bad"}`;
    el.textContent = text;
    $("hud").appendChild(el);
    setTimeout(() => el.remove(), 1300);
  }

  flash(kind: "good" | "bad") {
    const el = $("flash");
    el.className = kind;
    void el.offsetWidth;
    el.classList.add("on");
  }

  check(id: ChecklistId) {
    if (this.checked.has(id)) return;
    this.checked.add(id);
    this.renderChecklist();
  }

  private renderChecklist() {
    setHTML(
      $("checklist"),
      CHECKLIST.map((c) => `<li class="${this.checked.has(c.id) ? "on" : ""}">${esc(c.text)}</li>`).join(""),
    );
  }

  toast(text: string, color?: string) {
    const now = performance.now();
    if ((this.lastToast.get(text) ?? 0) > now - 1500) return; // no duplicate spam
    this.lastToast.set(text, now);
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    if (color) el.style.setProperty("--c", color);
    const box = $("toasts");
    box.prepend(el);
    setTimeout(() => el.classList.add("out"), 2600);
    setTimeout(() => el.remove(), 3100);
    while (box.children.length > 4) box.lastElementChild?.remove();
  }
}
