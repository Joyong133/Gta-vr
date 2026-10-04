import { BUILDINGS, CITY, GARAGE, IMPOUND, PLAZA, STORE, ZONES } from '../world/CityLayout';

export interface MapState {
  playerX: number;
  playerZ: number;
  playerYaw: number;
  target: { x: number; z: number } | null;
  police: { x: number; z: number; pursuing: boolean }[];
  search: { x: number; z: number; r: number } | null;
  car: { x: number; z: number } | null;
  checkpoints: { x: number; z: number; next: boolean }[];
  giver: { x: number; z: number } | null;
}

/** North-up map of the district, rendered into any 2D context (wrist menu). */
export class Minimap {
  private readonly bg: HTMLCanvasElement;
  readonly size = 600;
  private readonly scale: number;

  constructor() {
    this.scale = this.size / (CITY.worldHalf * 2);
    this.bg = document.createElement('canvas');
    this.bg.width = this.size;
    this.bg.height = this.size;
    const c = this.bg.getContext('2d')!;
    c.fillStyle = '#141626';
    c.fillRect(0, 0, this.size, this.size);
    // Roads
    c.fillStyle = '#3b3f5c';
    const hw = CITY.roadHalfWidth;
    for (const l of CITY.roadLines) {
      this.rect(c, -116, l - hw, 116, l + hw);
      this.rect(c, l - hw, -116, l + hw, 116);
    }
    // Buildings
    c.fillStyle = '#2a2d45';
    for (const b of BUILDINGS) this.rect(c, b.minX, b.minZ, b.maxX, b.maxZ);
    c.fillStyle = '#4a2a52';
    this.rect(c, PLAZA.minX, PLAZA.minZ, PLAZA.maxX, PLAZA.maxZ);
    c.fillStyle = '#1f6b5a';
    this.rect(c, STORE.minX, STORE.minZ, STORE.maxX, STORE.maxZ);
    c.fillStyle = '#2a5a4a';
    this.rect(c, GARAGE.minX, GARAGE.minZ, GARAGE.maxX, GARAGE.maxZ);
    c.strokeStyle = '#6a6f8f';
    c.lineWidth = 1.5;
    const [ix, iz] = this.toMap(IMPOUND.minX, IMPOUND.minZ);
    c.strokeRect(ix, iz, (IMPOUND.maxX - IMPOUND.minX) * this.scale, (IMPOUND.maxZ - IMPOUND.minZ) * this.scale);
    c.font = '600 13px system-ui, sans-serif';
    c.fillStyle = '#9fb0d0';
    c.textAlign = 'center';
    for (const z of ZONES) {
      if (z.id === 'store_inside') continue;
      const [x, y] = this.toMap(z.x, z.z);
      c.fillText(z.label, x, y - 6);
    }
  }

  private toMap(x: number, z: number): [number, number] {
    return [(x + CITY.worldHalf) * this.scale, (z + CITY.worldHalf) * this.scale];
  }

  private rect(c: CanvasRenderingContext2D, x0: number, z0: number, x1: number, z1: number): void {
    const [a, b] = this.toMap(x0, z0);
    c.fillRect(a, b, (x1 - x0) * this.scale, (z1 - z0) * this.scale);
  }

  draw(c: CanvasRenderingContext2D, ox: number, oy: number, s: MapState, time: number): void {
    c.save();
    c.translate(ox, oy);
    c.drawImage(this.bg, 0, 0);
    if (s.search) {
      const [x, y] = this.toMap(s.search.x, s.search.z);
      c.beginPath();
      c.arc(x, y, s.search.r * this.scale, 0, Math.PI * 2);
      c.fillStyle = 'rgba(255, 61, 110, 0.18)';
      c.fill();
      c.strokeStyle = 'rgba(255, 61, 110, 0.7)';
      c.lineWidth = 2;
      c.stroke();
    }
    for (const cp of s.checkpoints) {
      const [x, y] = this.toMap(cp.x, cp.z);
      c.beginPath();
      c.arc(x, y, cp.next ? 8 : 5, 0, Math.PI * 2);
      c.fillStyle = cp.next ? '#ffd23f' : 'rgba(255,210,63,0.4)';
      c.fill();
    }
    if (s.giver) {
      const [x, y] = this.toMap(s.giver.x, s.giver.z);
      c.fillStyle = '#ff9a3d';
      c.font = '800 22px system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText('!', x, y + 8);
    }
    if (s.car) {
      const [x, y] = this.toMap(s.car.x, s.car.z);
      c.fillStyle = '#3df5ff';
      c.fillRect(x - 6, y - 4, 12, 8);
    }
    for (const p of s.police) {
      const [x, y] = this.toMap(p.x, p.z);
      const blink = Math.floor(time * 4) % 2 === 0;
      c.beginPath();
      c.arc(x, y, 6, 0, Math.PI * 2);
      c.fillStyle = p.pursuing ? (blink ? '#ff3d6e' : '#4d8bff') : '#4d8bff';
      c.fill();
    }
    if (s.target) {
      const [x, y] = this.toMap(s.target.x, s.target.z);
      c.beginPath();
      c.arc(x, y, 10 + Math.sin(time * 5) * 2, 0, Math.PI * 2);
      c.strokeStyle = '#3dffb0';
      c.lineWidth = 4;
      c.stroke();
    }
    // Player arrow
    const [px, py] = this.toMap(s.playerX, s.playerZ);
    c.translate(px, py);
    // Map is north-up (-Z up): yaw 0 faces up.
    c.rotate(-s.playerYaw);
    c.beginPath();
    c.moveTo(0, -12);
    c.lineTo(8, 9);
    c.lineTo(0, 4);
    c.lineTo(-8, 9);
    c.closePath();
    c.fillStyle = '#ffffff';
    c.fill();
    c.restore();
  }
}
