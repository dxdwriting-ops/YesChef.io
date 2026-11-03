import { Room, type Client } from "colyseus";
import {
  CHEF_COLORS,
  COMBO_WINDOW,
  FRY,
  GRILL,
  INTERACT_RANGE,
  MODS,
  PINGS,
  PREP,
  RECIPES,
  RUSH_AT,
  RUSH_LENGTH,
  TRAINING_ORDERS,
  WARMUP_SHARE,
  WARMUP_SLOWDOWN,
  applyMods,
  comboMultiplier,
  distanceToStation,
  fryTimes,
  isItem,
  remainingNeeds,
  starsFor,
  walkinItems,
  type ItemId,
  type RecipeId,
  type StationDef,
} from "../shared/game";
import { LAYOUTS, type Layout } from "../shared/layouts";
import { SKIN_TONES, shopItem } from "../shared/meta";
import { rulesFor, type RoomOptions, type Rules } from "../shared/modes";
import { KitchenState, Player, Station, Ticket, type PlayerState, type TicketState } from "./state";

interface JoinOptions extends RoomOptions {
  name?: string;
  color?: number;
  skin?: number;
  hat?: string;
  jacket?: string;
}

interface UseMessage {
  station?: string;
  action?: string;
  item?: string;
  items?: unknown;
  quality?: number;
  result?: string;
}

const QUEUE_SECONDS = 20; // quick play: countdown once a second chef joins

