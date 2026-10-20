/**
 * Quest에서 가볍게 돌아가는 재질들. Blender 재질 이름(region.json materials)과 1:1로 대응한다.
 * - 정점 색(Ground, Roof, Facade, Tower_Glass)은 Blender에서 미리 구워 둔 값
 * - 창문은 텍스처 없이 벽 UV로 그린다: Blender에서 u = 벽 둘레를 따라 잰 거리(m), v = 바닥에서 높이(m)
 *   (glTF는 v를 뒤집어 저장하므로 높이 = 1 - uv.y)
 */
import * as THREE from 'three';
import type { FacadeParams, MaterialInfo } from './regions';

export const SUN_DIR = new THREE.Vector3(-0.29, 0.53, 0.8).normalize(); // 남남서 고도 32°
export const SKY_TOP = new THREE.Color().setRGB(0.18, 0.36, 0.72, THREE.LinearSRGBColorSpace);
export const SKY_HORIZON = new THREE.Color().setRGB(0.62, 0.72, 0.84, THREE.LinearSRGBColorSpace);
const SUN_COLOR = new THREE.Color().setRGB(1.0, 0.92, 0.8, THREE.LinearSRGBColorSpace);

function linear(c: [number, number, number]): THREE.Color {
  return new THREE.Color().setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace);
}

/** 창문 격자. 멀어지면(픽셀보다 촘촘해지면) 평균색으로 바뀌어 VR에서 반짝이지 않는다. */
export function facadeMaterial(p: FacadeParams): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.name = 'facade';
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uBay = { value: p.bay };
    shader.uniforms.uFloor = { value: p.floor };
    shader.uniforms.uWin = { value: new THREE.Vector4(p.wx[0], p.wx[1], p.wy[0], p.wy[1]) };
    shader.uniforms.uGlass = { value: linear(p.glass) };
    shader.uniforms.uSky = { value: SKY_HORIZON };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWall;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWall = vec2(uv.x, 1.0 - uv.y);');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vWall;
uniform float uBay;
uniform float uFloor;
uniform vec4 uWin;
uniform vec3 uGlass;
uniform vec3 uSky;
float winMask;
float winRand;
float band(float f, float lo, float hi, float w) {
  return smoothstep(lo - w, lo + w, f) - smoothstep(hi - w, hi + w, f);
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  // 지붕은 UV가 (0,0) → 창문 띠 밖이라 자동으로 빠진다. 1층(1.2m 아래)도 뺀다
  float wall = step(1.2, vWall.y);
  float u = vWall.x / uBay;
  float h = vWall.y / uFloor;
  float wu = fwidth(u);
  float wh = fwidth(h);
  float m = band(fract(u), uWin.x, uWin.y, wu) * band(fract(h), uWin.z, uWin.w, wh);
  float cover = (uWin.y - uWin.x) * (uWin.w - uWin.z);
  float far = clamp(max(wu, wh) * 2.0 - 0.4, 0.0, 1.0);
  winMask = wall * mix(m, cover, far);
  winRand = fract(sin(dot(floor(vec2(u, h)), vec2(12.9898, 78.233))) * 43758.5453);
  vec3 glass = uGlass * (0.8 + 1.2 * winRand * (1.0 - far));
  diffuseColor.rgb = mix(diffuseColor.rgb, glass, winMask);
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  vec3 V = normalize(vViewPosition);
  float fres = pow(1.0 - abs(dot(normal, V)), 3.0);
  totalEmissiveRadiance += uSky * winMask * (0.02 + 0.16 * fres);
}`,
      );
  };
  m.customProgramCacheKey = () => `facade:${p.bay}:${p.floor}`;
  return m;
}

/** 바다/강: 하늘 반사(프레넬) + 잔물결 + 햇빛 반짝임. 조명 계산 없이 한 번에 칠한다. */
export function waterMaterial(deep: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'water',
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uDeep: { value: deep },
        uSky: { value: SKY_TOP },
        uHorizon: { value: SKY_HORIZON },
        uSunDir: { value: SUN_DIR },
        uSunColor: { value: SUN_COLOR },
        uTime: { value: 0 },
      },
    ]),
    vertexShader: `
