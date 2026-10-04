/**
 * Fixed-capacity object pool. Objects are created up front so that gameplay
 * (projectiles, sparks, markers) never allocates during play.
 */
export class Pool<T> {
  private readonly free: T[] = [];
  readonly all: T[] = [];

  constructor(
    capacity: number,
    create: (index: number) => T,
    private readonly onAcquire?: (item: T) => void,
    private readonly onRelease?: (item: T) => void,
  ) {
    for (let i = 0; i < capacity; i++) {
      const item = create(i);
      this.all.push(item);
      this.free.push(item);
    }
  }

  /** Returns a free item, or null when the pool is exhausted (caller decides to skip). */
  acquire(): T | null {
    const item = this.free.pop();
    if (item === undefined) return null;
    this.onAcquire?.(item);
    return item;
  }

  release(item: T): void {
    if (this.free.includes(item)) return;
    this.onRelease?.(item);
    this.free.push(item);
  }

  get available(): number {
    return this.free.length;
  }
}
