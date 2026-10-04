/**
 * Hand-authored layout of the NEON DISTRICT vertical slice (300 m x 300 m).
 * Pure data: no rendering here, so missions / AI / tests can share it.
 *
 *          z = -150 (north)
 *   +------------------------------------------+
 *   |  boundary towers                          |
 *   |   NW: plaza + dispatch  | NE: VOLT gas +  |
 *   |   (mission giver, car)  |     NEON 24     |
 *   |-------- road z=0 -------+-----------------|
 *   |   SW: safehouse garage  | SE: precinct 7  |
 *   |   KAI RAMEN (delivery)  |     impound lot |
 *   +------------------------------------------+
 *   roads at x/z = -110, 0, 110 (12 m wide, right-hand traffic)
 */

export const CITY = {
  worldHalf: 150,
  boundary: 148,
  roadLines: [-110, 0, 110] as const,
  roadHalfWidth: 6,
  laneOffset: 3,
  sidewalkWidth: 4,
  speedLimit: 11,
} as const;

export type BuildingStyle = 'tower' | 'mid' | 'low' | 'shop';

export interface BuildingDef {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  height: number;
  style: BuildingStyle;
  /** Optional neon sign mounted on a facade. */
  sign?: SignDef;
}

export interface SignDef {
  text: string;
  sub?: string;
  color: string;
  color2?: string;
  /** Facade the sign is mounted on. */
  face: 'n' | 's' | 'e' | 'w';
  /** Height of the sign centre. */
  y: number;
  width: number;
  vertical?: boolean;
  flicker?: boolean;
}

export const BLOCKS = {
  nw: { minX: -100, minZ: -100, maxX: -10, maxZ: -10 },
  ne: { minX: 10, minZ: -100, maxX: 100, maxZ: -10 },
  sw: { minX: -100, minZ: 10, maxX: -10, maxZ: 100 },
  se: { minX: 10, minZ: 10, maxX: 100, maxZ: 100 },
} as const;

export const BUILDINGS: BuildingDef[] = [
  // ---- NW block (plaza)
  { minX: -100, minZ: -100, maxX: -78, maxZ: -70, height: 38, style: 'tower', sign: { text: 'HOTEL ORBIT', color: '#7af7ff', face: 's', y: 30, width: 4, vertical: true } },
  { minX: -76, minZ: -100, maxX: -56, maxZ: -74, height: 22, style: 'mid', sign: { text: 'CYBER CAFE', color: '#41ff9d', face: 's', y: 9, width: 10 } },
  { minX: -54, minZ: -100, maxX: -36, maxZ: -70, height: 28, style: 'mid' },
  { minX: -34, minZ: -100, maxX: -10, maxZ: -76, height: 18, style: 'mid', sign: { text: 'NOODLE BAR', sub: '국수', color: '#ffb347', face: 'e', y: 6, width: 9 } },
  { minX: -100, minZ: -68, maxX: -80, maxZ: -40, height: 16, style: 'low' },
  { minX: -100, minZ: -38, maxX: -80, maxZ: -10, height: 12, style: 'low', sign: { text: 'MOTEL LUNA', color: '#c77dff', color2: '#ff6ad5', face: 'e', y: 8, width: 11, flicker: true } },
  { minX: -32, minZ: -72, maxX: -10, maxZ: -42, height: 14, style: 'shop', sign: { text: 'KARAOKE', sub: '노래방', color: '#ff4fd8', face: 'w', y: 6.5, width: 9 } },
  // ---- NE block (gas station + store; store itself is built separately as an interior)
  { minX: 10, minZ: -100, maxX: 32, maxZ: -66, height: 30, style: 'tower' },
  { minX: 34, minZ: -100, maxX: 62, maxZ: -72, height: 46, style: 'tower', sign: { text: 'DRIVE THE NIGHT', color: '#ff3d6e', color2: '#ffd23f', face: 's', y: 26, width: 18 } },
  { minX: 64, minZ: -100, maxX: 100, maxZ: -74, height: 24, style: 'mid' },
  { minX: 10, minZ: -62, maxX: 36, maxZ: -46, height: 12, style: 'shop', sign: { text: 'PHARMACY', sub: '약국 +', color: '#3dffb0', face: 's', y: 6, width: 9 } },
  { minX: 38, minZ: -68, maxX: 62, maxZ: -44, height: 18, style: 'mid' },
  { minX: 64, minZ: -70, maxX: 100, maxZ: -46, height: 20, style: 'mid' },
  { minX: 64, minZ: -40, maxX: 100, maxZ: -12, height: 14, style: 'shop', sign: { text: 'LUCKY 8 ARCADE', color: '#ffe14d', color2: '#45ff7a', face: 's', y: 8, width: 14, flicker: true } },
  // ---- SW block (safehouse + delivery)
  { minX: -100, minZ: 12, maxX: -74, maxZ: 46, height: 20, style: 'mid' },
  { minX: -72, minZ: 12, maxX: -40, maxZ: 36, height: 16, style: 'mid' },
  { minX: -100, minZ: 52, maxX: -80, maxZ: 72, height: 9, style: 'shop', sign: { text: 'KAI RAMEN', sub: '카이 라멘', color: '#ff5a36', color2: '#ffd1a3', face: 'w', y: 6.2, width: 10 } },
  { minX: -100, minZ: 76, maxX: -72, maxZ: 100, height: 26, style: 'mid' },
  { minX: -70, minZ: 76, maxX: -40, maxZ: 100, height: 32, style: 'tower' },
  { minX: -38, minZ: 70, maxX: -10, maxZ: 100, height: 22, style: 'mid' },
  { minX: -60, minZ: 44, maxX: -36, maxZ: 66, height: 14, style: 'low' },
  { minX: -32, minZ: 40, maxX: -10, maxZ: 62, height: 18, style: 'mid', sign: { text: 'LAUNDRY 24', color: '#8ab4ff', face: 'e', y: 6, width: 9 } },
  // ---- SE block (precinct + impound)
  { minX: 10, minZ: 12, maxX: 38, maxZ: 40, height: 16, style: 'mid' },
  { minX: 40, minZ: 12, maxX: 70, maxZ: 36, height: 22, style: 'mid', sign: { text: 'SOUL FOOD', color: '#ff8c42', face: 'n', y: 7, width: 10 } },
  { minX: 72, minZ: 12, maxX: 100, maxZ: 40, height: 28, style: 'tower' },
  { minX: 10, minZ: 48, maxX: 38, maxZ: 74, height: 12, style: 'low' },
  { minX: 72, minZ: 42, maxX: 100, maxZ: 62, height: 18, style: 'mid' },
  { minX: 10, minZ: 78, maxX: 40, maxZ: 100, height: 20, style: 'mid' },
  { minX: 72, minZ: 64, maxX: 100, maxZ: 100, height: 12, style: 'low', sign: { text: 'PRECINCT 7', color: '#4d8bff', color2: '#ffffff', face: 'w', y: 8, width: 12 } },
];

