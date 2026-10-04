import type { Settings } from '../config/settings';
import { applyDeadzone } from '../core/math';
import { ControllerState } from './ControllerState';
import type { DesktopInput } from './DesktopInput';

/**
 * Abstract game actions, rebuilt every frame from either XR controllers or
 * keyboard/mouse. Gameplay systems read actions, never raw devices.
 *
 * XR default mapping (right-handed; swapped when dominant hand = left):
 *   left stick ........ smooth move            | in car: steer (x)
 *   right stick x ..... snap / smooth turn
 *   right stick fwd ... teleport aim, release to teleport
 *   grip .............. grab / release (both hands)
 *   trigger ........... select / use held item | in car: right = throttle, left = brake/reverse
 *   A ................. interact (talk, doors, enter/exit car)
 *   B ................. horn (in car)
 *   X ................. vehicle recovery (in car)
 *   Y ................. wrist menu
 *   left stick press .. re-centre seat (in car)
 *   right stick press . handbrake (in car)
 */
export interface Actions {
  move: { x: number; y: number };
  run: boolean;
  turn: number;
  snapTurn: -1 | 0 | 1;
  teleportAim: boolean;
  teleportConfirm: boolean;
  interact: boolean;
  menu: boolean;
  recover: boolean;
  horn: boolean;
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  recenter: boolean;
  lookX: number;
  lookY: number;
  debug: boolean;
  tuning: boolean;
}

export function emptyActions(): Actions {
  return {
    move: { x: 0, y: 0 },
    run: false,
    turn: 0,
    snapTurn: 0,
    teleportAim: false,
    teleportConfirm: false,
    interact: false,
    menu: false,
    recover: false,
    horn: false,
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: false,
    recenter: false,
    lookX: 0,
    lookY: 0,
    debug: false,
    tuning: false,
  };
}

export class InputRouter {
  readonly actions: Actions = emptyActions();
  readonly left = new ControllerState('left');
  readonly right = new ControllerState('right');
  private snapArmed = true;
  private teleportWasAiming = false;
  private readonly stickTmp = { x: 0, y: 0 };
  xrActive = false;

  constructor(
    private readonly desktop: DesktopInput,
    private readonly getSettings: () => Settings,
  ) {}

  dominant(): ControllerState {
    return this.getSettings().comfort.dominantHand === 'left' ? this.left : this.right;
  }

  offHand(): ControllerState {
    return this.getSettings().comfort.dominantHand === 'left' ? this.right : this.left;
  }

  controller(hand: 'left' | 'right'): ControllerState {
    return hand === 'left' ? this.left : this.right;
  }

  /** Reads XR gamepads for this frame. Call with the active session's input sources. */
  updateXR(sources: Iterable<XRInputSource> | null): void {
    let l: Gamepad | null = null;
    let r: Gamepad | null = null;
    if (sources) {
      for (const s of sources) {
        if (!s.gamepad) continue; // hand-tracking without gamepad is not supported in v1
        if (s.handedness === 'left') l = s.gamepad;
        else if (s.handedness === 'right') r = s.gamepad;
      }
    }
    this.left.update(l);
    this.right.update(r);
  }

  update(): void {
    const a = this.actions;
    const s = this.getSettings();
    const dz = s.input.stickDeadzone;
    const d = this.desktop;
    d.update();

    // Reset per-frame values.
    a.move.x = 0;
    a.move.y = 0;
    a.turn = 0;
    a.snapTurn = 0;
    a.teleportConfirm = false;
    a.teleportAim = false;
    a.lookX = 0;
    a.lookY = 0;

    if (this.xrActive) {
      const dom = this.dominant();
      const off = this.offHand();
      applyDeadzone(off.stickX, off.stickY, dz, this.stickTmp);
      a.move.x = this.stickTmp.x;
      a.move.y = -this.stickTmp.y;
      a.run = off.stickPress.pressed;

      // Dominant stick: x = turn, forward = teleport aim.
      const tx = Math.abs(dom.stickX) > dz ? dom.stickX : 0;
      const ty = dom.stickY;
      const aiming = ty < -0.65 && Math.abs(tx) < 0.6;
      const stillAiming = this.teleportWasAiming && Math.hypot(dom.stickX, dom.stickY) > 0.3;
      a.teleportAim = aiming || stillAiming;
      a.teleportConfirm = this.teleportWasAiming && !a.teleportAim;
      this.teleportWasAiming = a.teleportAim;
      if (!a.teleportAim) {
        a.turn = tx;
        if (this.snapArmed && Math.abs(tx) > 0.7) {
          a.snapTurn = tx > 0 ? 1 : -1;
          this.snapArmed = false;
        } else if (Math.abs(tx) < 0.3) {
          this.snapArmed = true;
        }
      }

      a.interact = dom.primary.down;
      a.menu = off.secondary.down;
      a.recover = off.primary.down;
      a.horn = dom.secondary.pressed;
      a.throttle = dom.trigger.value;
      a.brake = off.trigger.value;
      a.steer = Math.abs(off.stickX) > dz ? off.stickX : 0;
      a.handbrake = dom.stickPress.pressed;
      a.recenter = off.stickPress.down;
      a.debug = false;
      a.tuning = false;
    } else {
      const fwd = (d.held('KeyW') ? 1 : 0) - (d.held('KeyS') ? 1 : 0);
      const side = (d.held('KeyD') ? 1 : 0) - (d.held('KeyA') ? 1 : 0);
      const len = Math.hypot(fwd, side) || 1;
      a.move.x = side / len;
      a.move.y = fwd / len;
      a.run = d.held('ShiftLeft') || d.held('ShiftRight');
      const sens = 0.0022 * s.input.mouseSensitivity;
      a.lookX = d.mouseDX * sens;
      a.lookY = d.mouseDY * sens * (s.input.invertMouseY ? -1 : 1);
      // Arrow keys also look around (helps automation / trackpads).
      if (d.held('ArrowLeft')) a.lookX -= 0.03;
      if (d.held('ArrowRight')) a.lookX += 0.03;
      a.snapTurn = d.pressed('KeyQ') ? -1 : d.pressed('KeyZ') ? 1 : 0;
      a.teleportAim = d.held('KeyT');
      a.teleportConfirm = this.teleportWasAiming && !a.teleportAim;
      this.teleportWasAiming = a.teleportAim;
      a.interact = d.pressed('KeyE');
      a.menu = d.pressed('Tab') || d.pressed('KeyM');
      a.recover = d.pressed('KeyR');
      a.horn = d.held('KeyH');
      a.throttle = d.held('KeyW') || d.held('ArrowUp') ? 1 : 0;
      a.brake = d.held('KeyS') || d.held('ArrowDown') ? 1 : 0;
      a.steer = (d.held('KeyD') ? 1 : 0) - (d.held('KeyA') ? 1 : 0);
      a.handbrake = d.held('Space');
      a.recenter = d.pressed('KeyC');
      a.debug = d.pressed('F3') || d.pressed('Backquote');
      a.tuning = d.pressed('F4');
    }
  }
}
