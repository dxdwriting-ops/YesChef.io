// The helper: works out your single best next move, so new cooks always know what to do.
// `key` names the situation so the training coach can explain it in more depth.
import {
  BURNT,
  FRY_READY,
  ITEM_NAMES,
  PREP_RESULT,
  SOURCE,
  distanceToStation,
  isItem,
  remainingNeeds,
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
}

// What a held item will become by the time it reaches the pass.
const FINAL: Partial<Record<ItemId, ItemId>> = {
  bun: "bun",
  patty_raw: "patty_cooked",
  patty_cooked: "patty_cooked",
  lettuce: "lettuce_chopped",
  lettuce_chopped: "lettuce_chopped",
  tomato: "tomato_sliced",
  tomato_sliced: "tomato_sliced",
  potato: "fries",
  potato_cut: "fries",
  fries: "fries",
};

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

function route(final: ItemId): string {
  const steps = ["Walk-in"];
  const via = SOURCE[final]?.via;
  if (via) steps.push(STATION_LABEL[via]);
  if (final === "fries") steps.push("Fryer");
  steps.push("Pass");
  return steps.join(" → ");
}

export function nextStep(state: KitchenView, layout: Layout, me: string, x: number, z: number): GuideStep | null {
  if (state.phase !== "service" && state.phase !== "training") return null;
  const mine = state.players.get(me);
  if (!mine) return null;
  const stations = layout.stations;

  // Nearest station of a kind that nobody else is working (and, if given, matching a test).
  const pick = (kind: StationKind, test?: (s: StationView | undefined) => boolean) => {
    const ofKind = stations.filter((s) => s.kind === kind && (!test || test(state.stations.get(s.id))));
    const free = ofKind.filter((s) => !state.stations.get(s.id)?.user || state.stations.get(s.id)?.user === me);
    const pool = free.length ? free : ofKind.length ? ofKind : stations.filter((s) => s.kind === kind);
    return pool.sort((a, b) => distanceToStation(a, x, z) - distanceToStation(b, x, z))[0].id;
  };

  const tickets = [...state.tickets].sort((a, b) => a.id - b.id);
  const needed: string[] = tickets.flatMap((t) => remainingNeeds(t.need, t.have));
  const fryerViews = stations.filter((s) => s.kind === "fryer").map((s) => state.stations.get(s.id));
  const anyFrying = fryerViews.some((f) => !!f?.item);
  const anyReady = fryerViews.some((f) => !!f?.item && f.progress >= FRY_READY);
  const anyEmpty = fryerViews.some((f) => !f?.item);
  const fryer = { item: anyFrying, ready: anyReady, empty: anyEmpty };
  const holding = isItem(mine.holding) ? mine.holding : null;

  if (holding) {
    if (BURNT.includes(holding)) {
      return { key: "toss", html: `${icon(holding)} Burnt! <b>Toss it in the Trash</b>`, station: pick("trash") };
    }
    if (needed.includes(holding)) {
      return { key: "serve", html: `${icon(holding)} <b>Send the ${name(holding)} to the Pass</b>`, station: pick("pass") };
    }
    const prepped = PREP_RESULT[holding];
    if (prepped) {
      return { key: "prep", html: `${icon(holding)} → ${icon(prepped)} <b>Chop it at Prep</b>`, station: pick("prep") };
    }
    if (holding === "patty_raw") return { key: "grill", html: `${icon(holding)} <b>Sear it on the Grill</b>`, station: pick("grill") };
    if (holding === "potato_cut") {
      return fryer.empty
        ? { key: "fryer-drop", html: `${icon(holding)} <b>Drop it in the Fryer</b>`, station: pick("fryer", (f) => !f?.item) }
        : { key: "fryer-full", html: `${icon(holding)} Fryer's full. <b>Wait for the basket</b>`, station: pick("fryer") };
    }
    return { key: "unneeded", html: `${icon(holding)} No ticket needs that right now. <b>Hold it or toss it</b>`, station: null };
  }

  if (fryer.ready) {
    return {
      key: "fryer-pull",
      html: `${icon("fries")} <b>Pull the fries before they burn!</b>`,
      station: pick("fryer", (f) => !!f?.item && f.progress >= FRY_READY),
    };
  }
  if (fryer.item && needed.length === 1 && needed[0] === "fries") {
    return { key: "fryer-wait", html: `${icon("fries")} Frying... <b>pull them when the bar turns green</b>`, station: pick("fryer", (f) => !!f?.item) };
  }

  const waitingOnPlate = tickets.some((t) => remainingNeeds(t.need, t.have).length === 0);
  if (state.phase === "service" && state.cleanPlates === 0 && (state.dirtyPlates > 0 || waitingOnPlate)) {
    return { key: "plates", html: `<b>Out of plates! Scrub one at the Dish pit</b>`, station: pick("dishpit") };
  }

  // Skip work a teammate is already carrying, and fries already in the basket.
  const covered: string[] = [];
  state.players.forEach((p, id) => {
    if (id !== me && isItem(p.holding) && FINAL[p.holding]) covered.push(FINAL[p.holding]!);
  });
  fryerViews.forEach((f) => f?.item && covered.push("fries"));
  const todo = remainingNeeds(needed, covered);

  const next = todo.find(isItem);
  if (next) {
    const raw = SOURCE[next]?.raw ?? next;
    return {
      key: `fetch:${next}`,
      html: `Next: ${icon(next)} ${name(next)}. <b>Grab ${name(raw)} at the Walk-in</b><small>${route(next)}</small>`,
      station: pick("walkin"),
    };
  }

  if (tickets.length) return { key: "covered", html: `Everything's covered. <b>Back up a teammate or scrub plates</b>`, station: null };
  return { key: "idle", html: `No tickets yet. <b>Prep ahead: chop some lettuce</b>`, station: pick("walkin") };
}
