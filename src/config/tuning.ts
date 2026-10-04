/**
 * Gameplay tuning values - the web equivalent of Unity inspector fields.
 * The desktop debug panel (F4) edits these live; edit here to change defaults.
 */
export const tuning = {
  player: {
    eyeHeightDesktop: 1.65,
    bodyRadius: 0.28,
    /** Target standing eye height used by "height calibration" in seated mode. */
    calibratedEyeHeight: 1.6,
    teleportMaxDistance: 12,
    teleportArcSpeed: 9,
    nearGrabRadius: 0.11,
    farGrabMaxDistance: 6,
    uiRayMaxDistance: 12,
    throwVelocityScale: 1.15,
    maxThrowSpeed: 18,
    forceGrabPullTime: 0.18,
    headInWallFadeDepth: 0.18,
  },
  vehicle: {
    mass: 1150,
    engineForce: 3600,
    reverseForce: 1800,
    brakeForce: 55,
    handbrakeForce: 75,
    maxForwardSpeed: 31, // m/s (~112 km/h)
    maxReverseSpeed: 8,
    maxSteerLowSpeed: 0.58, // rad
    maxSteerHighSpeed: 0.16,
    steerSpeedRef: 28,
    steerRate: 2.6, // rad/s visual+physics steering slew
    suspensionStiffness: 38,
    suspensionRestLength: 0.32,
    frictionSlip: 3.2,
    rollInfluence: 0.04,
    lateralGripAssist: 2.2, // extra sideways velocity damping (arcade stability)
    yawDampingAssist: 0.6,
    downforce: 1.8,
    antiRollTorque: 9000,
    flipUpThreshold: 0.35, // chassis up.y below this = flipped
    flipConfirmTime: 1.5,
    stuckSpeed: 0.7,
    stuckTime: 3.0,
    exitMaxSpeed: 2.2,
    impactHapticSpeed: 2.0,
  },
  traffic: {
    count: 8,
    cruiseSpeed: 10,
    turnSpeed: 6.5,
    accel: 3.5,
    decel: 7,
    minGap: 5.5,
    headwayTime: 1.1,
    blockedOvertakeTime: 4,
  },
  pedestrians: {
    count: 22,
    walkSpeed: 1.25,
    runSpeed: 4.2,
    fleeTime: 7,
    knockedTime: 3.5,
    farUpdateInterval: 0.2,
    nearDistance: 45,
    cullDistance: 130,
  },
  police: {
    sightRange: [0, 40, 52, 65] as number[], // by wanted level
    sightFovDeg: 150,
    proximityAwareness: 9,
    lostSightTime: 2.5,
    searchRadius: [0, 55, 70, 85] as number[],
    cooldownTime: [0, 9, 13, 17] as number[],
    insideRadiusCooldownRate: 0.35,
    carPursuitSpeed: [0, 17, 20, 23] as number[],
    carPatrolSpeed: 9,
    officerRunSpeed: 4.6,
    arrestDistance: 1.6,
    arrestTime: 1.6,
    carArrestDistance: 4.2,
    carArrestTime: 2.6,
    civilianReportDelay: 3.5,
    perceptionInterval: 0.2,
  },
  missions: {
    resumeFromCheckpoint: true,
  },
};

export type Tuning = typeof tuning;
