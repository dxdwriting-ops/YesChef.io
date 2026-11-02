// Station mini-games: short, readable skill checks built on real kitchen technique.
import { ITEM_NAMES, PREP_RESULT, WALKIN_ITEMS, isItem, type ItemId } from "../shared/game";
import { iconURL } from "./icons";
import type { Sfx } from "./sfx";

export type MinigameResult =
  | { action: "take"; item: ItemId }
  | { action: "chop"; quality: number }
  | { action: "sear"; result: "cooked" | "burnt"; quality: number }
  | { action: "scrub" };

interface Context {
  holding: string;
  grillWindow: number;
  prepBonus?: number; // Santoku Knife widens the cut marks
}

type Finish = (result: MinigameResult | null, message?: string) => void;

export class Minigames {
  private readonly root: HTMLElement;
  private cleanup: (() => void) | null = null;
  active = false;

  constructor(
    private readonly onMessage: (text: string) => void,
    private readonly sfx: Sfx,
  ) {
    this.root = document.getElementById("minigame")!;
  }

  open(kind: string, ctx: Context): Promise<MinigameResult | null> {
    return new Promise((resolve) => {
      this.active = true;
      this.root.hidden = false;
      const finish: Finish = (result, message) => {
        if (result) this.sfx.success();
        else if (message) this.sfx.fail();
        this.cleanup?.();
        this.cleanup = null;
        this.root.hidden = true;
        this.root.innerHTML = "";
        this.active = false;
        if (message) this.onMessage(message);
        resolve(result);
      };
      const onEsc = (e: KeyboardEvent) => {
        if (e.code === "Escape") finish(null);
      };
      window.addEventListener("keydown", onEsc);
      const stop = this.start(kind, ctx, finish);
      this.cleanup = () => {
        window.removeEventListener("keydown", onEsc);
        stop();
      };
    });
  }

  private frame(title: string, hint: string, body: string) {
    this.root.innerHTML = `
      <div class="mg-panel">
        <div class="mg-title">${title}</div>
        <div class="mg-body">${body}</div>
        <div class="mg-hint">${hint} <span class="mg-esc">Esc to step away</span></div>
      </div>`;
  }

  private start(kind: string, ctx: Context, finish: Finish): () => void {
    switch (kind) {
      case "walkin":
        return this.walkin(finish);
      case "prep":
        return this.prep(ctx, finish);
      case "grill":
        return this.grill(ctx, finish);
      case "dishpit":
        return this.scrub(finish);
      default:
        finish(null);
        return () => {};
    }
  }

