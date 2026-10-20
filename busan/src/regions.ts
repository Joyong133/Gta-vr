/**
 * 지역 자동 등록: busan/regions/<지역>/region.json 이 있으면 목록에 나온다.
 * 에셋(.glb/.bin)은 번들에 넣지 않고 페이지 기준 regions/ 폴더에서 그대로 받는다
 * (VITE_REGION_BASE로 바꿀 수 있음 — 브랜치 그대로 서비스되는 busan/play/ 는 ../regions/).
 *
 * 좌표: 모든 지역이 부산 공통 원점(region.json의 origin) 기준 미터 좌표를 쓴다.
 *   지도 좌표 (x=동, y=북, z=위)  ↔  three.js (x, y=위, z=남)
 */
export interface FacadeParams {
  bay: number;
  floor: number;
  wx: [number, number];
  wy: [number, number];
  glass: [number, number, number];
  wall_rough: number;
}

export interface MaterialInfo {
  color: [number, number, number];
  roughness: number;
  facade?: FacadeParams;
}

export interface Spawn {
  name: string;
  x: number;
  y: number;
  /** 바라보는 방위각(도): 0=북, 90=동 */
  yaw: number;
  mode: 'walk' | 'fly';
  /** fly일 때 지면 위 시작 고도(m) */
  z: number;
}

export interface HeightInfo {
  file: string;
  x0: number;
  y0: number;
  step: number;
  nx: number;
  ny: number;
  scale: number;
}

export interface RegionInfo {
  id: string;
  name: string;
  subtitle: string;
  origin: [number, number];
  rect: [number, number, number, number];
  height: HeightInfo;
  files: Record<string, string>;
  materials: Record<string, MaterialInfo>;
  spawns: Spawn[];
  stats: Record<string, number>;
  attribution: string;
  /** 에셋 캐시 무효화용(내보낸 시각) */
  version?: number;
}

export interface Region extends RegionInfo {
  /** region.json의 files 값(파일 이름) → 배포된 URL */
  url(file: string): string;
}

const infos = import.meta.glob<RegionInfo>('../regions/*/region.json', { eager: true, import: 'default' });
const REGION_BASE: string = import.meta.env.VITE_REGION_BASE ?? './regions/';

export function listRegions(): Region[] {
  const base = new URL(REGION_BASE, document.baseURI);
  return Object.values(infos)
    .map((info) => ({
      ...info,
      url(file: string): string {
        const u = new URL(`${encodeURIComponent(info.id)}/${file}`, base);
        if (info.version) u.searchParams.set('v', String(info.version));
        return u.href;
      },
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
