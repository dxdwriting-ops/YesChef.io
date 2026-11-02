// The kitchen: textured geometry built from a layout, decor, lights, and live station visuals.
import * as THREE from "three";
import { isItem, type Facing, type RecipeId, type StationDef } from "../shared/game";
import type { Box2, Layout } from "../shared/layouts";
import { itemSprite, labelSprite, setIcon } from "./icons";
import { SPRITE_LAYER, toon } from "./render";
import { TEX, menuBoard, pantryShelf, streetView, worldUV, type PixelMap } from "./textures";
import type { KitchenView } from "./types";

export interface Collider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

type TexKey = keyof typeof TEX;
const WALL_H = 3;
const TILE_H = 1.3;

// One material per texture (and tint), with its repeat set so UVs in metres map to the right texel size.
const materials = new Map<string, THREE.Material>();
function mat(key: TexKey, tint = "#ffffff"): THREE.Material {
  const id = `${key}:${tint}`;
  let m = materials.get(id);
  if (!m) {
    const pm: PixelMap = TEX[key]();
    const tex = pm.tex.clone();
    tex.needsUpdate = true;
    tex.repeat.set(1 / pm.size, 1 / pm.size);
    m = toon(tint, { map: tex });
    materials.set(id, m);
  }
  return m;
}

function basic(color: THREE.ColorRepresentation) {
  return new THREE.MeshBasicMaterial({ color });
}

/** Box with world-scale UVs. `faces` is one material or [+x, -x, +y(top), -y, +z(front), -z]. */
function tbox(w: number, h: number, d: number, x: number, y: number, z: number, faces: THREE.Material | THREE.Material[]) {
  const m = new THREE.Mesh(worldUV(new THREE.BoxGeometry(w, h, d), w, h, d, 1), faces);
  m.position.set(x, y, z);
  return m;
}

function plane(w: number, h: number, material: THREE.Material, uvScale = false) {
  const geo = new THREE.PlaneGeometry(w, h);
  if (uvScale) {
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h);
  }
  return new THREE.Mesh(geo, material);
}

// Steel counter; its cabinet doors are on the local front (+z).
function counterFaces(topKey: TexKey = "steel"): THREE.Material[] {
  const side = mat("steel");
  return [side, side, mat(topKey), mat("steelDark"), mat("cabinet"), side];
}

const FACE_ANGLE: Record<Facing, number> = { "+z": 0, "-z": Math.PI, "+x": Math.PI / 2, "-x": -Math.PI / 2 };

/** A group placed at a spot on the floor, rotated so local +z faces the given way. */
function frame(x: number, z: number, face: Facing) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = FACE_ANGLE[face];
  return g;
}

interface Puff {
  sprite: THREE.Sprite;
  life: number;
  vx: number;
  vz: number;
}

interface FryerVis {
  def: StationDef;
  bar: THREE.Mesh;
  bg: THREE.Mesh;
}

interface GrillVis {
  def: StationDef;
  bars: THREE.Mesh[];
  light: THREE.PointLight;
}

export class KitchenWorld {
  readonly scene = new THREE.Scene();
  readonly colliders: Collider[] = [];
  private readonly labels = new Map<string, THREE.Sprite>();
  private readonly fryers: FryerVis[] = [];
  private readonly grills: GrillVis[] = [];
  private oilTex: THREE.Texture | null = null;
  private waterTex: THREE.Texture | null = null;
  private heatLamp: THREE.Mesh | null = null;
  private passSprites: THREE.Sprite[] = [];
  private ticketPapers: THREE.Mesh[] = [];
  private cleanStack: THREE.Mesh[] = [];
  private dirtyStack: THREE.Mesh[] = [];
  private readonly puffs: Puff[] = [];
  private readonly arrow: THREE.Mesh;
  private arrowTarget: StationDef | null = null;
  private busyGrills = new Set<string>();
  private busyFryers = new Set<string>();
  private emitTimer = 0;
  private catPaw: THREE.Mesh | null = null;

