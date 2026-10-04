/**
 * Per-frame snapshot of one XR controller (xr-standard gamepad mapping):
 *   buttons[0] trigger, [1] squeeze, [3] thumbstick press, [4] A/X, [5] B/Y
 *   axes[2], axes[3] thumbstick x / y (y is negative when pushed forward)
 */
export class ButtonState {
  pressed = false;
  down = false;
  up = false;
  value = 0;

  set(pressed: boolean, value: number): void {
    this.down = pressed && !this.pressed;
    this.up = !pressed && this.pressed;
    this.pressed = pressed;
    this.value = value;
  }

  reset(): void {
    this.set(false, 0);
  }
}

export type Hand = 'left' | 'right';

export class ControllerState {
  connected = false;
  readonly trigger = new ButtonState();
  readonly squeeze = new ButtonState();
  readonly stickPress = new ButtonState();
  readonly primary = new ButtonState(); // A (right) / X (left)
  readonly secondary = new ButtonState(); // B (right) / Y (left)
  stickX = 0;
  stickY = 0;
  private gamepad: Gamepad | null = null;

  constructor(readonly hand: Hand) {}

  update(gamepad: Gamepad | null): void {
    this.gamepad = gamepad;
    this.connected = gamepad !== null;
    if (!gamepad) {
      this.trigger.reset();
      this.squeeze.reset();
      this.stickPress.reset();
      this.primary.reset();
      this.secondary.reset();
      this.stickX = 0;
      this.stickY = 0;
      return;
    }
    const b = gamepad.buttons;
    const val = (i: number): number => (b[i] ? b[i].value : 0);
    const prs = (i: number): boolean => (b[i] ? b[i].pressed : false);
    // Analog hysteresis keeps grab/trigger from chattering around the threshold.
    this.trigger.set(this.trigger.pressed ? val(0) > 0.35 : val(0) > 0.55, val(0));
    this.squeeze.set(this.squeeze.pressed ? val(1) > 0.35 : val(1) > 0.55, val(1));
    this.stickPress.set(prs(3), val(3));
    this.primary.set(prs(4), val(4));
    this.secondary.set(prs(5), val(5));
    const ax = gamepad.axes;
    // xr-standard puts the thumbstick on axes 2/3; some runtimes only expose 0/1.
    this.stickX = ax.length >= 4 ? ax[2] : (ax[0] ?? 0);
    this.stickY = ax.length >= 4 ? ax[3] : (ax[1] ?? 0);
  }

  /** Fire-and-forget haptic pulse. Silently ignored where unsupported. */
  pulse(intensity: number, durationMs: number): void {
    const gp = this.gamepad as (Gamepad & { hapticActuators?: { pulse?: (v: number, d: number) => Promise<boolean> }[] }) | null;
    if (!gp) return;
    const v = Math.max(0, Math.min(1, intensity));
    try {
      const act = gp.hapticActuators?.[0];
      if (act && typeof act.pulse === 'function') {
        void act.pulse(v, durationMs);
        return;
      }
      const va = (gp as Gamepad & { vibrationActuator?: GamepadHapticActuator }).vibrationActuator;
      if (va && typeof va.playEffect === 'function') {
        void va.playEffect('dual-rumble', { duration: durationMs, strongMagnitude: v, weakMagnitude: v });
      }
    } catch {
      /* haptics are optional */
    }
  }
}
