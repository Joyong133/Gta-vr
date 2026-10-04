import * as THREE from 'three';
import { makeRng } from '../core/math';

/**
 * Procedural canvas textures. No external image files are required, so the
 * project runs fully offline and every asset is original.
 */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

function tex(c: HTMLCanvasElement, srgb = true, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/**
 * Facade with windows. One texture tile = 2 window columns x 2 floors (4 m x 7 m).
 * Returns the albedo map and an emissive map containing only lit windows.
 */
export function makeFacadeTextures(seed: number, warmBias: number): { map: THREE.Texture; emissive: THREE.Texture } {
  const S = 256;
  const [c, x] = canvas(S, S);
  const [ce, xe] = canvas(S, S);
  const rng = makeRng(seed);
  x.fillStyle = '#9a9aa8';
  x.fillRect(0, 0, S, S);
  // subtle panel lines
  x.fillStyle = 'rgba(0,0,0,0.12)';
  for (let i = 0; i < S; i += 32) x.fillRect(0, i, S, 2);
  xe.fillStyle = '#000';
  xe.fillRect(0, 0, S, S);
  const cols = 4;
  const rows = 4;
  const cw = S / cols;
  const rh = S / rows;
  const warm = ['#ffd38a', '#ffc46b', '#ffe6b0', '#ffb36b'];
  const cool = ['#9fd8ff', '#c2b8ff', '#8affe5', '#ff9fe0'];
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const wx = k * cw + cw * 0.18;
      const wy = r * rh + rh * 0.22;
      const ww = cw * 0.64;
      const wh = rh * 0.52;
      x.fillStyle = '#1c2230';
      x.fillRect(wx, wy, ww, wh);
      const lit = rng() < 0.42;
      if (lit) {
        const col = rng() < warmBias ? warm[Math.floor(rng() * warm.length)] : cool[Math.floor(rng() * cool.length)];
        const g = xe.createLinearGradient(0, wy, 0, wy + wh);
        g.addColorStop(0, col);
        g.addColorStop(1, shade(col, 0.55));
        xe.fillStyle = g;
        xe.fillRect(wx, wy, ww, wh);
        // blinds / silhouettes
        if (rng() < 0.4) {
          xe.fillStyle = 'rgba(0,0,0,0.45)';
          xe.fillRect(wx + ww * rng() * 0.6, wy + wh * 0.35, ww * 0.25, wh * 0.65);
        }
        x.fillStyle = '#3a3f4f';
        x.fillRect(wx, wy, ww, wh);
      } else {
        // dark glass reflection streak
        x.fillStyle = 'rgba(120,140,190,0.18)';
        x.fillRect(wx + ww * 0.1, wy, ww * 0.12, wh);
      }
      x.fillStyle = '#6d6f7c';
      x.fillRect(wx - 2, wy + wh, ww + 4, 4); // sill
    }
  }
  return { map: tex(c), emissive: tex(ce) };
}

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return `rgb(${r},${g},${b})`;
}

export function makeAsphaltTexture(): THREE.Texture {
  const S = 256;
  const [c, x] = canvas(S, S);
  x.fillStyle = '#2a2b31';
  x.fillRect(0, 0, S, S);
  const rng = makeRng(7);
  for (let i = 0; i < 5000; i++) {
    const v = 30 + Math.floor(rng() * 40);
    x.fillStyle = `rgb(${v},${v},${v + 4})`;
    x.fillRect(rng() * S, rng() * S, 1 + rng() * 2, 1 + rng() * 2);
  }
  // cracks / patches
  x.strokeStyle = 'rgba(15,15,18,0.6)';
  x.lineWidth = 1.5;
  for (let i = 0; i < 6; i++) {
    x.beginPath();
    let px = rng() * S;
    let py = rng() * S;
    x.moveTo(px, py);
    for (let k = 0; k < 6; k++) {
      px += (rng() - 0.5) * 40;
      py += (rng() - 0.5) * 40;
      x.lineTo(px, py);
    }
    x.stroke();
  }
  return tex(c);
}

export function makeSidewalkTexture(): THREE.Texture {
  const S = 256;
  const [c, x] = canvas(S, S);
  x.fillStyle = '#6b6a70';
  x.fillRect(0, 0, S, S);
  const rng = makeRng(11);
  const tile = 64;
  for (let r = 0; r < S / tile; r++) {
    for (let k = 0; k < S / tile; k++) {
      const v = 95 + Math.floor(rng() * 25);
      x.fillStyle = `rgb(${v},${v - 2},${v + 4})`;
      x.fillRect(k * tile + 2, r * tile + 2, tile - 4, tile - 4);
    }
  }
  for (let i = 0; i < 1500; i++) {
    x.fillStyle = `rgba(0,0,0,${rng() * 0.15})`;
    x.fillRect(rng() * S, rng() * S, 2, 2);
  }
  return tex(c);
}

export function makePlazaTexture(): THREE.Texture {
  const S = 256;
  const [c, x] = canvas(S, S);
  x.fillStyle = '#4a4552';
  x.fillRect(0, 0, S, S);
  const t = 32;
  for (let r = 0; r < S / t; r++) {
    for (let k = 0; k < S / t; k++) {
      const alt = (r + k) % 2 === 0;
      x.fillStyle = alt ? '#6e6474' : '#5b5463';
      x.fillRect(k * t + 1, r * t + 1, t - 2, t - 2);
    }
  }
  return tex(c);
}

