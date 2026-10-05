import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Grabbable } from '../../src/interaction/Grabbable';
import { InteractionManager, type InteractionEvents } from '../../src/interaction/InteractionManager';
import { InteractorHand } from '../../src/interaction/InteractorHand';
import { Socket } from '../../src/interaction/Socket';
import { Notifier } from '../../src/ui/Notifier';
import type { StaticWorld } from '../../src/world/StaticWorld';

const openWorld = { raycast: () => null } as unknown as StaticWorld;

function makeHand(scene: THREE.Scene, id: 'left' | 'right', x: number): InteractorHand {
  const grip = new THREE.Object3D();
  const ray = new THREE.Object3D();
  scene.add(grip, ray);
  grip.position.set(x, 1.2, -0.3);
  grip.updateMatrixWorld(true);
  const h = new InteractorHand(id, grip, ray, null);
  h.attachCursor(scene);
  return h;
}

function makeItem(scene: THREE.Scene, id: string, tags: string[] = []): Grabbable {
  const obj = new THREE.Object3D();
  scene.add(obj);
  const body = new CANNON.Body({ mass: 1, shape: new CANNON.Box(new CANNON.Vec3(0.1, 0.1, 0.1)) });
  return new Grabbable({ id, object: obj, body, tags });
}

describe('InteractionManager.setHands (C01)', () => {
  it('keeps items held by hands that stay connected', () => {
    const scene = new THREE.Scene();
    const im = new InteractionManager(openWorld, () => new THREE.Vector3(0, 1.6, 0));
    const left = makeHand(scene, 'left', -0.3);
    const right = makeHand(scene, 'right', 0.3);
    im.setHands([left, right]);
    const parcel = im.register(makeItem(scene, 'parcel'));
    parcel.grab(right, false);
    // Left controller disconnects.
    im.setHands([right]);
    expect(right.held).toBe(parcel);
    expect(parcel.primary).toBe(right);
    expect(im.hands).toEqual([right]);
  });

  it('clears hover and cursor of removed hands and drops their items', () => {
    const scene = new THREE.Scene();
    const im = new InteractionManager(openWorld, () => new THREE.Vector3(0, 1.6, 0));
    const desktop = makeHand(scene, 'left', 0);
    const right = makeHand(scene, 'right', 0.3);
    im.setHands([desktop]);
    const door = im.register(makeItem(scene, 'door'));
    // Simulate a hovered target with a visible panel cursor.
    desktop.hover = door;
    door.setHover(desktop, true);
    desktop.updateVisual(1, new THREE.Vector3(0, 1, -1));
    const cursor = (desktop as unknown as { rayCursor: THREE.Mesh }).rayCursor;
    expect(cursor.visible).toBe(true);
    const held = im.register(makeItem(scene, 'can'));
    held.grab(right, false);
    im.setHands([right]); // keep right
    im.setHands([]); // enter/exit: everything removed
    expect(desktop.hover).toBeNull();
    expect(door.hovered).toBe(false);
    expect(cursor.visible).toBe(false);
    expect(right.held).toBeNull();
    expect(held.isHeld).toBe(false);
  });
});

describe('InteractionManager in-car releases (C02)', () => {
  function setup() {
    const scene = new THREE.Scene();
    const events: InteractionEvents = {};
    const im = new InteractionManager(openWorld, () => new THREE.Vector3(-0.38, 1.5, 0.32), events);
    const hand = makeHand(scene, 'right', -0.2); // near the wheel, > 0.7 m from the seat socket
    im.setHands([hand]);
    const anchor = new THREE.Object3D();
    anchor.position.set(0.38, 1.1, 0.28);
    scene.add(anchor);
    anchor.updateMatrixWorld(true);
    const seat = im.addSocket(new Socket('seat', anchor, 0.7, (i) => i.tags.has('mission')));
    let driving = true;
    im.carSocket = () => (driving ? seat : null);
    return { scene, im, events, hand, seat, anchor, setDriving: (d: boolean) => (driving = d) };
  }

  it('seats a mission item released anywhere in the cabin', () => {
    const { scene, im, events, hand, seat } = setup();
    const parcel = im.register(makeItem(scene, 'parcel', ['mission']));
    parcel.grab(hand, false);
    parcel.object.position.set(-0.6, 1.3, -0.5); // 1.25 m from the seat anchor
    const onRelease = vi.fn();
    events.onRelease = onRelease;
    im.releaseHand(hand, false);
    expect(parcel.socket).toBe(seat);
    expect(seat.item).toBe(parcel);
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it('drops non-seatable items above the roof instead of inside the chassis', () => {
    const { scene, im, hand, anchor } = setup();
    const can = im.register(makeItem(scene, 'can'));
    can.grab(hand, false);
    can.object.position.set(-0.2, 1.2, -0.3);
    im.throwFromHand(hand, new THREE.Vector3(0, 0, -5));
    expect(can.socket).toBeNull();
    expect(can.object.position.y).toBeCloseTo(anchor.position.y + 1.4, 5);
    expect(can.body!.position.y).toBeCloseTo(anchor.position.y + 1.4, 5);
    expect(can.body!.velocity.length()).toBe(0);
  });

  it('leaves on-foot releases untouched', () => {
    const { scene, im, hand, seat, setDriving } = setup();
    setDriving(false);
    const parcel = im.register(makeItem(scene, 'parcel', ['mission']));
    parcel.grab(hand, false);
    parcel.object.position.set(-0.6, 1.3, -0.5);
    im.releaseHand(hand, false);
    expect(parcel.socket).toBeNull();
    expect(seat.item).toBeNull();
    expect(parcel.object.position.x).toBeCloseTo(-0.6, 5);
  });
});

describe('Notifier VR panel while the rig moves (C26)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('stays ~1.1 m ahead of the head while driving at 15 m/s', () => {
    const ctx = new Proxy({}, { get: (_t, p) => (p === 'measureText' ? () => ({ width: 10 }) : () => undefined), set: () => true });
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
      getElementById: () => null,
    });
    const scene = new THREE.Scene();
    const rig = new THREE.Group();
    const tracking = new THREE.Group();
    const camera = new THREE.PerspectiveCamera();
    rig.add(tracking);
    tracking.add(camera);
    scene.add(rig);
    camera.position.set(0, 1.2, 0); // looking down -Z
    const n = new Notifier(scene, camera);
    n.xr = true;
    n.push('체크포인트 1/9', 'info', 10);
    const dt = 1 / 72;
    const head = new THREE.Vector3();
    let minAhead = Infinity;
    for (let i = 0; i < 144; i++) {
      rig.position.z -= 15 * dt; // car carries the rig forward
      n.update(dt);
      camera.getWorldPosition(head);
      if (i > 0) minAhead = Math.min(minAhead, head.z - n.panel.mesh.position.z);
    }
    expect(minAhead).toBeGreaterThan(1.0);
  });
});
