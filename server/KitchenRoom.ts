import { Room, type Client } from "colyseus";
import {
  BURNT,
  CHEF_COLORS,
  COMBO_WINDOW,
  INTERACT_RANGE,
  MODS,
  PINGS,
  PREP_RESULT,
  RECIPES,
  RUSH_LENGTH,
  TRAINING_ORDERS,
  WALKIN_ITEMS,
  WARMUP_SHARE,
  WARMUP_SLOWDOWN,
  applyMods,
  comboMultiplier,
  distanceToStation,
  isItem,
  remainingNeeds,
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
  private nextOrderIn = 0;
  private nextTicketId = 1;
  private platesComingBack: number[] = [];
  private rushDone = false;
  private trainingStep = 0;

  onCreate(options: JoinOptions) {
    this.rules = rulesFor(options ?? {});
    this.layout = LAYOUTS[this.rules.layout];
    this.stationById = new Map(this.layout.stations.map((s) => [s.id, s]));
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

  private hold(p: PlayerState, item: ItemId | "", quality = 1) {
    p.holding = item;
    p.holdingQ = quality;
  }

  private handleUse(client: Client, msg: UseMessage) {
    const p = this.state.players.get(client.sessionId);
    const def = msg?.station ? this.stationById.get(msg.station) : undefined;
    if (!p || !def) return;
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

    switch (def.kind) {
      case "walkin": {
        if (msg.action !== "take" || !isItem(msg.item) || !WALKIN_ITEMS.includes(msg.item)) return;
        if (p.holding) return toast("Your hands are full.");
        this.hold(p, msg.item);
        return;
      }
      case "prep": {
        if (msg.action !== "chop") return;
        const result = isItem(p.holding) ? PREP_RESULT[p.holding] : undefined;
        if (!result) return toast("Bring lettuce, a tomato or a potato to prep.");
        this.hold(p, result, (p.holdingQ + clamp01(msg.quality)) / 2);
        return;
      }
      case "grill": {
        if (msg.action !== "sear") return;
        if (p.holding !== "patty_raw") return toast("The grill needs a raw patty.");
        if (msg.result === "cooked") this.hold(p, "patty_cooked", clamp01(msg.quality));
        else if (msg.result === "burnt") this.hold(p, "patty_burnt", 0);
        return;
      }
      case "fryer": {
        if (msg.action !== "fry") return;
        if (!station.item) {
          if (p.holding !== "potato_cut") return toast("The fryer takes cut potatoes.");
          station.item = "potato_cut";
          station.progress = 0;
          this.hold(p, "");
          return;
        }
        if (p.holding) return toast("Free your hands to pull the basket.");
        if (station.progress < this.rules.fryReady) return toast("Not golden yet...");
        const burnt = station.progress > this.rules.fryBurnt;
        const ideal = (this.rules.fryReady + this.rules.fryBurnt) / 2;
        const q = burnt ? 0 : 1 - Math.abs(station.progress - ideal) / (this.rules.fryBurnt - this.rules.fryReady);
        this.hold(p, burnt ? "fries_burnt" : "fries", q);
        station.item = "";
        station.progress = 0;
        return;
      }
      case "pass": {
        if (msg.action !== "serve") return;
        if (!p.holding) return toast("Bring finished food to the pass.");
        if (BURNT.includes(p.holding as ItemId)) return toast("The expo sends it back. Burnt!");
        const ticket = this.ticketsInOrder().find((tk) => remainingNeeds(tk.need, tk.have).includes(p.holding));
        if (!ticket) return toast("No ticket needs that right now.");
        ticket.have.push(p.holding);
        ticket.qSum += p.holdingQ;
        this.hold(p, "");
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
        if (!p.holding) return toast("Nothing to toss.");
        this.hold(p, "");
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
    s.players.forEach((p) => this.hold(p, ""));
    s.cleanPlates = this.rules.startPlates;
    s.dirtyPlates = 0;
    s.combo = 0;
    s.comboTime = 0;
    s.rushLeft = 0;
    s.queueLeft = 0;
    this.platesComingBack = [];
  }

  private startTraining() {
    this.resetKitchen();
    const s = this.state;
    s.phase = "training";
    s.timeLeft = 0;
    s.score = 0;
    this.trainingStep = 0;
    this.spawnTicket(TRAINING_ORDERS[0], true);
  }

  private startService() {
    const s = this.state;
    this.resetKitchen();
    s.phase = "service";
    s.timeLeft = this.rules.duration;
    s.score = 0;
    s.served = 0;
    s.missed = 0;
    s.strikes = 0;
    s.stars = 0;
    s.bestCombo = 0;
    this.rushDone = false;
    this.nextOrderIn = 2;
    this.broadcast("toast", `Service! ${this.rules.title} is open.`);
  }

  private endService(reason: string) {
    const s = this.state;
    s.phase = "results";
    const [one, two, three] = this.rules.stars;
    s.stars = s.score >= three ? 3 : s.score >= two ? 2 : s.score >= one ? 1 : 0;
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
    ticket.timeMax = this.rules.ticketTime + Math.max(0, needs.length - 2) * 8;
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

  // Training: no clock, no strikes, plates never run out. Serve each lesson dish to unlock the next.
  private trainingTick(dt: number) {
    const s = this.state;
    s.stations.forEach((st) => {
      if (st.item) st.progress += dt;
    });
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

    s.timeLeft = Math.max(0, s.timeLeft - dt);
    if (s.timeLeft === 0) return this.endService("Last call! Service is over.");

    // Fryer baskets keep cooking whether anyone is watching or not.
    s.stations.forEach((st) => {
      if (st.item) st.progress += dt;
    });

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

    // Rush hour: just past halfway, tickets come in twice as fast for a while.
    if (!this.rushDone && s.timeLeft < this.rules.duration * 0.45) {
      this.rushDone = true;
      s.rushLeft = RUSH_LENGTH;
      this.nextOrderIn = Math.min(this.nextOrderIn, 1);
      this.broadcast("rush", {});
    }
    s.rushLeft = Math.max(0, s.rushLeft - dt);
    const rushing = s.rushLeft > 0;

    this.nextOrderIn -= dt;
    const maxTickets = this.rules.maxTickets + (rushing ? 1 : 0);
    if (this.nextOrderIn <= 0 && s.tickets.length < maxTickets) {
      this.spawnTicket();
      const warmingUp = this.rules.duration - s.timeLeft < this.rules.duration * WARMUP_SHARE;
      this.nextOrderIn = randomBetween(this.rules.orderEvery) * (rushing ? 0.5 : warmingUp ? WARMUP_SLOWDOWN : 1);
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
  }
}
