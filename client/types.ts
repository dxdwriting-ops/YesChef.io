// Shape of the synced Colyseus state as the client reads it.
export interface MapLike<T> {
  size: number;
  get(key: string): T | undefined;
  forEach(cb: (value: T, key: string) => void): void;
}

export interface ListLike<T> extends Iterable<T> {
  length: number;
  [index: number]: T;
}

export interface PlayerView {
  name: string;
  color: number;
  skin: number;
  hat: string;
  jacket: string;
  x: number;
  z: number;
  yaw: number;
  holding: string;
  holdingQ: number;
  station: string;
}

export interface StationView {
  kind: string;
  item: string;
  progress: number;
  user: string;
}

export interface TicketView {
  id: number;
  recipe: string;
  mods: ListLike<string>;
  need: ListLike<string>;
  have: ListLike<string>;
  timeLeft: number;
  timeMax: number;
}

export interface KitchenView {
  phase: "lobby" | "training" | "service" | "results";
  tier: string;
  mode: string;
  title: string;
  queueLeft: number;
  timeLeft: number;
  score: number;
  served: number;
  missed: number;
  strikes: number;
  maxStrikes: number;
  stars: number;
  combo: number;
  comboTime: number;
  bestCombo: number;
  rushLeft: number;
  cleanPlates: number;
  dirtyPlates: number;
  players: MapLike<PlayerView>;
  stations: MapLike<StationView>;
  tickets: ListLike<TicketView>;
}