/** Safehouse garage shell (built with an opening + roll-up door). */
export const GARAGE = { minX: -34, minZ: 14, maxX: -12, maxZ: 32, height: 6, doorZ0: 19.5, doorZ1: 26.5, doorHeight: 3.4 };
/** NEON 24 convenience store shell (enterable). Door on the south wall. */
export const STORE = { minX: 42, minZ: -36, maxX: 60, maxZ: -18, height: 5, doorX0: 50.1, doorX1: 51.9 };
/** VOLT gas station forecourt. */
export const GAS = { minX: 12, minZ: -40, maxX: 40, maxZ: -12, canopyY: 5.2 };
/** Impound lot fence (gate on the north side). */
export const IMPOUND = { minX: 44, minZ: 56, maxX: 70, maxZ: 80, gateX0: 53, gateX1: 61 };
export const PLAZA = { minX: -78, minZ: -68, maxX: -34, maxZ: -14, fountainX: -56, fountainZ: -42 };

export interface Zone {
  id: string;
  kind: 'circle' | 'box';
  x: number;
  z: number;
  r?: number;
  minX?: number;
  maxX?: number;
  minZ?: number;
  maxZ?: number;
  label: string;
}

export const ZONES: Zone[] = [
  { id: 'store_front', kind: 'circle', x: 51, z: -14.5, r: 4.5, label: 'NEON 24 앞' },
  { id: 'store_inside', kind: 'box', x: 51, z: -27, minX: STORE.minX, maxX: STORE.maxX, minZ: STORE.minZ, maxZ: STORE.maxZ, label: 'NEON 24 내부' },
  { id: 'kai_ramen', kind: 'circle', x: -104, z: 62, r: 7, label: 'KAI RAMEN 배송함' },
  { id: 'impound', kind: 'box', x: 57, z: 68, minX: IMPOUND.minX, maxX: IMPOUND.maxX, minZ: IMPOUND.minZ, maxZ: IMPOUND.maxZ, label: '압류 차량 보관소' },
  { id: 'safehouse', kind: 'box', x: -23, z: 23, minX: GARAGE.minX, maxX: GARAGE.maxX, minZ: GARAGE.minZ, maxZ: GARAGE.maxZ, label: '은신처 차고' },
  { id: 'plaza', kind: 'circle', x: -56, z: -42, r: 24, label: '디스패치 광장' },
];

