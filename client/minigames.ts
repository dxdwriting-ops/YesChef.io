// Station mini-games: short, readable skill checks built on real kitchen technique.
// Each one works with the bound "mini-game action" key or the mouse.
import { GRILL, ITEM_NAMES, PREP, type ItemId } from "../shared/game";
import { iconURL } from "./icons";
import { keyName, type Settings } from "./settings";
import type { Sfx } from "./sfx";

export type MinigameResult =
  | { action: "take"; items: ItemId[] }
  | { action: "chop"; item: ItemId; quality: number }
  | { action: "sear"; item: ItemId; result: "cooked" | "burnt"; quality: number }
  | { action: "scrub" };

interface Context {
  item?: ItemId; // what you're prepping or grilling
  walkin?: ItemId[]; // what this kitchen's walk-in stocks
  free?: number; // empty hand slots
  grillWindow: number;
  prepBonus?: number; // Santoku Knife widens the cut marks
  keys: Settings["keys"];
}

type Finish = (result: MinigameResult | null, message?: string) => void;

export class Minigames {
  private readonly root: HTMLElement;
  private cleanup: (() => void) | null = null;
  private stepAway: (() => void) | null = null;
  active = false;

  constructor(
    private readonly onMessage: (text: string) => void,
    private readonly sfx: Sfx,
  ) {
    this.root = document.getElementById("minigame")!;
  }

  /** Leave the current mini-game (Esc, or the pause menu opening). */
  close() {
    this.stepAway?.();
  }

