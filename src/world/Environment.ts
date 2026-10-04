import * as THREE from 'three';
import type { GraphicsQuality } from '../config/settings';
import { makeRng } from '../core/math';

/**
 * Dusk atmosphere: gradient sky dome with a low sun, stars, fog,
 * hemisphere fill and a single shadow-casting sun whose shadow camera
 * follows the player (shadow distance is limited on purpose).
 */
export class Environment {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sky: THREE.Mesh;
  private readonly sunDir = new THREE.Vector3(-0.75, 0.16, 0.42).normalize();
  private shadowSize = 45;

  constructor(scene: THREE.Scene) {
    scene.background = new THREE.Color(0x2a1838);
    scene.fog = new THREE.FogExp2(0x4a2a52, 0.0068);

    this.hemi = new THREE.HemisphereLight(0x8a7ad8, 0x3a2420, 1.35);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xff9a5a, 2.1);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun);
    scene.add(this.sun.target);

    const ambient = new THREE.AmbientLight(0x40305a, 0.6);
    scene.add(ambient);

    this.sky = this.buildSky();
    scene.add(this.sky);
    scene.add(this.buildStars());
  }

  setQuality(q: GraphicsQuality, renderer: THREE.WebGLRenderer): void {
    renderer.shadowMap.enabled = q !== 'low';
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.sun.castShadow = q !== 'low';
    const size = q === 'high' ? 2048 : 1024;
    this.shadowSize = q === 'high' ? 60 : 40;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    const cam = this.sun.shadow.camera;
    cam.left = -this.shadowSize;
    cam.right = this.shadowSize;
    cam.top = this.shadowSize;
    cam.bottom = -this.shadowSize;
    cam.near = 1;
    cam.far = 260;
    cam.updateProjectionMatrix();
  }

  /** Keeps the shadow frustum centred on the player (snapped to texels to avoid shimmer). */
  update(focus: THREE.Vector3): void {
    const texel = (this.shadowSize * 2) / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx - this.sunDir.x * -120, this.sunDir.y * 120, fz - this.sunDir.z * -120);
    this.sky.position.set(focus.x, 0, focus.z);
  }

  private buildSky(): THREE.Mesh {
    const geo = new THREE.SphereGeometry(420, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uSunDir: { value: this.sunDir.clone() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir;
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, -0.2, 1.0);
          vec3 zenith = vec3(0.07, 0.05, 0.20);
          vec3 mid = vec3(0.36, 0.15, 0.40);
          vec3 horizon = vec3(0.95, 0.42, 0.33);
          vec3 col = mix(horizon, mid, smoothstep(0.0, 0.25, h));
          col = mix(col, zenith, smoothstep(0.2, 0.75, h));
          float s = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
          col += vec3(1.0, 0.55, 0.25) * pow(s, 18.0) * 0.9;
          col += vec3(1.0, 0.8, 0.5) * pow(s, 400.0) * 2.0;
          // haze band near the ground
          col = mix(col, vec3(0.30, 0.17, 0.32), smoothstep(0.02, -0.15, h));
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -10;
    mesh.name = 'Sky';
    return mesh;
  }

  private buildStars(): THREE.Points {
    const rng = makeRng(77);
    const n = 600;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = rng() * Math.PI * 2;
      const v = 0.25 + rng() * 0.75;
      const r = 400;
      const y = v * r;
      const rr = Math.sqrt(r * r - y * y);
      pos[i * 3] = Math.cos(u) * rr;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = Math.sin(u) * rr;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const p = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, sizeAttenuation: false, transparent: true, opacity: 0.7, fog: false, depthWrite: false }));
    p.frustumCulled = false;
    p.renderOrder = -9;
    return p;
  }
}
