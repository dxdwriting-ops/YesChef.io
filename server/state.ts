import { schema, t } from "@colyseus/schema";

export const Player = schema(
  {
    name: t.string().default("Chef"),
    color: t.uint8().default(0),
    skin: t.uint8().default(1),
    hat: t.string().default("hat-toque"),
    jacket: t.string().default("jacket-white"),
    x: t.float32().default(0),
    z: t.float32().default(0),
    yaw: t.float32().default(0),
    holding: t.string().default(""),
    holdingQ: t.float32().default(1),
    station: t.string().default(""),
  },
  "Player",
);

export const Station = schema(
  {
    kind: t.string().default(""),
    item: t.string().default(""), // fryer contents
    progress: t.float32().default(0), // fryer seconds
    user: t.string().default(""), // sessionId of the cook working it
  },
  "Station",
);

export const Ticket = schema(
  {
    id: t.uint16().default(0),
    recipe: t.string().default(""),
    mods: t.array("string"),
    need: t.array("string"),
    have: t.array("string"),
    timeLeft: t.float32().default(0),
    timeMax: t.float32().default(0),
    qSum: t.float32().default(0),
  },
  "Ticket",
);

export const KitchenState = schema(
  {
    phase: t.string().default("lobby"), // lobby | training | service | results
    tier: t.string().default("foodtruck"),
    mode: t.string().default("quick"), // quick | career | challenge | training
    title: t.string().default(""),
    queueLeft: t.float32().default(0), // quick play countdown once 2+ chefs are in
    timeLeft: t.float32().default(0),
    score: t.int32().default(0),
    served: t.uint16().default(0),
    missed: t.uint16().default(0),
    strikes: t.uint8().default(0),
    maxStrikes: t.uint8().default(0),
    stars: t.uint8().default(0),
    combo: t.uint8().default(0),
    comboTime: t.float32().default(0), // seconds left to keep the combo alive
    bestCombo: t.uint8().default(0),
    rushLeft: t.float32().default(0),
    cleanPlates: t.uint8().default(0),
    dirtyPlates: t.uint8().default(0),
    players: t.map(Player),
    stations: t.map(Station),
    tickets: t.array(Ticket),
  },
  "KitchenState",
);

export type PlayerState = InstanceType<typeof Player>;
export type StationState = InstanceType<typeof Station>;
export type TicketState = InstanceType<typeof Ticket>;
export type KitchenStateT = InstanceType<typeof KitchenState>;
