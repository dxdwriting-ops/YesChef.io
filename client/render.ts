// "2.5D pixel cel shading": render the 3D scene at a low resolution with toon materials,
// then a post pass adds ink outlines (depth + normal edges), a warm grade, a vignette
// and a dithered, posterized palette. CSS upscales the canvas with image-rendering: pixelated.
import * as THREE from "three";

/** Sprites (icons, labels) live on this layer so they skip the normal pass and its outlines. */
export const SPRITE_LAYER = 1;

export type Quality = "retro" | "sharp" | "hd";
export const QUALITY_LABEL: Record<Quality, string> = {
  retro: "Retro (chunky pixels)",
  sharp: "Sharp",
  hd: "HD + shadows",
};
const QUALITY_ORDER: Quality[] = ["retro", "sharp", "hd"];
export function nextQuality(q: Quality): Quality {
  return QUALITY_ORDER[(QUALITY_ORDER.indexOf(q) + 1) % QUALITY_ORDER.length];
}
export function isQuality(v: unknown): v is Quality {
  return typeof v === "string" && (QUALITY_ORDER as string[]).includes(v);
}

const POST_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const POST_FRAG = /* glsl */ `
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tNormal;
uniform vec2 resolution;
uniform float cameraNear;
uniform float cameraFar;
uniform vec3 inkColor;
uniform float levels;
varying vec2 vUv;

float viewDepth(vec2 uv) {
  return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar);
}

vec3 viewNormal(vec2 uv) {
  return texture2D(tNormal, uv).xyz * 2.0 - 1.0;
}

float bayer4(vec2 p) {
  int x = int(mod(p.x, 4.0));
  int y = int(mod(p.y, 4.0));
  float m[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
  return m[x + y * 4] / 16.0;
}

void main() {
  vec2 px = 1.0 / resolution;
  float d = viewDepth(vUv);
  vec3 n = viewNormal(vUv);

  // Compare with the right and lower neighbours only, giving crisp 1-pixel lines.
  vec2 o1 = vec2(px.x, 0.0);
  vec2 o2 = vec2(0.0, px.y);
  float depthEdge = max(abs(d - viewDepth(vUv + o1)), abs(d - viewDepth(vUv + o2)));
  float normalEdge = max(1.0 - dot(n, viewNormal(vUv + o1)), 1.0 - dot(n, viewNormal(vUv + o2)));
  bool edge = depthEdge > 0.05 + d * 0.04 || (normalEdge > 0.35 && d < 14.0);

  vec3 col = texture2D(tColor, vUv).rgb;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>

  // Warm grade: lift shadows toward plum, push highlights toward cream.
  vec3 c = gl_FragColor.rgb;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(c * vec3(0.92, 0.86, 1.0) + vec3(0.04, 0.02, 0.05), c * vec3(1.04, 1.0, 0.92), smoothstep(0.2, 0.8, lum));
  c = mix(vec3(lum), c, 1.12); // a touch more saturation

  // Vignette.
  vec2 v = vUv - 0.5;
  c *= 1.0 - dot(v, v) * 0.55;

  // Posterize in display space with a 4x4 ordered dither (finer steps at higher quality).
  float b = bayer4(gl_FragCoord.xy) - 0.5;
  c = floor(c * levels + b * 0.7 + 0.5) / levels;

  if (edge) c = mix(c, inkColor, 0.8);
  gl_FragColor.rgb = c;
}`;

