// Procedural pixel-art textures, painted on small canvases and sampled with nearest filtering.
// Boxes get world-scale UVs (texelsPerMetre), so a texture never stretches on long counters.
import * as THREE from "three";
import { RECIPES, type RecipeId } from "../shared/game";
import { iconCanvas } from "./icons";

type Ctx = CanvasRenderingContext2D;

// Deterministic noise so textures look the same for every player.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function shade(hex: string, amount: number) {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, amount);
  return `#${c.getHexString()}`;
}

function make(w: number, h: number, paint: (g: Ctx, r: () => number) => void, seed = 1) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  paint(g, rng(seed));
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function speckle(g: Ctx, r: () => number, w: number, h: number, colors: string[], density: number) {
  for (let i = 0; i < w * h * density; i++) {
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    g.fillRect(Math.floor(r() * w), Math.floor(r() * h), 1, 1);
  }
}

const cache = new Map<string, THREE.Texture>();
function cached(key: string, build: () => THREE.Texture) {
  let t = cache.get(key);
  if (!t) {
    t = build();
    cache.set(key, t);
  }
  return t;
}

/** Texture plus how many texels it should span per metre in the world. */
export interface PixelMap {
  tex: THREE.Texture;
  size: number; // metres covered by one repeat of the texture
}

export const TEX = {
  // 0.5 m terracotta/cream checker with grout, wear and the odd stain.
  floor: (): PixelMap => ({
    size: 1,
    tex: cached("floor", () =>
      make(32, 32, (g, r) => {
        const tile = (x: number, y: number, base: string) => {
          g.fillStyle = base;
          g.fillRect(x, y, 16, 16);
          speckle(g, r, 16, 16, [shade(base, 0.04), shade(base, -0.05)], 0.25);
          g.fillStyle = shade(base, 0.07);
          g.fillRect(x + 1, y + 1, 14, 1);
          g.fillStyle = shade(base, -0.08);
          g.fillRect(x + 1, y + 14, 14, 1);
        };
        tile(0, 0, "#b5543f");
        tile(16, 16, "#b5543f");
        tile(16, 0, "#e3d6bf");
        tile(0, 16, "#e3d6bf");
        g.fillStyle = "#6b5a52";
        g.fillRect(0, 0, 32, 1);
        g.fillRect(0, 16, 32, 1);
        g.fillRect(0, 0, 1, 32);
        g.fillRect(16, 0, 1, 32);
        g.fillStyle = "rgba(60,40,30,0.18)";
        g.fillRect(20, 5, 5, 3);
        g.fillRect(6, 22, 3, 4);
      }, 7),
    ),
  }),

  // Glossy white subway tile for the lower walls.
  subway: (): PixelMap => ({
    size: 0.6,
    tex: cached("subway", () =>
      make(32, 32, (g, r) => {
        g.fillStyle = "#b8b2a6";
        g.fillRect(0, 0, 32, 32);
        for (let row = 0; row < 4; row++) {
          const off = row % 2 ? 8 : 0;
          for (let col = -1; col < 2; col++) {
            const x = col * 16 + off;
            const y = row * 8;
            g.fillStyle = "#efeae0";
            g.fillRect(x + 1, y + 1, 15, 7);
            g.fillStyle = "#fbf8f1";
            g.fillRect(x + 2, y + 2, 6, 1);
            g.fillStyle = "#d9d2c4";
            g.fillRect(x + 1, y + 7, 15, 1);
          }
        }
        speckle(g, r, 32, 32, ["#e3dccf"], 0.05);
      }, 3),
    ),
  }),

  // Painted plaster above the tile line.
  plaster: (): PixelMap => ({
    size: 1,
    tex: cached("plaster", () =>
      make(16, 16, (g, r) => {
        g.fillStyle = "#2f5d55";
        g.fillRect(0, 0, 16, 16);
        speckle(g, r, 16, 16, ["#36685f", "#2a544c"], 0.4);
      }, 5),
    ),
  }),

  steel: (): PixelMap => ({
    size: 0.5,
    tex: cached("steel", () =>
      make(16, 16, (g, r) => {
        g.fillStyle = "#aeb8c3";
        g.fillRect(0, 0, 16, 16);
        for (let y = 0; y < 16; y++) {
          g.fillStyle = r() > 0.5 ? "#b9c3cd" : "#a3adb8";
          g.fillRect(Math.floor(r() * 8), y, 4 + Math.floor(r() * 10), 1);
        }
      }, 11),
    ),
  }),

  steelDark: (): PixelMap => ({
    size: 0.5,
    tex: cached("steelDark", () =>
      make(16, 16, (g, r) => {
        g.fillStyle = "#6c7783";
        g.fillRect(0, 0, 16, 16);
        for (let y = 0; y < 16; y++) {
          g.fillStyle = r() > 0.5 ? "#77828e" : "#626d78";
          g.fillRect(Math.floor(r() * 8), y, 4 + Math.floor(r() * 10), 1);
        }
      }, 12),
    ),
  }),

  // Steel cabinet doors with handles and a kick plate, 0.6 m per door.
  cabinet: (): PixelMap => ({
    size: 0.6,
    tex: cached("cabinet", () =>
      make(24, 24, (g, r) => {
        g.fillStyle = "#8d97a2";
        g.fillRect(0, 0, 24, 24);
        g.fillStyle = "#a7b1bc";
        g.fillRect(1, 1, 22, 18);
        for (let y = 2; y < 18; y++) {
          g.fillStyle = r() > 0.5 ? "#b0bac4" : "#9ea8b3";
          g.fillRect(2 + Math.floor(r() * 6), y, 8 + Math.floor(r() * 10), 1);
        }
        g.fillStyle = "#5c6670";
        g.fillRect(0, 19, 24, 1);
        g.fillRect(0, 0, 1, 19);
        g.fillStyle = "#3d454d";
        g.fillRect(9, 4, 6, 2); // handle
        g.fillStyle = "#4a535c";
        g.fillRect(0, 20, 24, 4); // kick plate
      }, 13),
    ),
  }),

  wood: (): PixelMap => ({
    size: 0.5,
    tex: cached("wood", () =>
      make(16, 16, (g, r) => {
        g.fillStyle = "#c58e55";
        g.fillRect(0, 0, 16, 16);
        for (let x = 0; x < 16; x += 4) {
          g.fillStyle = "#b07a45";
          g.fillRect(x, 0, 1, 16);
        }
        speckle(g, r, 16, 16, ["#d39d63", "#a8723e"], 0.3);
      }, 17),
    ),
  }),

  darkWood: (): PixelMap => ({
    size: 0.5,
    tex: cached("darkWood", () =>
      make(16, 16, (g, r) => {
        g.fillStyle = "#6b4228";
        g.fillRect(0, 0, 16, 16);
        for (let y = 0; y < 16; y += 3) {
          g.fillStyle = "#5a3620";
          g.fillRect(0, y, 16, 1);
        }
        speckle(g, r, 16, 16, ["#7a4d30"], 0.2);
      }, 19),
    ),
  }),

  grate: (): PixelMap => ({
    size: 0.4,
    tex: cached("grate", () =>
      make(16, 16, (g) => {
        g.fillStyle = "#1a1416";
        g.fillRect(0, 0, 16, 16);
        g.fillStyle = "#3a3236";
        for (let x = 1; x < 16; x += 4) g.fillRect(x, 0, 2, 16);
        g.fillStyle = "#544a4f";
        for (let x = 1; x < 16; x += 4) g.fillRect(x, 0, 1, 16);
      }),
    ),
  }),

  oil: (): PixelMap => ({
    size: 0.4,
    tex: cached("oil", () =>
      make(16, 16, (g, r) => {
        g.fillStyle = "#c48a22";
        g.fillRect(0, 0, 16, 16);
        speckle(g, r, 16, 16, ["#e2b04a", "#a87418"], 0.25);
        g.fillStyle = "#f3d27a";
        for (let i = 0; i < 6; i++) g.fillRect(Math.floor(r() * 15), Math.floor(r() * 15), 2, 1);
      }, 23),
    ),
  }),

  water: (): PixelMap => ({
    size: 0.4,
    tex: cached("water", () =>
      make(16, 16, (g, r) => {
        g.fillStyle = "#4f9ccc";
        g.fillRect(0, 0, 16, 16);
        speckle(g, r, 16, 16, ["#7fc0e6", "#3d84b3"], 0.2);
        g.fillStyle = "#d8f0ff";
        g.fillRect(3, 4, 3, 1);
        g.fillRect(10, 11, 4, 1);
      }, 29),
    ),
  }),

  // Anti-fatigue rubber mat with drainage holes.
  mat: (): PixelMap => ({
    size: 0.3,
    tex: cached("mat", () =>
      make(8, 8, (g) => {
        g.fillStyle = "#2b2629";
        g.fillRect(0, 0, 8, 8);
        g.fillStyle = "#151214";
        g.fillRect(2, 2, 2, 2);
        g.fillRect(6, 6, 2, 2);
        g.fillStyle = "#3a3438";
        g.fillRect(0, 0, 8, 1);
      }),
    ),
  }),

  binGreen: (): PixelMap => ({
    size: 0.5,
    tex: cached("bin", () =>
      make(16, 16, (g, r) => {
        g.fillStyle = "#3f6b45";
        g.fillRect(0, 0, 16, 16);
        g.fillStyle = "#355b3a";
        for (let x = 0; x < 16; x += 4) g.fillRect(x, 0, 1, 16);
        speckle(g, r, 16, 16, ["#4a7a51"], 0.15);
      }, 31),
    ),
  }),
};