  private walkin(finish: Finish) {
    const cards = WALKIN_ITEMS.map(
      (id, i) => `<button class="mg-card" data-item="${id}">
        <img src="${iconURL(id)}" alt=""><span>${i + 1}. ${ITEM_NAMES[id]}</span></button>`,
    ).join("");
    this.frame("Walk-in fridge", "Pick an ingredient: click it or press 1-5.", `<div class="mg-grid">${cards}</div>`);
    const onClick = (e: MouseEvent) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>("[data-item]")?.dataset.item;
      if (isItem(item)) finish({ action: "take", item });
    };
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= WALKIN_ITEMS.length) finish({ action: "take", item: WALKIN_ITEMS[n - 1] });
    };
    this.root.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      this.root.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }

  // Rhythm chop: the knife sweeps across the board once; tap Space on each cut mark.
  private prep(ctx: Context, finish: Finish) {
    const result = isItem(ctx.holding) ? PREP_RESULT[ctx.holding] : undefined;
    if (!isItem(ctx.holding) || !result) {
      finish(null, "Bring lettuce, a tomato or a potato from the walk-in.");
      return () => {};
    }
    const marks = [0.2, 0.4, 0.6, 0.8];
    const zone = 0.05 * (ctx.prepBonus ?? 1);
    const hit = new Set<number>();
    let misses = 0;
    const duration = 2600;
    const marksHtml = marks
      .map((m, i) => `<i class="mg-mark" data-i="${i}" style="left:${m * 100}%;width:${zone * 200}%;margin-left:-${zone * 100}%"></i>`)
      .join("");
    this.frame(
      "Prep: knife work",
      "Tap Space as the knife crosses each mark.",
      `<div class="mg-row"><img class="mg-big" src="${iconURL(ctx.holding)}" alt="">
        <span class="mg-arrow">→</span><img class="mg-big" src="${iconURL(result)}" alt=""></div>
       <div class="mg-track">${marksHtml}<b class="mg-knife"></b></div>
       <div class="mg-score">Cuts: <span id="mg-cuts">0</span>/4</div>`,
    );
    const knife = this.root.querySelector<HTMLElement>(".mg-knife")!;
    const cuts = this.root.querySelector<HTMLElement>("#mg-cuts")!;
    let t0 = 0;
    let raf = 0;
    const pos = () => Math.min(1, Math.max(0, (performance.now() - t0) / duration));
    const loop = () => {
      const p = pos();
      knife.style.left = `${p * 100}%`;
      if (p >= 1) {
        const quality = Math.max(0, (hit.size - misses * 0.5) / marks.length);
        if (hit.size === 0) finish(null, "Every chop missed. Try again!");
        else finish({ action: "chop", quality }, hit.size === 4 && misses === 0 ? "Perfect brunoise!" : undefined);
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      e.preventDefault();
      if (performance.now() < t0) return; // ignore presses during the count-in
      const p = pos();
      const i = marks.findIndex((m, n) => !hit.has(n) && Math.abs(p - m) <= zone);
      if (i >= 0) {
        hit.add(i);
        this.sfx.chop();
        this.root.querySelector(`.mg-mark[data-i="${i}"]`)?.classList.add("hit");
        cuts.textContent = String(hit.size);
      } else {
        misses++;
        this.sfx.miss();
        knife.classList.remove("miss");
        void knife.offsetWidth;
        knife.classList.add("miss");
      }
    };
    t0 = performance.now() + 500; // short count-in
    raf = requestAnimationFrame(loop);
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
    };
  }

  // Sear by feel: hold Space, release in the seared window. Too long and it burns.
  private grill(ctx: Context, finish: Finish) {
    if (ctx.holding !== "patty_raw") {
      finish(null, "The grill needs a raw patty from the walk-in.");
      return () => {};
    }
    const center = 0.62;
    const lo = center - ctx.grillWindow / 2;
    const hi = center + ctx.grillWindow / 2;
    this.frame(
      "Grill: smash & sear",
      "Hold Space to sear. Release in the green zone.",
      `<div class="mg-row"><img class="mg-big mg-patty" src="${iconURL("patty_raw")}" alt=""></div>
       <div class="mg-meter"><i class="mg-zone" style="left:${lo * 100}%;width:${(hi - lo) * 100}%"></i>
         <i class="mg-burn" style="left:${(hi + 0.12) * 100}%"></i><b class="mg-fill"></b></div>
       <div class="mg-score" id="mg-doneness">Raw</div>`,
    );
    const fill = this.root.querySelector<HTMLElement>(".mg-fill")!;
    const patty = this.root.querySelector<HTMLImageElement>(".mg-patty")!;
    const label = this.root.querySelector<HTMLElement>("#mg-doneness")!;
    let v = 0;
    let shown: ItemId = "patty_raw";
    let holding = false;
    let last = performance.now();
    let raf = 0;
    let sizzleAt = 0;
    const release = () => {
      if (v < lo) {
        holding = false;
        v = 0;
        label.textContent = "Still raw. Hold longer!";
        return;
      }
      if (v <= hi) finish({ action: "sear", result: "cooked", quality: 1 - Math.abs(v - center) / (hi - lo) }, "Beautiful crust!");
      else finish({ action: "sear", result: "burnt", quality: 0 }, "Burnt! Toss it and grab another.");
    };
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (holding) v = Math.min(1, v + dt / 2.4);
      if (holding && now > sizzleAt) {
        this.sfx.sizzle();
        sizzleAt = now + 150;
      }
      fill.style.width = `${v * 100}%`;
      const look: ItemId = v < lo ? "patty_raw" : v <= hi + 0.12 ? "patty_cooked" : "patty_burnt";
      if (look !== shown) {
        shown = look;
        patty.src = iconURL(look);
      }
      if (holding) label.textContent = v < lo ? "Searing..." : v <= hi ? "Medium! Let go!" : "Smoking!";
      if (v >= 1) return release();
      raf = requestAnimationFrame(loop);
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        holding = true;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" && holding) release();
    };
    raf = requestAnimationFrame(loop);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }

  // Scrub: alternate A and D fast enough to clean a plate before the timer runs out.
  private scrub(finish: Finish) {
    const needed = 14;
    const limit = 5000;
    let strokes = 0;
    let lastKey = "";
    const start = performance.now();
    this.frame(
      "Dish pit: scrub",
      "Alternate A and D to scrub. 14 strokes in 5 seconds.",
      `<div class="mg-row"><div class="mg-plate"><i></i></div></div>
       <div class="mg-meter"><b class="mg-fill mg-blue"></b></div>
       <div class="mg-score" id="mg-time">5.0s</div>`,
    );
    const fill = this.root.querySelector<HTMLElement>(".mg-fill")!;
    const grime = this.root.querySelector<HTMLElement>(".mg-plate i")!;
    const time = this.root.querySelector<HTMLElement>("#mg-time")!;
    let raf = 0;
    const loop = () => {
      const left = Math.max(0, limit - (performance.now() - start));
      time.textContent = `${(left / 1000).toFixed(1)}s`;
      if (left === 0) return finish(null, "Still greasy. Scrub faster!");
      raf = requestAnimationFrame(loop);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.code !== "KeyA" && e.code !== "KeyD") || e.code === lastKey) return;
      lastKey = e.code;
      strokes++;
      this.sfx.scrub();
      fill.style.width = `${(strokes / needed) * 100}%`;
      grime.style.opacity = String(1 - strokes / needed);
      if (strokes >= needed) finish({ action: "scrub" }, "Sparkling!");
    };
    raf = requestAnimationFrame(loop);
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
    };
  }
}