export class PixelRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  private target!: THREE.WebGLRenderTarget;
  private normalTarget!: THREE.WebGLRenderTarget;
  private readonly normalMaterial = new THREE.MeshNormalMaterial();
  private readonly post: THREE.ShaderMaterial;
  private readonly postScene = new THREE.Scene();
  private readonly postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private scale = 1; // dynamic resolution: 1 is the quality preset's full size

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private quality: Quality = "hd",
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = quality === "hd";
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.05, 40);
    this.camera.layers.enable(SPRITE_LAYER);

    this.post = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        tNormal: { value: null },
        resolution: { value: new THREE.Vector2(1, 1) },
        cameraNear: { value: this.camera.near },
        cameraFar: { value: this.camera.far },
        inkColor: { value: new THREE.Color("#1a1216") },
        levels: { value: 8 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post));

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  get currentQuality() {
    return this.quality;
  }

  get resolutionScale() {
    return this.scale;
  }

  /** Render at a fraction of the preset's resolution (auto performance). */
  setScale(s: number) {
    const next = Math.min(1, Math.max(0.5, Math.round(s * 20) / 20));
    if (next === this.scale) return;
    this.scale = next;
    this.resize();
  }

  /** Switch quality; shadows need every material recompiled, so the scene is passed in. */
  setQuality(q: Quality, scene: THREE.Scene) {
    this.quality = q;
    this.renderer.shadowMap.enabled = q === "hd";
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
      else if (m) m.needsUpdate = true;
    });
    this.resize();
  }

  resize() {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    const ih = window.innerHeight;
    // Retro: chunky pixels. Sharp: twice the detail. HD: close to native, smoother colour steps.
    const h = Math.round(
      this.scale *
      (this.quality === "retro"
        ? Math.min(300, Math.max(200, ih / 3.2))
        : this.quality === "sharp"
          ? Math.min(540, Math.max(360, ih / 1.8))
          : Math.min(1080, Math.max(540, ih * 0.9))),
    );
    this.post.uniforms.levels.value = { retro: 8, sharp: 11, hd: 18 }[this.quality];
    const w = Math.max(1, Math.round(h * aspect));
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();

    this.target?.dispose();
    this.normalTarget?.dispose();
    const depthTexture = new THREE.DepthTexture(w, h);
    const opts = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
    this.target = new THREE.WebGLRenderTarget(w, h, { ...opts, depthTexture });
    this.normalTarget = new THREE.WebGLRenderTarget(w, h, opts);
    this.post.uniforms.tColor.value = this.target.texture;
    this.post.uniforms.tDepth.value = depthTexture;
    this.post.uniforms.tNormal.value = this.normalTarget.texture;
    this.post.uniforms.resolution.value.set(w, h);
  }

  render(scene: THREE.Scene) {
    const r = this.renderer;
    r.setRenderTarget(this.target);
    r.render(scene, this.camera);

    // Normals pass, without sprites.
    const bg = scene.background;
    const fog = scene.fog;
    scene.background = null;
    scene.fog = null;
    scene.overrideMaterial = this.normalMaterial;
    this.camera.layers.disable(SPRITE_LAYER);
    r.setRenderTarget(this.normalTarget);
    r.setClearColor(0x8080ff, 1);
    r.clear();
    r.render(scene, this.camera);
    this.camera.layers.enable(SPRITE_LAYER);
    scene.overrideMaterial = null;
    scene.background = bg;
    scene.fog = fog;

    r.setRenderTarget(null);
    r.render(this.postScene, this.postCamera);
  }
}

// Three-step light ramp shared by every toon material: shadow, mid, lit.
let ramp: THREE.DataTexture | null = null;
function toonRamp(): THREE.DataTexture {
  if (!ramp) {
    ramp = new THREE.DataTexture(new Uint8Array([90, 165, 255]), 3, 1, THREE.RedFormat);
    ramp.minFilter = THREE.NearestFilter;
    ramp.magFilter = THREE.NearestFilter;
    ramp.needsUpdate = true;
  }
  return ramp;
}

export function toon(color: THREE.ColorRepresentation, extra: THREE.MeshToonMaterialParameters = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonRamp(), ...extra });
}

/** Put a sprite (and its children) on the sprite layer. */
export function spriteLayer<T extends THREE.Object3D>(obj: T): T {
  obj.traverse((o) => o.layers.set(SPRITE_LAYER));
  return obj;
}