/** Chalkboard menu: every dish and what goes on it, so new cooks can learn by looking. */
export function menuBoard(recipes: RecipeId[]): THREE.Texture {
  return make(128, 96, (g, r) => {
    g.fillStyle = "#6b4228";
    g.fillRect(0, 0, 128, 96);
    g.fillStyle = "#23302b";
    g.fillRect(4, 4, 120, 88);
    speckle(g, r, 128, 96, ["#2c3a34"], 0.05);
    g.fillStyle = "#f3e9d2";
    g.font = "8px Silkscreen, monospace";
    g.textBaseline = "top";
    g.fillText("TODAY'S MENU", 30, 8);
    g.fillStyle = "#f2b632";
    g.fillRect(30, 18, 68, 1);
    recipes.forEach((id, row) => {
      const y = 24 + row * 22;
      g.fillStyle = "#f3e9d2";
      g.fillText(RECIPES[id].name, 9, y);
      RECIPES[id].needs.forEach((item, i) => g.drawImage(iconCanvas(item), 9 + i * 18, y + 9, 16, 16));
    });
  }, 41);
}

/** The street outside the service window, with a neon OPEN sign. */
export function streetView(): THREE.Texture {
  return make(96, 32, (g, r) => {
    for (let y = 0; y < 32; y++) {
      const t = y / 32;
      g.fillStyle = `rgb(${Math.round(255 - t * 70)},${Math.round(170 - t * 60)},${Math.round(110 + t * 30)})`;
      g.fillRect(0, y, 96, 1);
    }
    g.fillStyle = "#ffe9a8";
    g.fillRect(70, 6, 6, 6); // sun
    let x = 0;
    while (x < 96) {
      const w = 8 + Math.floor(r() * 12);
      const h = 10 + Math.floor(r() * 14);
      g.fillStyle = r() > 0.5 ? "#4a2f45" : "#3b2738";
      g.fillRect(x, 32 - h, w, h);
      g.fillStyle = "#f6c66a";
      for (let wy = 32 - h + 2; wy < 30; wy += 4) for (let wx = x + 2; wx < x + w - 2; wx += 3) if (r() > 0.5) g.fillRect(wx, wy, 1, 2);
      x += w + 1;
    }
    g.fillStyle = "#2a1d27";
    g.fillRect(0, 29, 96, 3);
    // Neon sign
    g.fillStyle = "#1a1216";
    g.fillRect(6, 4, 30, 11);
    g.fillStyle = "#ff4fa0";
    g.font = "8px Silkscreen, monospace";
    g.textBaseline = "top";
    g.fillText("OPEN", 9, 5);
  }, 43);
}

