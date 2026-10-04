import * as THREE from 'three';
import type { VignetteLevel } from '../config/settings';
import { clamp01, damp } from '../core/math';

/**
 * Head-locked comfort overlay: a small inverted sphere around the eyes.
 *  - tunnel vignette that narrows the field of view during artificial motion
 *  - full fade used for teleport, entering/exiting vehicles, respawns
 *  - darkening when the real head pushes into a wall (instead of shoving the player)
 * Rendered last with depthTest off so it is never occluded.
 */
export class ComfortOverlay {
  readonly mesh: THREE.Mesh;
  private readonly uniforms = {
    uVignette: { value: 0 },
    uFade: { value: 0 },
    uColor: { value: new THREE.Color(0x000000) },
  };
  private vignetteTarget = 0;
  private vignette = 0;
  private fade = 0;
  private fadeTarget = 0;
  private fadeSpeed = 6;
  private wallFade = 0;
  level: VignetteLevel = 'low';

  constructor(camera: THREE.Camera) {
    const geo = new THREE.SphereGeometry(0.25, 32, 16);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uVignette;
        uniform float uFade;
        uniform vec3 uColor;
        varying vec3 vDir;
        void main() {
          // Angle from the view axis (-Z in camera space).
          float c = dot(vDir, vec3(0.0, 0.0, -1.0));
          float ang = acos(clamp(c, -1.0, 1.0));
          // Strength 0 -> open (no tunnel), 1 -> narrow tunnel.
          float inner = mix(1.2, 0.42, uVignette);
          float outer = inner + 0.32;
          float v = smoothstep(inner, outer, ang) * step(0.001, uVignette);
          float a = max(v, uFade);
          if (a < 0.003) discard;
          gl_FragColor = vec4(uColor, a);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 10_000;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'ComfortOverlay';
    camera.add(this.mesh);
  }

  /** motion: 0..1 how much artificial motion is happening this frame. */
  setMotion(motion: number): void {
    const max = this.level === 'off' ? 0 : this.level === 'low' ? 0.55 : 0.9;
    this.vignetteTarget = clamp01(motion) * max;
  }

  setWallPenetration(amount: number): void {
    this.wallFade = clamp01(amount);
  }

  /** Fades to black; resolves when fully black. */
  fadeOut(seconds = 0.18): Promise<void> {
    this.fadeTarget = 1;
    this.fadeSpeed = 1 / Math.max(0.01, seconds);
    return this.waitFor(() => this.fade >= 0.999);
  }

  fadeIn(seconds = 0.25): Promise<void> {
    this.fadeTarget = 0;
    this.fadeSpeed = 1 / Math.max(0.01, seconds);
    return this.waitFor(() => this.fade <= 0.001);
  }

  get isFading(): boolean {
    return this.fade > 0.001 || this.fadeTarget > 0;
  }

  private waiters: { done: () => boolean; resolve: () => void }[] = [];

  private waitFor(done: () => boolean): Promise<void> {
    return new Promise((resolve) => this.waiters.push({ done, resolve }));
  }

  update(dt: number): void {
    this.vignette = damp(this.vignette, this.vignetteTarget, this.vignetteTarget > this.vignette ? 10 : 4, dt);
    const step = this.fadeSpeed * dt;
    if (this.fade < this.fadeTarget) this.fade = Math.min(this.fadeTarget, this.fade + step);
    else if (this.fade > this.fadeTarget) this.fade = Math.max(this.fadeTarget, this.fade - step);
    this.uniforms.uVignette.value = this.vignette;
    this.uniforms.uFade.value = Math.max(this.fade, this.wallFade * 0.92);
    this.mesh.visible = this.vignette > 0.003 || this.uniforms.uFade.value > 0.003;
    if (this.waiters.length) {
      const pending = this.waiters;
      this.waiters = [];
      for (const w of pending) {
        if (w.done()) w.resolve();
        else this.waiters.push(w);
      }
    }
  }
}
