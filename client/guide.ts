// The helper: works out your single best next move, so new cooks always know what to do.
// `key` names the situation so the training coach can explain it in more depth.
// With several hand slots the helper plans a whole trip: grab everything for a dish at the walk-in,
// then work each item down the line, and send it all at the pass.
import {
  ITEM_NAMES,
  distanceToStation,
  finalForm,
  fryTimes,
  isItem,
  nextStation,
  processed,
  remainingNeeds,
  routeOf,
  type ItemId,
  type StationKind,
} from "../shared/game";
import type { Layout } from "../shared/layouts";
import { iconURL } from "./icons";
import type { KitchenView, StationView } from "./types";

export interface GuideStep {
  key: string;
  html: string;
  station: string | null;
  item?: ItemId; // the item in hand this step is about
}

const STATION_LABEL: Record<StationKind, string> = {
  walkin: "Walk-in",
  prep: "Prep",
  grill: "Grill",
  fryer: "Fryer",
  pass: "Pass",
  dishpit: "Dish pit",
  trash: "Trash",
};

const icon = (item: ItemId) => `<img src="${iconURL(item)}" alt="">`;
const name = (item: ItemId) => ITEM_NAMES[item].toLowerCase();

export function route(final: ItemId): string {
  return ["Walk-in", ...routeOf(final).steps.map((s) => STATION_LABEL[s]), "Pass"].join(" → ");
}

export function nextStep(state: KitchenView, layout: Layout, me: string, x: number, z: number, fry: { ready: number; burnt: number }): GuideStep | null {
  if (state.phase !== "service" && state.phase !== "training") return null;
  const mine = state.players.get(me);
  if (!mine) return null;
  const stations = layout.stations;

  // Nearest station of a kind that nobody else is working (and, if given, matching a test).
  const pick = (kind: StationKind, test?: (s: StationView | undefined) => boolean) => {
    const ofKind = stations.filter((s) => s.kind === kind && (!test || test(state.stations.get(s.id))));
    const free = ofKind.filter((s) => !state.stations.get(s.id)?.user || state.stations.get(s.id)?.user === me);
    const pool = free.length ? free : ofKind.length ? ofKind : stations.filter((s) => s.kind === kind);
    return [...pool].sort((a, b) => distanceToStation(a, x, z) - distanceToStation(b, x, z))[0].id;
  };

  const tickets = [...state.tickets].sort((a, b) => a.id - b.id);
  const needed: string[] = tickets.flatMap((t) => remainingNeeds(t.need, t.have));
  const fryers = stations.filter((s) => s.kind === "fryer").map((s) => state.stations.get(s.id));
  const ready = (f: StationView | undefined) => !!f?.item && f.progress >= fryTimes(fry.ready, fry.burnt, f.item).ready;
  const hands = [...mine.hands].filter(isItem);
  const free = mine.slots - hands.length;

  // 1. Burnt food first: it's taking up a hand.
  const burnt = hands.find((h) => h === "burnt");
  if (burnt) return { key: "toss", html: `${icon(burnt)} Burnt! <b>Toss it in the Trash</b>`, station: pick("trash"), item: burnt };

  // 2. Fries (or rings, or chicken) about to burn beat everything else.
  if (free > 0 && fryers.some(ready)) {
    return { key: "fryer-pull", html: `${icon("fries")} <b>Pull the basket before it burns!</b>`, station: pick("fryer", ready) };
  }

  // 3. Everything in hand is finished: one stop at the pass sends it all.
  const sendable = hands.filter((h) => needed.includes(h));
  const unfinished = hands.filter((h) => nextStation(h) && needed.includes(finalForm(h)));
  if (sendable.length && !unfinished.length) {
    const what = sendable.length > 1 ? "it all" : `the ${name(sendable[0])}`;
    return { key: "serve", html: `${sendable.map(icon).join("")} <b>Send ${what} to the Pass</b>`, station: pick("pass") };
  }

  // 4. Work the next unfinished item: prep, then grill, then fryer, in line order.
  // Items a ticket is waiting for come first; spare ones only when nothing needed is in hand.
  const wanted = new Set(needed);
  const useful = hands.filter((h) => nextStation(h) && wanted.has(finalForm(h)));
  const work = useful.length ? useful : hands.filter((h) => nextStation(h));
  for (const kind of ["prep", "grill", "fryer"] as const) {
    const item = work.find((h) => nextStation(h) === kind);
    if (!item) continue;
    const result = processed(item)!;
    if (kind === "prep") return { key: "prep", html: `${icon(item)} → ${icon(result)} <b>Prep it at a Prep board</b>`, station: pick("prep"), item };
    if (kind === "grill") {
      const verb = item === "bun" ? "Toast it" : "Sear it";
      return { key: item === "bun" ? "toast" : "grill", html: `${icon(item)} → ${icon(result)} <b>${verb} on the Grill</b>`, station: pick("grill"), item };
    }
    if (fryers.some((f) => !f?.item)) {
      return { key: "fryer-drop", html: `${icon(item)} <b>Drop it in the Fryer</b>`, station: pick("fryer", (f) => !f?.item), item };
    }
    return { key: "fryer-full", html: `${icon(item)} Fryer's busy. <b>Wait for a basket</b>`, station: pick("fryer"), item };
  }

  if (sendable.length) {
    return { key: "serve", html: `${sendable.map(icon).join("")} <b>Send it to the Pass</b>`, station: pick("pass") };
  }

  if (fryers.some((f) => !!f?.item) && needed.every((n) => n === "fries" || n === "onion_rings" || n === "chicken_fried")) {
    return { key: "fryer-wait", html: `${icon("fries")} Frying... <b>pull it when the bar turns green</b>`, station: pick("fryer", (f) => !!f?.item) };
  }

  const waitingOnPlate = tickets.some((t) => remainingNeeds(t.need, t.have).length === 0);
  if (state.phase === "service" && state.cleanPlates === 0 && (state.dirtyPlates > 0 || waitingOnPlate)) {
    return { key: "plates", html: `<b>Out of plates! Scrub one at the Dish pit</b>`, station: pick("dishpit") };
  }

  // 5. Shopping list: what the rail still needs that nobody is carrying or frying, up to your free hands.
  const covered: string[] = hands.map(finalForm);
  state.players.forEach((p, id) => {
    if (id !== me) for (const h of p.hands) if (isItem(h)) covered.push(finalForm(h));
  });
  fryers.forEach((f) => f?.item && isItem(f.item) && covered.push(finalForm(f.item)));
  const todo = remainingNeeds(needed, covered).filter(isItem);

  if (todo.length && free > 0) {
    const trip = todo.slice(0, free);
    const raws = trip.map((t) => routeOf(t).raw);
    const first = trip[0];
    return {
      key: `fetch:${first}`,
      html: `Grab ${raws.map(icon).join("")} <b>${raws.map(name).join(", ")} at the Walk-in</b><small>${route(first)}</small>`,
      station: pick("walkin"),
    };
  }
  if (todo.length && hands.length) {
    return { key: "unneeded", html: `Hands full. <b>Toss what you don't need</b>`, station: pick("trash") };
  }

  if (tickets.length) return { key: "covered", html: `Everything's covered. <b>Back up a teammate or scrub plates</b>`, station: null };
  return { key: "idle", html: `No tickets yet. <b>Get ahead: grab a bun and some beef</b>`, station: pick("walkin") };
}