#include <common>
#include <fog_pars_vertex>
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uDeep;
uniform vec3 uSky;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uTime;
varying vec3 vW;
void main() {
  vec3 toCam = cameraPosition - vW;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec2 p = vW.xz;
  float t = uTime;
  // 물결은 가까울수록만: 멀리서 촘촘한 사인파가 줄무늬(모아레)로 보이지 않게 거리·각도로 줄인다
  float graze = max(V.y, 0.05);
  float a1 = 0.05 * clamp(1.0 - dist * 0.0004 / graze, 0.0, 1.0);
  float a2 = 0.03 * clamp(1.0 - dist * 0.0015 / graze, 0.0, 1.0);
  vec3 n = normalize(vec3(
    a1 * (sin(p.x * 0.05 + t * 0.7) + 0.7 * sin(p.y * 0.083 - t * 1.1)) + a2 * sin((p.x + p.y) * 0.21 + t * 1.7),
    1.0,
    a1 * (cos(p.y * 0.047 + t * 0.6) + 0.7 * cos(p.x * 0.091 + t * 0.9)) + a2 * cos((p.x - p.y) * 0.19 - t * 1.5)));
  float fres = 0.03 + 0.62 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec3 R = reflect(-V, n);
  vec3 sky = mix(uHorizon, uSky, clamp(R.y * 2.5, 0.0, 1.0));
  vec3 col = mix(uDeep, sky, fres);
  col += uSunColor * pow(max(dot(R, uSunDir), 0.0), 300.0) * 3.0;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`,
  });
}

/** 하늘 돔: 카메라를 따라다니는 큰 구. 지평선 → 천정 그라데이션 + 해. */
export function skyMesh(radius: number): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    name: 'sky',
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uTop: { value: SKY_TOP }, uHorizon: { value: SKY_HORIZON }, uSunDir: { value: SUN_DIR }, uSun: { value: SUN_COLOR } },
    vertexShader: `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p;
}`,
    fragmentShader: `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSun;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float k = pow(clamp(d.y, 0.0, 1.0), 0.45);
  vec3 col = mix(uHorizon, uTop, k);
  col = mix(col, uHorizon * 0.9, clamp(-d.y * 4.0, 0.0, 1.0));
  float s = max(dot(d, uSunDir), 0.0);
  col += uSun * (pow(s, 1500.0) * 8.0 + pow(s, 40.0) * 0.15);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), mat);
  mesh.name = 'Sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

/** Blender 재질 이름 → three 재질. 같은 이름은 한 번만 만든다. */
export class MaterialLibrary {
  private readonly cache = new Map<string, THREE.Material>();
  readonly water = waterMaterial(new THREE.Color().setRGB(0.008, 0.04, 0.055, THREE.LinearSRGBColorSpace));
  private readonly river = waterMaterial(new THREE.Color().setRGB(0.02, 0.05, 0.045, THREE.LinearSRGBColorSpace));

  constructor(private readonly table: Record<string, MaterialInfo>) {}

  get(name: string): THREE.Material {
    let m = this.cache.get(name);
    if (!m) {
      m = this.make(name);
      this.cache.set(name, m);
    }
    return m;
  }

  private make(name: string): THREE.Material {
    const info = this.table[name];
    if (info?.facade) return facadeMaterial(info.facade);
    if (name === 'River' || name === 'Sea') return this.river;
    if (name === 'Ground' || name === 'Roof') return new THREE.MeshLambertMaterial({ vertexColors: true, name });
    const m = new THREE.MeshLambertMaterial({ color: info ? linear(info.color) : 0x888888, name });
    // 도로·차선·해변은 지형 위 수십 cm라 멀리서 깊이 값이 겹친다 → 앞으로 당겨 그린다
    if (/^(Asphalt|Sidewalk|Railbed|Paint|Sand)/.test(name)) {
      m.polygonOffset = true;
      m.polygonOffsetFactor = name === 'Paint' ? -4 : -2;
      m.polygonOffsetUnits = name === 'Paint' ? -8 : -4;
    }
    return m;
  }

  tick(t: number): void {
    (this.water.uniforms.uTime as { value: number }).value = t;
    (this.river.uniforms.uTime as { value: number }).value = t;
  }
}
