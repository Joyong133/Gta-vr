import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** One face of a box footprint: 's' = maxZ, 'n' = minZ, 'e' = maxX, 'w' = minX. */
export type WallSide = 'n' | 's' | 'e' | 'w';

/**
 * Accumulates quads (with explicit UVs + vertex colours) into a single
 * BufferGeometry. Used for facades, roofs and ground so the whole city is a
 * handful of draw calls.
 */
export class QuadBatch {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly uv: number[] = [];
  private readonly col: number[] = [];
  private readonly idx: number[] = [];

  /** Adds a quad from 4 corners (counter-clockwise when seen from the front). */
  quad(
    a: THREE.Vector3Like,
    b: THREE.Vector3Like,
    c: THREE.Vector3Like,
    d: THREE.Vector3Like,
    n: THREE.Vector3Like,
    uvs: [number, number, number, number, number, number, number, number],
    color: THREE.Color,
  ): void {
    const base = this.pos.length / 3;
    for (const p of [a, b, c, d]) this.pos.push(p.x, p.y, p.z);
    for (let i = 0; i < 4; i++) {
      this.nrm.push(n.x, n.y, n.z);
      this.col.push(color.r, color.g, color.b);
    }
    this.uv.push(...uvs);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Horizontal rectangle at height y with world-space UVs (uvScale metres per tile). */
  floor(minX: number, minZ: number, maxX: number, maxZ: number, y: number, uvScale: number, color: THREE.Color): void {
    const s = 1 / uvScale;
    this.quad(
      { x: minX, y, z: maxZ },
      { x: maxX, y, z: maxZ },
      { x: maxX, y, z: minZ },
      { x: minX, y, z: minZ },
      { x: 0, y: 1, z: 0 },
      [minX * s, -maxZ * s, maxX * s, -maxZ * s, maxX * s, -minZ * s, minX * s, -minZ * s],
      color,
    );
  }

  /**
   * Four outward-facing walls of a box footprint with facade UVs (tileW x tileH metres).
   * `skip` leaves one face out (e.g. to rebuild it with `wallWithOpening`).
   */
  walls(minX: number, minZ: number, maxX: number, maxZ: number, y0: number, y1: number, tileW: number, tileH: number, color: THREE.Color, skip?: WallSide): void {
    const v0 = y0 / tileH;
    const v1 = y1 / tileH;
    const wx = (maxX - minX) / tileW;
    const wz = (maxZ - minZ) / tileW;
    // south (+Z)
    if (skip !== 's') this.quad({ x: minX, y: y0, z: maxZ }, { x: maxX, y: y0, z: maxZ }, { x: maxX, y: y1, z: maxZ }, { x: minX, y: y1, z: maxZ }, { x: 0, y: 0, z: 1 }, [0, v0, wx, v0, wx, v1, 0, v1], color);
    // north (-Z)
    if (skip !== 'n') this.quad({ x: maxX, y: y0, z: minZ }, { x: minX, y: y0, z: minZ }, { x: minX, y: y1, z: minZ }, { x: maxX, y: y1, z: minZ }, { x: 0, y: 0, z: -1 }, [0, v0, wx, v0, wx, v1, 0, v1], color);
    // east (+X)
    if (skip !== 'e') this.quad({ x: maxX, y: y0, z: maxZ }, { x: maxX, y: y0, z: minZ }, { x: maxX, y: y1, z: minZ }, { x: maxX, y: y1, z: maxZ }, { x: 1, y: 0, z: 0 }, [0, v0, wz, v0, wz, v1, 0, v1], color);
    // west (-X)
    if (skip !== 'w') this.quad({ x: minX, y: y0, z: minZ }, { x: minX, y: y0, z: maxZ }, { x: minX, y: y1, z: maxZ }, { x: minX, y: y1, z: minZ }, { x: -1, y: 0, z: 0 }, [0, v0, wz, v0, wz, v1, 0, v1], color);
  }

  /** Inward-facing walls (interiors). `skip` leaves one face out, as in `walls`. */
  innerWalls(minX: number, minZ: number, maxX: number, maxZ: number, y0: number, y1: number, tile: number, color: THREE.Color, skip?: WallSide): void {
    const v1 = (y1 - y0) / tile;
    const wx = (maxX - minX) / tile;
    const wz = (maxZ - minZ) / tile;
    if (skip !== 's') this.quad({ x: maxX, y: y0, z: maxZ }, { x: minX, y: y0, z: maxZ }, { x: minX, y: y1, z: maxZ }, { x: maxX, y: y1, z: maxZ }, { x: 0, y: 0, z: -1 }, [0, 0, wx, 0, wx, v1, 0, v1], color);
    if (skip !== 'n') this.quad({ x: minX, y: y0, z: minZ }, { x: maxX, y: y0, z: minZ }, { x: maxX, y: y1, z: minZ }, { x: minX, y: y1, z: minZ }, { x: 0, y: 0, z: 1 }, [0, 0, wx, 0, wx, v1, 0, v1], color);
    if (skip !== 'e') this.quad({ x: maxX, y: y0, z: minZ }, { x: maxX, y: y0, z: maxZ }, { x: maxX, y: y1, z: maxZ }, { x: maxX, y: y1, z: minZ }, { x: -1, y: 0, z: 0 }, [0, 0, wz, 0, wz, v1, 0, v1], color);
    if (skip !== 'w') this.quad({ x: minX, y: y0, z: maxZ }, { x: minX, y: y0, z: minZ }, { x: minX, y: y1, z: minZ }, { x: minX, y: y1, z: maxZ }, { x: 1, y: 0, z: 0 }, [0, 0, wz, 0, wz, v1, 0, v1], color);
  }

  /**
   * Vertical wall face with a doorway cut out: the quads left and right of the
   * opening plus the lintel above it. `axis` is the direction the wall runs
   * ('x': plane z = c, 'z': plane x = c), [a0, a1] its extent along that axis,
   * [o0, o1] x [y0, oTop] the opening and `facing` the sign of the face normal
   * (+1 = +Z for an 'x' wall, +X for a 'z' wall). UVs are world-space (tile metres).
   */
  wallWithOpening(axis: 'x' | 'z', c: number, a0: number, a1: number, y0: number, y1: number, o0: number, o1: number, oTop: number, facing: 1 | -1, tile: number, color: THREE.Color): void {
    this.vquad(axis, c, a0, o0, y0, y1, facing, tile, color);
    this.vquad(axis, c, o1, a1, y0, y1, facing, tile, color);
    this.vquad(axis, c, o0, o1, oTop, y1, facing, tile, color);
  }

  /**
   * Lines a doorway through a wall whose thickness spans [c0, c1] across it
   * (along Z for an 'x' wall, along X for a 'z' wall): two jambs facing into the
   * opening [o0, o1] and a downward soffit at oTop, so the hollow between the
   * outer and inner faces never shows through the opening.
   */
  doorReveal(axis: 'x' | 'z', c0: number, c1: number, o0: number, o1: number, y0: number, oTop: number, tile: number, color: THREE.Color): void {
    const across = axis === 'x' ? 'z' : 'x';
    this.vquad(across, o0, c0, c1, y0, oTop, 1, tile, color);
    this.vquad(across, o1, c0, c1, y0, oTop, -1, tile, color);
    const minX = axis === 'x' ? o0 : c0;
    const maxX = axis === 'x' ? o1 : c1;
    const minZ = axis === 'x' ? c0 : o0;
    const maxZ = axis === 'x' ? c1 : o1;
    const s = 1 / tile;
    this.quad(
      { x: minX, y: oTop, z: minZ },
      { x: maxX, y: oTop, z: minZ },
      { x: maxX, y: oTop, z: maxZ },
      { x: minX, y: oTop, z: maxZ },
      { x: 0, y: -1, z: 0 },
      [minX * s, minZ * s, maxX * s, minZ * s, maxX * s, maxZ * s, minX * s, maxZ * s],
      color,
    );
  }

  /** Axis-aligned vertical quad (see `wallWithOpening` for the parameters). Skips degenerate spans. */
  private vquad(axis: 'x' | 'z', c: number, a0: number, a1: number, y0: number, y1: number, facing: 1 | -1, tile: number, color: THREE.Color): void {
    if (a1 - a0 < 1e-4 || y1 - y0 < 1e-4) return;
    // Seen from the front, the left edge sits at a1 for +X / -Z normals and at a0 otherwise.
    const flip = axis === 'x' ? facing < 0 : facing > 0;
    const l = flip ? a1 : a0;
    const r = flip ? a0 : a1;
    const s = (flip ? -1 : 1) / tile;
    const vb = y0 / tile;
    const vt = y1 / tile;
    const uvs: [number, number, number, number, number, number, number, number] = [l * s, vb, r * s, vb, r * s, vt, l * s, vt];
    if (axis === 'x') {
      this.quad({ x: l, y: y0, z: c }, { x: r, y: y0, z: c }, { x: r, y: y1, z: c }, { x: l, y: y1, z: c }, { x: 0, y: 0, z: facing }, uvs, color);
    } else {
      this.quad({ x: c, y: y0, z: l }, { x: c, y: y0, z: r }, { x: c, y: y1, z: r }, { x: c, y: y1, z: l }, { x: facing, y: 0, z: 0 }, uvs, color);
    }
  }

  get empty(): boolean {
    return this.pos.length === 0;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/**
 * Accumulates primitive geometries (boxes, cylinders...) with a per-piece
 * vertex colour, then merges them into one geometry.
 */
export class PrimitiveBatch {
  private readonly parts: THREE.BufferGeometry[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();

  add(geo: THREE.BufferGeometry, x: number, y: number, z: number, color: THREE.ColorRepresentation, rotY = 0, rotX = 0, rotZ = 0): void {
    const g = geo.index ? geo : geo;
    this.e.set(rotX, rotY, rotZ);
    this.q.setFromEuler(this.e);
    this.m.compose(this.p.set(x, y, z), this.q, this.s.set(1, 1, 1));
    const clone = g.clone();
    clone.applyMatrix4(this.m);
    const c = new THREE.Color(color);
    const n = clone.getAttribute('position').count;
    const cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      cols[i * 3] = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;
    }
    clone.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    if (!clone.index) {
      const idx: number[] = [];
      for (let i = 0; i < n; i++) idx.push(i);
      clone.setIndex(idx);
    }
    // Keep only the attributes every part shares.
    for (const name of Object.keys(clone.attributes)) {
      if (!['position', 'normal', 'color', 'uv'].includes(name)) clone.deleteAttribute(name);
    }
    if (!clone.getAttribute('uv')) {
      clone.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
    this.parts.push(clone);
  }

  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: THREE.ColorRepresentation, rotY = 0): void {
    this.add(new THREE.BoxGeometry(sx, sy, sz), x, y, z, color, rotY);
  }

  cylinder(x: number, y: number, z: number, r: number, h: number, color: THREE.ColorRepresentation, segs = 10): void {
    this.add(new THREE.CylinderGeometry(r, r, h, segs), x, y, z, color);
  }

  get empty(): boolean {
    return this.parts.length === 0;
  }

  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.parts, false);
    if (!merged) throw new Error('PrimitiveBatch merge failed');
    for (const p of this.parts) p.dispose();
    this.parts.length = 0;
    merged.computeBoundingSphere();
    return merged;
  }
}
