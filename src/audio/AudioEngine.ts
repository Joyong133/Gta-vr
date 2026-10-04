import * as THREE from 'three';
import type { AudioSettings } from '../config/settings';

/**
 * Procedural WebAudio sound: every sound is synthesised at runtime, so the game
 * needs no audio files (nothing to license, nothing missing at runtime).
 * Spatial sounds use PannerNodes (HRTF for the few important loops).
 *
 * Swap-in point for real assets: replace a `play*` method body with an
 * AudioBufferSourceNode fed by a decoded file; the call sites stay the same.
 */
export type OneShot =
  | 'footstep'
  | 'door_open'
  | 'door_close'
  | 'grab'
  | 'release'
  | 'socket'
  | 'button'
  | 'ui'
  | 'cash'
  | 'mission_start'
  | 'mission_complete'
  | 'mission_fail'
  | 'checkpoint'
  | 'blaster'
  | 'zap_hit'
  | 'wanted_up'
  | 'busted'
  | 'alarm'
  | 'honk'
  | 'garage';

const _p = new THREE.Vector3();
const _f = new THREE.Vector3();
const _u = new THREE.Vector3();

class Loop {
  readonly panner: PannerNode;
  readonly gain: GainNode;
  constructor(
    readonly ctx: AudioContext,
    out: AudioNode,
    hrtf: boolean,
  ) {
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.panner = ctx.createPanner();
    this.panner.panningModel = hrtf ? 'HRTF' : 'equalpower';
    this.panner.distanceModel = 'inverse';
    this.panner.refDistance = 4;
    this.panner.maxDistance = 400;
    this.panner.rolloffFactor = 1;
    this.gain.connect(this.panner).connect(out);
  }
  setPos(p: THREE.Vector3): void {
    setPannerPos(this.panner, p);
  }
}