function clamp01(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

function randomBetween([lo, hi]: [number, number]): number {
  return lo + Math.random() * (hi - lo);
}

export class KitchenRoom extends Room<{ state: InstanceType<typeof KitchenState> }> {
  maxClients = 6;

  private rules!: Rules;
  private layout!: Layout;
  private stationById = new Map<string, StationDef>();
  private walkin: ItemId[] = [];
  private nextOrderIn = 0;
  private nextTicketId = 1;
  private platesComingBack: number[] = [];
  private rushDone = false;
  private trainingStep = 0;
  // The night's length in tickets. Server-only on purpose: nobody knows when the last order is coming.
  private ordersTotal = 0;
  private ordersSpawned = 0;

  onCreate(options: JoinOptions) {
    this.rules = rulesFor(options ?? {});
    this.layout = LAYOUTS[this.rules.layout];
    this.stationById = new Map(this.layout.stations.map((s) => [s.id, s]));
    this.walkin = walkinItems(this.rules.recipes);
    // Career, challenge and training are solo runs in a private kitchen.
    if (this.rules.mode !== "quick") this.maxClients = 1;

    const state = new KitchenState();
    state.tier = this.rules.tier;
    state.mode = this.rules.mode;
    state.title = this.rules.title;
    state.maxStrikes = this.rules.maxStrikes;
    state.cleanPlates = this.rules.startPlates;
    for (const def of this.layout.stations) {
      const station = new Station();
      station.kind = def.kind;
      state.stations.set(def.id, station);
    }
    this.setState(state);

    this.onMessage("move", (client, msg: { x?: number; z?: number; yaw?: number }) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || typeof msg?.x !== "number" || typeof msg?.z !== "number") return;
      const hw = this.layout.width / 2 - 0.3;
      const hd = this.layout.depth / 2 - 0.3;
      p.x = Math.max(-hw, Math.min(hw, msg.x));
      p.z = Math.max(-hd, Math.min(hd, msg.z));
      if (typeof msg.yaw === "number" && Number.isFinite(msg.yaw)) p.yaw = msg.yaw;
    });

    this.onMessage("enter", (client, msg: { station?: string }) => {
      const p = this.state.players.get(client.sessionId);
      const def = msg?.station ? this.stationById.get(msg.station) : undefined;
      if (!p || !def || !this.inRange(p, def)) return;
      const station = this.state.stations.get(def.id)!;
      if (station.user && station.user !== client.sessionId) {
        client.send("toast", "Someone is already working that station.");
        return;
      }
      this.releaseStation(client.sessionId);
      station.user = client.sessionId;
      p.station = def.id;
    });

    this.onMessage("leave", (client) => this.releaseStation(client.sessionId));
    this.onMessage("use", (client, msg: UseMessage) => this.handleUse(client, msg));

    this.onMessage("start", () => {
      if (this.state.phase !== "service") this.startService();
    });

    this.onMessage("train", () => {
      if (this.state.phase === "lobby" || this.state.phase === "results") this.startTraining();
    });

    // Solo kitchens stop the world while you're in the pause menu. A shared kitchen never stops.
    this.onMessage("pause", (_client, paused: unknown) => {
      if (this.rules.mode !== "quick") this.state.paused = paused === true;
    });

    this.onMessage("ping", (client, index: number) => {
      const p = this.state.players.get(client.sessionId);
      const text = PINGS[index];
      if (p && text) this.broadcast("ping", { name: p.name, color: p.color, text });
    });

    this.setSimulationInterval((dtMs) => this.tick(dtMs / 1000), 100);
  }

  onJoin(client: Client, options: JoinOptions) {
    const p = new Player();
    const raw = typeof options?.name === "string" ? options.name : "";
    p.name = raw.replace(/[^\w .'-]/g, "").trim().slice(0, 14) || "Chef";
    p.color = this.colorFor(options?.color);
    // Outfit: only known item ids get through.
    if (typeof options?.skin === "number" && options.skin >= 0 && options.skin < SKIN_TONES.length) p.skin = Math.floor(options.skin);
    if (shopItem(options?.hat ?? "")?.kind === "hat") p.hat = options.hat!;
    if (shopItem(options?.jacket ?? "")?.kind === "jacket") p.jacket = options.jacket!;
    // Hand slots are personal (the Sheet Tray), so each chef brings their own.
    p.slots = rulesFor({ ...options, mode: this.rules.mode }).slots;
    const n = this.state.players.size;
    p.x = this.layout.spawn.x - 0.6 + (n % 3) * 0.6;
    p.z = this.layout.spawn.z + Math.floor(n / 3) * 0.6;
    p.yaw = 0; // face the back line (the camera looks down -Z at yaw 0)
    this.state.players.set(client.sessionId, p);
    if (this.rules.mode === "quick") this.broadcast("toast", `${p.name} clocked in.`);
    if (this.rules.mode === "training") this.startTraining();
  }

  onLeave(client: Client) {
    const p = this.state.players.get(client.sessionId);
    this.releaseStation(client.sessionId);
    this.state.players.delete(client.sessionId);
    if (p && this.rules.mode === "quick") this.broadcast("toast", `${p.name} clocked out.`);
  }

  // Your chosen apron colour if nobody in the kitchen wears it yet, otherwise the first free one.
  private colorFor(wanted: unknown): number {
    const used = new Set<number>();
    this.state.players.forEach((p) => used.add(p.color));
    if (typeof wanted === "number" && Number.isInteger(wanted) && wanted >= 0 && wanted < CHEF_COLORS.length && !used.has(wanted)) {
      return wanted;
    }
    for (let i = 0; i < CHEF_COLORS.length; i++) if (!used.has(i)) return i;
    return 0;
  }

  private inRange(p: PlayerState, def: StationDef): boolean {
    return distanceToStation(def, p.x, p.z) <= INTERACT_RANGE + 0.4; // small allowance for latency
  }

  private releaseStation(sessionId: string) {
    const p = this.state.players.get(sessionId);
    if (p) p.station = "";
    this.state.stations.forEach((s) => {
      if (s.user === sessionId) s.user = "";
    });
  }

  // ----- Hands -----

  private give(p: PlayerState, item: ItemId, quality = 1): boolean {
    if (p.hands.length >= p.slots) return false;
    p.hands.push(item);
    p.handsQ.push(quality);
    return true;
  }

  /** Take one of `item` out of the chef's hands; returns its quality, or null if they aren't holding one. */
  private takeItem(p: PlayerState, item: string): number | null {
    const i = p.hands.indexOf(item);
    if (i < 0) return null;
    const q = p.handsQ[i] ?? 1;
    p.hands.splice(i, 1);
    p.handsQ.splice(i, 1);
    return q;
  }

  /** Swap a held item for what it becomes, in the same slot so the hotbar doesn't shuffle. */
  private transform(p: PlayerState, item: string, result: ItemId, quality: number): boolean {
    const i = p.hands.indexOf(item);
    if (i < 0) return false;
    p.hands[i] = result;
    p.handsQ[i] = quality;
    return true;
  }

  private clearHands(p: PlayerState) {
    p.hands.splice(0, p.hands.length);
    p.handsQ.splice(0, p.handsQ.length);
  }

  private handleUse(client: Client, msg: UseMessage) {
    const p = this.state.players.get(client.sessionId);
    const def = msg?.station ? this.stationById.get(msg.station) : undefined;
    if (!p || !def || this.state.paused) return;
    if (!this.inRange(p, def)) {
      client.send("toast", "Get closer to the station.");
      return;
    }
    const station = this.state.stations.get(def.id)!;
    if (station.user && station.user !== client.sessionId) {
      client.send("toast", "Someone is already working that station.");
      return;
    }
    const toast = (text: string) => client.send("toast", text);
    const held = (item: unknown): item is ItemId => isItem(item) && p.hands.includes(item);

    switch (def.kind) {
      case "walkin": {
        // One trip can fill every free slot.
        if (msg.action !== "take" || !Array.isArray(msg.items)) return;
        for (const item of msg.items.slice(0, p.slots)) {
          if (!isItem(item) || !this.walkin.includes(item)) continue;
          if (!this.give(p, item)) return toast("Your hands are full.");
        }
        return;
      }
      case "prep": {
        if (msg.action !== "chop") return;
        const step = held(msg.item) ? PREP[msg.item] : undefined;
        if (!step) return toast("Nothing here to prep. Bring raw ingredients.");
        const q = p.handsQ[p.hands.indexOf(msg.item as string)] ?? 1;
        this.transform(p, msg.item as string, step.result, (q + clamp01(msg.quality)) / 2);
        return;
      }
      case "grill": {
        if (msg.action !== "sear") return;
        const step = held(msg.item) ? GRILL[msg.item] : undefined;
        if (!step) return toast("The grill takes raw patties and buns.");
        if (msg.result === "cooked") this.transform(p, msg.item as string, step.result, clamp01(msg.quality));
        else if (msg.result === "burnt") this.transform(p, msg.item as string, "burnt", 0);
        return;
      }
      case "fryer": {
        if (msg.action !== "fry") return;
        if (!station.item) {
          const item = held(msg.item) && FRY[msg.item] ? msg.item : p.hands.find((h) => isItem(h) && !!FRY[h]);
          if (!item) return toast("The fryer takes cut potatoes, raw onion rings and breaded chicken.");
          this.takeItem(p, item);
          station.item = item;
          station.progress = 0;
          return;
        }
        const t = fryTimes(this.rules.fryReady, this.rules.fryBurnt, station.item);
        if (station.progress < t.ready) return toast("Not golden yet...");
        if (p.hands.length >= p.slots) return toast("Free a hand to pull the basket.");
        const burnt = station.progress > t.burnt;
        const ideal = (t.ready + t.burnt) / 2;
        const q = burnt ? 0 : 1 - Math.abs(station.progress - ideal) / (t.burnt - t.ready);
        this.give(p, burnt ? "burnt" : FRY[station.item as ItemId]!.result, q);
        station.item = "";
        station.progress = 0;
        return;
      }
      case "pass": {
        // Send everything the rail needs in one go, oldest ticket first.
        if (msg.action !== "serve") return;
        if (!p.hands.length) return toast("Bring finished food to the pass.");
        const tickets = this.ticketsInOrder();
        let sent = 0;
        for (const item of [...p.hands]) {
          if (item === "burnt") continue;
          const ticket = tickets.find((tk) => remainingNeeds(tk.need, tk.have).includes(item));
          if (!ticket) continue;
          const q = this.takeItem(p, item) ?? 1;
          ticket.have.push(item);
          ticket.qSum += q;
          sent++;
        }
        if (sent === 0) toast(p.hands.includes("burnt") ? "The expo sends it back. Burnt!" : "No ticket needs that right now.");
        return;
      }
      case "dishpit": {
        if (msg.action !== "scrub") return;
        if (this.state.dirtyPlates === 0) return toast("No dirty plates. Nice.");
        this.state.dirtyPlates -= 1;
        this.state.cleanPlates += 1;
        return;
      }
      case "trash": {
        if (msg.action !== "toss") return;
        if (!p.hands.length) return toast("Nothing to toss.");
        this.takeItem(p, held(msg.item) ? msg.item : p.hands[p.hands.length - 1]!);
        return;
      }
    }
  }

  private ticketsInOrder(): TicketState[] {
    return [...this.state.tickets].sort((a, b) => a.id - b.id);
  }

  private resetKitchen() {
    const s = this.state;
    s.tickets.splice(0, s.tickets.length);
    s.stations.forEach((st) => {
      st.item = "";
      st.progress = 0;
    });
    s.players.forEach((p) => this.clearHands(p));
    s.cleanPlates = this.rules.startPlates;
    s.dirtyPlates = 0;
    s.combo = 0;
    s.comboTime = 0;
    s.rushLeft = 0;
    s.queueLeft = 0;
    s.elapsed = 0;
    s.lastCall = false;
    s.paused = false;
    this.platesComingBack = [];
  }

  private startTraining() {
    this.resetKitchen();
    const s = this.state;
    s.phase = "training";
    s.score = 0;
    this.trainingStep = 0;
    this.spawnTicket(TRAINING_ORDERS[0], true);
  }

  private startService() {
    const s = this.state;
    this.resetKitchen();
    s.phase = "service";
    s.score = 0;
    s.served = 0;
    s.missed = 0;
    s.strikes = 0;
    s.stars = 0;
    s.bestCombo = 0;
    this.rushDone = false;
    this.ordersTotal = this.rules.orders[Math.floor(Math.random() * this.rules.orders.length)];
    this.ordersSpawned = 0;
    this.nextOrderIn = 2;
    this.broadcast("toast", `Service! ${this.rules.title} is open.`);
  }

  private endService(reason: string) {
    const s = this.state;
    s.phase = "results";
    s.paused = false;
    // Tickets still on the rail when the kitchen closes early count as walk-outs for the rating.
    s.stars = starsFor(s.score, Math.max(this.ordersSpawned, s.served + s.missed), this.rules.stars);
    this.broadcast("toast", reason);
  }

  private spawnTicket(forced?: RecipeId, plain = false) {
    const recipeId = forced ?? this.rules.recipes[Math.floor(Math.random() * this.rules.recipes.length)];
    const ticket = new Ticket();
    ticket.id = this.nextTicketId++;
    ticket.recipe = recipeId;
    if (!plain && Math.random() < this.rules.modChance) {
      const options = MODS[recipeId];
      ticket.mods.push(options[Math.floor(Math.random() * options.length)].id);
    }
    const needs = applyMods(recipeId, ticket.mods);
    for (const item of needs) ticket.need.push(item);
    // Bigger orders get a little more time.
    ticket.timeMax = this.rules.ticketTime + Math.max(0, needs.length - 2) * 10;
    ticket.timeLeft = ticket.timeMax;
    this.state.tickets.push(ticket);
    this.broadcast("order", { id: ticket.id, recipe: recipeId, mods: [...ticket.mods] });
  }

  private ticketPoints(tk: TicketState): number {
    const recipe = RECIPES[tk.recipe as RecipeId];
    const modBonus = [...tk.mods].reduce(
      (sum, id) => sum + (MODS[tk.recipe as RecipeId]?.find((m) => m.id === id)?.bonus ?? 0),
      0,
    );
    const base = recipe.base + modBonus;
    const speedBonus = Math.round((base * tk.timeLeft) / tk.timeMax);
    const tip = Math.round((tk.qSum / Math.max(1, tk.have.length)) * 10);
    return Math.round((base + speedBonus + tip) * comboMultiplier(this.state.combo));
  }

  private cookFryers(dt: number) {
    this.state.stations.forEach((st) => {
      if (st.item) st.progress += dt;
    });
  }

  // Training: no clock, no strikes, plates never run out. Serve each lesson dish to unlock the next.
  private trainingTick(dt: number) {
    const s = this.state;
    this.cookFryers(dt);
    const tk = s.tickets[0];
    if (!tk || remainingNeeds(tk.need, tk.have).length > 0) return;
    s.tickets.splice(0, 1);
    this.broadcast("served", { id: tk.id, recipe: tk.recipe, points: 0, combo: 0 });
    this.trainingStep++;
    if (this.trainingStep < TRAINING_ORDERS.length) {
      this.spawnTicket(TRAINING_ORDERS[this.trainingStep], true);
    } else {
      s.phase = "lobby";
      this.broadcast("trained", {});
    }
  }

  // Quick play matchmaking: once two chefs are in, count down and start automatically.
  private queueTick(dt: number) {
    const s = this.state;
    if (s.players.size < 2) {
      s.queueLeft = 0;
      return;
    }
    if (s.queueLeft === 0) s.queueLeft = QUEUE_SECONDS;
    s.queueLeft = Math.max(0.01, s.queueLeft - dt);
    if (s.queueLeft <= 0.01) this.startService();
  }

  private tick(dt: number) {
    const s = this.state;
    if (s.paused) return;

    // Stations whose cook walked away are freed for someone else.
    s.stations.forEach((st, id) => {
      if (!st.user) return;
      const p = s.players.get(st.user);
      const def = this.stationById.get(id)!;
      if (!p || distanceToStation(def, p.x, p.z) > INTERACT_RANGE + 1.5) {
        st.user = "";
        if (p) p.station = "";
      }
    });

    if (s.phase === "training") return this.trainingTick(dt);
    if (s.phase === "lobby" && this.rules.mode === "quick") return this.queueTick(dt);
    if (s.phase !== "service") return;

    s.elapsed += dt;
    this.cookFryers(dt); // baskets keep cooking whether anyone is watching or not

    this.platesComingBack = this.platesComingBack
      .map((t) => t - dt)
      .filter((t) => {
        if (t > 0) return true;
        s.dirtyPlates += 1;
        return false;
      });

    // Combo decays if the next serve doesn't land in time.
    if (s.combo > 0) {
      s.comboTime = Math.max(0, s.comboTime - dt);
      if (s.comboTime === 0) s.combo = 0;
    }

    // Rush hour: about halfway through the night, tickets come in twice as fast for a while.
    if (!this.rushDone && this.ordersSpawned >= Math.ceil(this.ordersTotal * RUSH_AT)) {
      this.rushDone = true;
      s.rushLeft = RUSH_LENGTH;
      this.nextOrderIn = Math.min(this.nextOrderIn, 1);
      this.broadcast("rush", {});
    }
    s.rushLeft = Math.max(0, s.rushLeft - dt);
    const rushing = s.rushLeft > 0;

    this.nextOrderIn -= dt;
    const maxTickets = this.rules.maxTickets + (rushing ? 1 : 0);
    if (this.ordersSpawned < this.ordersTotal && this.nextOrderIn <= 0 && s.tickets.length < maxTickets) {
      this.spawnTicket();
      this.ordersSpawned++;
      const warmingUp = this.ordersSpawned < this.ordersTotal * WARMUP_SHARE;
      this.nextOrderIn = randomBetween(this.rules.orderEvery) * (rushing ? 0.5 : warmingUp ? WARMUP_SLOWDOWN : 1);
      if (this.ordersSpawned === this.ordersTotal) {
        s.lastCall = true;
        this.broadcast("lastcall", {});
      }
    }

    for (let i = s.tickets.length - 1; i >= 0; i--) {
      const tk = s.tickets[i];
      const complete = remainingNeeds(tk.need, tk.have).length === 0;
      if (complete && s.cleanPlates > 0) {
        s.cleanPlates -= 1;
        this.platesComingBack.push(this.rules.plateDelay);
        const points = this.ticketPoints(tk);
        s.score += points;
        s.served += 1;
        s.combo = Math.min(255, s.combo + 1);
        s.bestCombo = Math.max(s.bestCombo, s.combo);
        s.comboTime = COMBO_WINDOW;
        s.tickets.splice(i, 1);
        this.broadcast("served", { id: tk.id, recipe: tk.recipe, points, combo: s.combo });
        continue;
      }
      tk.timeLeft = Math.max(0, tk.timeLeft - dt);
      if (tk.timeLeft === 0) {
        s.tickets.splice(i, 1);
        s.missed += 1;
        s.strikes += 1;
        s.combo = 0;
        s.comboTime = 0;
        this.broadcast("missed", { id: tk.id, recipe: tk.recipe });
        if (s.strikes >= s.maxStrikes) return this.endService("Too many walk-outs. Kitchen closed!");
      }
    }

    // The shift is over once the last ticket has been and gone.
    if (s.lastCall && s.tickets.length === 0) this.endService("That's the last ticket. Great shift, chefs!");
  }
}
