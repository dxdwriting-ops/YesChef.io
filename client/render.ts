// Two looks share one pipeline. "3D": the scene at full resolution with antialiasing, soft toon
// shading, thin ink outlines (depth + normal edges), a warm grade and a vignette; "3D Ultra" adds
// ambient occlusion (from the depth and normal buffers) and a glow around lights. The pixel looks
// render at a low resolution instead and add a dithered, posterized palette; CSS upscales them
// with image-rendering: pixelated.
import * as THREE from "three";

/** Sprites (icons, labels) live on this layer so they skip the normal pass and its outlines. */
export const SPRITE_LAYER = 1;

export type Quality = "ultra" | "smooth" | "retro" | "sharp" | "hd";
export const QUALITY_LABEL: Record<Quality, string> = {
  ultra: "3D Ultra (shading + glow)",
  smooth: "3D (smooth)",
  retro: "Retro (chunky pixels)",
  sharp: "Sharp",
  hd: "HD + shadows",
};
const QUALITY_ORDER: Quality[] = ["ultra", "smooth", "retro", "sharp", "hd"];
export function nextQuality(q: Quality): Quality {
  return QUALITY_ORDER[(QUALITY_ORDER.indexOf(q) + 1) % QUALITY_ORDER.length];
}
export function isQuality(v: unknown): v is Quality {
  return typeof v === "string" && (QUALITY_ORDER as string[]).includes(v);
}
const is3d = (q: Quality) => q === "ultra" || q === "smooth";

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
uniform float smoothLook;
uniform float aoStrength;
uniform sampler2D tBloom;
uniform float bloomStrength;
uniform vec2 projScale; // projection matrix [0][0], [1][1]
varying vec2 vUv;

float viewDepth(vec2 uv) {
  return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar);
}

vec3 viewNormal(vec2 uv) {
  return texture2D(tNormal, uv).xyz * 2.0 - 1.0;
}

vec3 viewPos(vec2 uv) {
  float z = perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar);
  return vec3((uv * 2.0 - 1.0) / projScale * -z, z);
}