/** A shelf's worth of jars, cans and boxes. */
export function pantryShelf(): THREE.Texture {
  return make(64, 16, (g, r) => {
    g.clearRect(0, 0, 64, 16);
    let x = 1;
    const colors = ["#e04f3f", "#f2b632", "#4fae3c", "#3f8de0", "#efe6d4", "#a75fe0", "#c98431"];
    while (x < 62) {
      const w = 3 + Math.floor(r() * 4);
      const h = 6 + Math.floor(r() * 9);
      const c = colors[Math.floor(r() * colors.length)];
      g.fillStyle = "#1a1216";
      g.fillRect(x - 1, 16 - h - 1, w + 2, h + 1);
      g.fillStyle = c;
      g.fillRect(x, 16 - h, w, h);
      g.fillStyle = "#fff4dc";
      g.fillRect(x, 16 - h + Math.floor(h / 3), w, 2); // label
      x += w + 2;
    }
  }, 47);
}

// Rescale a box's UVs so the texture repeats every `size` metres on every face.
export function worldUV(geo: THREE.BoxGeometry, w: number, h: number, d: number, size: number) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z; 4 verts each.
  const dims: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / size, (uv.getY(i) * dims[f][1]) / size);
    }
  }
  uv.needsUpdate = true;
  return geo;
}
