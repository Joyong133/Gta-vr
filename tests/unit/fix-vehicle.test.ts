import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Actions } from '../../src/input/InputRouter';
import type { InteractorHand } from '../../src/interaction/InteractorHand';
import { PlayerController, type PlayerControllerDeps } from '../../src/player/PlayerController';
import { RECOVER_Y, type PlayerVehicle } from '../../src/vehicles/PlayerVehicle';
import { SteeringWheelGrab } from '../../src/vehicles/SteeringWheelGrab';
import { VehiclePhysics } from '../../src/vehicles/VehiclePhysics';

function makeWorld() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(300, 0.5, 300)), position: new CANNON.Vec3(0, -0.5, 0) });
  world.addBody(ground);
  const v = new VehiclePhysics(world);
  world.addEventListener('preStep', () => v.fixedUpdate(1 / 60));
  v.reset(0, 0.8, 0, 0);
  const step = (sec: number, each?: () => void) => {
    for (let i = 0; i < Math.round(sec * 60); i++) {
      world.step(1 / 60);
      each?.();
    }
  };
  return { world, v, step };
}

/** PlayerController with stub deps around a real VehiclePhysics. */
function makeController(v: VehiclePhysics) {
  const vehicle = {
    id: 'player_car',
    physics: v,
    occupied: false,
    get speed() {
      return Math.abs(v.forwardSpeed);
    },
    get body() {
      return v.chassis;
    },
    door: { isOpen: true, angle: -1.2, open() {}, close() {}, getAnchor: (o: THREE.Vector3) => o.set(0, 0, 0) },
    wheelGrab: { enabled: false, steerInput: null, releaseAll() {} },
    findExitSpot: (_o: unknown, out: THREE.Vector3) => (out.set(2, 0, 0), true),
    seatPose: (_l: boolean, p: THREE.Vector3, q: THREE.Quaternion) => (p.set(0, 1, 0), q.identity()),
    worldPosition: (o: THREE.Vector3) => o.set(v.chassis.position.x, v.chassis.position.y, v.chassis.position.z),
  };
  const rig = {
    rig: new THREE.Object3D(),
    camera: new THREE.Object3D(),
    resetDesktopPitch() {},
    syncHeadMatrices() {},
    placeHeadAt() {},
    spawnAt() {},
    applyDesktopLook() {},
    headWorld: (o: THREE.Vector3) => o.set(0, 1.6, 0),
    headLocalInRig: (o: THREE.Vector3) => o.set(0, 1.2, 0),
  };
  const deps = {
    rig,
    overlay: { fadeOut: () => Promise.resolve(), fadeIn: () => Promise.resolve(), setMotion() {}, setWallPenetration() {} },
    locomotion: { enabled: true, update() {}, warp() {} },
    interaction: { hands: [], releaseHand() {}, releaseAll() {} },
    vehicle,
    movers: { carObbs: () => [] },
    bus: { emit() {} },
    settings: () => ({ comfort: { wheelGrabSteering: false, horizonLockInVehicle: true } }),
    isXR: () => false,
    onHorn() {},
  } as unknown as PlayerControllerDeps;
  return { pc: new PlayerController(deps), vehicle: vehicle as unknown as PlayerVehicle };
}

describe('player car parking (enter / exit)', () => {
  it('enter enables physics, exit parks the car and clears stale input', async () => {
    const { v, step } = makeWorld();
    step(1);
    v.enabled = false; // PlayerVehicle starts parked
    const { pc } = makeController(v);
    await pc.enterVehicle();
    expect(pc.driving).toBe(true);
    expect(v.enabled).toBe(true);

    v.controls.throttle = 1;
    v.controls.steer = -0.6;
    v.controls.handbrake = true;
    expect(await pc.exitVehicle(true)).toBe(true);
    expect(pc.driving).toBe(false);
    expect(v.enabled).toBe(false);
    expect(v.controls).toEqual({ throttle: 0, brake: 0, steer: 0, handbrake: false });
  });

  it('an abandoned car stops near where it was left and never reverses', async () => {
    const { v, step } = makeWorld();
    step(1);
    const { pc } = makeController(v);
    await pc.enterVehicle();
    v.controls.throttle = 0.5;
    v.controls.steer = -0.4;
    step(3, () => {
      if (v.forwardSpeed > 2) v.controls.throttle = 0;
    });
    expect(v.forwardSpeed).toBeGreaterThan(1.2);
    await pc.exitVehicle(true);
    const x0 = v.chassis.position.x;
    const z0 = v.chassis.position.z;
    let minSpeed = Infinity;
    step(6, () => (minSpeed = Math.min(minSpeed, v.forwardSpeed)));
    expect(minSpeed).toBeGreaterThan(-0.1);
    expect(Math.hypot(v.chassis.position.x - x0, v.chassis.position.z - z0)).toBeLessThan(1);
    expect(Math.abs(v.forwardSpeed)).toBeLessThan(0.05);
  });

  it('warping out of the car parks it as well', async () => {
    const { v, step } = makeWorld();
    step(1);
    const { pc } = makeController(v);
    await pc.enterVehicle();
    await pc.warpTo(10, 10, 0);
    expect(pc.driving).toBe(false);
    expect(v.enabled).toBe(false);
    expect(v.controls.brake).toBe(0);
  });

  it('busy fades hold the car with the handbrake, not brake (= reverse when slow)', async () => {
    const { v, step } = makeWorld();
    step(1);
    const { pc } = makeController(v);
    await pc.enterVehicle();
    pc.busy = true;
    pc.update(1 / 60, {} as Actions);
    expect(v.controls.throttle).toBe(0);
    expect(v.controls.brake).toBe(0);
    expect(v.controls.handbrake).toBe(true);
    let minSpeed = Infinity;
    step(2, () => (minSpeed = Math.min(minSpeed, v.forwardSpeed)));
    expect(minSpeed).toBeGreaterThan(-0.1);
  });
});

