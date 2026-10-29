import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { edgeStyle, nodeStyle } from "../model.js";
import type { Camera } from "./camera.js";
import type { GraphModel } from "./graph-model.js";
import type { VisualState } from "./visual-state.js";

const SEGMENTS = 14;

/**
 * Shared camera mapping. Positions are world units; the camera is applied in
 * the vertex shader from uniforms, so pan/zoom never touch buffers.
 */
const CAMERA_GLSL = `
uniform vec2 u_center;
uniform float u_zoom;
uniform vec2 u_view;
vec4 toClip(vec2 screen) {
  vec2 clip = screen / (u_view * 0.5);
  return vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

/**
 * Nebula: every node also emits a wide, faint, coloured cloud. One cloud is
 * barely visible; where many entities sit together the clouds add up, so
 * dense regions of the codebase glow like nebulae, tinted by the kinds that
 * dominate them (the hue-preserving tone map keeps that colour instead of
 * bleaching it to white). Purely an emission of real nodes — no decorative
 * particles.
 */
const NEBULA_VS = `
precision highp float;
in vec3 position;
in vec2 a_pos;
in float a_radius;
in vec3 a_color;
in float a_alpha;
${CAMERA_GLSL}
uniform float u_gain;
out vec2 v_p;
out vec3 v_color;
void main() {
  if (a_alpha <= 0.001 || u_gain <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float ext = clamp(a_radius * 10.0 * u_zoom, 14.0, 110.0);
  gl_Position = toClip((a_pos - u_center) * u_zoom + position.xy * ext);
  v_p = position.xy;
  v_color = a_color * a_alpha * u_gain;
}`;

const NEBULA_FS = `
precision highp float;
in vec2 v_p;
in vec3 v_color;
out vec4 outColor;
void main() {
  float d2 = dot(v_p, v_p);
  if (d2 > 1.0) discard;
  float cloud = exp(-d2 * 4.0) * (1.0 - d2);
  outColor = vec4(v_color * cloud, 1.0);
}`;

/**
 * Stars: each entity is a point of emitted light — a small over-exposed core
 * (HDR, > 1.0, so it blooms) inside a coloured point-spread falloff. The core
 * keeps its kind's colour; only a faint white tint marks its centre. Size
 * stays tied to structural level.
 */
const STAR_VS = `
precision highp float;
in vec3 position;
in vec2 a_pos;
in float a_radius;
in float a_minpx;
in vec3 a_color;
in float a_alpha;
in float a_glow;
${CAMERA_GLSL}
uniform float u_pulse;
out vec2 v_p;
out float v_r;
out vec3 v_color;
out float v_intensity;
out float v_selected;
out float v_ext;
void main() {
  if (a_alpha <= 0.001) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  // Same as starRadius() in graph-model.ts: grows with zoom, capped per kind.
  float r = min(max(a_radius * u_zoom * 0.55, a_minpx * 0.6), a_radius * 3.2);
  float selected = step(0.99, a_glow);
  float ext = r * (5.0 + 5.0 * a_glow) + 4.0 + selected * u_pulse * r * 6.0;
  gl_Position = toClip((a_pos - u_center) * u_zoom + position.xy * ext);
  v_p = position.xy * ext;
  v_r = r;
  v_color = a_color;
  v_intensity = a_alpha * (1.0 + 1.6 * a_glow + selected * u_pulse * 1.5);
  v_selected = selected;
  v_ext = ext;
}`;

const STAR_FS = `
precision highp float;
in vec2 v_p;
in float v_r;
in vec3 v_color;
in float v_intensity;
in float v_selected;
in float v_ext;
out vec4 outColor;
void main() {
  float len = length(v_p);
  if (len > v_ext) discard;
  float d = len / v_r;
  float core = exp(-d * d * 1.6);
  float halo = exp(-d * 1.4) * 0.22;
  float scatter = 0.03 / (1.0 + d * d);
  float fade = 1.0 - smoothstep(v_ext * 0.4, v_ext, len);
  vec3 light = mix(v_color, vec3(1.0), core * 0.3) * core * 1.8 + v_color * (halo + scatter) * fade * 1.2;
  // Selection keeps a faint ring so it never depends on brightness alone.
  float ring = v_selected * exp(-pow((len - v_r * 2.6 - 3.0) / 1.2, 2.0)) * 0.9;
  outColor = vec4((light + vec3(ring)) * v_intensity, 1.0);
}`;

const EDGE_VS = `
precision highp float;
in vec3 position;
in vec2 a_p0;
in vec2 a_p1;
in vec2 a_ctrl;
in vec3 a_color;
in float a_alpha;
in float a_width;
${CAMERA_GLSL}
uniform float u_edgeGain;
out float v_t;
out float v_side;
out float v_w;
out vec3 v_color;
out float v_alpha;
void main() {
  if (a_alpha <= 0.001) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float t = position.x;
  float side = position.y;
  vec2 p = mix(mix(a_p0, a_ctrl, t), mix(a_ctrl, a_p1, t), t);
  vec2 tang = 2.0 * (1.0 - t) * (a_ctrl - a_p0) + 2.0 * t * (a_p1 - a_ctrl);
  vec2 nrm = normalize(vec2(-tang.y, tang.x) + vec2(1e-9));
  float w = a_width * 0.5 + 0.7;
  gl_Position = toClip((p - u_center) * u_zoom + nrm * side * w);
  v_t = t;
  v_side = side;
  v_w = w;
  v_color = a_color;
  // Edges collapsed to a few pixels at far zoom fade out instead of becoming noise.
  v_alpha = a_alpha * u_edgeGain * smoothstep(1.5, 8.0, length(a_p1 - a_p0) * u_zoom);
}`;

const EDGE_FS = `
precision highp float;
in float v_t;
in float v_side;
in float v_w;
in vec3 v_color;
in float v_alpha;
out vec4 outColor;
void main() {
  float edge = 1.0 - smoothstep(v_w - 1.0, v_w, abs(v_side) * v_w);
  // Direction: faint at the source, strongest at the target.
  float a = v_alpha * edge * mix(0.2, 1.0, v_t) * 0.3;
  outColor = vec4(v_color * a, 1.0);
}`;

/**
 * Final pass: hue-preserving tone map. Additive light is compressed on
 * luminance only (extended Reinhard) and out-of-gamut colours are scaled
 * down, not clipped per channel — so a region dense with functions glows
 * teal, a mixed region glows in its dominant kind's colour, and nothing
 * bleaches to white the way per-channel ACES does. Then linear → sRGB.
 */
const TONE_MAP_SHADER = {
  uniforms: { tDiffuse: { value: null }, u_exposure: { value: 1 }, u_saturation: { value: 1.12 } },
  vertexShader: `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
  fragmentShader: `
uniform sampler2D tDiffuse;
uniform float u_exposure;
uniform float u_saturation;
varying vec2 vUv;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  vec3 c = max(texture2D(tDiffuse, vUv).rgb * u_exposure, 0.0);
  float l = dot(c, LUMA);
  float white = 2.4;
  float lm = l * (1.0 + l / (white * white)) / (1.0 + l);
  vec3 m = c * (lm / max(l, 1e-5));
  m = mix(vec3(dot(m, LUMA)), m, u_saturation);
  m = max(m, 0.0);
  m /= max(max(max(m.r, m.g), m.b), 1.0);
  gl_FragColor = vec4(toSRGB(m), 1.0);
}`,
};

