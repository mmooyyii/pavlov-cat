import { midiToFreq } from './music';

// A sustained reference tone ("drone") to practise intonation against — the
// single most effective tool for a beginner's ear. Deliberately NOT a pure
// sine: each pitch is built from two slightly-detuned triangle voices plus a
// soft sub-octave sine, run through a gentle low-pass, giving a warm organ/
// string-like pad that's easy to tune to and pleasant to leave running.

export type DroneMode = 'off' | 'root' | 'fifth';

const VOICE: { type: OscillatorType; mult: number; detune: number; level: number }[] = [
  { type: 'triangle', mult: 1, detune: -4, level: 1.0 },
  { type: 'triangle', mult: 1, detune: 4, level: 1.0 },
  { type: 'sine', mult: 0.5, detune: 0, level: 0.7 }, // sub-octave body
];

export class Drone {
  private ctx: AudioContext;
  private lp: BiquadFilterNode;
  private master: GainNode;
  private oscs: OscillatorNode[] = [];
  private nodes: AudioNode[] = [];

  mode: DroneMode = 'off';
  rootMidi = 57; // A3 — a low, unobtrusive drone by default
  vol = 0.18;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 2200;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.lp.connect(this.master);
    this.master.connect(ctx.destination);
  }

  private addPitch(freq: number, gainFrac: number): void {
    for (const v of VOICE) {
      const o = this.ctx.createOscillator();
      o.type = v.type;
      o.frequency.value = freq * v.mult;
      o.detune.value = v.detune;
      const g = this.ctx.createGain();
      g.gain.value = gainFrac * v.level;
      o.connect(g);
      g.connect(this.lp);
      o.start();
      this.oscs.push(o);
      this.nodes.push(g);
    }
  }

  private stopOscs(): void {
    for (const o of this.oscs) { try { o.stop(); o.disconnect(); } catch { /* */ } }
    for (const n of this.nodes) { try { n.disconnect(); } catch { /* */ } }
    this.oscs = [];
    this.nodes = [];
  }

  private rebuild(): void {
    this.stopOscs();
    if (this.mode === 'off') return;
    this.addPitch(midiToFreq(this.rootMidi), 0.5);
    if (this.mode === 'fifth') this.addPitch(midiToFreq(this.rootMidi + 7), 0.3);
  }

  // Apply a new configuration and cross-fade the master gain to avoid clicks.
  set(mode: DroneMode, rootMidi: number, vol: number): void {
    this.mode = mode;
    this.rootMidi = rootMidi;
    this.vol = vol;
    this.rebuild();
    const now = this.ctx.currentTime;
    const target = mode === 'off' ? 0 : vol;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(target, now + 0.08);
  }

  get playing(): boolean {
    return this.mode !== 'off';
  }

  dispose(): void {
    this.stopOscs();
    try { this.master.disconnect(); this.lp.disconnect(); } catch { /* */ }
  }
}