describe('recovery spawn height', () => {
  it('settles without a visible drop', () => {
    const { v, step } = makeWorld();
    step(1);
    v.reset(5, RECOVER_Y, 5, 0.3);
    let minY = Infinity;
    let maxVy = 0;
    step(0.6, () => {
      minY = Math.min(minY, v.chassis.position.y);
      maxVy = Math.max(maxVy, Math.abs(v.chassis.velocity.y));
    });
    expect(RECOVER_Y - minY).toBeLessThan(0.06);
    expect(maxVy).toBeLessThan(0.6);
    expect(v.vehicle.numWheelsOnGround).toBe(4);
  });
});

describe('SteeringWheelGrab', () => {
  function makeHand(r: number, angle: number) {
    const pos = new THREE.Vector3(Math.cos(angle) * r, Math.sin(angle) * r, 0);
    const hand = {
      touchPoint: (out: THREE.Vector3) => out.copy(pos),
      pulse() {},
    };
    const at = (rr: number, a: number) => pos.set(Math.cos(a) * rr, Math.sin(a) * rr, 0);
    return { hand: hand as unknown as InteractorHand, at };
  }

  function makeWheel() {
    const wheel = new SteeringWheelGrab(new THREE.Group());
    wheel.enabled = true;
    return wheel;
  }

  it('cranking one hand past 180 degrees stays at full lock instead of flipping', () => {
    const wheel = makeWheel();
    const h = makeHand(0.19, 0);
    wheel.beginDrag(h.hand);
    let prev = wheel.wheelAngle;
    for (let deg = 10; deg <= 260; deg += 10) {
      h.at(0.19, (deg * Math.PI) / 180);
      wheel.updateDrag(h.hand);
      expect(wheel.wheelAngle).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = wheel.wheelAngle;
    }
    expect(wheel.wheelAngle).toBeCloseTo(2.4, 5);
    expect(wheel.steerInput).toBeCloseTo(-1, 5);
    // Turning back responds straight away (no wind-up past the stop).
    h.at(0.19, (250 * Math.PI) / 180);
    wheel.updateDrag(h.hand);
    expect(wheel.wheelAngle).toBeCloseTo(2.4 - (10 * Math.PI) / 180, 5);
  });

  it('ignores hand jitter at the hub', () => {
    const wheel = makeWheel();
    const h = makeHand(0.19, 0);
    wheel.beginDrag(h.hand);
    h.at(0.19, 0.2);
    wheel.updateDrag(h.hand);
    const held = wheel.wheelAngle;
    expect(held).toBeCloseTo(0.2, 5);
    for (const [r, a] of [
      [0.01, 0],
      [0.012, 2.5],
      [0.008, -2.8],
      [0.02, 1.4],
    ] as const) {
      h.at(r, a);
      wheel.updateDrag(h.hand);
      expect(wheel.wheelAngle).toBeCloseTo(held, 9);
    }
    // Back on the rim somewhere else: tracking resumes from there, no jump.
    h.at(0.19, -1.0);
    wheel.updateDrag(h.hand);
    expect(wheel.wheelAngle).toBeCloseTo(held, 9);
    h.at(0.19, -0.9);
    wheel.updateDrag(h.hand);
    expect(wheel.wheelAngle).toBeCloseTo(held + 0.1, 5);
  });

  it('averages two hands and keeps the angle when one lets go', () => {
    const wheel = makeWheel();
    const l = makeHand(0.19, Math.PI);
    const r = makeHand(0.19, 0);
    wheel.beginDrag(l.hand);
    wheel.beginDrag(r.hand);
    l.at(0.19, Math.PI + 0.5);
    r.at(0.19, 0.5);
    wheel.updateDrag(l.hand);
    wheel.updateDrag(r.hand);
    expect(wheel.wheelAngle).toBeCloseTo(0.5, 5);
    wheel.endDrag(l.hand);
    expect(wheel.wheelAngle).toBeCloseTo(0.5, 5);
    r.at(0.19, 0.3);
    wheel.updateDrag(r.hand);
    expect(wheel.wheelAngle).toBeCloseTo(0.3, 5);
    wheel.endDrag(r.hand);
    expect(wheel.held).toBe(false);
    expect(wheel.steerInput).toBeNull();
  });
});
