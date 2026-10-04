import * as THREE from 'three';
import { PrimitiveBatch } from '../world/MeshBatch';
import { makeLabelTexture } from '../world/Textures';
import { WHEEL_LAYOUT } from './VehiclePhysics';

export type CarKind = 'player' | 'traffic' | 'police';

export interface CarVisual {
  root: THREE.Group;
  /** Wheel pivots (position + steer); each has one child spinning about X. */
  wheels: THREE.Object3D[];
  wheelSpins: THREE.Object3D[];
  headMat: THREE.MeshBasicMaterial;
  tailMat: THREE.MeshBasicMaterial;
  lightbar?: { red: THREE.MeshBasicMaterial; blue: THREE.MeshBasicMaterial };
  /** Player only: driver door hinge (rotates about local Y, panel along +X). */
  doorPivot?: THREE.Group;
  doorMeshes?: THREE.Mesh[];
  doorHandleLocal?: THREE.Vector3;
  steeringMount?: THREE.Group;
  steeringSpin?: THREE.Group;
  dashAnchor?: THREE.Group;
  gpsArrow?: THREE.Mesh;
  /** Local eye point for the driver (player car). */
  seatEye: THREE.Vector3;
  passengerSeat: THREE.Vector3;
}

/** Body origin sits ~0.41 m above the ground at rest; all offsets are relative to it. */
export function buildCarModel(kind: CarKind, color: THREE.ColorRepresentation): CarVisual {
  const root = new THREE.Group();
  root.name = `Car_${kind}`;
  const body = new PrimitiveBatch();
  const paint = new THREE.Color(color);
  const dark = '#15161c';
  const trim = '#2a2c36';
  const glassCol = '#1d2433';
  const police = kind === 'police';
  const doorCol = police ? '#e9ebf2' : paint;

  if (kind === 'player') {
    // Hollow cabin so the driver sees a real interior.
    body.box(0, 0.09, -1.47, 1.84, 0.6, 1.42, paint); // hood block
    body.box(0, 0.09, 1.72, 1.84, 0.6, 0.92, paint); // trunk block
    body.box(0.86, 0.09, 0.24, 0.12, 0.6, 2.0, paint); // passenger side sill/door
    body.box(-0.86, -0.12, 0.24, 0.12, 0.18, 2.0, paint); // driver sill under door
    body.box(0, -0.16, 0.24, 1.6, 0.1, 2.0, '#22232b'); // cabin floor
    body.box(0, 0.36, -0.79, 1.84, 0.06, 0.08, trim); // cowl
    // Open-top roadster: a low windshield frame and roll hoops only. No roof
    // keeps the view wide and bright in VR (less claustrophobic, better comfort).
    for (const s of [-1, 1]) {
      body.add(new THREE.BoxGeometry(0.045, 0.32, 0.06), s * 0.8, 0.52, -0.74, trim, 0, -0.7);
      body.add(new THREE.TorusGeometry(0.22, 0.03, 6, 12, Math.PI), s * 0.38, 0.62, 0.86, '#c8ccd8');
    }
    // Low racing screen: its top edge stays below the driver's eye line.
    body.add(new THREE.BoxGeometry(1.62, 0.035, 0.05), 0, 0.64, -0.64, trim, 0, -0.7);
    // Interior
    body.box(0, 0.47, -0.62, 1.68, 0.22, 0.36, '#2a2c38'); // dashboard
    body.box(0, 0.585, -0.62, 1.66, 0.012, 0.3, '#3a3d4c'); // dash top
    body.box(0, 0.28, -0.4, 0.26, 0.36, 0.6, '#2c2e3a'); // centre console
    for (const sx of [-0.38, 0.38]) {
      body.box(sx, 0.03, 0.3, 0.52, 0.14, 0.52, '#6a4f86');
      body.add(new THREE.BoxGeometry(0.52, 0.66, 0.12), sx, 0.4, 0.62, '#6a4f86', 0, -0.18);
      body.box(sx, 0.8, 0.7, 0.28, 0.16, 0.1, '#6a4f86'); // headrest
    }
    body.box(0, 0.12, 1.05, 1.6, 0.25, 0.4, '#3a3048'); // rear deck
  } else {
    body.box(0, 0.09, 0, 1.84, 0.6, 4.36, paint);
    body.box(0, 0.62, 0.22, 1.58, 0.48, 2.1, glassCol); // greenhouse (dark glass)
    body.box(0, 0.88, 0.22, 1.5, 0.06, 1.7, police ? '#e9ebf2' : paint);
    if (police) {
      body.box(-0.925, 0.12, 0.1, 0.02, 0.42, 1.9, doorCol);
      body.box(0.925, 0.12, 0.1, 0.02, 0.42, 1.9, doorCol);
    }
  }
  body.box(0, -0.08, -2.2, 1.8, 0.28, 0.12, dark); // bumpers
  body.box(0, -0.08, 2.2, 1.8, 0.28, 0.12, dark);
  body.box(0, 0.1, -2.21, 0.9, 0.12, 0.03, '#0b0b10'); // grille
  for (const s of [-1, 1]) {
    // wheel arches
    body.box(s * 0.93, 0.0, WHEEL_LAYOUT.frontZ, 0.06, 0.2, 0.9, dark);
    body.box(s * 0.93, 0.0, WHEEL_LAYOUT.rearZ, 0.06, 0.2, 0.9, dark);
  }
  const bodyMesh = new THREE.Mesh(body.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  root.add(bodyMesh);

  // Lights
  const headMat = new THREE.MeshBasicMaterial({ color: 0xdff4ff, toneMapped: false });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0x8a0f1a, toneMapped: false });
  const lights = new THREE.Group();
  for (const s of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.04), headMat);
    hl.position.set(s * 0.6, 0.22, -2.2);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.1, 0.04), tailMat);
    tl.position.set(s * 0.6, 0.22, 2.2);
    lights.add(hl, tl);
  }
  root.add(lights);

  // Wheels
  const wheels: THREE.Object3D[] = [];
  const wheelSpins: THREE.Object3D[] = [];
  const tireGeo = new THREE.CylinderGeometry(WHEEL_LAYOUT.radius, WHEEL_LAYOUT.radius, 0.24, 16);
  tireGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.25, 8);
  rimGeo.rotateZ(Math.PI / 2);
  const tireMat = new THREE.MeshLambertMaterial({ color: 0x111114 });
  const rimMat = new THREE.MeshLambertMaterial({ color: kind === 'police' ? 0x888b96 : 0xb8bcc8 });
  const positions: [number, number][] = [
    [-WHEEL_LAYOUT.halfTrack, WHEEL_LAYOUT.frontZ],
    [WHEEL_LAYOUT.halfTrack, WHEEL_LAYOUT.frontZ],
    [-WHEEL_LAYOUT.halfTrack, WHEEL_LAYOUT.rearZ],
    [WHEEL_LAYOUT.halfTrack, WHEEL_LAYOUT.rearZ],
  ];
  for (const [x, z] of positions) {
    const pivot = new THREE.Object3D();
    pivot.position.set(x, WHEEL_LAYOUT.connectionY - 0.3, z);
    const spin = new THREE.Group();
    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.castShadow = true;
    const rim = new THREE.Mesh(rimGeo, rimMat);
    spin.add(tire, rim);
    pivot.add(spin);
    root.add(pivot);
    wheels.push(pivot);
    wheelSpins.push(spin);
  }

  const visual: CarVisual = {
    root,
    wheels,
    wheelSpins,
    headMat,
    tailMat,
    seatEye: new THREE.Vector3(-0.38, 0.76, 0.32),
    passengerSeat: new THREE.Vector3(0.38, 0.24, 0.28),
  };

  if (police) {
    const red = new THREE.MeshBasicMaterial({ color: 0x400000, toneMapped: false });
    const blue = new THREE.MeshBasicMaterial({ color: 0x000a40, toneMapped: false });
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 0.26), red);
    r.position.set(-0.32, 0.97, 0.25);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 0.26), blue);
    b.position.set(0.32, 0.97, 0.25);
    root.add(r, b);
    visual.lightbar = { red, blue };
    const label = makeLabelTexture('NDPD', '#e9ebf2', '#1a2a6a', 256, 96);
    for (const s of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.32), new THREE.MeshBasicMaterial({ map: label }));
      plate.position.set(s * 0.94, 0.15, 0.1);
      plate.rotation.y = (s * Math.PI) / 2;
      root.add(plate);
    }
  }

  if (kind === 'player') {
    buildPlayerExtras(visual, paint);
  }
  return visual;
}

