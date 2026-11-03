// Other cooks in the kitchen, interpolated toward their last synced position.
import * as THREE from "three";
import { CHEF_COLORS, isItem } from "../shared/game";
import { SKIN_TONES, shopItem } from "../shared/meta";
import { itemSprite, labelSprite, setIcon } from "./icons";
import { toon } from "./render";
import type { MapLike, PlayerView } from "./types";

interface Avatar {
  root: THREE.Group;
  held: THREE.Sprite;
  key: string; // rebuild the model when name or outfit changes
  target: THREE.Vector3;
  yaw: number;
}

function buildChef(color: string, name: string, look: Pick<PlayerView, "skin" | "hat" | "jacket">) {
  const root = new THREE.Group();
  const white = toon(shopItem(look.jacket)?.color ?? "#f4f1ea");
  const hatMat = toon(shopItem(look.hat)?.color ?? "#f4f1ea");
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(0, y, z);
    root.add(m);
    return m;
  };
  const pants = toon("#2d2a33");
  const skin = toon(SKIN_TONES[look.skin] ?? SKIN_TONES[1]);
  for (const s of [-1, 1]) {
    const leg = add(new THREE.BoxGeometry(0.16, 0.75, 0.18), pants, 0.375);
    leg.position.x = s * 0.1;
    const arm = add(new THREE.BoxGeometry(0.12, 0.5, 0.14), white, 1.05, 0.06);
    arm.position.x = s * 0.31;
    arm.rotation.x = -0.5; // arms forward, carrying
    const hand = add(new THREE.BoxGeometry(0.1, 0.1, 0.1), skin, 0.86, 0.22);
    hand.position.x = s * 0.31;
  }
  add(new THREE.BoxGeometry(0.5, 0.6, 0.3), white, 1.05); // jacket
  for (const y of [1.2, 1.05, 0.9]) add(new THREE.BoxGeometry(0.04, 0.04, 0.02), toon("#1a1216"), y, 0.16).position.x = 0.12; // buttons
  add(new THREE.BoxGeometry(0.42, 0.45, 0.02), toon(color), 0.95, 0.165); // apron
  add(new THREE.BoxGeometry(0.34, 0.08, 0.32), toon(color), 1.37); // neckerchief
  add(new THREE.BoxGeometry(0.3, 0.3, 0.3), skin, 1.55); // head
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.05, 0.05, 0.01), toon("#1a1216"), 1.58, 0.155).position.x = s * 0.07; // eyes
  add(new THREE.BoxGeometry(0.1, 0.02, 0.01), toon("#9a4a3a"), 1.49, 0.155); // smile
  switch (look.hat) {
    case "hat-tall":
      add(new THREE.CylinderGeometry(0.17, 0.16, 0.5, 10), hatMat, 1.95);
      break;
    case "hat-bandana":
      add(new THREE.BoxGeometry(0.32, 0.1, 0.32), hatMat, 1.68);
      add(new THREE.BoxGeometry(0.12, 0.06, 0.1), hatMat, 1.66, -0.2);
      break;
    case "hat-beret":
      add(new THREE.CylinderGeometry(0.22, 0.2, 0.08, 12), hatMat, 1.74).rotation.z = 0.15;
      break;
    case "hat-hachimaki":
      add(new THREE.BoxGeometry(0.32, 0.06, 0.32), hatMat, 1.64);
      add(new THREE.BoxGeometry(0.05, 0.05, 0.02), toon("#e04f3f"), 1.64, 0.165);
      break;
    default:
      add(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 10), hatMat, 1.74); // hat band
      add(new THREE.CylinderGeometry(0.22, 0.16, 0.24, 10), hatMat, 1.89); // puffy toque
  }

  const tag = labelSprite(name, color);
  tag.position.y = 2.25;
  root.add(tag);

  const held = itemSprite(0.3);
  held.position.set(0, 1.0, 0.42);
  root.add(held);
  return { root, held };
}

export class Avatars {
  private readonly avatars = new Map<string, Avatar>();

  constructor(private readonly scene: THREE.Scene) {}

  sync(players: MapLike<PlayerView>, me: string) {
    const seen = new Set<string>();
    players.forEach((p, id) => {
      if (id === me) return;
      seen.add(id);
      let a = this.avatars.get(id);
      const key = `${p.name}|${p.color}|${p.skin}|${p.hat}|${p.jacket}`;
      if (!a || a.key !== key) {
        if (a) this.scene.remove(a.root);
        const built = buildChef(CHEF_COLORS[p.color % CHEF_COLORS.length], p.name, p);
        a = { ...built, key, target: new THREE.Vector3(p.x, 0, p.z), yaw: p.yaw };
        a.root.position.copy(a.target);
        this.scene.add(a.root);
        this.avatars.set(id, a);
      }
      a.target.set(p.x, 0, p.z);
      a.yaw = p.yaw;
      const first = p.hands[0];
      setIcon(a.held, isItem(first) ? first : null);
    });
    for (const [id, a] of this.avatars) {
      if (!seen.has(id)) {
        this.scene.remove(a.root);
        this.avatars.delete(id);
      }
    }
  }

  update(dt: number, time: number) {
    const k = 1 - Math.exp(-dt * 12);
    for (const a of this.avatars.values()) {
      const moving = a.root.position.distanceToSquared(a.target) > 0.0004;
      a.root.position.lerp(a.target, k);
      a.root.position.y = moving ? Math.abs(Math.sin(time * 12)) * 0.05 : 0;
      // Camera yaw 0 looks down -Z; the chef model faces +Z, hence the half turn.
      let diff = a.yaw + Math.PI - a.root.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      a.root.rotation.y += diff * k;
    }
  }
}