  open(kind: string, ctx: Context): Promise<MinigameResult | null> {
    return new Promise((resolve) => {
      this.active = true;
      this.root.hidden = false;
      const finish: Finish = (result, message) => {
        if (result && result.action !== "take") this.sfx.success();
        else if (message) this.sfx.fail();
        this.cleanup?.();
        this.cleanup = null;
        this.stepAway = null;
        this.root.hidden = true;
        this.root.innerHTML = "";
        this.active = false;
        if (message) this.onMessage(message);
        resolve(result);
      };
      let leave = () => finish(null);
      const onEsc = (e: KeyboardEvent) => {
        if (e.code === "Escape") {
          e.preventDefault();
          leave();
        }
      };
      window.addEventListener("keydown", onEsc);
      const started = this.start(kind, ctx, finish);
      if (started.leave) leave = started.leave;
      this.stepAway = () => leave();
      this.cleanup = () => {
        window.removeEventListener("keydown", onEsc);
        started.stop();
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

  private start(kind: string, ctx: Context, finish: Finish): { stop: () => void; leave?: () => void } {
    switch (kind) {
      case "walkin":
        return this.walkin(ctx, finish);
      case "prep":
        return { stop: this.prep(ctx, finish) };
      case "grill":
        return { stop: this.grill(ctx, finish) };
      case "dishpit":
        return { stop: this.scrub(ctx, finish) };
      default:
        finish(null);
        return { stop: () => {} };
    }
  }

  // Shopping trip: pick up to one item per free hand slot, then close (E, Enter or Esc) or fill up.
  private walkin(ctx: Context, finish: Finish) {
    const stock = ctx.walkin ?? [];
    const free = ctx.free ?? 1;
    const picked: ItemId[] = [];
    const cards = stock
      .map(
        (id, i) => `<button class="mg-card" data-item="${id}">
        <img src="${iconURL(id)}" alt=""><span>${i + 1}. ${ITEM_NAMES[id]}</span></button>`,
      )
      .join("");
    this.frame(
      "Walk-in fridge",
      `Pick up to ${free}: click or press 1-${stock.length}. ${keyName(ctx.keys.interact)} or Enter when you're done.`,
      `<div class="mg-grid">${cards}</div>
       <div class="mg-basket" id="mg-basket"></div>`,
    );
    const basket = this.root.querySelector<HTMLElement>("#mg-basket")!;
    const draw = () => {
      basket.innerHTML =
        Array.from({ length: free }, (_, i) =>
          picked[i] ? `<span class="slot full"><img src="${iconURL(picked[i])}" alt=""></span>` : `<span class="slot"></span>`,
        ).join("") + `<small>${picked.length}/${free} in hand</small>`;
    };
    let closed = false;
    const done = () => {
      if (closed) return;
      closed = true;
      finish(picked.length ? { action: "take", items: picked } : null);
    };
    const pick = (item: ItemId) => {
      picked.push(item);
      this.sfx.pick();
      draw();
      if (picked.length >= free) done(); // full: back to the line
    };
    draw();
    const onClick = (e: MouseEvent) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>("[data-item]")?.dataset.item;
      const item = stock.find((s) => s === id);
      if (item && picked.length < free) pick(item);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === ctx.keys.interact || e.code === "Enter") return done();
      const n = Number(e.key);
      if (n >= 1 && n <= stock.length && picked.length < free) pick(stock[n - 1]);
    };
    this.root.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey);
    return {
      stop: () => {
        this.root.removeEventListener("click", onClick);
        window.removeEventListener("keydown", onKey);
      },
      leave: done, // stepping away keeps what you picked
    };
  }

  // Rhythm prep: the knife sweeps across the board once; hit the action key on each mark.
  private prep(ctx: Context, finish: Finish) {
    const item = ctx.item;
    const step = item ? PREP[item] : undefined;
    if (!item || !step) {
      finish(null, "Bring raw ingredients from the walk-in.");
      return () => {};
    }
    const marks = [0.2, 0.4, 0.6, 0.8];
    const zone = 0.05 * (ctx.prepBonus ?? 1);
    const hit = new Set<number>();
    let misses = 0;
    const duration = 2400;
    const marksHtml = marks
      .map((m, i) => `<i class="mg-mark" data-i="${i}" style="left:${m * 100}%;width:${zone * 200}%;margin-left:-${zone * 100}%"></i>`)
      .join("");
    this.frame(
      `Prep: ${step.verb.toLowerCase()}`,
      `Press ${keyName(ctx.keys.work)} (or click) as the knife crosses each mark.`,
      `<div class="mg-row"><img class="mg-big" src="${iconURL(item)}" alt="">
        <span class="mg-arrow">→</span><img class="mg-big" src="${iconURL(step.result)}" alt=""></div>
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
      knife.style.transform = `translateX(${p * 100}cqw)`;
      if (p >= 1) {
        const quality = Math.max(0, (hit.size - misses * 0.5) / marks.length);
        if (hit.size === 0) finish(null, "Every cut missed. Try again!");
        else finish({ action: "chop", item, quality }, hit.size === 4 && misses === 0 ? "Perfect knife work!" : undefined);
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    const press = () => {
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
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== ctx.keys.work || e.repeat) return;
      e.preventDefault();
      press();
    };
    const onPointer = (e: PointerEvent) => {
      if (e.button === 0) press();
    };
    t0 = performance.now() + 450; // short count-in
    raf = requestAnimationFrame(loop);
    window.addEventListener("keydown", onKey);
    this.root.addEventListener("pointerdown", onPointer);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      this.root.removeEventListener("pointerdown", onPointer);
    };
  }

  // Sear or toast by feel: hold the action key (or the mouse), release in the green window. Too long and it burns.
  private grill(ctx: Context, finish: Finish) {
    const item = ctx.item;
    const step = item ? GRILL[item] : undefined;
    if (!item || !step) {
      finish(null, "The grill takes raw patties and buns.");
      return () => {};
    }
    const center = 0.62;
    const lo = center - ctx.grillWindow / 2;
    const hi = center + ctx.grillWindow / 2;
    const fillTime = 2.4 / step.speed;
    this.frame(
      `Grill: ${step.verb.toLowerCase()}`,
      `Hold ${keyName(ctx.keys.work)} (or the mouse). Let go in the green zone.`,
      `<div class="mg-row"><img class="mg-big mg-patty" src="${iconURL(item)}" alt=""></div>
       <div class="mg-meter"><i class="mg-zone" style="left:${lo * 100}%;width:${(hi - lo) * 100}%"></i>
         <i class="mg-burn" style="left:${(hi + 0.12) * 100}%"></i><b class="mg-fill"></b></div>
       <div class="mg-score" id="mg-doneness">${item === "bun" ? "Untoasted" : "Raw"}</div>`,
    );
    const fill = this.root.querySelector<HTMLElement>(".mg-fill")!;
    const pic = this.root.querySelector<HTMLImageElement>(".mg-patty")!;
    const label = this.root.querySelector<HTMLElement>("#mg-doneness")!;
    let v = 0;
    let shown: ItemId = item;
    let holding = false;
    let last = performance.now();
    let raf = 0;
    let sizzleAt = 0;
    const release = () => {
      if (!holding) return;
      holding = false;
      if (v < lo) {
        v = 0;
        label.textContent = item === "bun" ? "Still pale. Hold longer!" : "Still raw. Hold longer!";
        return;
      }
      if (v <= hi) finish({ action: "sear", item, result: "cooked", quality: 1 - Math.abs(v - center) / (hi - lo) }, item === "bun" ? "Golden toast!" : "Beautiful crust!");
      else finish({ action: "sear", item, result: "burnt", quality: 0 }, "Burnt! Toss it and grab another.");
    };
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (holding) v = Math.min(1, v + dt / fillTime);
      if (holding && now > sizzleAt) {
        this.sfx.sizzle();
        sizzleAt = now + 150;
      }
      fill.style.transform = `scaleX(${v})`;
      const look: ItemId = v < lo ? item : v <= hi + 0.12 ? step.result : "burnt";
      if (look !== shown) {
        shown = look;
        pic.src = iconURL(look);
      }
      if (holding) label.textContent = v < lo ? (item === "bun" ? "Toasting..." : "Searing...") : v <= hi ? "Now! Let go!" : "Smoking!";
      if (v >= 1) {
        holding = true;
        return release();
      }
      raf = requestAnimationFrame(loop);
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === ctx.keys.work) {
        e.preventDefault();
        holding = true;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === ctx.keys.work) release();
    };
    const pDown = (e: PointerEvent) => {
      if (e.button === 0) holding = true;
    };
    raf = requestAnimationFrame(loop);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    this.root.addEventListener("pointerdown", pDown);
    window.addEventListener("pointerup", release);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      this.root.removeEventListener("pointerdown", pDown);
      window.removeEventListener("pointerup", release);
    };
  }

  // Scrub: alternate the strafe keys fast enough to clean a plate before the timer runs out.
  private scrub(ctx: Context, finish: Finish) {
    const needed = 14;
    const limit = 5000;
    const a = ctx.keys.left;
    const d = ctx.keys.right;
    let strokes = 0;
    let lastKey = "";
    const start = performance.now();
    this.frame(
      "Dish pit: scrub",
      `Alternate ${keyName(a)} and ${keyName(d)} to scrub. ${needed} strokes in 5 seconds.`,
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
      if ((e.code !== a && e.code !== d) || e.code === lastKey) return;
      lastKey = e.code;
      strokes++;
      this.sfx.scrub();
      fill.style.transform = `scaleX(${strokes / needed})`;
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