  constructor(
    private readonly layout: Layout,
    recipes: RecipeId[],
    private readonly fry: { ready: number; burnt: number },
  ) {
    this.scene.background = new THREE.Color("#1e161b");
    this.scene.fog = new THREE.Fog("#1e161b", 12, 26);
    this.scene.add(new THREE.HemisphereLight("#fff0d8", "#5a4048", 1.3));
    const key = new THREE.DirectionalLight("#ffe2b5", 1.3);
    key.position.set(3, 7, 4);
    // Shadows only render when the renderer's shadow map is on (HD quality).
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const half = Math.max(layout.width, layout.depth) / 2 + 1;
    Object.assign(key.shadow.camera, { left: -half, right: half, top: half, bottom: -half, far: 30 });
    key.shadow.bias = -0.0008;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);

    this.buildRoom(recipes);
    for (const def of layout.stations) this.buildStation(def);
    for (const island of layout.islands) this.buildIsland(island, island === layout.islands[0]);
    this.buildPuffs();

    this.scene.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      const unlit = (o as THREE.Mesh).material instanceof THREE.MeshBasicMaterial;
      o.castShadow = !unlit;
      o.receiveShadow = !unlit;
    });

    // Guide arrow: bounces over the next station the helper wants you at.
    this.arrow = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.32, 4), basic("#9a7bff"));
    this.arrow.rotation.x = Math.PI;
    this.arrow.visible = false;
    this.scene.add(this.arrow);
  }

  private addCollider(x: number, z: number, w: number, d: number) {
    this.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
  }

  /** A full-height wall: subway tile below, painted plaster above, wood rail and skirting. */
  private wall(x: number, z: number, w: number, d: number) {
    const plaster = toon(this.layout.plaster, { map: (mat("plaster") as THREE.MeshToonMaterial).map });
    this.scene.add(tbox(w, TILE_H, d, x, TILE_H / 2, z, mat("subway")));
    this.scene.add(tbox(w, WALL_H - TILE_H, d, x, TILE_H + (WALL_H - TILE_H) / 2, z, plaster));
    const grow = (n: number) => (n < 0.5 ? n + 0.06 : n);
    this.scene.add(tbox(grow(w), 0.08, grow(d), x, TILE_H, z, mat("darkWood")));
    this.scene.add(tbox(grow(w), 0.12, grow(d), x, 0.06, z, mat("darkWood")));
  }

  private buildRoom(recipes: RecipeId[]) {
    const { width: W, depth: D } = this.layout;
    const t = 0.2;
    this.scene.add(tbox(W, 0.1, D, 0, -0.05, 0, mat("floor")));
    this.wall(0, -D / 2 - t / 2, W, t);
    this.wall(0, D / 2 + t / 2, W, t);
    this.wall(-W / 2 - t / 2, 0, t, D);
    this.wall(W / 2 + t / 2, 0, t, D);

    // Interior partitions: these are what make the bigger kitchens feel like real rooms.
    for (const p of this.layout.walls) {
      this.wall(p.x, p.z, p.w, p.d);
      this.addCollider(p.x, p.z, p.w, p.d);
    }

    // Ceiling, beams, pendant lamps. Only some lamps cast light, to keep big kitchens fast.
    const ceiling = plane(W, D, toon("#2b2026"));
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = WALL_H;
    this.scene.add(ceiling);
    for (let z = -D / 2 + 2; z < D / 2; z += 2.6) this.scene.add(tbox(W, 0.18, 0.22, 0, WALL_H - 0.09, z, mat("darkWood")));
    const cols = Math.max(2, Math.round(W / 4.2));
    const rows = Math.max(2, Math.round(D / 4.2));
    const lamps: [number, number][] = [];
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) lamps.push([-W / 2 + (W / cols) * (i + 0.5), -D / 2 + (D / rows) * (j + 0.5)]);
    const every = Math.max(1, Math.ceil(lamps.length / 6));
    lamps.forEach(([x, z], i) => {
      this.scene.add(tbox(0.02, 0.6, 0.02, x, WALL_H - 0.3, z, basic("#1a1216")));
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.24, 8, 1, true), toon(this.layout.plaster, { side: THREE.DoubleSide }));
      shade.position.set(x, WALL_H - 0.66, z);
      this.scene.add(shade);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), basic("#fff1c4"));
      bulb.position.set(x, WALL_H - 0.76, z);
      this.scene.add(bulb);
      if (i % every === 0) {
        const light = new THREE.PointLight("#ffd9a0", 3.4, 7, 1.3);
        light.position.set(x, WALL_H - 0.85, z);
        this.scene.add(light);
      }
    });

    // Menu chalkboard, exit door, pantry shelves.
    const menu = frame(this.layout.menu.x, this.layout.menu.z, this.layout.menu.face);
    const board = plane(1.7, 1.28, toon("#ffffff", { map: menuBoard(recipes) }));
    board.position.set(0, 1.95, 0.02);
    menu.add(board);
    this.scene.add(menu);

    const door = frame(this.layout.door.x, this.layout.door.z, this.layout.door.face);
    door.add(tbox(1.0, 2.1, 0.06, 0, 1.05, 0.03, mat("darkWood")));
    door.add(tbox(0.18, 0.05, 0.05, 0.3, 1.05, 0.08, basic("#c9a64a")));
    door.add(tbox(0.5, 0.16, 0.04, 0, 2.3, 0.03, basic("#3fdc6a")));
    this.scene.add(door);

    const shelfTex = pantryShelf();
    for (const s of this.layout.shelves) {
      const g = frame(s.x, s.z, s.face);
      for (const y of [1.75, 2.25]) {
        g.add(tbox(1.5, 0.05, 0.32, 0, y, 0.16, mat("darkWood")));
        const goods = plane(1.45, 0.36, new THREE.MeshToonMaterial({ map: shelfTex, transparent: true, alphaTest: 0.5 }));
        goods.position.set(0, y + 0.2, 0.14);
        g.add(goods);
      }
      this.scene.add(g);
    }
  }

  private label(def: StationDef, y: number) {
    const s = labelSprite(def.label);
    s.position.set(def.x, y, def.z);
    s.userData.baseX = s.scale.x;
    s.userData.baseY = s.scale.y;
    this.scene.add(s);
    this.labels.set(def.id, s);
  }

  private buildStation(def: StationDef) {
    this.addCollider(def.x, def.z, def.w, def.d);
    const alongX = def.face === "+z" || def.face === "-z";
    const W = alongX ? def.w : def.d; // along the wall
    const D = alongX ? def.d : def.w; // out from the wall
    const h = def.h;
    const g = frame(def.x, def.z, def.face);
    this.scene.add(g);

    // Rubber mat where the cook stands.
    if (def.kind === "prep" || def.kind === "grill" || def.kind === "fryer" || def.kind === "dishpit") {
      const m = plane(W, 0.6, mat("mat"), true);
      m.rotation.x = -Math.PI / 2;
      m.position.set(0, 0.006, D / 2 + 0.36);
      g.add(m);
    }

    switch (def.kind) {
      case "walkin": {
        g.add(tbox(W, h, D, 0, h / 2, 0, mat("steel")));
        g.add(tbox(0.02, h - 0.2, 0.01, 0, h / 2, D / 2 + 0.005, basic("#4a535c"))); // door seam
        for (const s of [-1, 1]) g.add(tbox(0.05, 0.7, 0.08, s * 0.12, 1.15, D / 2 + 0.04, mat("steelDark")));
        g.add(tbox(0.36, 0.14, 0.02, -W / 2 + 0.35, 1.9, D / 2 + 0.01, basic("#0f2a20")));
        g.add(tbox(0.2, 0.06, 0.01, -W / 2 + 0.35, 1.9, D / 2 + 0.025, basic("#5fffa0"))); // temp display
        this.label(def, h + 0.3);
        break;
      }
      case "prep": {
        g.add(tbox(W, h, D, 0, h / 2, 0, counterFaces()));
        g.add(tbox(Math.min(1.0, W - 0.3), 0.05, 0.6, 0, h + 0.025, 0.08, mat("wood")));
        g.add(tbox(0.36, 0.015, 0.05, W / 2 - 0.25, h + 0.06, 0.15, toon("#e6edf2")));
        this.label(def, h + 0.85);
        break;
      }
      case "grill": {
        g.add(tbox(W, h, D, 0, h / 2, 0, counterFaces("steelDark")));
        g.add(tbox(W - 0.12, 0.04, D - 0.15, 0, h + 0.02, 0, mat("grate")));
        const bars: THREE.Mesh[] = [];
        for (let i = 0; i < 5; i++) {
          const bar = tbox(W - 0.3, 0.012, 0.03, 0, h + 0.045, -0.3 + i * 0.15, basic("#ff7a2e"));
          bars.push(bar);
          g.add(bar);
        }
        g.add(tbox(W + 0.2, 0.42, 0.75, 0, 2.4, 0.05, mat("steel"))); // hood
        g.add(tbox(W, 0.08, 0.02, 0, 2.25, 0.43, mat("grate")));
        const light = new THREE.PointLight("#ff8a3a", 2.5, 3.2, 1.5);
        light.position.set(0, h + 0.35, 0.3);
        g.add(light);
        this.grills.push({ def, bars, light });
        this.label(def, h + 0.85);
        break;
      }
      case "fryer": {
        g.add(tbox(W, h, D, 0, h / 2, 0, counterFaces()));
        const oil = plane(W - 0.3, D - 0.3, mat("oil"));
        this.oilTex ??= (oil.material as THREE.MeshToonMaterial).map;
        oil.rotation.x = -Math.PI / 2;
        oil.position.set(0, h + 0.005, 0);
        g.add(oil);
        for (const s of [-1, 1]) {
          g.add(tbox(0.4, 0.14, 0.32, s * 0.27, h + 0.1, 0.05, toon("#c9cfd6", { wireframe: true })));
          g.add(tbox(0.04, 0.04, 0.3, s * 0.27, h + 0.18, 0.36, toon("#1a1216")));
        }
        const bg = tbox(1.0, 0.09, 0.02, 0, h + 0.55, 0.2, basic("#2a1f24"));
        const bar = tbox(1.0, 0.09, 0.03, 0, h + 0.55, 0.21, basic("#5fd35a"));
        bg.visible = bar.visible = false;
        g.add(bg, bar);
        this.fryers.push({ def, bar, bg });
        this.label(def, h + 0.9);
        break;
      }
      case "pass": {
        g.add(tbox(W, h, D, 0, h / 2, 0, counterFaces()));
        this.heatLamp = tbox(W - 0.4, 0.08, 0.22, 0, 1.95, 0.1, basic("#ff8a3a"));
        g.add(this.heatLamp);
        const lamp = new THREE.PointLight("#ff9a4a", 2.2, 3, 1.5);
        lamp.position.set(0, 1.7, 0.2);
        g.add(lamp);
        // Service window onto the street, right behind the pass.
        const street = plane(W + 0.4, 1.1, toon("#ffffff", { map: streetView(), emissive: "#ffffff", emissiveIntensity: 0.45 }));
        street.position.set(0, 2.05, -D / 2 + 0.01);
        g.add(street);
        for (const [w, hh, x, y] of [[W + 0.7, 0.12, 0, 2.65], [W + 0.7, 0.12, 0, 1.45], [0.12, 1.3, -W / 2 - 0.3, 2.05], [0.12, 1.3, W / 2 + 0.3, 2.05]]) {
          g.add(tbox(w, hh, 0.1, x, y, -D / 2 + 0.05, mat("darkWood")));
        }
        // Ticket rail with paper tickets clipped on.
        g.add(tbox(W - 0.2, 0.04, 0.04, 0, 1.62, 0.48, mat("steelDark")));
        for (let i = 0; i < 8; i++) {
          const paper = plane(0.2, 0.3, toon("#fff4dc"));
          paper.position.set(-W / 2 + 0.35 + i * ((W - 0.7) / 7), 1.44, 0.5);
          paper.visible = false;
          this.ticketPapers.push(paper);
          g.add(paper);
        }
        for (let i = 0; i < 12; i++) {
          const s = itemSprite(0.3);
          s.position.set(-W / 2 + 0.35 + (i % 6) * ((W - 0.7) / 5), h + 0.2, 0.15 - Math.floor(i / 6) * 0.3);
          this.passSprites.push(s);
          g.add(s);
        }
        this.label(def, 2.3);
        break;
      }
      case "dishpit": {
        g.add(tbox(W, h, D, 0, h / 2, 0, counterFaces()));
        const water = plane(W - 0.9, D - 0.25, mat("water"));
        this.waterTex ??= (water.material as THREE.MeshToonMaterial).map;
        water.rotation.x = -Math.PI / 2;
        water.position.set(-W / 2 + 0.6, h + 0.004, 0);
        g.add(water);
        g.add(tbox(0.05, 0.45, 0.05, -W / 2 + 0.6, h + 0.22, -D / 2 + 0.15, mat("steel"))); // faucet
        g.add(tbox(0.05, 0.05, 0.3, -W / 2 + 0.6, h + 0.43, -D / 2 + 0.28, mat("steel")));
        const plateGeo = new THREE.CylinderGeometry(0.16, 0.13, 0.04, 10);
        for (let i = 0; i < 8; i++) {
          const clean = new THREE.Mesh(plateGeo, toon("#f2f4f7"));
          clean.position.set(W / 2 - 0.3, h + 0.04 + i * 0.045, 0);
          const dirty = new THREE.Mesh(plateGeo, toon("#b49a6a"));
          dirty.position.set(W / 2 - 0.75, h + 0.04 + i * 0.045, 0.05);
          this.cleanStack.push(clean);
          this.dirtyStack.push(dirty);
          g.add(clean, dirty);
        }
        this.label(def, h + 0.9);
        break;
      }
      case "trash": {
        const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.3, h, 12), mat("binGreen"));
        bin.position.set(0, h / 2, 0);
        g.add(bin);
        const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.06, 12), toon("#2e5034"));
        lid.position.set(0, h + 0.03, 0);
        g.add(lid);
        this.label(def, h + 0.4);
        break;
      }
    }
  }

  private buildIsland(b: Box2, withRack: boolean) {
    const h = 0.95;
    this.scene.add(tbox(b.w, h, b.d, b.x, h / 2, b.z, [mat("steel"), mat("steel"), mat("wood"), mat("steelDark"), mat("cabinet"), mat("cabinet")]));
    this.addCollider(b.x, b.z, b.w, b.d);
    const colors = ["#e04f3f", "#f2b632", "#4fae3c", "#e04f3f"];
    colors.forEach((c, i) => {
      const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.2, 6), toon(c));
      bottle.position.set(b.x + b.w / 2 - 0.25 - i * 0.12, h + 0.1, b.z - b.d / 2 + 0.2);
      this.scene.add(bottle);
    });
    if (!withRack) return;
    // Pot rack, hung high so it never blocks your view.
    this.scene.add(tbox(b.w - 0.6, 0.04, 0.04, b.x, 2.75, b.z, basic("#2b2326")));
    for (let i = 0; i < 4; i++) {
      const x = b.x - (b.w - 1.2) / 2 + i * ((b.w - 1.2) / 3);
      const r = 0.1 + (i % 2) * 0.03;
      this.scene.add(tbox(0.01, 0.12, 0.01, x, 2.68, b.z, basic("#2b2326")));
      const pan = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.85, 0.05, 10), i % 2 ? mat("steelDark") : toon("#b0623a"));
      pan.rotation.z = Math.PI / 2;
      pan.position.set(x, 2.55 - r, b.z);
      this.scene.add(pan);
    }
  }

  private buildPuffs() {
    const c = document.createElement("canvas");
    c.width = c.height = 8;
    const g2 = c.getContext("2d")!;
    g2.fillStyle = "#ffffff";
    g2.fillRect(2, 1, 4, 6);
    g2.fillRect(1, 2, 6, 4);
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    for (let i = 0; i < 40; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
      sprite.layers.set(SPRITE_LAYER);
      sprite.visible = false;
      this.scene.add(sprite);
      this.puffs.push({ sprite, life: 0, vx: 0, vz: 0 });
    }
  }

  private emit(def: StationDef, color: string) {
    const p = this.puffs.find((q) => q.life <= 0);
    if (!p) return;
    p.life = 1;
    p.vx = (Math.random() - 0.5) * 0.15;
    p.vz = (Math.random() - 0.5) * 0.15;
    p.sprite.position.set(def.x + (Math.random() - 0.5) * 0.5, 1.05, def.z + (Math.random() - 0.5) * 0.3);
    (p.sprite.material as THREE.SpriteMaterial).color.set(color);
    p.sprite.visible = true;
  }

  /** Decorations you've collected, placed around your kitchen. */
  addDecor(ids: string[]) {
    const { width: W, depth: D } = this.layout;
    const pass = this.layout.stations.find((s) => s.kind === "pass")!;
    const canvasTex = (w: number, h: number, paint: (g: CanvasRenderingContext2D) => void) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      paint(c.getContext("2d")!);
      const t = new THREE.CanvasTexture(c);
      t.magFilter = t.minFilter = THREE.NearestFilter;
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const add = (o: THREE.Object3D) => {
      o.traverse((m) => {
        m.castShadow = m.receiveShadow = (m as THREE.Mesh).isMesh && !((m as THREE.Mesh).material instanceof THREE.MeshBasicMaterial);
      });
      this.scene.add(o);
    };

    if (ids.includes("decor-rug")) {
      const tex = canvasTex(32, 16, (g) => {
        g.fillStyle = "#8c2f3a";
        g.fillRect(0, 0, 32, 16);
        g.fillStyle = "#f2b632";
        g.fillRect(2, 2, 28, 1);
        g.fillRect(2, 13, 28, 1);
        g.fillStyle = "#fff4dc";
        g.font = "7px Silkscreen, monospace";
        g.fillText("HI!", 9, 11);
      });
      const rug = plane(2.4, 1.0, toon("#ffffff", { map: tex }));
      rug.rotation.x = -Math.PI / 2;
      rug.position.set(pass.x, 0.008, pass.z - pass.d / 2 - 1.1);
      add(rug);
    }
    if (ids.includes("decor-plant")) {
      const g = new THREE.Group();
      g.position.set(W / 2 - 0.35, 0, D / 4); // free spot on the side wall, clear of every station
      g.add(tbox(0.4, 0.4, 0.4, 0, 0.2, 0, toon("#b0623a")));
      for (let i = 0; i < 6; i++) {
        const leaf = tbox(0.08, 0.6, 0.3, 0, 0.7, 0, toon(i % 2 ? "#3f8f3a" : "#5fb84f"));
        leaf.rotation.set(0.5, (i / 6) * Math.PI * 2, 0);
        g.add(leaf);
      }
      add(g);
    }
    if (ids.includes("decor-poster")) {
      const tex = canvasTex(24, 32, (g) => {
        g.fillStyle = "#f2b632";
        g.fillRect(0, 0, 24, 32);
        g.fillStyle = "#e04f3f";
        g.fillRect(3, 4, 18, 14);
        g.fillStyle = "#fff4dc";
        g.fillRect(6, 8, 12, 6);
        g.fillStyle = "#1a1216";
        g.font = "6px Silkscreen, monospace";
        g.fillText("EAT", 6, 26);
      });
      const poster = plane(0.7, 0.95, toon("#ffffff", { map: tex }));
      poster.rotation.y = Math.PI;
      poster.position.set(Math.min(W / 2 - 0.6, pass.x + pass.w / 2 + 1.0), 1.9, D / 2 - 0.02);
      add(poster);
    }
    if (ids.includes("decor-neon")) {
      const tex = canvasTex(48, 16, (g) => {
        g.fillStyle = "#1a1216";
        g.fillRect(0, 0, 48, 16);
        g.fillStyle = "#ff5fb0";
        g.font = "8px Silkscreen, monospace";
        g.fillText("RAMEN", 5, 11);
      });
      const sign = plane(1.4, 0.48, new THREE.MeshBasicMaterial({ map: tex }));
      sign.rotation.y = Math.PI;
      sign.position.set(Math.max(-W / 2 + 0.9, pass.x - pass.w / 2 - 1.0), 2.15, D / 2 - 0.02);
      add(sign);
      const glow = new THREE.PointLight("#ff5fb0", 1.5, 3, 1.5);
      glow.position.set(sign.position.x, 2.1, D / 2 - 0.4);
      this.scene.add(glow);
    }
    if (ids.includes("decor-lights")) {
      const colors = ["#ffd36a", "#ff8a5a", "#9ad7ff", "#b6ff8a"];
      for (let i = 0; i <= 24; i++) {
        const x = -W / 2 + 0.3 + (i / 24) * (W - 0.6);
        const sag = Math.sin((i / 24) * Math.PI * 6) * 0.08;
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 5, 4), basic(colors[i % colors.length]));
        bulb.position.set(x, 2.72 - Math.abs(sag), -D / 2 + 0.1);
        this.scene.add(bulb);
      }
    }
    if (ids.includes("decor-lanterns")) {
      // Over the first island, or over the middle of the aisle in open kitchens.
      const isl = this.layout.islands[0] ?? { x: pass.x, z: 0, w: Math.min(4, pass.w), d: 0.6 };
      for (let i = 0; i < 3; i++) {
        const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.34, 10), new THREE.MeshBasicMaterial({ color: "#e0412f" }));
        lantern.position.set(isl.x - isl.w / 3 + (i * isl.w) / 3, 2.3, isl.z + 0.35);
        this.scene.add(lantern);
        this.scene.add(tbox(0.34, 0.03, 0.34, lantern.position.x, 2.48, lantern.position.z, toon("#1a1216")));
      }
    }
    if (ids.includes("decor-cat")) {
      const g = frame(pass.x + pass.w / 2 - 0.3, pass.z, pass.face);
      const white = toon("#fbf6ee");
      g.add(tbox(0.2, 0.2, 0.16, 0, pass.h + 0.1, 0.2, white));
      g.add(tbox(0.22, 0.18, 0.16, 0, pass.h + 0.29, 0.2, white));
      g.add(tbox(0.05, 0.05, 0.02, -0.06, pass.h + 0.3, 0.29, toon("#1a1216")));
      g.add(tbox(0.05, 0.05, 0.02, 0.06, pass.h + 0.3, 0.29, toon("#1a1216")));
      g.add(tbox(0.12, 0.04, 0.17, 0, pass.h + 0.15, 0.2, toon("#e04f3f"))); // collar
      this.catPaw = tbox(0.06, 0.14, 0.06, 0.12, pass.h + 0.32, 0.22, white);
      g.add(this.catPaw);
      add(g);
    }
  }

  /** Grow the label of the station you're looking at. */
  setFocus(id: string | null) {
    this.labels.forEach((s, key) => {
      const k = key === id ? 1.35 : 1;
      s.scale.x += (s.userData.baseX * k - s.scale.x) * 0.3;
      s.scale.y += (s.userData.baseY * k - s.scale.y) * 0.3;
    });
  }

  setGuideTarget(id: string | null) {
    this.arrowTarget = id ? this.layout.stations.find((s) => s.id === id) ?? null : null;
    this.arrow.visible = !!this.arrowTarget;
  }

  update(state: KitchenView) {
    this.busyFryers.clear();
    for (const f of this.fryers) {
      const st = state.stations.get(f.def.id);
      const cooking = !!st?.item;
      f.bar.visible = f.bg.visible = cooking;
      if (!st || !cooking) continue;
      this.busyFryers.add(f.def.id);
      const t = Math.min(1, st.progress / this.fry.burnt);
      f.bar.scale.x = Math.max(0.02, t);
      f.bar.position.x = -0.5 + t * 0.5;
      (f.bar.material as THREE.MeshBasicMaterial).color.set(
        st.progress < this.fry.ready ? "#e0b23f" : st.progress <= this.fry.burnt ? "#5fd35a" : "#e04f3f",
      );
    }
    this.busyGrills.clear();
    for (const g of this.grills) if (state.stations.get(g.def.id)?.user) this.busyGrills.add(g.def.id);

    // Food already on the pass, and one paper per ticket on the rail.
    let i = 0;
    for (const ticket of state.tickets) {
      for (const item of ticket.have) {
        const s = this.passSprites[i++];
        if (s) setIcon(s, isItem(item) ? item : null);
      }
    }
    for (; i < this.passSprites.length; i++) setIcon(this.passSprites[i], null);
    this.ticketPapers.forEach((p, n) => (p.visible = n < state.tickets.length));
    this.cleanStack.forEach((m, n) => (m.visible = n < state.cleanPlates));
    this.dirtyStack.forEach((m, n) => (m.visible = n < state.dirtyPlates));
  }

  animate(time: number, dt: number) {
    for (const g of this.grills) {
      const busy = this.busyGrills.has(g.def.id);
      const glow = 0.75 + Math.sin(time * 6 + g.def.x) * 0.25 + (busy ? 0.3 : 0);
      for (const bar of g.bars) (bar.material as THREE.MeshBasicMaterial).color.setRGB(1, 0.3 + glow * 0.25, 0.08);
      g.light.intensity = 2.2 + Math.sin(time * 13 + g.def.x) * 0.3 + Math.sin(time * 7.3) * 0.2 + (busy ? 1.5 : 0);
    }
    if (this.heatLamp) (this.heatLamp.material as THREE.MeshBasicMaterial).color.setRGB(1, 0.5 + Math.sin(time * 2) * 0.05, 0.2);
    this.oilTex?.offset.set(Math.sin(time * 3) * 0.02, time * (this.busyFryers.size ? 0.12 : 0.02));
    this.waterTex?.offset.set(time * 0.03, Math.sin(time) * 0.02);
    if (this.catPaw) this.catPaw.rotation.z = Math.sin(time * 5) * 0.5; // lucky cat waves

    // Steam from busy grills, faint smoke from idle ones, steam from fryers with a basket in.
    this.emitTimer -= dt;
    if (this.emitTimer <= 0) {
      this.emitTimer = 0.12;
      for (const g of this.grills) {
        if (this.busyGrills.has(g.def.id)) this.emit(g.def, "#d8d2cc");
        else if (Math.random() < 0.2) this.emit(g.def, "#8c8288");
      }
      for (const f of this.fryers) if (this.busyFryers.has(f.def.id)) this.emit(f.def, "#f3e6c8");
    }
    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt * 0.7;
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.z += p.vz * dt;
      p.sprite.position.y += dt * 0.55;
      const s = 0.12 + (1 - p.life) * 0.25;
      p.sprite.scale.set(s, s, 1);
      (p.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, p.life * 0.55);
      if (p.life <= 0) p.sprite.visible = false;
    }

    if (this.arrowTarget) {
      const t = this.arrowTarget;
      // Tall stations have little headroom under the ceiling, so the arrow bounces less there.
      const [top, bounce] = t.kind === "walkin" ? [2.74, 0.08] : t.kind === "pass" ? [2.6, 0.12] : [t.h + 1.25, 0.18];
      this.arrow.position.set(t.x, top + Math.abs(Math.sin(time * 4)) * bounce, t.z);
      this.arrow.rotation.y = time * 2;
    }
  }
}
