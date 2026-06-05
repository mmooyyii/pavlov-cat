export type StringName = 'G' | 'D' | 'A' | 'E';

export interface Fingering {
  position: 1 | 2 | 3;
  string: StringName;
  finger: 0 | 1 | 2 | 3 | 4;
}

export interface Note {
  name: string;       // e.g. "A4"
  frequency: number;  // Hz
  staffStep: number;  // diatonic steps above E4 (treble clef bottom line = 0)
  fingerings: Fingering[];
}

function freq(semitones: number): number {
  return 442 * Math.pow(2, (semitones - 57) / 12);
}

function staffStep(letter: 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B', octave: number): number {
  const idx: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
  return idx[letter] + octave * 7 - 30; // 30 = E4 reference (2 + 4*7)
}

// 1st position: natural notes G3–B5
// 2nd position: one whole-step shift (1st finger starts one step higher)
// 3rd position: 1st finger at 3rd/4th fret equivalent (~C on G string)
export const ALL_NOTES: Note[] = [
  // ── 1st position ──────────────────────────────────────────────────
  { name: 'G3', frequency: freq(43), staffStep: staffStep('G', 3),
    fingerings: [{ position: 1, string: 'G', finger: 0 }] },

  { name: 'A3', frequency: freq(45), staffStep: staffStep('A', 3),
    fingerings: [{ position: 1, string: 'G', finger: 1 }] },

  { name: 'B3', frequency: freq(47), staffStep: staffStep('B', 3),
    fingerings: [{ position: 1, string: 'G', finger: 2 }] },

  { name: 'C4', frequency: freq(48), staffStep: staffStep('C', 4),
    fingerings: [{ position: 1, string: 'G', finger: 3 }] },

  { name: 'D4', frequency: freq(50), staffStep: staffStep('D', 4),
    fingerings: [
      { position: 1, string: 'G', finger: 4 },
      { position: 1, string: 'D', finger: 0 },
    ] },

  { name: 'E4', frequency: freq(52), staffStep: staffStep('E', 4),
    fingerings: [{ position: 1, string: 'D', finger: 1 }] },

  { name: 'F#4', frequency: freq(54), staffStep: staffStep('F', 4),
    fingerings: [{ position: 1, string: 'D', finger: 2 }] },

  { name: 'G4', frequency: freq(55), staffStep: staffStep('G', 4),
    fingerings: [{ position: 1, string: 'D', finger: 3 }] },

  { name: 'A4', frequency: freq(57), staffStep: staffStep('A', 4),
    fingerings: [
      { position: 1, string: 'D', finger: 4 },
      { position: 1, string: 'A', finger: 0 },
    ] },

  { name: 'B4', frequency: freq(59), staffStep: staffStep('B', 4),
    fingerings: [{ position: 1, string: 'A', finger: 1 }] },

  { name: 'C#5', frequency: freq(61), staffStep: staffStep('C', 5),
    fingerings: [{ position: 1, string: 'A', finger: 2 }] },

  { name: 'D5', frequency: freq(62), staffStep: staffStep('D', 5),
    fingerings: [{ position: 1, string: 'A', finger: 3 }] },

  { name: 'E5', frequency: freq(64), staffStep: staffStep('E', 5),
    fingerings: [
      { position: 1, string: 'A', finger: 4 },
      { position: 1, string: 'E', finger: 0 },
    ] },

  { name: 'F#5', frequency: freq(66), staffStep: staffStep('F', 5),
    fingerings: [{ position: 1, string: 'E', finger: 1 }] },

  { name: 'G#5', frequency: freq(68), staffStep: staffStep('G', 5),
    fingerings: [{ position: 1, string: 'E', finger: 2 }] },

  { name: 'A5', frequency: freq(69), staffStep: staffStep('A', 5),
    fingerings: [{ position: 1, string: 'E', finger: 3 }] },

  { name: 'B5', frequency: freq(71), staffStep: staffStep('B', 5),
    fingerings: [{ position: 1, string: 'E', finger: 4 }] },

  // ── 2nd position ───────────────────────────────────────────────────
  // Shift: 1st finger lands one whole step above 1st-position 1st finger.
  // Same finger-interval pattern as 1st position, just shifted up a 3rd.
  { name: 'B3', frequency: freq(47), staffStep: staffStep('B', 3),
    fingerings: [{ position: 2, string: 'G', finger: 1 }] },

  { name: 'C4', frequency: freq(48), staffStep: staffStep('C', 4),
    fingerings: [{ position: 2, string: 'G', finger: 2 }] },

  { name: 'D4', frequency: freq(50), staffStep: staffStep('D', 4),
    fingerings: [{ position: 2, string: 'G', finger: 3 }] },

  { name: 'E4', frequency: freq(52), staffStep: staffStep('E', 4),
    fingerings: [{ position: 2, string: 'G', finger: 4 }] },

  { name: 'F#4', frequency: freq(54), staffStep: staffStep('F', 4),
    fingerings: [{ position: 2, string: 'D', finger: 1 }] },

  { name: 'G4', frequency: freq(55), staffStep: staffStep('G', 4),
    fingerings: [{ position: 2, string: 'D', finger: 2 }] },

  { name: 'A4', frequency: freq(57), staffStep: staffStep('A', 4),
    fingerings: [{ position: 2, string: 'D', finger: 3 }] },

  { name: 'B4', frequency: freq(59), staffStep: staffStep('B', 4),
    fingerings: [{ position: 2, string: 'D', finger: 4 }] },

  { name: 'C#5', frequency: freq(61), staffStep: staffStep('C', 5),
    fingerings: [{ position: 2, string: 'A', finger: 1 }] },

  { name: 'D5', frequency: freq(62), staffStep: staffStep('D', 5),
    fingerings: [{ position: 2, string: 'A', finger: 2 }] },

  { name: 'E5', frequency: freq(64), staffStep: staffStep('E', 5),
    fingerings: [{ position: 2, string: 'A', finger: 3 }] },

  { name: 'F#5', frequency: freq(66), staffStep: staffStep('F', 5),
    fingerings: [{ position: 2, string: 'A', finger: 4 }] },

  { name: 'G#5', frequency: freq(68), staffStep: staffStep('G', 5),
    fingerings: [{ position: 2, string: 'E', finger: 1 }] },

  { name: 'A5', frequency: freq(69), staffStep: staffStep('A', 5),
    fingerings: [{ position: 2, string: 'E', finger: 2 }] },

  { name: 'B5', frequency: freq(71), staffStep: staffStep('B', 5),
    fingerings: [{ position: 2, string: 'E', finger: 3 }] },

  { name: 'C#6', frequency: freq(73), staffStep: staffStep('C', 6),
    fingerings: [{ position: 2, string: 'E', finger: 4 }] },

  // ── 3rd position ───────────────────────────────────────────────────
  // 1st finger one perfect 4th above each open string (where 1st-position
  // 3rd finger was). Pattern W-W-H from f1 to f4 (half step between 3-4),
  // covering exactly a perfect 4th — the natural hand span.
  { name: 'C4', frequency: freq(48), staffStep: staffStep('C', 4),
    fingerings: [{ position: 3, string: 'G', finger: 1 }] },

  { name: 'D4', frequency: freq(50), staffStep: staffStep('D', 4),
    fingerings: [{ position: 3, string: 'G', finger: 2 }] },

  { name: 'E4', frequency: freq(52), staffStep: staffStep('E', 4),
    fingerings: [{ position: 3, string: 'G', finger: 3 }] },

  { name: 'F4', frequency: freq(53), staffStep: staffStep('F', 4),
    fingerings: [{ position: 3, string: 'G', finger: 4 }] },

  { name: 'G4', frequency: freq(55), staffStep: staffStep('G', 4),
    fingerings: [{ position: 3, string: 'D', finger: 1 }] },

  { name: 'A4', frequency: freq(57), staffStep: staffStep('A', 4),
    fingerings: [{ position: 3, string: 'D', finger: 2 }] },

  { name: 'B4', frequency: freq(59), staffStep: staffStep('B', 4),
    fingerings: [{ position: 3, string: 'D', finger: 3 }] },

  { name: 'C5', frequency: freq(60), staffStep: staffStep('C', 5),
    fingerings: [{ position: 3, string: 'D', finger: 4 }] },

  { name: 'D5', frequency: freq(62), staffStep: staffStep('D', 5),
    fingerings: [{ position: 3, string: 'A', finger: 1 }] },

  { name: 'E5', frequency: freq(64), staffStep: staffStep('E', 5),
    fingerings: [{ position: 3, string: 'A', finger: 2 }] },

  { name: 'F#5', frequency: freq(66), staffStep: staffStep('F', 5),
    fingerings: [{ position: 3, string: 'A', finger: 3 }] },

  { name: 'G5', frequency: freq(67), staffStep: staffStep('G', 5),
    fingerings: [{ position: 3, string: 'A', finger: 4 }] },

  { name: 'A5', frequency: freq(69), staffStep: staffStep('A', 5),
    fingerings: [{ position: 3, string: 'E', finger: 1 }] },

  { name: 'B5', frequency: freq(71), staffStep: staffStep('B', 5),
    fingerings: [{ position: 3, string: 'E', finger: 2 }] },

  { name: 'C#6', frequency: freq(73), staffStep: staffStep('C', 6),
    fingerings: [{ position: 3, string: 'E', finger: 3 }] },

  { name: 'D6', frequency: freq(74), staffStep: staffStep('D', 6),
    fingerings: [{ position: 3, string: 'E', finger: 4 }] },
];