function buildPlayerExtras(v: CarVisual, paint: THREE.Color): void {
  // Driver door: hinge frame rotated so the door panel runs along the car's +Z.
  const hingeFrame = new THREE.Group();
  hingeFrame.position.set(-0.92, 0, -0.72);
  hingeFrame.rotation.y = -Math.PI / 2;
  const pivot = new THREE.Group();
  hingeFrame.add(pivot);
  const len = 1.3;
  const doorPanel = new THREE.Mesh(new THREE.BoxGeometry(len, 0.5, 0.08), new THREE.MeshLambertMaterial({ color: paint }));
  doorPanel.position.set(len / 2, 0.13, 0.02);
  const sillTop = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.12), new THREE.MeshLambertMaterial({ color: 0x2a2c36 }));
  sillTop.position.set(len / 2, 0.4, 0.02);
  const inner = new THREE.Mesh(new THREE.BoxGeometry(len - 0.1, 0.42, 0.02), new THREE.MeshLambertMaterial({ color: 0x2b2533 }));
  inner.position.set(len / 2, 0.15, -0.04);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.05), new THREE.MeshLambertMaterial({ color: 0xc8ccd8, emissive: 0x151515 }));
  handle.position.set(len - 0.25, 0.3, 0.08);
  const innerHandle = handle.clone();
  innerHandle.position.set(len - 0.35, 0.28, -0.07);
  // Window frame
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.48, 0.05), new THREE.MeshLambertMaterial({ color: 0x2a2c36 }));
  frame.position.set(len - 0.05, 0.66, 0.0);
  pivot.add(doorPanel, sillTop, inner, handle, innerHandle, frame);
  v.root.add(hingeFrame);
  v.doorPivot = pivot;
  v.doorMeshes = [doorPanel, handle];
  v.doorHandleLocal = new THREE.Vector3(len - 0.25, 0.3, 0.06);

  // Steering wheel (mount tilted toward the driver, spin about local Z)
  const mount = new THREE.Group();
  mount.position.set(-0.38, 0.44, -0.3);
  mount.rotation.x = -0.42;
  const spin = new THREE.Group();
  const rimMat = new THREE.MeshLambertMaterial({ color: 0x1a1b22, emissive: 0x050508 });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.022, 8, 28), rimMat);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 12), new THREE.MeshLambertMaterial({ color: 0x2a2c36 }));
  hub.rotation.x = Math.PI / 2;
  const marker = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.03), new THREE.MeshBasicMaterial({ color: 0x3df5ff }));
  marker.position.set(0, 0.19, 0.01);
  spin.add(rim, hub, marker);
  for (const a of [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.17, 0.015), rimMat);
    spoke.position.set(Math.sin(a) * 0.085, -Math.cos(a) * 0.085, 0);
    spoke.rotation.z = a;
    spin.add(spoke);
  }
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8), new THREE.MeshLambertMaterial({ color: 0x1a1b22 }));
  column.rotation.x = Math.PI / 2;
  column.position.z = -0.16;
  mount.add(spin, column);
  v.root.add(mount);
  v.steeringMount = mount;
  v.steeringSpin = spin;

  // Dashboard screen anchor (centre stack, angled to the driver)
  const dash = new THREE.Group();
  dash.position.set(0.02, 0.66, -0.66);
  dash.rotation.set(-0.5, -0.3, 0, 'YXZ');
  v.root.add(dash);
  v.dashAnchor = dash;

  // GPS arrow on top of the dashboard
  const arrowShape = new THREE.Shape();
  arrowShape.moveTo(0, -0.06);
  arrowShape.lineTo(0.035, 0.02);
  arrowShape.lineTo(0.012, 0.012);
  arrowShape.lineTo(0.012, 0.05);
  arrowShape.lineTo(-0.012, 0.05);
  arrowShape.lineTo(-0.012, 0.012);
  arrowShape.lineTo(-0.035, 0.02);
  arrowShape.closePath();
  const arrowGeo = new THREE.ShapeGeometry(arrowShape);
  arrowGeo.rotateX(-Math.PI / 2);
  const arrow = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({ color: 0x3dffb0, side: THREE.DoubleSide, toneMapped: false }));
  arrow.position.set(-0.38, 0.62, -0.62);
  v.root.add(arrow);
  v.gpsArrow = arrow;

  // Ambient light strip along the dash + faint windshield.
  const strip = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.012, 0.012), new THREE.MeshBasicMaterial({ color: 0x3df5ff, toneMapped: false }));
  strip.position.set(0, 0.36, -0.44);
  v.root.add(strip);
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(1.56, 0.3),
    new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide }),
  );
  glass.position.set(0, 0.52, -0.72);
  glass.rotation.x = -0.7;
  v.root.add(glass);
}
