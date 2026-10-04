import * as THREE from 'three';
import { tuning } from '../config/tuning';
import { CanvasPanel } from '../ui/CanvasPanel';

const _head = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _target = new THREE.Vector3();

/**
 * Debug text: DOM <pre> on desktop, a lazily-following world panel in VR.
 * Also draws world-space helpers (police sight lines, last known position,
 * search radius) and hosts the desktop tuning panel (F4).
 */
export class DebugOverlay {
  enabled = false;
  private readonly dom = document.getElementById('debug');
  private readonly tuningEl = document.getElementById('tuning');
  readonly panel: CanvasPanel;
  private lines: string[] = [];
  private timer = 0;
  xr = false;
  // World helpers
  readonly helpers = new THREE.Group();
  private readonly sightGeo: THREE.BufferGeometry;
  private readonly sightPos: Float32Array;
  private readonly sightCol: Float32Array;
  private readonly lkp: THREE.Mesh;
  private readonly searchRing: THREE.Line;
  private tuningBuilt = false;

  constructor(
    scene: THREE.Scene,
    private readonly camera: THREE.Camera,
  ) {
    this.panel = new CanvasPanel(900, 1100, 0.55, { depthTest: false });
    this.panel.mesh.renderOrder = 950;
    this.panel.mesh.visible = false;
    scene.add(this.panel.mesh);
    this.panel.draw = (ctx) => {
      ctx.fillStyle = 'rgba(0,0,0,0.78)';
      ctx.fillRect(0, 0, 900, 1100);
      ctx.fillStyle = '#b8ffd9';
      ctx.font = '22px ui-monospace, Menlo, monospace';
      this.lines.slice(0, 44).forEach((l, i) => ctx.fillText(l, 14, 30 + i * 24));
    };

    this.sightPos = new Float32Array(16 * 6);
    this.sightCol = new Float32Array(16 * 6);
    this.sightGeo = new THREE.BufferGeometry();
    this.sightGeo.setAttribute('position', new THREE.BufferAttribute(this.sightPos, 3));
    this.sightGeo.setAttribute('color', new THREE.BufferAttribute(this.sightCol, 3));
    const sight = new THREE.LineSegments(this.sightGeo, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
    sight.frustumCulled = false;
    sight.renderOrder = 960;
    this.lkp = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff00ff, transparent: true, opacity: 0.5, depthWrite: false }));
    const ringPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      ringPts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
    }
    this.searchRing = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPts), new THREE.LineBasicMaterial({ color: 0xff3d6e }));
    this.helpers.add(sight, this.lkp, this.searchRing);
    this.helpers.visible = false;
    scene.add(this.helpers);
  }

  toggle(): void {
    this.enabled = !this.enabled;
    this.dom?.classList.toggle('hidden', !this.enabled || this.xr);
    this.helpers.visible = this.enabled;
  }

  setXR(xr: boolean): void {
    this.xr = xr;
    this.dom?.classList.toggle('hidden', !this.enabled || xr);
  }

  setLines(lines: string[]): void {
    this.lines = lines;
  }

  /** Police sight lines: [x0,y0,z0,x1,y1,z1, sees] */
  setSight(segments: { ax: number; ay: number; az: number; bx: number; by: number; bz: number; sees: boolean }[]): void {
    const n = Math.min(16, segments.length);
    for (let i = 0; i < 16; i++) {
      const s = segments[i];
      const o = i * 6;
      if (i < n && s) {
        this.sightPos.set([s.ax, s.ay, s.az, s.bx, s.by, s.bz], o);
        const c = s.sees ? [1, 0.2, 0.3] : [0.4, 0.4, 0.5];
        this.sightCol.set([...c, ...c], o);
      } else {
        this.sightPos.fill(0, o, o + 6);
      }
    }
    (this.sightGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.sightGeo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  setSearch(lkp: { x: number; z: number; r: number } | null): void {
    this.lkp.visible = !!lkp;
    this.searchRing.visible = !!lkp;
    if (!lkp) return;
    this.lkp.position.set(lkp.x, 4, lkp.z);
    this.searchRing.position.set(lkp.x, 0.3, lkp.z);
    this.searchRing.scale.setScalar(Math.max(1, lkp.r));
  }

  update(dt: number): void {
    if (!this.enabled) {
      this.panel.mesh.visible = false;
      return;
    }
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.25;
    if (!this.xr) {
      if (this.dom) this.dom.textContent = this.lines.join('\n');
      this.panel.mesh.visible = false;
    } else {
      this.panel.mesh.visible = true;
      this.panel.markDirty();
      this.panel.refresh();
      this.camera.getWorldPosition(_head);
      this.camera.getWorldDirection(_fwd);
      _fwd.y = 0;
      _fwd.normalize();
      _right.set(-_fwd.z, 0, _fwd.x);
      _target.copy(_head).addScaledVector(_fwd, 1.3).addScaledVector(_right, -0.7);
      this.panel.mesh.position.lerp(_target, this.panel.mesh.position.lengthSq() === 0 ? 1 : 0.5);
      this.panel.mesh.lookAt(_head);
    }
  }

  /** Desktop tuning panel: live-edit numeric values in config/tuning.ts. */
  toggleTuning(): void {
    if (!this.tuningEl) return;
    if (!this.tuningBuilt) this.buildTuning();
    this.tuningEl.classList.toggle('hidden');
  }

  private buildTuning(): void {
    const el = this.tuningEl!;
    this.tuningBuilt = true;
    el.innerHTML = '<b>Tuning (live)</b>';
    for (const [section, values] of Object.entries(tuning)) {
      const h = document.createElement('h4');
      h.textContent = section;
      el.appendChild(h);
      for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
        if (typeof value !== 'number') continue;
        const label = document.createElement('label');
        label.textContent = key;
        const input = document.createElement('input');
        input.type = 'number';
        input.step = 'any';
        input.value = String(value);
        input.addEventListener('change', () => {
          const v = parseFloat(input.value);
          if (Number.isFinite(v)) (values as Record<string, number>)[key] = v;
        });
        input.addEventListener('keydown', (e) => e.stopPropagation());
        label.appendChild(input);
        el.appendChild(label);
      }
    }
  }
}