// Deduplicate: merge fingerings for same note name across positions
function buildNoteMap(): Map<string, Note> {
  const map = new Map<string, Note>();
  for (const n of ALL_NOTES) {
    if (map.has(n.name)) {
      const existing = map.get(n.name)!;
      for (const f of n.fingerings) {
        if (!existing.fingerings.some(e => e.position === f.position && e.string === f.string && e.finger === f.finger)) {
          existing.fingerings.push(f);
        }
      }
    } else {
      map.set(n.name, { ...n, fingerings: [...n.fingerings] });
    }
  }
  return map;
}

export const NOTES_BY_NAME: Map<string, Note> = buildNoteMap();

export function getFilteredNotes(positions: number[], strings: StringName[]): Note[] {
  const seen = new Set<string>();
  const result: Note[] = [];
  for (const n of NOTES_BY_NAME.values()) {
    const filteredFingerings = n.fingerings.filter(
      f => positions.includes(f.position) && strings.includes(f.string)
    );
    if (filteredFingerings.length > 0 && !seen.has(n.name)) {
      seen.add(n.name);
      result.push({ ...n, fingerings: filteredFingerings });
    }
  }
  // Sort by staff step
  result.sort((a, b) => a.staffStep - b.staffStep);
  return result;
}

// All distinct note names, sorted by pitch (staff step, then frequency for
// natural/sharp ties like F4 vs F#4). Each note carries its full fingering set.
export function allNotesSorted(): Note[] {
  return [...NOTES_BY_NAME.values()]
    .sort((a, b) => a.staffStep - b.staffStep || a.frequency - b.frequency);
}

