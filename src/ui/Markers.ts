import * as THREE from 'three';
import { CHECKPOINTS } from '../world/CityLayout';

/**
 * World-space objective markers: a tall light beacon (visible over rooftops)
 * and driving-mission checkpoint gates. No screen-space HUD needed in VR.
 */
export class Markers {
  readonly group = new THREE.Group();
  private readonly beacon: THREE.Group;
  private readonly beamMat: THREE.MeshBasicMaterial;
  private readonly diamond: THREE.Mesh;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly gates = new Map<string, { group: THREE.Group; mat: THREE.MeshBasicMaterial; arrow: THREE.Mesh }>();
  private time = 0;
  private readonly beam: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private baseY = 3.2;

  constructor() {
    this.group.name = 'Markers';
    this.beacon = new THREE.Group();
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0x3dffb0, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 60, 16, 1, true), this.beamMat);
    beam.position.y = 30;
    this.beam = beam;
    this.diamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.45), new THREE.MeshBasicMaterial({ color: 0x3dffb0, toneMapped: false }));
    this.diamond.position.y = 3.2;
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0x3dffb0, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 1.85, 40), this.ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    this.ring = ring;
    this.beacon.add(beam, this.diamond, ring);
    this.beacon.visible = false;
    this.group.add(this.beacon);

    for (const cp of CHECKPOINTS) {
      const g = new THREE.Group();
      g.position.set(cp.x, 0, cp.z);
      g.rotation.y = cp.yaw;
      const mat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
      const torus = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.18, 8, 40), mat);
      torus.position.y = 3.2;
      const posts = new THREE.Mesh(new THREE.BoxGeometry(8.8, 0.15, 0.15), mat);
      posts.position.y = 0.1;
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.4, 4), mat);
      arrow.rotation.x = -Math.PI / 2;
      arrow.position.set(0, 3.2, 0);
      g.add(torus, posts, arrow);
      g.visible = false;
      this.group.add(g);
      this.gates.set(cp.id, { group: g, mat, arrow });
    }
  }

  /**
   * Shows the objective beacon. Far away it is a tall light beam visible over
   * rooftops; close up (near = true) only a small diamond floats above the target
   * so it never fills the view in VR.
   */
  setBeacon(pos: THREE.Vector3 | null, near = false, color = 0x3dffb0): void {
    this.beacon.visible = pos !== null;
    if (!pos) return;
    this.beacon.position.set(pos.x, 0, pos.z);
    this.beamMat.color.setHex(color);
    this.ringMat.color.setHex(color);
    (this.diamond.material as THREE.MeshBasicMaterial).color.setHex(color);
    this.beam.visible = !near;
    this.ring.visible = !near;
    this.diamond.scale.setScalar(near ? 0.3 : 1);
    this.baseY = near ? pos.y + 0.45 : Math.max(2.4, pos.y + 1.2);
  }

  showCheckpoints(ids: string[] | null): void {
    for (const [id, g] of this.gates) g.group.visible = !!ids && ids.includes(id);
  }

  setNextCheckpoint(id: string | null, afterId: string | null): void {
    for (const [gid, g] of this.gates) {
      const next = gid === id;
      g.mat.color.setHex(next ? 0xffd23f : 0x8a7a3a);
      g.mat.opacity = next ? 0.75 : afterId === gid ? 0.35 : 0.15;
      g.arrow.visible = next;
    }
  }

  update(dt: number): void {
    this.time += dt;
    this.diamond.rotation.y += dt * 1.6;
    this.diamond.position.y = this.baseY + Math.sin(this.time * 2.4) * 0.06 * this.diamond.scale.y;
    this.beamMat.opacity = 0.18 + Math.sin(this.time * 3) * 0.05;
  }
}
