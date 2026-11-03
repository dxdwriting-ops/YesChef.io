// First-person walking and looking with simple circle-vs-box collision.
// Three ways to look, picked in Settings:
// - hold: hold a mouse button and drag (the cursor stays free, works everywhere, touch included),
// - follow: the view follows the cursor, and pushing it to a screen edge keeps turning,
// - lock: classic FPS mouse capture where the browser allows it; Esc frees the mouse.
// Every key comes from the player's bindings.
import * as THREE from "three";
import { PLAYER_RADIUS } from "../shared/game";
import type { Action, Settings } from "./settings";
import type { Collider } from "./world";

const EYE_HEIGHT = 1.62;
const DRAG_SPEED = 0.0052; // radians per pixel when holding to look
const HOVER_SPEED = 0.006; // radians per pixel of free mouse movement
const LOCK_SPEED = 0.0024;
const EDGE = 0.12; // outer share of the screen that keeps turning
const EDGE_TURN = 2.6; // radians per second at the very edge
const TURN_SPEED = 2.6; // turn keys
const WALK = 4.2; // metres per second
const SPRINT = 6.6;
const BASE_FOV = 72;

export class FirstPersonControls {
  readonly position = new THREE.Vector3(0, EYE_HEIGHT, 1.8);
  yaw = 0;
  pitch = -0.12;
  enabled = true;
  sprinting = false;
  speedMul = 1; // Kitchen Clogs
  onLooked = () => {};
  onWalked = () => {};
  /** The browser let go of the mouse (Esc in lock mode): the game treats it as "pause". */
  onLockLost = () => {};
  private readonly keys = new Set<string>();
  private bob = 0;
  private lastX: number | null = null;
  private lastY: number | null = null;
  private dragging: number | null = null; // pointer id while holding to look
  private edge = 0; // -1..1 when the cursor sits near the left/right edge
  private lookedDistance = 0;
  private walkedDistance = 0;
  private releasing = false; // we asked for the unlock ourselves

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly element: HTMLElement,
    private readonly colliders: Collider[],
    private readonly bounds: { width: number; depth: number },
    private readonly settings: Settings,
  ) {
    this.applyLookMode();

    element.addEventListener("pointerdown", (e) => {
      if (!this.enabled) return;
      const drag = this.settings.look === "hold" || e.pointerType === "touch";
      if (drag) {
        this.dragging = e.pointerId;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        element.setPointerCapture?.(e.pointerId);
        element.classList.add("dragging");
      } else if (this.settings.look === "lock" && !this.locked) {
        this.lock();
      }
    });
    const endDrag = (e: PointerEvent) => {
      if (e.pointerId !== this.dragging) return;
      this.dragging = null;
      element.classList.remove("dragging");
      if (element.hasPointerCapture?.(e.pointerId)) element.releasePointerCapture(e.pointerId);
    };
    element.addEventListener("pointerup", endDrag);
    element.addEventListener("pointercancel", endDrag);

    element.addEventListener("pointermove", (e) => {
      if (!this.enabled) return;
      const sens = this.settings.sensitivity;
      if (this.locked) {
        this.look(e.movementX * LOCK_SPEED * sens, e.movementY * LOCK_SPEED * sens);
        return;
      }
      if (this.dragging === e.pointerId) {
        if (this.lastX !== null && this.lastY !== null) {
          this.look((e.clientX - this.lastX) * DRAG_SPEED * sens, (e.clientY - this.lastY) * DRAG_SPEED * sens);
        }
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        return;
      }
      if (this.settings.look !== "follow" || e.pointerType === "touch") return;
      if (this.lastX !== null && this.lastY !== null) {
        this.look((e.clientX - this.lastX) * HOVER_SPEED * sens, (e.clientY - this.lastY) * HOVER_SPEED * 0.8 * sens);
      }
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      const nx = e.clientX / window.innerWidth;
      this.edge = nx < EDGE ? -(1 - nx / EDGE) : nx > 1 - EDGE ? (nx - (1 - EDGE)) / EDGE : 0;
    });
    element.addEventListener("pointerleave", () => {
      if (this.dragging !== null) return;
      this.lastX = this.lastY = null;
      this.edge = 0;
    });
    element.addEventListener("contextmenu", (e) => e.preventDefault());

    document.addEventListener("pointerlockchange", () => {
      if (document.pointerLockElement === element) return;
      if (!this.releasing && this.enabled) this.onLockLost();
      this.releasing = false;
    });

    window.addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      if (e.code.startsWith("Arrow") && this.enabled) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.release());
  }

  /** Call after the look mode changes in Settings. */
  applyLookMode() {
    this.element.dataset.look = this.settings.look;
    this.edge = 0;
    this.lastX = this.lastY = null;
    if (this.settings.look !== "lock") this.unlock();
  }

  get locked() {
    return document.pointerLockElement === this.element;
  }

  lock() {
    try {
      const result = this.element.requestPointerLock?.() as unknown;
      if (result instanceof Promise) result.catch(() => {});
    } catch {
      // Not supported here: hold-to-look still works.
    }
  }

  unlock() {
    if (this.locked) {
      this.releasing = true;
      document.exitPointerLock();
    }
    this.edge = 0;
    this.lastX = this.lastY = null;
  }

  /** Let go of everything: held keys, drags and the mouse (pause menu, mini-games, lost focus). */
  release() {
    this.keys.clear();
    this.dragging = null;
    this.element.classList.remove("dragging");
    this.unlock();
  }

  setPose(x: number, z: number, yaw: number) {
    this.position.set(x, EYE_HEIGHT, z);
    this.yaw = yaw;
  }

  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  /** Is the key bound to this action held down? The right-hand modifier counts as the left one. */
  private down(action: Action) {
    const code = this.settings.keys[action];
    return this.keys.has(code) || (/^(Shift|Control|Alt)Left$/.test(code) && this.keys.has(code.replace(/Left$/, "Right")));
  }

  private look(dx: number, dy: number) {
    this.yaw -= dx;
    this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch - dy * (this.settings.invertY ? -1 : 1)));
    this.lookedDistance += Math.abs(dx) + Math.abs(dy);
    if (this.lookedDistance > 0.6) {
      this.onLooked();
      this.lookedDistance = -Infinity;
    }
  }

  update(dt: number) {
    let mx = 0;
    let mz = 0;
    if (this.enabled) {
      if (this.down("forward")) mz -= 1;
      if (this.down("back")) mz += 1;
      if (this.down("left")) mx -= 1;
      if (this.down("right")) mx += 1;
      if (this.down("turnLeft")) this.look(-TURN_SPEED * dt, 0);
      if (this.down("turnRight")) this.look(TURN_SPEED * dt, 0);
      if (!this.locked && this.dragging === null && this.edge !== 0) this.look(this.edge * EDGE_TURN * dt * this.settings.sensitivity, 0);
    }
    const len = Math.hypot(mx, mz);
    this.sprinting = len > 0 && this.down("sprint");
    if (len > 0) {
      const speed = (this.sprinting ? SPRINT : WALK) * this.speedMul * dt;
      mx = (mx / len) * speed;
      mz = (mz / len) * speed;
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      this.move(mx * cos + mz * sin, -mx * sin + mz * cos);
      this.bob += dt * (this.sprinting ? 15 : 11);
      this.walkedDistance += speed;
      if (this.walkedDistance > 2) {
        this.onWalked();
        this.walkedDistance = -Infinity;
      }
    }

    // A little FOV kick when sprinting sells the speed.
    const fov = BASE_FOV + (this.sprinting ? 8 : 0);
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 8);
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.set(this.position.x, EYE_HEIGHT + Math.sin(this.bob) * (this.sprinting ? 0.04 : 0.025), this.position.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
  }

  // Move one axis at a time so you slide along counters instead of sticking.
  private move(dx: number, dz: number) {
    const hw = this.bounds.width / 2 - PLAYER_RADIUS;
    const hd = this.bounds.depth / 2 - PLAYER_RADIUS;
    const nx = Math.max(-hw, Math.min(hw, this.position.x + dx));
    if (!this.blocked(nx, this.position.z)) this.position.x = nx;
    const nz = Math.max(-hd, Math.min(hd, this.position.z + dz));
    if (!this.blocked(this.position.x, nz)) this.position.z = nz;
  }

  private blocked(x: number, z: number) {
    const r = PLAYER_RADIUS;
    for (const c of this.colliders) if (x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r) return true;
    return false;
  }
}