function setPannerPos(pan: PannerNode, p: THREE.Vector3): void {
  if (pan.positionX) {
    pan.positionX.value = p.x;
    pan.positionY.value = p.y;
    pan.positionZ.value = p.z;
  } else {
    (pan as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(p.x, p.y, p.z);
  }
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private veh!: GainNode;
  private noise!: AudioBuffer;
  // Engine loop
  private engine?: { loop: Loop; osc1: OscillatorNode; osc2: OscillatorNode; filter: BiquadFilterNode };
  private sirens: { loop: Loop; osc: OscillatorNode; lfo: OscillatorNode }[] = [];
  private horn?: { loop: Loop; o1: OscillatorNode; o2: OscillatorNode };
  private ambienceTimer = 0;
  private settings: AudioSettings = { master: 0.8, sfx: 0.9, ambience: 0.6, vehicle: 0.8 };

  /** Must be called from a user gesture (browser autoplay policy). */
  resume(): void {
    try {
      if (!this.ctx) this.init();
      void this.ctx?.resume();
    } catch {
      this.ctx = null; // audio unavailable: game continues silently
    }
  }

  get running(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  private init(): void {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.amb = ctx.createGain();
    this.veh = ctx.createGain();
    this.sfx.connect(this.master);
    this.amb.connect(this.master);
    this.veh.connect(this.master);
    // 2 s of white noise reused by all noise-based sounds.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applySettings(this.settings);
    this.startAmbience();
    this.startEngine();
    for (let i = 0; i < 2; i++) this.sirens.push(this.makeSiren());
    this.makeHorn();
  }

  applySettings(s: AudioSettings): void {
    this.settings = { ...s };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(s.sfx, t, 0.05);
    this.amb.gain.setTargetAtTime(s.ambience, t, 0.05);
    this.veh.gain.setTargetAtTime(s.vehicle, t, 0.05);
  }

  /** Listener follows the head (call every frame with the camera). */
  updateListener(camera: THREE.Camera): void {
    const ctx = this.ctx;
    if (!ctx) return;
    camera.getWorldPosition(_p);
    camera.getWorldDirection(_f);
    _u.set(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.value = _p.x;
      l.positionY.value = _p.y;
      l.positionZ.value = _p.z;
      l.forwardX.value = _f.x;
      l.forwardY.value = _f.y;
      l.forwardZ.value = _f.z;
      l.upX.value = _u.x;
      l.upY.value = _u.y;
      l.upZ.value = _u.z;
    } else {
      const ll = l as unknown as { setPosition(x: number, y: number, z: number): void; setOrientation(a: number, b: number, c: number, d: number, e: number, f: number): void };
      ll.setPosition(_p.x, _p.y, _p.z);
      ll.setOrientation(_f.x, _f.y, _f.z, _u.x, _u.y, _u.z);
    }
  }

  private out(pos?: THREE.Vector3, bus?: GainNode): AudioNode {
    const ctx = this.ctx!;
    const dest = bus ?? this.sfx;
    if (!pos) return dest;
    const pan = ctx.createPanner();
    pan.panningModel = 'equalpower';
    pan.distanceModel = 'inverse';
    pan.refDistance = 2;
    pan.maxDistance = 200;
    setPannerPos(pan, pos);
    pan.connect(dest);
    return pan;
  }

  private env(g: GainNode, t0: number, attack: number, peak: number, decay: number): void {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, peak: number, dest: AudioNode, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.005, peak, dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noiseBurst(dur: number, peak: number, filterType: BiquadFilterType, freq: number, dest: AudioNode, q = 1, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, 0.003, peak, dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  play(kind: OneShot, pos?: THREE.Vector3, strength = 1): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const o = this.out(pos);
    switch (kind) {
      case 'footstep':
        this.noiseBurst(0.07, 0.25, 'bandpass', 900 + Math.random() * 300, o, 1.2);
        this.tone('sine', 120, 60, 0.06, 0.12, o);
        break;
      case 'door_open':
        this.noiseBurst(0.25, 0.15, 'bandpass', 2400, o, 6);
        this.tone('triangle', 300, 520, 0.25, 0.05, o);
        break;
      case 'door_close':
        this.tone('sine', 140, 50, 0.18, 0.5, o);
        this.noiseBurst(0.08, 0.25, 'lowpass', 1200, o);
        break;
      case 'grab':
        this.tone('sine', 880, 1320, 0.05, 0.08, o);
        break;
      case 'release':
        this.tone('sine', 660, 440, 0.06, 0.05, o);
        break;
      case 'socket':
        this.tone('triangle', 520, 520, 0.08, 0.2, o);
        this.tone('triangle', 780, 780, 0.12, 0.2, o, 0.08);
        break;
      case 'button':
        this.tone('square', 1200, 900, 0.04, 0.06, o);
        this.noiseBurst(0.03, 0.12, 'highpass', 3000, o);
        break;
      case 'ui':
        this.tone('sine', 1400, 1100, 0.04, 0.06, o);
        break;
      case 'cash':
        [988, 1319, 1568, 1976].forEach((f, i) => this.tone('square', f, f, 0.07, 0.07, o, i * 0.06));
        break;
      case 'mission_start':
        [392, 523, 659].forEach((f, i) => this.tone('triangle', f, f, 0.18, 0.18, o, i * 0.12));
        break;
      case 'mission_complete':
        [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, 0.22, 0.2, o, i * 0.11));
        break;
      case 'mission_fail':
        [392, 330, 262].forEach((f, i) => this.tone('sawtooth', f, f * 0.95, 0.3, 0.1, o, i * 0.2));
        break;
      case 'checkpoint':
        this.tone('sine', 880, 1760, 0.15, 0.2, o);
        this.tone('sine', 1320, 1320, 0.15, 0.12, o, 0.08);
        break;
      case 'blaster':
        this.tone('sawtooth', 1800, 120, 0.22, 0.22, o);
        this.noiseBurst(0.12, 0.15, 'highpass', 2500, o);
        break;
      case 'zap_hit':
        this.noiseBurst(0.18, 0.3 * strength, 'bandpass', 1800, o, 2);
        this.tone('square', 300, 80, 0.15, 0.1, o);
        break;
      case 'wanted_up':
        this.tone('square', 660, 660, 0.12, 0.08, o);
        this.tone('square', 880, 880, 0.12, 0.08, o, 0.14);
        break;
      case 'busted':
        [523, 392, 262, 196].forEach((f, i) => this.tone('square', f, f, 0.25, 0.1, o, i * 0.18));
        break;
      case 'alarm':
        for (let i = 0; i < 6; i++) this.tone('square', 900, 700, 0.25, 0.12, o, i * 0.3);
        break;
      case 'honk':
        this.tone('square', 400, 400, 0.35, 0.12, o);
        this.tone('square', 500, 500, 0.35, 0.1, o);
        break;
      case 'garage':
        this.noiseBurst(2.2, 0.12, 'lowpass', 500, o);
        this.tone('sawtooth', 70, 90, 2.0, 0.04, o);
        break;
    }
  }

  /** Collision / impact, louder and duller for harder hits. */
  impact(pos: THREE.Vector3, strength: number): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const o = this.out(pos);
    const s = Math.min(1, strength);
    this.noiseBurst(0.12 + s * 0.25, 0.2 + s * 0.6, 'lowpass', 2500 - s * 1700, o);
    this.tone('sine', 110, 40, 0.2 + s * 0.2, 0.3 * s, o);
    if (s > 0.5) this.noiseBurst(0.4, 0.15, 'highpass', 4000, o, 0.7, 0.03); // glass/metal rattle
  }

  // ---------------- continuous sounds ----------------
  private startEngine(): void {
    const ctx = this.ctx!;
    const loop = new Loop(ctx, this.veh, true);
    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    const g2 = ctx.createGain();
    g2.gain.value = 0.4;
    osc1.connect(filter);
    osc2.connect(g2).connect(filter);
    filter.connect(loop.gain);
    osc1.start();
    osc2.start();
    this.engine = { loop, osc1, osc2, filter };
  }

  /** speed m/s, throttle 0..1, active = player car exists near the listener. */
  updateEngine(pos: THREE.Vector3, speed: number, throttle: number, running: boolean): void {
    const e = this.engine;
    if (!e || !this.ctx) return;
    const t = this.ctx.currentTime;
    // Fake gearbox: rpm saw-tooths with speed.
    const gear = Math.min(4, Math.floor(Math.abs(speed) / 9));
    const inGear = (Math.abs(speed) - gear * 9) / 9;
    const rpm = 0.25 + inGear * 0.6 + throttle * 0.15;
    const f = 38 + rpm * 70;
    e.osc1.frequency.setTargetAtTime(f, t, 0.05);
    e.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    e.filter.frequency.setTargetAtTime(350 + throttle * 1400 + rpm * 400, t, 0.05);
    e.loop.gain.gain.setTargetAtTime(running ? 0.12 + throttle * 0.12 : 0.0, t, 0.1);
    e.loop.setPos(pos);
  }

  private makeSiren(): { loop: Loop; osc: OscillatorNode; lfo: OscillatorNode } {
    const ctx = this.ctx!;
    const loop = new Loop(ctx, this.sfx, false);
    loop.panner.refDistance = 10;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 750;
    const lfo = ctx.createOscillator();
    lfo.type = 'triangle';
    lfo.frequency.value = 0.35;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 260;
    lfo.connect(lfoGain).connect(osc.frequency);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1200;
    filter.Q.value = 0.7;
    osc.connect(filter).connect(loop.gain);
    osc.start();
    lfo.start();
    return { loop, osc, lfo };
  }

  /** Up to two sirens (nearest police units). */
  updateSirens(positions: THREE.Vector3[]): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sirens.forEach((s, i) => {
      const p = positions[i];
      if (p) {
        s.loop.setPos(p);
        s.loop.gain.gain.setTargetAtTime(0.09, t, 0.2);
      } else s.loop.gain.gain.setTargetAtTime(0, t, 0.3);
    });
  }

  private makeHorn(): void {
    const ctx = this.ctx!;
    const loop = new Loop(ctx, this.veh, true);
    const o1 = ctx.createOscillator();
    o1.type = 'square';
    o1.frequency.value = 415;
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.value = 523;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1800;
    o1.connect(f);
    o2.connect(f);
    f.connect(loop.gain);
    o1.start();
    o2.start();
    this.horn = { loop, o1, o2 };
  }

  setHorn(on: boolean, pos: THREE.Vector3): void {
    if (!this.horn || !this.ctx) return;
    this.horn.loop.setPos(pos);
    this.horn.loop.gain.gain.setTargetAtTime(on ? 0.1 : 0, this.ctx.currentTime, 0.02);
  }

  private startAmbience(): void {
    const ctx = this.ctx!;
    // City rumble: brown-ish filtered noise.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    const g = ctx.createGain();
    g.gain.value = 0.22;
    src.connect(lp).connect(g).connect(this.amb);
    src.start();
    // Neon hum (60 Hz-ish buzz) - subtle
    const hum = ctx.createOscillator();
    hum.type = 'sawtooth';
    hum.frequency.value = 60;
    const hf = ctx.createBiquadFilter();
    hf.type = 'bandpass';
    hf.frequency.value = 240;
    hf.Q.value = 8;
    const hg = ctx.createGain();
    hg.gain.value = 0.012;
    hum.connect(hf).connect(hg).connect(this.amb);
    hum.start();
  }

  /** Random distant city events (horns, chatter-like blips). */
  updateAmbience(dt: number, listener: THREE.Vector3): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    this.ambienceTimer -= dt;
    if (this.ambienceTimer > 0) return;
    this.ambienceTimer = 4 + Math.random() * 7;
    const a = Math.random() * Math.PI * 2;
    const d = 40 + Math.random() * 60;
    _p.set(listener.x + Math.cos(a) * d, 2, listener.z + Math.sin(a) * d);
    const o = this.out(_p, this.amb);
    if (Math.random() < 0.6) {
      const f = 300 + Math.random() * 200;
      this.tone('square', f, f, 0.25 + Math.random() * 0.3, 0.05, o);
    } else {
      this.noiseBurst(0.6, 0.05, 'bandpass', 600 + Math.random() * 800, o, 3);
    }
  }
}
