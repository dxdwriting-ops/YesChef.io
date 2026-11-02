// Hand-designed kitchens, laid out like real ones for flow:
// - one cooking line along the back wall, in workflow order (walk-in → prep → grill → fryer),
// - the pass straight across a short open aisle, with dish pits and trash beside it,
// - no islands in the walkway, so every route is a few steps across or along the line.
// Bigger restaurants are wider, with mirrored half-lines (a walk-in at each end) so every cook
// works a short, self-contained stretch instead of running the length of the kitchen.
import type { Facing, StationDef, StationKind } from "./game";

export type LayoutId = "truck" | "diner" | "bistro";

export interface Box2 {
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface Layout {
  name: string;
  width: number;
  depth: number;
  stations: StationDef[];
  islands: Box2[];
  walls: Box2[]; // interior partitions, full height
  spawn: { x: number; z: number };
  menu: { x: number; z: number; face: Facing };
  door: { x: number; z: number; face: Facing };
  shelves: { x: number; z: number; face: Facing }[];
  plaster: string; // upper wall colour, gives each restaurant its own feel
}

const H: Record<StationKind, number> = { walkin: 2.2, prep: 0.95, grill: 0.95, fryer: 0.95, pass: 1.05, dishpit: 0.95, trash: 0.9 };
const LABEL: Record<StationKind, string> = {
  walkin: "Walk-in",
  prep: "Prep",
  grill: "Grill",
  fryer: "Fryer",
  pass: "Pass",
  dishpit: "Dish pit",
  trash: "Trash",
};

// Station helper: `len` runs along the wall, `deep` sticks out from it.
function st(id: string, kind: StationKind, x: number, z: number, len: number, deep: number, face: Facing, label?: string): StationDef {
  const alongX = face === "+z" || face === "-z";
  return { id, kind, label: label ?? LABEL[kind], x, z, w: alongX ? len : deep, d: alongX ? deep : len, h: H[kind], face };
}

// Back-wall station (faces into the room) and front-wall station (faces back toward the line).
const back = (depth: number, id: string, kind: StationKind, x: number, len: number, label?: string) =>
  st(id, kind, x, -depth / 2 + (kind === "walkin" ? 0.6 : 0.5), len, kind === "walkin" ? 1.2 : 1.0, "+z", label);
const front = (depth: number, id: string, kind: StationKind, x: number, len: number, label?: string) =>
  st(id, kind, x, depth / 2 - 0.5, len, kind === "trash" ? 0.8 : 1.0, "-z", label);

const TRUCK_D = 5;
const DINER_D = 6;
const BISTRO_D = 6.6;

export const LAYOUTS: Record<LayoutId, Layout> = {
  // A real food truck: one line, the service window three steps behind you.
  truck: {
    name: "Food Truck",
    width: 8,
    depth: TRUCK_D,
    stations: [
      back(TRUCK_D, "walkin", "walkin", -3.0, 1.6),
      back(TRUCK_D, "prep1", "prep", -1.2, 1.6),
      back(TRUCK_D, "grill1", "grill", 0.6, 1.6),
      back(TRUCK_D, "fryer1", "fryer", 2.3, 1.4),
      front(TRUCK_D, "dishpit", "dishpit", -2.8, 1.6),
      front(TRUCK_D, "pass", "pass", 0.2, 3.0),
      front(TRUCK_D, "trash1", "trash", 2.8, 0.8),
    ],
    islands: [],
    walls: [],
    spawn: { x: -0.4, z: 0.2 },
    menu: { x: 4, z: 0, face: "-x" },
    door: { x: -4, z: 0, face: "+x" },
    shelves: [{ x: -1.2, z: -TRUCK_D / 2, face: "+z" }],
    plaster: "#2f5d55",
  },

  // Two mirrored half-lines around a shared fryer: each side has its own walk-in, prep and grill.
  diner: {
    name: "Diner",
    width: 12,
    depth: DINER_D,
    stations: [
      back(DINER_D, "walkin", "walkin", -5.1, 1.4, "Walk-in A"),
      back(DINER_D, "prep1", "prep", -3.5, 1.4),
      back(DINER_D, "grill1", "grill", -1.8, 1.6),
      back(DINER_D, "fryer1", "fryer", 0, 1.4),
      back(DINER_D, "grill2", "grill", 1.8, 1.6),
      back(DINER_D, "prep2", "prep", 3.5, 1.4),
      back(DINER_D, "walkin2", "walkin", 5.1, 1.4, "Walk-in B"),
      front(DINER_D, "trash1", "trash", -5.4, 0.8),
      front(DINER_D, "dishpit", "dishpit", -4.0, 1.6),
      front(DINER_D, "pass", "pass", 0, 4.4),
      front(DINER_D, "prep3", "prep", 3.4, 1.4, "Salad"),
      front(DINER_D, "trash2", "trash", 5.2, 0.8),
    ],
    islands: [],
    walls: [],
    spawn: { x: 0, z: 0.2 },
    menu: { x: 6, z: 0, face: "-x" },
    door: { x: -6, z: 0, face: "+x" },
    shelves: [
      { x: -3.5, z: -DINER_D / 2, face: "+z" },
      { x: 3.5, z: -DINER_D / 2, face: "+z" },
    ],
    plaster: "#6a2f35",
  },

  // A full brigade line: mirrored halves (walk-in, prep, grill, fryer) meeting at a shared centre prep,
  // a long pass, and a dish nook at each end framed by short half-walls.
  bistro: {
    name: "Bistro",
    width: 16,
    depth: BISTRO_D,
    stations: [
      back(BISTRO_D, "walkin", "walkin", -6.6, 1.4, "Walk-in A"),
      back(BISTRO_D, "prep1", "prep", -5.0, 1.4),
      back(BISTRO_D, "grill1", "grill", -3.3, 1.6),
      back(BISTRO_D, "fryer1", "fryer", -1.6, 1.4),
      back(BISTRO_D, "prep2", "prep", 0, 1.4, "Centre prep"),
      back(BISTRO_D, "fryer2", "fryer", 1.6, 1.4),
      back(BISTRO_D, "grill2", "grill", 3.3, 1.6),
      back(BISTRO_D, "prep3", "prep", 5.0, 1.4),
      back(BISTRO_D, "walkin2", "walkin", 6.6, 1.4, "Walk-in B"),
      front(BISTRO_D, "dishpit", "dishpit", -6.0, 2.0, "Dish A"),
      front(BISTRO_D, "trash1", "trash", -4.2, 0.8),
      front(BISTRO_D, "pass", "pass", 0, 6.0),
      front(BISTRO_D, "trash2", "trash", 4.2, 0.8),
      front(BISTRO_D, "dishpit2", "dishpit", 6.0, 2.0, "Dish B"),
    ],
    islands: [],
    walls: [
      // Half-walls jutting from the front wall, framing each dish nook without blocking the aisle.
      { x: -4.9, z: BISTRO_D / 2 - 0.55, w: 0.15, d: 1.1 },
      { x: 4.9, z: BISTRO_D / 2 - 0.55, w: 0.15, d: 1.1 },
    ],
    spawn: { x: 0, z: 0.2 },
    menu: { x: 8, z: 0, face: "-x" },
    door: { x: -8, z: 0, face: "+x" },
    shelves: [
      { x: -5.0, z: -BISTRO_D / 2, face: "+z" },
      { x: 0, z: -BISTRO_D / 2, face: "+z" },
      { x: 5.0, z: -BISTRO_D / 2, face: "+z" },
    ],
    plaster: "#2f3f63",
  },
};

export function stationById(layout: Layout, id: string): StationDef | undefined {
  return layout.stations.find((s) => s.id === id);
}
