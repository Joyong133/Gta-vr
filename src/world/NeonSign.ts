import * as THREE from 'three';
import { makeNeonSignTexture } from './Textures';

let glowTex: THREE.Texture | null = null;

function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

/**
 * A neon sign: an unlit textured plane plus a soft additive halo behind it.
 * Real lights are not used (cost); the halo + emissive look sells the glow.
 */
export class NeonSign {
  readonly group = new THREE.Group();
  private readonly signMat: THREE.MeshBasicMaterial;
  private readonly haloMat: THREE.MeshBasicMaterial;
  private flickerTimer = Math.random() * 5;
  private flickerOff = 0;

  constructor(
    text: string,
    color: string,
    width: number,
    opts: { sub?: string; color2?: string; vertical?: boolean; flicker?: boolean } = {},
  ) {
    const { texture, aspect } = makeNeonSignTexture(text, color, opts);
    const height = width / aspect;
    this.signMat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(width, height), this.signMat);
    sign.renderOrder = 5;
    this.haloMat = new THREE.MeshBasicMaterial({
      map: glowTexture(),
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(width * 1.5, height * 2.2), this.haloMat);
    halo.position.z = -0.05;
    halo.renderOrder = 4;
    // Backing board so the sign reads in daylight-ish dusk.
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(width * 1.02, height * 1.02, 0.06),
      new THREE.MeshLambertMaterial({ color: 0x0b0b12 }),
    );
    board.position.z = -0.08;
    this.group.add(board, halo, sign);
    this.flicker = opts.flicker ?? false;
  }

  flicker: boolean;

  update(dt: number): void {
    if (!this.flicker) return;
    this.flickerTimer -= dt;
    if (this.flickerOff > 0) {
      this.flickerOff -= dt;
      if (this.flickerOff <= 0) this.setOn(true);
    } else if (this.flickerTimer <= 0) {
      this.flickerTimer = 3 + Math.random() * 6;
      this.flickerOff = 0.06 + Math.random() * 0.12;
      this.setOn(false);
    }
  }

  private setOn(on: boolean): void {
    this.signMat.opacity = on ? 1 : 0.25;
    this.haloMat.opacity = on ? 0.55 : 0.08;
  }
}
