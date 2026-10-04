import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Grabbable } from '../../src/interaction/Grabbable';
import { InteractorHand } from '../../src/interaction/InteractorHand';

function hand(id: 'left' | 'right') {
  const grip = new THREE.Object3D();
  const ray = new THREE.Object3D();
  const scene = new THREE.Scene();
  scene.add(grip, ray);
  return { h: new InteractorHand(id, grip, ray, null), grip, scene };
}

describe('InteractorHand throw estimation', () => {
  it('angular velocity stays finite for (nearly) identical rotations', () => {
    const { h, grip } = hand('right');
    // Rotations that differ by float noise only (this produced NaN before the fix).
    for (let i = 0; i < 8; i++) {
      grip.quaternion.setFromAxisAngle(new THREE.Vector3(0.3, 1, 0.2).normalize(), 0.7 + i * 1e-9);
      grip.updateMatrixWorld(true);
      h.recordPose(1 / 72);
    }
    const w = h.getAngularVelocity(new THREE.Vector3());
    expect(Number.isFinite(w.x + w.y + w.z)).toBe(true);
  });

  it('linear velocity matches hand motion', () => {
    const { h, grip } = hand('right');
    for (let i = 0; i < 8; i++) {
      grip.position.set(i * 0.05, 1, 0); // 0.05 m per 1/60 s = 3 m/s
      grip.updateMatrixWorld(true);
      h.recordPose(1 / 60);
    }
    const v = h.getVelocity(new THREE.Vector3());
    expect(v.x).toBeCloseTo(3, 1);
  });
});

describe('Grabbable two-hand modes', () => {
  it('aim mode points the barrel from the primary toward the secondary hand', () => {
    const scene = new THREE.Scene();
    const obj = new THREE.Object3D();
    scene.add(obj);
    const g = new Grabbable({ id: 'gun', object: obj, attach: { mode: 'snap' }, twoHand: 'aim' });
    const right = hand('right');
    const left = hand('left');
    right.grip.position.set(0, 1.2, 0);
    left.grip.position.set(0, 1.2, -0.4); // straight ahead (-Z)
    right.grip.updateMatrixWorld(true);
    left.grip.updateMatrixWorld(true);
    g.grab(right.h, false);
    g.grab(left.h, false);
    expect(g.secondary).toBe(left.h);
    g.updateHeld(1 / 60);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(obj.quaternion);
    expect(fwd.z).toBeLessThan(-0.99);
    // Move the support hand to the right: the barrel follows.
    left.grip.position.set(0.4, 1.2, 0);
    left.grip.updateMatrixWorld(true);
    g.updateHeld(1 / 60);
    fwd.set(0, 0, -1).applyQuaternion(obj.quaternion);
    expect(fwd.x).toBeGreaterThan(0.99);
  });

  it('midpoint mode centres a box between both hands and hands over on release', () => {
    const scene = new THREE.Scene();
    const obj = new THREE.Object3D();
    scene.add(obj);
    const g = new Grabbable({ id: 'crate', object: obj, twoHand: 'midpoint' });
    const right = hand('right');
    const left = hand('left');
    right.grip.position.set(0.3, 1, -0.5);
    left.grip.position.set(-0.3, 1, -0.5);
    right.grip.updateMatrixWorld(true);
    left.grip.updateMatrixWorld(true);
    g.grab(right.h, false);
    g.grab(left.h, false);
    g.updateHeld(1 / 60);
    expect(obj.position.x).toBeCloseTo(0, 5);
    expect(obj.position.z).toBeCloseTo(-0.5, 5);
    const free = g.release(right.h, new THREE.Vector3(), new THREE.Vector3());
    expect(free).toBe(false);
    expect(g.primary).toBe(left.h);
    expect(left.h.held).toBe(g);
    expect(g.release(left.h, new THREE.Vector3(), new THREE.Vector3())).toBe(true);
    expect(g.isHeld).toBe(false);
  });
});
