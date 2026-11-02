// First-person walking and looking with simple circle-vs-box collision.
// Looking is free: just move the mouse. Push the cursor toward a screen edge to keep turning.
// Where the browser allows it, the first click captures the mouse for classic FPS look.
// Arrow keys turn too, and dragging still works on touch screens.
import * as THREE from "three";
import { PLAYER_RADIUS } from "../shared/game";
import type { Collider } from "./world";

const EYE_HEIGHT = 1.62;
const HOVER_SPEED = 0.006; // radians per pixel of free mouse movement
const LOCK_SPEED = 0.0024;
const EDGE = 0.12; // outer share of the screen that keeps turning
const EDGE_TURN = 2.6; // radians per second at the very edge
const TURN_SPEED = 2.6; // arrow keys
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
  private readonly keys = new Set<string>();
  private bob = 0;
  private lastX: number | null = null;
  private lastY: number | null = null;
  private edge = 0; // -1..1 when the cursor sits near the left/right edge
  private lookedDistance = 0;
  private walkedDistance = 0;
  private triedLock = false;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly element: HTMLElement,
    private readonly colliders: Collider[],
    private readonly bounds: { width: number; depth: number },
  ) {
    element.addEventListener("pointermove", (e) => {
      if (!this.enabled) return;
      if (this.locked) {
        this.look(e.movementX * LOCK_SPEED, e.movementY * LOCK_SPEED);
        return;
      }
      if (this.lastX !== null && this.lastY !== null) {
        this.look((e.clientX - this.lastX) * HOVER_SPEED, (e.clientY - this.lastY) * HOVER_SPEED * 0.8);
      }
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      const nx = e.clientX / window.innerWidth;
      this.edge = nx < EDGE ? -(1 - nx / EDGE) : nx > 1 - EDGE ? (nx - (1 - EDGE)) / EDGE : 0;
    });
    element.addEventListener("pointerleave", () => {
      this.lastX = this.lastY = null;
      this.edge = 0;
    });
    // First click: try to capture the mouse (works in normal browsers; harmless where it doesn't).
    element.addEventListener("click", () => {
      if (!this.triedLock && this.enabled) {
        this.triedLock = true;
        this.lock();
      }
    });
    element.addEventListener("contextmenu", (e) => e.preventDefault());

    window.addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      if (e.code.startsWith("Arrow") && this.enabled) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.edge = 0;
    });
  }

  get locked() {
    return document.pointerLockElement === this.element;
  }

  lock() {
    try {
      const result = this.element.requestPointerLock?.() as unknown;
      if (result instanceof Promise) result.catch(() => {});
    } catch {
      // Not supported here: free mouse look covers it.
    }
  }

  unlock() {
    if (this.locked) document.exitPointerLock();
    this.edge = 0;
    this.lastX = this.lastY = null;
  }

  setPose(x: number, z: number, yaw: number) {
    this.position.set(x, EYE_HEIGHT, z);
    this.yaw = yaw;
  }

  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  private look(dx: number, dy: number) {
    this.yaw -= dx;
    this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch - dy));
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
      if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) mz -= 1;
      if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) mz += 1;
      if (this.keys.has("KeyA")) mx -= 1;
      if (this.keys.has("KeyD")) mx += 1;
      if (this.keys.has("ArrowLeft")) this.look(-TURN_SPEED * dt, 0);
      if (this.keys.has("ArrowRight")) this.look(TURN_SPEED * dt, 0);
      if (!this.locked && this.edge !== 0) this.look(this.edge * EDGE_TURN * dt, 0);
    }
    const len = Math.hypot(mx, mz);
    this.sprinting = len > 0 && (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight"));
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
    return this.colliders.some((c) => x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r);
  }
}
