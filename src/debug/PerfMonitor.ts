import type * as THREE from 'three';

/**
 * Frame timing: CPU time per section (performance.now) and, where the browser
 * exposes EXT_disjoint_timer_query_webgl2, GPU time of the main render pass.
 * Numbers are measured on the running machine; nothing here is estimated.
 */
export class PerfMonitor {
  private readonly sections = new Map<string, number>();
  private readonly avg = new Map<string, number>();
  private starts = new Map<string, number>();
  frameMs = 0;
  frameMsMax = 0;
  fps = 0;
  private frames = 0;
  private acc = 0;
  private maxAcc = 0;
  gpuMs: number | null = null;
  private ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private query: WebGLQuery | null = null;
  private queryActive = false;
  private queryPending: WebGLQuery | null = null;

  constructor(renderer: THREE.WebGLRenderer) {
    try {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      if (ext) {
        this.gl = gl;
        this.ext = ext as unknown as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };
      }
    } catch {
      /* not available */
    }
  }

  get gpuTimerAvailable(): boolean {
    return this.ext !== null;
  }

  begin(name: string): void {
    this.starts.set(name, performance.now());
  }

  end(name: string): void {
    const s = this.starts.get(name);
    if (s === undefined) return;
    this.sections.set(name, (this.sections.get(name) ?? 0) + (performance.now() - s));
  }

  beginGpu(): void {
    if (!this.gl || !this.ext || this.queryActive || this.queryPending) return;
    this.query = this.gl.createQuery();
    if (!this.query) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.query);
    this.queryActive = true;
  }

  endGpu(): void {
    if (!this.gl || !this.ext || !this.queryActive) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.queryActive = false;
    this.queryPending = this.query;
  }

  private pollGpu(): void {
    const gl = this.gl;
    const q = this.queryPending;
    if (!gl || !q || !this.ext) return;
    const available = gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE);
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    if (available) {
      if (!disjoint) {
        const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
        const ms = ns / 1e6;
        this.gpuMs = this.gpuMs === null ? ms : this.gpuMs * 0.9 + ms * 0.1;
      }
      gl.deleteQuery(q);
      this.queryPending = null;
    }
  }

  /** Call once per frame with the real frame delta (seconds). */
  frame(dt: number): void {
    this.pollGpu();
    this.frames++;
    this.acc += dt;
    this.maxAcc = Math.max(this.maxAcc, dt);
    for (const [k, v] of this.sections) this.avg.set(k, (this.avg.get(k) ?? v) * 0.9 + v * 0.1);
    this.sections.clear();
    if (this.acc >= 0.5) {
      this.fps = this.frames / this.acc;
      this.frameMs = (this.acc / this.frames) * 1000;
      this.frameMsMax = this.maxAcc * 1000;
      this.frames = 0;
      this.acc = 0;
      this.maxAcc = 0;
    }
  }

  sectionMs(name: string): number {
    return this.avg.get(name) ?? 0;
  }

  report(): string {
    const parts = [...this.avg.entries()].map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' | ');
    return parts;
  }
}