// Default note pool = old "1st position, all strings" default, to preserve
// the original out-of-the-box experience.
export const DEFAULT_NOTE_NAMES: string[] =
  getFilteredNotes([1], ['G', 'D', 'A', 'E'] as StringName[]).map(n => n.name);

export function fingeringLabel(f: Fingering): string {
  const finger = f.finger === 0 ? '空弦' : `${f.finger}指`;
  const pos = ['', '一', '二', '三'][f.position];
  return `${pos}把位 ${f.string}弦 ${finger}`;
}

// ── Chromatic / key-based note model ─────────────────────────────────────────
// Lets the quiz pool be driven by a major/minor key. The natural notes and the
// hand-entered sharps keep their fingerings; any other accidental resolves to
// no fingering (it can still appear in staff / sound / name questions).

const A4_HZ = 442; // matches freq() reference above
export const PITCH_MIN_MIDI = 55; // G3
export const PITCH_MAX_MIDI = 86; // D6

export function midiToFreq(midi: number): number {
  return A4_HZ * Math.pow(2, (midi - 69) / 12);
}
function freqToMidi(freq: number): number {
  return Math.round(69 + 12 * Math.log2(freq / A4_HZ));
}

// midi → fingerings, derived from the curated note set.
export const FINGERINGS_BY_MIDI = new Map<number, Fingering[]>();
for (const n of NOTES_BY_NAME.values()) {
  FINGERINGS_BY_MIDI.set(freqToMidi(n.frequency), n.fingerings);
}

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export interface Spelled { name: string; staffStep: number; }

