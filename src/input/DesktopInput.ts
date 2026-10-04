/**
 * Keyboard + mouse state for the non-VR test path (also used for automated tests).
 * Key codes use KeyboardEvent.code so layouts (QWERTY / 두벌식) do not matter.
 */
export class DesktopInput {
  private readonly keys = new Set<string>();
  private readonly downThisFrame = new Set<string>();
  private readonly upThisFrame = new Set<string>();
  private pendingDown = new Set<string>();
  private pendingUp = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  private accDX = 0;
  private accDY = 0;
  mouseLeft = false;
  mouseLeftDown = false;
  mouseRight = false;
  mouseRightDown = false;
  private pendingLeftDown = false;
  private pendingRightDown = false;
  pointerLocked = false;
  /** Disabled while a DOM overlay (title, menu) has focus. */
  enabled = true;

  constructor(private readonly element: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'F3', 'F4'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pendingDown.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.pendingUp.add(e.code);
    });
    window.addEventListener('blur', () => this.keys.clear());
    element.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (e.button === 0) {
        this.mouseLeft = true;
        this.pendingLeftDown = true;
      }
      if (e.button === 2) {
        this.mouseRight = true;
        this.pendingRightDown = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseLeft = false;
      if (e.button === 2) this.mouseRight = false;
    });
    element.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked || !this.enabled) return;
      this.accDX += e.movementX;
      this.accDY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.element;
    });
  }

  requestPointerLock(): void {
    try {
      const p = this.element.requestPointerLock() as unknown;
      if (p instanceof Promise) p.catch(() => undefined);
    } catch {
      /* pointer lock may be unavailable (iframes, automation) */
    }
  }

  /** Call once per frame before reading. */
  update(): void {
    this.downThisFrame.clear();
    this.upThisFrame.clear();
    for (const k of this.pendingDown) this.downThisFrame.add(k);
    for (const k of this.pendingUp) this.upThisFrame.add(k);
    this.pendingDown.clear();
    this.pendingUp.clear();
    this.mouseDX = this.accDX;
    this.mouseDY = this.accDY;
    this.accDX = 0;
    this.accDY = 0;
    this.mouseLeftDown = this.pendingLeftDown;
    this.mouseRightDown = this.pendingRightDown;
    this.pendingLeftDown = false;
    this.pendingRightDown = false;
  }

  held(code: string): boolean {
    return this.enabled && this.keys.has(code);
  }

  pressed(code: string): boolean {
    return this.enabled && this.downThisFrame.has(code);
  }

  released(code: string): boolean {
    return this.upThisFrame.has(code);
  }

  /** Test hook: simulate a key press for one frame. */
  simulateKey(code: string, down: boolean): void {
    if (down) {
      if (!this.keys.has(code)) this.pendingDown.add(code);
      this.keys.add(code);
    } else {
      this.keys.delete(code);
      this.pendingUp.add(code);
    }
  }
}
