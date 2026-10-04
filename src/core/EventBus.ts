/**
 * Minimal typed event bus. Systems publish facts ("crime happened", "zone entered")
 * and other systems react; nobody needs a direct reference to the publisher.
 */
export type Listener<T> = (payload: T) => void;

export class EventBus<Events extends Record<string, unknown>> {
  private listeners: { [K in keyof Events]?: Listener<Events[K]>[] } = {};

  on<K extends keyof Events>(type: K, fn: Listener<Events[K]>): () => void {
    const list = (this.listeners[type] ??= []);
    list.push(fn);
    return () => this.off(type, fn);
  }

  off<K extends keyof Events>(type: K, fn: Listener<Events[K]>): void {
    const list = this.listeners[type];
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const list = this.listeners[type];
    if (!list) return;
    // Copy so listeners may unsubscribe while being notified.
    for (const fn of list.slice()) fn(payload);
  }
}
