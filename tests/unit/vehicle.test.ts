import * as CANNON from 'cannon-es';
import { describe, expect, it } from 'vitest';
import { VehiclePhysics } from '../../src/vehicles/VehiclePhysics';

function makeWorld() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(300, 0.5, 300)), position: new CANNON.Vec3(0, -0.5, 0) });
  world.addBody(ground);
  const v = new VehiclePhysics(world);
  world.addEventListener('preStep', () => v.fixedUpdate(1 / 60));
  v.reset(0, 0.8, 0, 0);
  const step = (sec: number) => {
    for (let i = 0; i < Math.round(sec * 60); i++) world.step(1 / 60);
  };
  return { world, v, step };
}

describe('VehiclePhysics', () => {
  it('settles on four wheels', () => {
    const { v, step } = makeWorld();
    step(1.5);
    expect(v.vehicle.numWheelsOnGround).toBe(4);
    expect(v.upY()).toBeGreaterThan(0.98);
  });

  it('accelerates forward (-Z) and respects top speed', () => {
    const { v, step } = makeWorld();
    step(1);
    v.controls.throttle = 1;
    step(4);
    expect(v.forwardSpeed).toBeGreaterThan(8);
    expect(v.chassis.position.z).toBeLessThan(-10);
    step(20);
    expect(v.forwardSpeed).toBeLessThan(32);
  });

  it('brakes, then reverses when brake is held at a stop', () => {
    const { v, step } = makeWorld();
    step(1);
    v.controls.throttle = 1;
    step(3);
    v.controls.throttle = 0;
    v.controls.brake = 1;
    step(4);
    expect(v.forwardSpeed).toBeLessThan(0);
    expect(v.forwardSpeed).toBeGreaterThan(-8.5);
  });

  it('steers right with positive steer input', () => {
    const { v, step } = makeWorld();
    step(1);
    v.controls.throttle = 0.6;
    v.controls.steer = 1;
    step(3);
    // Heading -Z then turning right means x increases.
    expect(v.chassis.position.x).toBeGreaterThan(1);
    expect(v.upY()).toBeGreaterThan(0.9);
  });

  it('detects a flip and recovers upright', () => {
    const { v, step } = makeWorld();
    step(1);
    v.chassis.quaternion.setFromEuler(Math.PI, 0, 0);
    v.chassis.position.y = 1.5;
    step(3);
    expect(v.isFlipped).toBe(true);
    v.reset(5, 0.8, 5, 1);
    step(1);
    expect(v.isFlipped).toBe(false);
    expect(v.upY()).toBeGreaterThan(0.98);
    expect(v.yaw()).toBeCloseTo(1, 1);
  });

  it('detects being stuck against a wall', () => {
    const { world, v, step } = makeWorld();
    const wall = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(5, 3, 0.5)), position: new CANNON.Vec3(0, 3, -3.2) });
    world.addBody(wall);
    step(1);
    v.controls.throttle = 1;
    step(5);
    expect(v.isStuck).toBe(true);
  });
});