// Ambient occlusion: how much nearby geometry faces this pixel, sampled in a rotated spiral.
float ambientOcclusion(vec2 uv, vec3 n) {
  const int N = 14;
  const float R = 0.45; // metres
  vec3 p = viewPos(uv);
  float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec2 rUv = vec2(R * projScale.x, R * projScale.y) / -p.z * 0.5;
  float occ = 0.0;
  for (int i = 0; i < N; i++) {
    float t = (float(i) + noise) / float(N);
    float a = (float(i) + noise) * 2.39996;
    vec3 q = viewPos(uv + vec2(cos(a), sin(a)) * rUv * t) - p;
    float l = length(q);
    occ += max(0.0, dot(n, q) / (l + 1e-4) - 0.1) * (1.0 - smoothstep(R * 0.6, R * 1.6, l));
  }
  return clamp(1.0 - occ / float(N) * 1.6, 0.0, 1.0);
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
  if (aoStrength > 0.0 && d < cameraFar * 0.9) col *= mix(1.0, ambientOcclusion(vUv, n), aoStrength);
  if (bloomStrength > 0.0) col += texture2D(tBloom, vUv).rgb * bloomStrength;
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

  // Pixel looks: posterize in display space with a 4x4 ordered dither (finer steps at higher quality).
  if (smoothLook < 0.5) {
    float b = bayer4(gl_FragCoord.xy) - 0.5;
    c = floor(c * levels + b * 0.7 + 0.5) / levels;
  }

  if (edge) c = mix(c, inkColor, smoothLook > 0.5 ? 0.55 : 0.8);
  gl_FragColor.rgb = c;
}`;

// Glow: keep only the brightest parts of the image, then blur them at quarter resolution.
const BLOOM_FRAG = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 texel;
uniform vec2 dir;
uniform float threshold; // > 0 on the first pass: extract the bright parts
varying vec2 vUv;
void main() {
  if (threshold > 0.0) {
    vec3 c = vec3(0.0);
    for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) c += texture2D(tInput, vUv + vec2(x, y) * texel * 1.5).rgb;
    c /= 9.0;
    float l = max(c.r, max(c.g, c.b));
    gl_FragColor = vec4(c * smoothstep(threshold, threshold * 1.6, l), 1.0);
    return;
  }
  float w[5] = float[5](0.227, 0.194, 0.122, 0.054, 0.016);
  vec3 c = texture2D(tInput, vUv).rgb * w[0];
  for (int i = 1; i < 5; i++) {
    vec2 o = dir * texel * float(i);
    c += (texture2D(tInput, vUv + o).rgb + texture2D(tInput, vUv - o).rgb) * w[i];
  }
  gl_FragColor = vec4(c, 1.0);
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
  private readonly bloom: THREE.ShaderMaterial;
  private readonly bloomScene = new THREE.Scene();
  private bloomA!: THREE.WebGLRenderTarget;
  private bloomB!: THREE.WebGLRenderTarget;
  private scale = 1; // dynamic resolution: 1 is the quality preset's full size

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private quality: Quality = "hd",
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
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
        smoothLook: { value: 0 },
        aoStrength: { value: 0 },
        tBloom: { value: null },
        bloomStrength: { value: 0 },
        projScale: { value: new THREE.Vector2(1, 1) },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post));
    this.bloom = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: BLOOM_FRAG,
      uniforms: { tInput: { value: null }, texel: { value: new THREE.Vector2() }, dir: { value: new THREE.Vector2() }, threshold: { value: 0 } },
      depthTest: false,
      depthWrite: false,
    });
    this.bloomScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.bloom));

    this.applyLook();
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
    this.applyLook();
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
      else if (m) m.needsUpdate = true;
    });
    this.resize();
  }

  /** Shadows, shading ramp, texture filtering and canvas scaling for the current quality. */
  private applyLook() {
    const smooth = is3d(this.quality);
    const ultra = this.quality === "ultra";
    this.renderer.shadowMap.enabled = smooth || this.quality === "hd";
    this.renderer.shadowMap.type = smooth ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.post.uniforms.smoothLook.value = smooth ? 1 : 0;
    this.post.uniforms.aoStrength.value = ultra ? 0.9 : 0;
    this.post.uniforms.bloomStrength.value = ultra ? 0.8 : 0;
    this.canvas.classList.toggle("smooth", smooth);
    setSmoothLook(smooth, this.renderer.capabilities.getMaxAnisotropy());
  }

  resize() {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    const ih = window.innerHeight;
    const smooth = is3d(this.quality);
    // 3D: native resolution (up to 2x on high-DPI screens). Retro: chunky pixels. Sharp: twice the detail. HD: close to native, smoother colour steps.
    const h = Math.round(
      this.scale *
      (smooth
        ? Math.min(1600, ih * Math.min(2, window.devicePixelRatio || 1))
        : this.quality === "retro"
        ? Math.min(300, Math.max(200, ih / 3.2))
        : this.quality === "sharp"
          ? Math.min(540, Math.max(360, ih / 1.8))
          : Math.min(1080, Math.max(540, ih * 0.9))),
    );
    this.post.uniforms.levels.value = { ultra: 32, smooth: 32, retro: 8, sharp: 11, hd: 18 }[this.quality];
    const w = Math.max(1, Math.round(h * aspect));
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    const pm = this.camera.projectionMatrix.elements;
    this.post.uniforms.projScale.value.set(pm[0], pm[5]);

    this.target?.dispose();
    this.normalTarget?.dispose();
    const depthTexture = new THREE.DepthTexture(w, h);
    const filter = smooth ? THREE.LinearFilter : THREE.NearestFilter;
    const opts = { minFilter: filter, magFilter: filter, samples: smooth ? 4 : 0 };
    this.target = new THREE.WebGLRenderTarget(w, h, { ...opts, depthTexture });
    this.normalTarget = new THREE.WebGLRenderTarget(w, h, opts);
    this.post.uniforms.tColor.value = this.target.texture;
    this.post.uniforms.tDepth.value = depthTexture;
    this.post.uniforms.tNormal.value = this.normalTarget.texture;
    this.post.uniforms.resolution.value.set(w, h);

    this.bloomA?.dispose();
    this.bloomB?.dispose();
    const bw = Math.max(1, Math.round(w / 4)), bh = Math.max(1, Math.round(h / 4));
    const bopts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, type: THREE.HalfFloatType };
    this.bloomA = new THREE.WebGLRenderTarget(bw, bh, bopts);
    this.bloomB = new THREE.WebGLRenderTarget(bw, bh, bopts);
    this.bloom.uniforms.texel.value.set(1 / bw, 1 / bh);
    this.post.uniforms.tBloom.value = this.bloomA.texture;
  }

  private bloomPass(input: THREE.Texture, out: THREE.WebGLRenderTarget, dir: [number, number], threshold = 0) {
    const u = this.bloom.uniforms;
    u.tInput.value = input;
    u.dir.value.set(...dir);
    u.threshold.value = threshold;
    this.renderer.setRenderTarget(out);
    this.renderer.render(this.bloomScene, this.postCamera);
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

    if (this.quality === "ultra") {
      // The first pass reads the full image with 1.5-texel steps, so nothing small is missed.
      this.bloom.uniforms.texel.value.set(1 / this.target.width, 1 / this.target.height);
      this.bloomPass(this.target.texture, this.bloomA, [0, 0], 0.86);
      this.bloom.uniforms.texel.value.set(1 / this.bloomA.width, 1 / this.bloomA.height);
      for (const spread of [1, 2]) {
        this.bloomPass(this.bloomA.texture, this.bloomB, [spread, 0]);
        this.bloomPass(this.bloomB.texture, this.bloomA, [0, spread]);
      }
    }

    r.setRenderTarget(null);
    r.render(this.postScene, this.postCamera);
  }
}

// Light ramp shared by every toon material: shadow, mid, lit. Hard bands in the pixel looks;
// in 3D the bands blend into soft, cartoon-style shading.
let ramp: THREE.DataTexture | null = null;
function toonRamp(): THREE.DataTexture {
  if (!ramp) {
    ramp = new THREE.DataTexture(new Uint8Array([90, 165, 255]), 3, 1, THREE.RedFormat);
    filterSmooth(ramp, false);
  }
  return ramp;
}

/** Surface textures painted as pixel art. In 3D they stay crisp up close but blend smoothly into
 * the distance (mipmaps + anisotropy) instead of shimmering. */
const surfaceTextures = new Set<THREE.Texture>();
let look = { smooth: false, aniso: 1 };
export function surfaceTexture<T extends THREE.Texture>(tex: T): T {
  surfaceTextures.add(tex);
  filterSmooth(tex, true);
  return tex;
}

function filterSmooth(tex: THREE.Texture, mipmaps: boolean) {
  tex.magFilter = look.smooth && !mipmaps ? THREE.LinearFilter : THREE.NearestFilter;
  tex.minFilter = look.smooth ? (mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter) : THREE.NearestFilter;
  tex.generateMipmaps = look.smooth && mipmaps;
  tex.anisotropy = look.smooth && mipmaps ? look.aniso : 1;
  tex.needsUpdate = true;
}

function setSmoothLook(smooth: boolean, maxAniso: number) {
  look = { smooth, aniso: Math.min(8, maxAniso) };
  if (ramp) filterSmooth(ramp, false);
  for (const tex of surfaceTextures) filterSmooth(tex, true);
}

export function toon(color: THREE.ColorRepresentation, extra: THREE.MeshToonMaterialParameters = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonRamp(), ...extra });
}

/** Put a sprite (and its children) on the sprite layer. */
export function spriteLayer<T extends THREE.Object3D>(obj: T): T {
  obj.traverse((o) => o.layers.set(SPRITE_LAYER));
  return obj;
}
