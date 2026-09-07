// ── Shared music theory & pitch math ────────────────────────────────────────
// Single source of truth for tuning and note math. Everything in the app that
// converts between frequency / MIDI / note name goes through here so the
// reference lanes, the judgment, and the numeric readout can never disagree
// about what "in tune" means.

// Orchestral pitch standard. The whole app tunes to A4 = 442 Hz (not 440).
export const A4_HZ = 442;

export const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export function midiToFreq(midi: number, a4: number = A4_HZ): number {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

export function freqToMidi(freq: number, a4: number = A4_HZ): number {
  return 69 + 12 * Math.log2(freq / a4);
}

export function midiToNoteName(midi: number): string {
  const idx = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return NOTE_NAMES_SHARP[idx] + octave;
}

// Signed cents from f2 to f1 (positive = f1 is sharp of f2).
export function centsBetween(f1: number, f2: number): number {
  return 1200 * Math.log2(f1 / f2);
}

// ── Scales & keys ────────────────────────────────────────────────────────────
export type Mode = 'major' | 'minor';
export type Temperament = 'equal' | 'just';

// Semitone offsets from the tonic, one octave.
export const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11] as const;
export const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10] as const; // natural minor

// 5-limit just-intonation ratios per scale degree (index aligned to *_STEPS).
const JUST_MAJOR = [1 / 1, 9 / 8, 5 / 4, 4 / 3, 3 / 2, 5 / 3, 15 / 8];
const JUST_MINOR = [1 / 1, 9 / 8, 6 / 5, 4 / 3, 3 / 2, 8 / 5, 9 / 5];

export interface Key {
  tonicPc: number;       // 0..11, C = 0
  mode: Mode;
  temperament: Temperament;
  a4: number;
}

// Beginner-friendly key list. Violin-friendly keys (open-string sympathetic
// resonance) come first so a newcomer picks a comfortable one by default.
export const COMMON_KEYS: { label: string; tonicPc: number; mode: Mode }[] = [
  { label: 'D 大调', tonicPc: 2, mode: 'major' },
  { label: 'A 大调', tonicPc: 9, mode: 'major' },
  { label: 'G 大调', tonicPc: 7, mode: 'major' },
  { label: 'C 大调', tonicPc: 0, mode: 'major' },
  { label: 'F 大调', tonicPc: 5, mode: 'major' },
  { label: 'B♭ 大调', tonicPc: 10, mode: 'major' },
  { label: 'E 大调', tonicPc: 4, mode: 'major' },
  { label: 'A 小调', tonicPc: 9, mode: 'minor' },
  { label: 'E 小调', tonicPc: 4, mode: 'minor' },
  { label: 'D 小调', tonicPc: 2, mode: 'minor' },
  { label: 'G 小调', tonicPc: 7, mode: 'minor' },
  { label: 'B 小调', tonicPc: 11, mode: 'minor' },
];

export function scaleSteps(mode: Mode): readonly number[] {
  return mode === 'major' ? MAJOR_STEPS : MINOR_STEPS;
}

// Is this MIDI note a member of the key's scale?
export function isInScale(midi: number, key: Key): boolean {
  const pc = (((midi - key.tonicPc) % 12) + 12) % 12;
  return scaleSteps(key.mode).includes(pc);
}

// Ideal frequency for a target MIDI note in a key. Equal temperament is the
// plain default; just intonation anchors each octave's tonic to equal
// temperament and tunes the degrees within it by pure ratios. Chromatic notes
// outside the scale always fall back to equal temperament.
export function targetFreq(midi: number, key: Key): number {
  if (key.temperament === 'equal') return midiToFreq(midi, key.a4);
  const pc = (((midi - key.tonicPc) % 12) + 12) % 12;
  const steps = scaleSteps(key.mode);
  const degree = steps.indexOf(pc);
  if (degree < 0) return midiToFreq(midi, key.a4);
  const ratios = key.mode === 'major' ? JUST_MAJOR : JUST_MINOR;
  // Tonic at or below this note, anchored to equal temperament.
  const tonicMidiBelow = midi - (((midi - key.tonicPc) % 12) + 12) % 12;
  return midiToFreq(tonicMidiBelow, key.a4) * ratios[degree];
}

// Nearest scale-tone MIDI to an arbitrary MIDI value (for scale-mode judging).
export function nearestScaleMidi(midi: number, key: Key): number {
  const r = Math.round(midi);
  for (let d = 0; d <= 6; d++) {
    if (isInScale(r - d, key)) return r - d;
    if (isInScale(r + d, key)) return r + d;
  }
  return r;
}

// ── Target track (shared by scale-mode and imported scores) ─────────────────
// A single note the player is meant to hit: pitch, when it starts, how long.
export interface TargetNote {
  midi: number;
  startBeat: number;
  durBeat: number;
  name: string;      // display label, e.g. "A4"
}

export interface TargetTrack {
  notes: TargetNote[];
  totalBeats: number;
  title: string;
  bpm: number | null;   // score-declared tempo, if any
}
