/**
 * Physics collision groups (cannon-es collisionFilterGroup / collisionFilterMask).
 *
 * The player body is NOT a physics body: on-foot movement is resolved against
 * StaticWorld AABBs in code, so props and held objects can never shove the
 * player's head around (a common VR comfort bug).
 *
 *  group            collides with
 *  STATIC           PROP, PLAYER_CAR, PROJECTILE
 *  PROP             STATIC, PROP, PLAYER_CAR, AI_CAR, PROJECTILE
 *  PLAYER_CAR       STATIC, PROP, AI_CAR
 *  AI_CAR           PROP, PLAYER_CAR        (kinematic; AI avoids statics itself)
 *  HELD             nothing                 (kinematic while in a hand)
 *  SOCKETED         nothing                 (kinematic while snapped into a socket)
 */
export const COL = {
  STATIC: 1,
  PROP: 2,
  PLAYER_CAR: 4,
  AI_CAR: 8,
  HELD: 16,
  PROJECTILE: 32,
} as const;

export const MASK = {
  STATIC: COL.PROP | COL.PLAYER_CAR | COL.PROJECTILE,
  PROP: COL.STATIC | COL.PROP | COL.PLAYER_CAR | COL.AI_CAR | COL.PROJECTILE,
  PLAYER_CAR: COL.STATIC | COL.PROP | COL.AI_CAR,
  AI_CAR: COL.PROP | COL.PLAYER_CAR,
  NONE: 0,
} as const;

/** three.js render layers. Layer 0 is the default for everything visible. */
export const RENDER_LAYER = {
  DEFAULT: 0,
  /** Debug-only helpers (police vision lines, search radius) - enabled on the camera when debug is on. */
  DEBUG: 5,
} as const;
