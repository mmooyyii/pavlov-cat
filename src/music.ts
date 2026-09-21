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

// All 24 keys. Ordered by tonic pitch (not the circle of fifths) because this
// list is for *finding* a key you already have in mind — by-pitch is the order
// anyone can scan. Enharmonic tonics get their conventional spelling (D♭ not
// C♯ for the major, C♯ not D♭ for the minor). `sharps` is the key signature:
// positive = that many sharps, negative = that many flats.
export const COMMON_KEYS: { label: string; tonicPc: number; mode: Mode; sharps: number }[] = [
  { label: 'C 大调',  tonicPc: 0,  mode: 'major', sharps: 0 },
  { label: 'D♭ 大调', tonicPc: 1,  mode: 'major', sharps: -5 },
  { label: 'D 大调',  tonicPc: 2,  mode: 'major', sharps: 2 },
  { label: 'E♭ 大调', tonicPc: 3,  mode: 'major', sharps: -3 },
  { label: 'E 大调',  tonicPc: 4,  mode: 'major', sharps: 4 },
  { label: 'F 大调',  tonicPc: 5,  mode: 'major', sharps: -1 },
  { label: 'F♯ 大调', tonicPc: 6,  mode: 'major', sharps: 6 },
  { label: 'G 大调',  tonicPc: 7,  mode: 'major', sharps: 1 },
  { label: 'A♭ 大调', tonicPc: 8,  mode: 'major', sharps: -4 },
  { label: 'A 大调',  tonicPc: 9,  mode: 'major', sharps: 3 },
  { label: 'B♭ 大调', tonicPc: 10, mode: 'major', sharps: -2 },
  { label: 'B 大调',  tonicPc: 11, mode: 'major', sharps: 5 },
  { label: 'C 小调',  tonicPc: 0,  mode: 'minor', sharps: -3 },
  { label: 'C♯ 小调', tonicPc: 1,  mode: 'minor', sharps: 4 },
  { label: 'D 小调',  tonicPc: 2,  mode: 'minor', sharps: -1 },
  { label: 'E♭ 小调', tonicPc: 3,  mode: 'minor', sharps: -6 },
  { label: 'E 小调',  tonicPc: 4,  mode: 'minor', sharps: 1 },
  { label: 'F 小调',  tonicPc: 5,  mode: 'minor', sharps: -4 },
  { label: 'F♯ 小调', tonicPc: 6,  mode: 'minor', sharps: 3 },
  { label: 'G 小调',  tonicPc: 7,  mode: 'minor', sharps: -2 },
  { label: 'G♯ 小调', tonicPc: 8,  mode: 'minor', sharps: 5 },
  { label: 'A 小调',  tonicPc: 9,  mode: 'minor', sharps: 0 },
  { label: 'B♭ 小调', tonicPc: 10, mode: 'minor', sharps: -5 },
  { label: 'B 小调',  tonicPc: 11, mode: 'minor', sharps: 2 },
];

// Sharps and flats always appear in these fixed orders, so the signature can
// be spelled out from the count alone.
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'] as const;
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'] as const;

/** Which notes carry an accidental in this key, e.g. "F♯ C♯" for D major. */
export function keySignatureText(sharps: number): string {
  if (sharps > 0) return SHARP_ORDER.slice(0, sharps).map(n => `${n}♯`).join(' ');
  if (sharps < 0) return FLAT_ORDER.slice(0, -sharps).map(n => `${n}♭`).join(' ');
  return '无升降号';
}

// D major: open-string resonance makes it the friendliest starting key on a
// violin, so it stays the default even though C major heads the list.
export const DEFAULT_KEY_INDEX =
  COMMON_KEYS.findIndex(k => k.tonicPc === 2 && k.mode === 'major');

// The pre-expansion 12-key list, in its original order. Settings used to store
// a bare index into it; without this table an upgrade would silently move the
// user to a different key.
export const LEGACY_KEY_ORDER: readonly (readonly [number, Mode])[] = [
  [2, 'major'], [9, 'major'], [7, 'major'], [0, 'major'], [5, 'major'], [10, 'major'],
  [4, 'major'], [9, 'minor'], [4, 'minor'], [2, 'minor'], [7, 'minor'], [11, 'minor'],
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
