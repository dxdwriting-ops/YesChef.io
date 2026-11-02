// 16x16 pixel-art ingredient icons, drawn in code so there are no image assets to manage.
import * as THREE from "three";
import type { ItemId } from "../shared/game";
import { SPRITE_LAYER } from "./render";

type Ctx = CanvasRenderingContext2D;

function px(g: Ctx, x: number, y: number, w: number, h: number, c: string) {
  g.fillStyle = c;
  g.fillRect(x, y, w, h);
}

function blob(g: Ctx, cx: number, cy: number, rx: number, ry: number, c: string) {
  g.fillStyle = c;
  for (let y = -ry; y <= ry; y++) {
    const span = Math.round(rx * Math.sqrt(1 - (y * y) / (ry * ry + 0.01)));
    g.fillRect(cx - span, cy + y, span * 2 + 1, 1);
  }
}

function patty(g: Ctx, top: string, side: string, mark: string) {
  blob(g, 7, 8, 6, 3, side);
  blob(g, 7, 7, 6, 3, top);
  px(g, 4, 6, 2, 1, mark);
  px(g, 8, 7, 3, 1, mark);
  px(g, 6, 9, 2, 1, mark);
}

function sticks(g: Ctx, c: string, dark: string, y0: number) {
  for (let i = 0; i < 5; i++) {
    const h = 6 + ((i * 3) % 4);
    px(g, 4 + i * 2, y0 - h, 1, h, c);
    px(g, 4 + i * 2, y0 - h, 1, 1, dark);
  }
}

const DRAW: Record<ItemId, (g: Ctx) => void> = {
  bun: (g) => {
    blob(g, 7, 6, 6, 3, "#e3a24c");
    px(g, 1, 9, 13, 1, "#f3e3c0");
    blob(g, 7, 11, 6, 1, "#c98431");
    px(g, 4, 5, 1, 1, "#fbf0cf");
    px(g, 8, 4, 1, 1, "#fbf0cf");
    px(g, 10, 6, 1, 1, "#fbf0cf");
  },
  patty_raw: (g) => patty(g, "#e38b80", "#c3655a", "#f4b6ad"),
  patty_cooked: (g) => patty(g, "#8a4a2a", "#5e2f18", "#3a1c0d"),
  patty_burnt: (g) => patty(g, "#2b2522", "#161210", "#4a403a"),
  lettuce: (g) => {
    blob(g, 7, 8, 6, 5, "#4fae3c");
    blob(g, 7, 8, 4, 3, "#7cd35c");
    px(g, 7, 4, 1, 8, "#d8f5b8");
  },
  lettuce_chopped: (g) => {
    for (const [x, y] of [[2, 9], [6, 7], [10, 9], [4, 12], [9, 12], [7, 10], [12, 6]]) {
      px(g, x, y, 3, 2, "#4fae3c");
      px(g, x, y, 1, 1, "#9be27a");
    }
  },
  tomato: (g) => {
    blob(g, 7, 9, 5, 5, "#e0412f");
    px(g, 5, 6, 2, 2, "#f28a77");
    px(g, 6, 3, 3, 2, "#3f8f2f");
    px(g, 7, 2, 1, 1, "#3f8f2f");
  },
  tomato_sliced: (g) => {
    for (const x of [4, 10]) {
      blob(g, x, 9, 3, 3, "#e0412f");
      blob(g, x, 9, 2, 2, "#f28a77");
      px(g, x, 9, 1, 1, "#f9d38a");
    }
  },
  potato: (g) => {
    blob(g, 7, 8, 6, 4, "#c89b58");
    px(g, 4, 7, 1, 1, "#8c6631");
    px(g, 9, 9, 1, 1, "#8c6631");
    px(g, 11, 6, 1, 1, "#8c6631");
    px(g, 5, 5, 3, 1, "#e0bd80");
  },
  potato_cut: (g) => sticks(g, "#f1dfb0", "#d9bf7c", 13),
  fries: (g) => {
    sticks(g, "#f2c94c", "#c9952a", 9);
    px(g, 3, 9, 10, 5, "#d63d3d");
    px(g, 4, 10, 8, 1, "#f06a5a");
  },
  fries_burnt: (g) => {
    sticks(g, "#4a3a22", "#231a0f", 9);
    px(g, 3, 9, 10, 5, "#7a2c2c");
  },
};

// Adds a 1px dark outline around opaque pixels, the classic pixel-art read.
function outline(g: Ctx, size: number) {
  const img = g.getImageData(0, 0, size, size);
  const src = new Uint8ClampedArray(img.data);
  const alpha = (x: number, y: number) =>
    x < 0 || y < 0 || x >= size || y >= size ? 0 : src[(y * size + x) * 4 + 3];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (src[i + 3] > 0) continue;
      if (alpha(x - 1, y) || alpha(x + 1, y) || alpha(x, y - 1) || alpha(x, y + 1)) {
        img.data[i] = 26;
        img.data[i + 1] = 18;
        img.data[i + 2] = 22;
        img.data[i + 3] = 255;
      }
    }
  }
  g.putImageData(img, 0, 0);
}

const canvasCache = new Map<string, HTMLCanvasElement>();
const urlCache = new Map<string, string>();
const textureCache = new Map<string, THREE.Texture>();

export function iconCanvas(id: ItemId): HTMLCanvasElement {
  let c = canvasCache.get(id);
  if (!c) {
    c = document.createElement("canvas");
    c.width = c.height = 16;
    const g = c.getContext("2d")!;
    DRAW[id](g);
    outline(g, 16);
    canvasCache.set(id, c);
  }
  return c;
}

export function iconURL(id: ItemId): string {
  let url = urlCache.get(id);
  if (!url) {
    url = iconCanvas(id).toDataURL();
    urlCache.set(id, url);
  }
  return url;
}

export function iconTexture(id: ItemId): THREE.Texture {
  let tex = textureCache.get(id);
  if (!tex) {
    tex = new THREE.CanvasTexture(iconCanvas(id));
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    textureCache.set(id, tex);
  }
  return tex;
}

// Small pixel-font text sprite for station names and chef name tags.
export function labelSprite(text: string, color = "#fff7e0", bg = "rgba(20,14,18,0.85)"): THREE.Sprite {
  const font = "8px Silkscreen, monospace";
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = font;
  const w = Math.ceil(measure.measureText(text).width) + 6;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = 12;
  const g = c.getContext("2d")!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, 12);
  g.font = font;
  g.textBaseline = "middle";
  g.fillStyle = color;
  g.fillText(text, 3, 6.5);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true }));
  sprite.scale.set(w / 40, 12 / 40, 1);
  sprite.layers.set(SPRITE_LAYER);
  return sprite;
}

/** Sprite that shows an ingredient icon; swap its icon with setIcon. */
export function itemSprite(scale = 0.3): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, alphaTest: 0.5 }));
  s.scale.set(scale, scale, 1);
  s.visible = false;
  s.layers.set(SPRITE_LAYER);
  return s;
}

export function setIcon(sprite: THREE.Sprite, id: ItemId | null) {
  const mat = sprite.material as THREE.SpriteMaterial;
  if (!id) {
    sprite.visible = false;
    return;
  }
  const tex = iconTexture(id);
  if (mat.map !== tex) {
    mat.map = tex;
    mat.needsUpdate = true;
  }
  sprite.visible = true;
}