// staffStep for a letter + octave (matches private staffStep(): accidentals
// don't move the staff line). 30 = E4 reference.
function stepForLetter(letter: string, octave: number): number {
  return LETTERS.indexOf(letter) + octave * 7 - 30;
}

function accSymbol(delta: number): string {
  if (delta === 2) return '##';
  if (delta === 1) return '#';
  if (delta === -1) return 'b';
  if (delta === -2) return 'bb';
  return '';
}

// Spell a midi pitch using sharps or flats for the black keys.
export function spellMidi(midi: number, acc: 'sharp' | 'flat'): Spelled {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1; // C4 (midi 60) → 4
  const nm = (acc === 'flat' ? FLAT_NAMES : SHARP_NAMES)[pc];
  return { name: `${nm}${octave}`, staffStep: stepForLetter(nm[0], octave) };
}

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10]; // natural minor

function parseTonic(name: string): { letter: string; delta: number } {
  const acc = name.slice(1);
  const delta = acc === '#' ? 1 : acc === 'b' ? -1 : 0;
  return { letter: name[0], delta };
}

// The 7 spelled degrees of a key: each uses a distinct consecutive letter,
// with the accidental needed to hit the target pitch class.
function scaleDegrees(tonicName: string, mode: 'major' | 'minor') {
  const { letter, delta } = parseTonic(tonicName);
  const steps = mode === 'major' ? MAJOR_STEPS : MINOR_STEPS;
  const tonicPc = (LETTER_PC[letter] + delta + 120) % 12;
  const li = LETTERS.indexOf(letter);
  const out: { letter: string; delta: number; pc: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const lt = LETTERS[(li + i) % 7];
    const pc = (tonicPc + steps[i]) % 12;
    let d = ((pc - LETTER_PC[lt] + 6 + 1200) % 12) - 6; // normalize to -6..5
    out.push({ letter: lt, delta: d, pc });
  }
  return out;
}

// Build the note pool for a key: which in-range midis belong to the scale, plus
// a spelling for every in-range pitch (scale tones get their exact spelling;
// the rest follow the key's sharp/flat direction).
export function buildKeyPool(tonicName: string, mode: 'major' | 'minor'): {
  midis: number[];
  spelling: Map<number, Spelled>;
} {
  const degrees = scaleDegrees(tonicName, mode);
  const flats = degrees.filter(d => d.delta < 0).length;
  const sharps = degrees.filter(d => d.delta > 0).length;
  const dir: 'sharp' | 'flat' = flats > sharps ? 'flat' : 'sharp';

  const spelling = new Map<number, Spelled>();
  for (let m = PITCH_MIN_MIDI; m <= PITCH_MAX_MIDI; m++) {
    spelling.set(m, spellMidi(m, dir));
  }

  const byPc = new Map<number, { letter: string; delta: number }>();
  for (const d of degrees) byPc.set(d.pc, d);

  const midis: number[] = [];
  for (let m = PITCH_MIN_MIDI; m <= PITCH_MAX_MIDI; m++) {
    const pc = ((m % 12) + 12) % 12;
    const d = byPc.get(pc);
    if (!d) continue;
    midis.push(m);
    const octave = Math.round((m - d.delta - LETTER_PC[d.letter]) / 12) - 1;
    spelling.set(m, {
      name: `${d.letter}${accSymbol(d.delta)}${octave}`,
      staffStep: stepForLetter(d.letter, octave),
    });
  }
  return { midis, spelling };
}

// Construct a playable Note for a midi + chosen spelling.
export function noteForMidi(midi: number, sp: Spelled): Note {
  return {
    name: sp.name,
    frequency: midiToFreq(midi),
    staffStep: sp.staffStep,
    fingerings: FINGERINGS_BY_MIDI.get(midi) ?? [],
  };
}

// Default pool = old "1st position, all strings" notes, as midi values, so the
// quiz works out of the box and fingering question types have material.
export const DEFAULT_MIDIS: number[] =
  getFilteredNotes([1], ['G', 'D', 'A', 'E'] as StringName[]).map(n => freqToMidi(n.frequency));

// Tonics offered per mode (chosen to avoid double accidentals).
export const TONICS_MAJOR = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
export const TONICS_MINOR = ['A', 'E', 'B', 'F#', 'C#', 'G#', 'Eb', 'Bb', 'F', 'C', 'G', 'D'];