/**
 * three.js renderer with an HDR pipeline: additive nebula + edges + stars
 * into a half-float target, UnrealBloom, then a hue-preserving tone map.
 * Exposure, bloom and edge strength fall as the camera zooms out, where many
 * entities share each pixel. Graph
 * geometry is uploaded once per model; filters, focus and hover only
 * rewrite the per-instance alpha/glow/width attributes; pan and zoom are
 * uniforms.
 */
export class GraphRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera3 = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly composer: EffectComposer;
  private readonly uniforms = {
    u_center: { value: new THREE.Vector2() },
    u_zoom: { value: 1 },
    u_view: { value: new THREE.Vector2(1, 1) },
    u_pulse: { value: 0 },
    u_gain: { value: 1 },
    u_edgeGain: { value: 1 },
  };
  private readonly bloom: UnrealBloomPass;
  private readonly toneMap: ShaderPass;
  /** Dims crowded graphs at far zoom (1 for small graphs). */
  private crowding = 1;
  private meshes: THREE.Mesh[] = [];
  private nodeAlpha: THREE.InstancedBufferAttribute | undefined;
  private nodeGlow: THREE.InstancedBufferAttribute | undefined;
  private edgeAlpha: THREE.InstancedBufferAttribute | undefined;
  private edgeWidth: THREE.InstancedBufferAttribute | undefined;
  /** Zoom at which the whole project fits; nebula strength is relative to it. */
  private baseZoom = 1;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
    if (!renderer.capabilities.isWebGL2) throw new Error("WebGL2 is not available in this browser.");
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(new THREE.Color("#02030a"), 1);
    this.renderer = renderer;
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera3));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.4, 0.5);
    this.composer.addPass(this.bloom);
    this.toneMap = new ShaderPass(TONE_MAP_SHADER);
    this.composer.addPass(this.toneMap);
  }

  resize(width: number, height: number, dpr: number): void {
    this.dpr = dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(Math.max(1, width), Math.max(1, height), false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(Math.max(1, width), Math.max(1, height));
  }

  setModel(model: GraphModel, baseZoom: number): void {
    this.baseZoom = baseZoom;
    this.crowding = Math.min(1, Math.max(0.5, 1 / Math.sqrt(Math.max(1, model.n / 1500))));
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    const { n, m } = model;
    const pos = new Float32Array(n * 2);
    const radius = new Float32Array(n);
    const minPx = new Float32Array(n);
    const color = new Float32Array(n * 3);
    // THREE.Color converts the sRGB style colours to the linear working space.
    const linear = model.kindNames.map((k) => new THREE.Color(nodeStyle(k).color));
    for (let i = 0; i < n; i += 1) {
      pos[i * 2] = model.x[i]!;
      pos[i * 2 + 1] = model.y[i]!;
      radius[i] = model.radius[i]!;
      minPx[i] = model.minPixels[i]!;
      const c = linear[model.kind[i]!]!;
      color.set([c.r, c.g, c.b], i * 3);
    }
    this.nodeAlpha = dynamic(new Float32Array(n));
    this.nodeGlow = dynamic(new Float32Array(n));

    const quad = (): THREE.InstancedBufferGeometry => {
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3));
      g.setIndex([0, 1, 2, 2, 1, 3]);
      g.setAttribute("a_pos", new THREE.InstancedBufferAttribute(pos, 2));
      g.setAttribute("a_radius", new THREE.InstancedBufferAttribute(radius, 1));
      g.setAttribute("a_color", new THREE.InstancedBufferAttribute(color, 3));
      g.setAttribute("a_alpha", this.nodeAlpha!);
      g.instanceCount = n;
      return g;
    };
    const nebula = quad();
    const stars = quad();
    stars.setAttribute("a_minpx", new THREE.InstancedBufferAttribute(minPx, 1));
    stars.setAttribute("a_glow", this.nodeGlow);

    const edges = new THREE.InstancedBufferGeometry();
    const strip: number[] = [];
    const index: number[] = [];
    for (let s = 0; s <= SEGMENTS; s += 1) strip.push(s / SEGMENTS, -1, 0, s / SEGMENTS, 1, 0);
    for (let s = 0; s < SEGMENTS; s += 1) index.push(s * 2, s * 2 + 1, s * 2 + 2, s * 2 + 2, s * 2 + 1, s * 2 + 3);
    edges.setAttribute("position", new THREE.Float32BufferAttribute(strip, 3));
    edges.setIndex(index);
    const p0 = new Float32Array(m * 2);
    const p1 = new Float32Array(m * 2);
    const ctrl = new Float32Array(m * 2);
    const ecolor = new Float32Array(m * 3);
    const elinear = model.edgeKindNames.map((k) => new THREE.Color(edgeStyle(k).color));
    for (let e = 0; e < m; e += 1) {
      const s = model.source[e]!;
      const t = model.target[e]!;
      p0.set([model.x[s]!, model.y[s]!], e * 2);
      p1.set([model.x[t]!, model.y[t]!], e * 2);
      ctrl.set([model.ctrlX[e]!, model.ctrlY[e]!], e * 2);
      const c = elinear[model.edgeKind[e]!]!;
      ecolor.set([c.r, c.g, c.b], e * 3);
    }
    this.edgeAlpha = dynamic(new Float32Array(m));
    this.edgeWidth = dynamic(new Float32Array(m));
    edges.setAttribute("a_p0", new THREE.InstancedBufferAttribute(p0, 2));
    edges.setAttribute("a_p1", new THREE.InstancedBufferAttribute(p1, 2));
    edges.setAttribute("a_ctrl", new THREE.InstancedBufferAttribute(ctrl, 2));
    edges.setAttribute("a_color", new THREE.InstancedBufferAttribute(ecolor, 3));
    edges.setAttribute("a_alpha", this.edgeAlpha);
    edges.setAttribute("a_width", this.edgeWidth);
    edges.instanceCount = m;

    this.meshes = [this.mesh(nebula, NEBULA_VS, NEBULA_FS, 0), this.mesh(edges, EDGE_VS, EDGE_FS, 1), this.mesh(stars, STAR_VS, STAR_FS, 2)];
    for (const mesh of this.meshes) this.scene.add(mesh);
  }

  setVisualState(state: VisualState): void {
    if (!this.nodeAlpha || !this.nodeGlow || !this.edgeAlpha || !this.edgeWidth) return;
    (this.nodeAlpha.array as Float32Array).set(state.nodeAlpha);
    (this.nodeGlow.array as Float32Array).set(state.nodeGlow);
    (this.edgeAlpha.array as Float32Array).set(state.edgeAlpha);
    (this.edgeWidth.array as Float32Array).set(state.edgeWidth);
    for (const a of [this.nodeAlpha, this.nodeGlow, this.edgeAlpha, this.edgeWidth]) a.needsUpdate = true;
  }

  /** `pulse` in [0,1] briefly flares the selection after it changes. */
  render(camera: Camera, pulse: number): void {
    const u = this.uniforms;
    u.u_center.value.set(camera.cx, camera.cy);
    u.u_zoom.value = camera.zoom;
    u.u_view.value.set(camera.width, camera.height);
    u.u_pulse.value = pulse;
    // The nebula is the far-zoom view of density; it thins out as individual entities resolve.
    const relative = camera.zoom / this.baseZoom;
    u.u_gain.value = 0.09 * (1 - smoothstep(3, 14, relative) * 0.8);
    // Zoomed out, many entities share each pixel and additive light piles up:
    // lower exposure, bloom and edge strength there, full strength when close.
    const near = smoothstep(0.8, 5, relative);
    const far = 1 - near;
    this.toneMap.uniforms["u_exposure"]!.value = (0.6 + 0.6 * near) * (1 - far * (1 - this.crowding));
    this.bloom.strength = 0.22 + 0.28 * near;
    u.u_edgeGain.value = 0.4 + 0.6 * near;
    this.composer.render();
  }

  get pixelRatio(): number {
    return this.dpr;
  }

  private mesh(geometry: THREE.BufferGeometry, vertexShader: string, fragmentShader: string, order: number): THREE.Mesh {
    const material = new THREE.RawShaderMaterial({
      vertexShader,
      fragmentShader,
      glslVersion: THREE.GLSL3,
      uniforms: this.uniforms,
      blending: THREE.AdditiveBlending,
      // Screen-space y is flipped in the vertex shaders, which reverses winding; never cull.
      side: THREE.DoubleSide,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    return mesh;
  }
}

function dynamic(array: Float32Array): THREE.InstancedBufferAttribute {
  const a = new THREE.InstancedBufferAttribute(array, 1);
  a.setUsage(THREE.DynamicDrawUsage);
  return a;
}

function smoothstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