export function makeTileFloorTexture(): THREE.Texture {
  const S = 128;
  const [c, x] = canvas(S, S);
  x.fillStyle = '#c9ccd6';
  x.fillRect(0, 0, S, S);
  x.fillStyle = '#e6e8ef';
  x.fillRect(2, 2, 60, 60);
  x.fillRect(66, 66, 60, 60);
  x.fillStyle = '#b8bccb';
  x.fillRect(66, 2, 60, 60);
  x.fillRect(2, 66, 60, 60);
  return tex(c);
}

export function makeGrassTexture(): THREE.Texture {
  const S = 128;
  const [c, x] = canvas(S, S);
  x.fillStyle = '#1f3a24';
  x.fillRect(0, 0, S, S);
  const rng = makeRng(5);
  for (let i = 0; i < 1800; i++) {
    const g = 50 + Math.floor(rng() * 50);
    x.fillStyle = `rgb(${20 + Math.floor(rng() * 20)},${g},${30 + Math.floor(rng() * 15)})`;
    x.fillRect(rng() * S, rng() * S, 1, 2 + rng() * 2);
  }
  return tex(c);
}

/** Radial glow sprite (light pools, halos). White - tint with material colour. */
export function makeGlowTexture(): THREE.Texture {
  const S = 128;
  const [c, x] = canvas(S, S);
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  return tex(c, true, false);
}

/** Neon sign: glowing tube text on a transparent background. */
export function makeNeonSignTexture(
  text: string,
  color: string,
  opts: { sub?: string; color2?: string; vertical?: boolean } = {},
): { texture: THREE.Texture; aspect: number } {
  const font = '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';
  if (opts.vertical) {
    const chars = text.replace(/ /g, '').split('');
    const W = 128;
    const H = 110 * chars.length + 40;
    const [c, x] = canvas(W, H);
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.font = `800 92px ${font}`;
    chars.forEach((ch, i) => glowText(x, ch, W / 2, 60 + i * 110, color));
    const t = tex(c, true, false);
    return { texture: t, aspect: W / H };
  }
  const W = 1024;
  const H = opts.sub ? 320 : 220;
  const [c, x] = canvas(W, H);
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  let size = 150;
  x.font = `800 ${size}px ${font}`;
  while (x.measureText(text).width > W - 80 && size > 40) {
    size -= 6;
    x.font = `800 ${size}px ${font}`;
  }
  // frame tube
  x.lineWidth = 8;
  x.strokeStyle = opts.color2 ?? color;
  x.shadowColor = opts.color2 ?? color;
  x.shadowBlur = 24;
  x.globalAlpha = 0.85;
  x.strokeRect(14, 14, W - 28, H - 28);
  x.globalAlpha = 1;
  glowText(x, text, W / 2, opts.sub ? H * 0.38 : H / 2, color);
  if (opts.sub) {
    x.font = `700 ${Math.round(size * 0.6)}px ${font}`;
    glowText(x, opts.sub, W / 2, H * 0.76, opts.color2 ?? '#ffffff');
  }
  const t = tex(c, true, false);
  return { texture: t, aspect: W / H };
}

function glowText(x: CanvasRenderingContext2D, s: string, px: number, py: number, color: string): void {
  x.shadowColor = color;
  x.shadowBlur = 40;
  x.fillStyle = color;
  x.fillText(s, px, py);
  x.shadowBlur = 16;
  x.fillText(s, px, py);
  x.shadowBlur = 0;
  x.fillStyle = 'rgba(255,255,255,0.85)';
  x.fillText(s, px, py);
}

/** Simple label texture (store signage, terminals). */
export function makeLabelTexture(text: string, bg: string, fg: string, w = 512, h = 128): THREE.Texture {
  const [c, x] = canvas(w, h);
  x.fillStyle = bg;
  x.fillRect(0, 0, w, h);
  x.fillStyle = fg;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = `700 ${Math.round(h * 0.5)}px system-ui, sans-serif`;
  x.fillText(text, w / 2, h / 2);
  return tex(c, true, false);
}

/** Lit shop window strip (ground-floor storefronts), tiles horizontally every 4 m. */
export function makeStorefrontTexture(): THREE.Texture {
  const W = 256;
  const H = 128;
  const [c, x] = canvas(W, H);
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#ffcf8a');
  g.addColorStop(0.6, '#ff9e6b');
  g.addColorStop(1, '#6b3a4a');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  // shelves / silhouettes inside
  const rng = makeRng(23);
  for (let i = 0; i < 14; i++) {
    x.fillStyle = `rgba(40,20,40,${0.25 + rng() * 0.3})`;
    x.fillRect(rng() * W, H * (0.35 + rng() * 0.3), 8 + rng() * 30, H * 0.4);
  }
  // mullions + awning band
  x.fillStyle = '#1a1520';
  for (let i = 0; i <= W; i += W / 2) x.fillRect(i - 4, 0, 8, H);
  x.fillRect(0, 0, W, 10);
  x.fillRect(0, H - 8, W, 8);
  return tex(c);
}