export function zoneById(id: string): Zone | undefined {
  return ZONES.find((z) => z.id === id);
}

export function isInZone(zone: Zone, x: number, z: number): boolean {
  if (zone.kind === 'circle') return (x - zone.x) ** 2 + (z - zone.z) ** 2 <= (zone.r ?? 0) ** 2;
  return x >= (zone.minX ?? 0) && x <= (zone.maxX ?? 0) && z >= (zone.minZ ?? 0) && z <= (zone.maxZ ?? 0);
}

export interface SpawnPoint {
  id: string;
  x: number;
  z: number;
  yaw: number;
}

export const SPAWNS: Record<string, SpawnPoint> = {
  plaza: { id: 'plaza', x: -52, z: -18, yaw: 0 },
  safehouse: { id: 'safehouse', x: -22, z: 23, yaw: -Math.PI / 2 },
  store: { id: 'store', x: 51, z: -12, yaw: 0 },
  precinct: { id: 'precinct', x: 62, z: 103, yaw: 0 },
};

export const PLAYER_CAR_SPAWN = { x: -20, z: -24, yaw: Math.PI };

export const MISSION_GIVER = { id: 'mika', name: 'MIKA', x: -45, z: -25 };

/** Ordered checkpoints for the driving mission (yaw = direction of travel). */
export const CHECKPOINTS: { id: string; x: number; z: number; yaw: number }[] = [
  { id: 'cp1', x: -60, z: 3, yaw: -Math.PI / 2 },
  { id: 'cp2', x: 50, z: 3, yaw: -Math.PI / 2 },
  { id: 'cp3', x: 113, z: -50, yaw: 0 },
  { id: 'cp4', x: 50, z: -113, yaw: Math.PI / 2 },
  { id: 'cp5', x: -50, z: -113, yaw: Math.PI / 2 },
  { id: 'cp6', x: -113, z: -50, yaw: Math.PI },
  { id: 'cp7', x: -113, z: 50, yaw: Math.PI },
  { id: 'cp8', x: -50, z: 113, yaw: -Math.PI / 2 },
  { id: 'cp9', x: 3, z: 60, yaw: 0 },
];

/** Where mission items rest when spawned. */
export const ITEM_SPAWNS: Record<string, { x: number; y: number; z: number }> = {
  package_m1: { x: 45.6, y: 1.16, z: -26.8 },
  datachip_m3: { x: 57, y: 0.98, z: 70 },
};

/** Sockets (drop targets) referenced by mission data. */
export const SOCKETS: Record<string, { x: number; y: number; z: number; r: number; label: string }> = {
  kai_dropbox: { x: -100.7, y: 0.95, z: 62, r: 0.6, label: 'KAI RAMEN 배송함' },
};

/** Pedestrian walking loops (sidewalk centre lines + plaza). */
export function pedestrianRoutes(): { x: number; z: number }[][] {
  const routes: { x: number; z: number }[][] = [];
  for (const b of Object.values(BLOCKS)) {
    routes.push([
      { x: b.minX - 2, z: b.minZ - 2 },
      { x: b.maxX + 2, z: b.minZ - 2 },
      { x: b.maxX + 2, z: b.maxZ + 2 },
      { x: b.minX - 2, z: b.maxZ + 2 },
    ]);
  }
  routes.push([
    { x: -70, z: -60 },
    { x: -42, z: -60 },
    { x: -40, z: -30 },
    { x: -60, z: -22 },
    { x: -72, z: -34 },
  ]);
  routes.push([
    { x: 14, z: -12 },
    { x: 40, z: -12 },
    { x: 60, z: -14 },
    { x: 62, z: -8 },
    { x: 12, z: -8 },
  ]);
  return routes;
}

/** On-foot officer patrol (plaza <-> store). */
export const OFFICER_PATROL = [
  { x: -40, z: -8 },
  { x: -8, z: -8 },
  { x: 8, z: -8 },
  { x: 40, z: -8 },
  { x: 8, z: -8 },
  { x: -8, z: -8 },
];

export const POLICE_PARKING = [
  { x: 52, z: 92, yaw: Math.PI },
  { x: 62, z: 92, yaw: Math.PI },
];
