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
  // Shift: open strings same, 1st finger moves up 1 whole step
  { name: 'B3', frequency: freq(47), staffStep: staffStep('B', 3),
    fingerings: [{ position: 2, string: 'G', finger: 1 }] },

  { name: 'C4', frequency: freq(48), staffStep: staffStep('C', 4),
    fingerings: [{ position: 2, string: 'G', finger: 2 }] },

  { name: 'D4', frequency: freq(50), staffStep: staffStep('D', 4),
    fingerings: [{ position: 2, string: 'G', finger: 3 }, { position: 2, string: 'D', finger: 1 }] },

  { name: 'E4', frequency: freq(52), staffStep: staffStep('E', 4),
    fingerings: [{ position: 2, string: 'G', finger: 4 }, { position: 2, string: 'D', finger: 2 }] },

  { name: 'F4', frequency: freq(53), staffStep: staffStep('F', 4),
    fingerings: [{ position: 2, string: 'D', finger: 2 }] },

  { name: 'G4', frequency: freq(55), staffStep: staffStep('G', 4),
    fingerings: [{ position: 2, string: 'D', finger: 3 }, { position: 2, string: 'A', finger: 1 }] },

  { name: 'A4', frequency: freq(57), staffStep: staffStep('A', 4),
    fingerings: [{ position: 2, string: 'D', finger: 4 }, { position: 2, string: 'A', finger: 2 }] },

  { name: 'B4', frequency: freq(59), staffStep: staffStep('B', 4),
    fingerings: [{ position: 2, string: 'A', finger: 3 }, { position: 2, string: 'E', finger: 1 }] },

  { name: 'C5', frequency: freq(60), staffStep: staffStep('C', 5),
    fingerings: [{ position: 2, string: 'A', finger: 3 }] },

  { name: 'D5', frequency: freq(62), staffStep: staffStep('D', 5),
    fingerings: [{ position: 2, string: 'A', finger: 4 }, { position: 2, string: 'E', finger: 3 }] },

  { name: 'E5', frequency: freq(64), staffStep: staffStep('E', 5),
    fingerings: [{ position: 2, string: 'E', finger: 3 }] },

  { name: 'F5', frequency: freq(65), staffStep: staffStep('F', 5),
    fingerings: [{ position: 2, string: 'E', finger: 4 }] },

  // ── 3rd position ───────────────────────────────────────────────────
  // Shift: 1st finger starts at C on G string (2 whole steps from G open)
  { name: 'C4', frequency: freq(48), staffStep: staffStep('C', 4),
    fingerings: [{ position: 3, string: 'G', finger: 1 }] },

  { name: 'D4', frequency: freq(50), staffStep: staffStep('D', 4),
    fingerings: [{ position: 3, string: 'G', finger: 2 }, { position: 3, string: 'D', finger: 1 }] },

  { name: 'E4', frequency: freq(52), staffStep: staffStep('E', 4),
    fingerings: [{ position: 3, string: 'G', finger: 3 }, { position: 3, string: 'D', finger: 2 }] },

  { name: 'F4', frequency: freq(53), staffStep: staffStep('F', 4),
    fingerings: [{ position: 3, string: 'G', finger: 4 }] },

  { name: 'G4', frequency: freq(55), staffStep: staffStep('G', 4),
    fingerings: [{ position: 3, string: 'D', finger: 3 }, { position: 3, string: 'A', finger: 1 }] },

  { name: 'A4', frequency: freq(57), staffStep: staffStep('A', 4),
    fingerings: [{ position: 3, string: 'D', finger: 4 }, { position: 3, string: 'A', finger: 2 }] },

  { name: 'B4', frequency: freq(59), staffStep: staffStep('B', 4),
    fingerings: [{ position: 3, string: 'A', finger: 3 }, { position: 3, string: 'E', finger: 1 }] },

  { name: 'C5', frequency: freq(60), staffStep: staffStep('C', 5),
    fingerings: [{ position: 3, string: 'A', finger: 4 }, { position: 3, string: 'E', finger: 2 }] },

  { name: 'D5', frequency: freq(62), staffStep: staffStep('D', 5),
    fingerings: [{ position: 3, string: 'E', finger: 3 }] },

  { name: 'E5', frequency: freq(64), staffStep: staffStep('E', 5),
    fingerings: [{ position: 3, string: 'E', finger: 4 }] },

  { name: 'F5', frequency: freq(65), staffStep: staffStep('F', 5),
    fingerings: [{ position: 3, string: 'E', finger: 4 }] },

  { name: 'G5', frequency: freq(67), staffStep: staffStep('G', 5),
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

export function fingeringLabel(f: Fingering): string {
  const finger = f.finger === 0 ? '空弦' : `${f.finger}指`;
  const pos = ['', '一', '二', '三'][f.position];
  return `${pos}把位 ${f.string}弦 ${finger}`;
}
