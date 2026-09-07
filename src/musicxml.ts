import { midiToNoteName, type TargetTrack, type TargetNote } from './music';

// Minimal MusicXML reader for follow-along practice. Parses the common
// `score-partwise` layout with the browser's built-in DOMParser (no deps).
// Scope for v1: the first part, its first voice, monophonic melody line.
// Chords keep the top note; other voices, backup/forward and grace notes are
// skipped. Good enough for the single-line violin scores a learner practises.

const STEP_SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function midiFromPitch(pitch: Element): number {
  const step = pitch.querySelector('step')?.textContent?.trim() ?? 'C';
  const alter = parseInt(pitch.querySelector('alter')?.textContent ?? '0', 10) || 0;
  const octave = parseInt(pitch.querySelector('octave')?.textContent ?? '4', 10);
  return (octave + 1) * 12 + (STEP_SEMITONE[step] ?? 0) + alter;
}

export function parseMusicXml(xmlText: string, fallbackTitle: string): TargetTrack {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('文件解析失败:不是有效的 MusicXML');

  const part = doc.querySelector('score-partwise part') ?? doc.querySelector('part');
  if (!part) throw new Error('乐谱里没有找到声部(part)');

  let divisions = 1;          // ticks per quarter note (= per beat here)
  let bpm: number | null = null;
  let pos = 0;                // current position in beats
  let firstVoice: string | null = null;
  const notes: TargetNote[] = [];

  for (const measure of Array.from(part.querySelectorAll('measure'))) {
    for (const el of Array.from(measure.children)) {
      switch (el.tagName) {
        case 'attributes': {
          const d = el.querySelector('divisions');
          const v = d ? parseInt(d.textContent ?? '', 10) : NaN;
          if (v > 0) divisions = v;
          break;
        }
        case 'direction': {
          const t = el.querySelector('sound')?.getAttribute('tempo');
          if (t && bpm == null) { const v = parseFloat(t); if (v > 0) bpm = v; }
          break;
        }
        case 'sound': {
          const t = el.getAttribute('tempo');
          if (t && bpm == null) { const v = parseFloat(t); if (v > 0) bpm = v; }
          break;
        }
        case 'note': {
          if (el.querySelector('grace')) break;  // no duration — skip
          const voice = el.querySelector('voice')?.textContent?.trim() ?? null;
          if (firstVoice == null && voice != null) firstVoice = voice;
          if (voice != null && firstVoice != null && voice !== firstVoice) break; // other voice

          const durTicks = parseInt(el.querySelector('duration')?.textContent ?? '0', 10) || 0;
          const durBeat = durTicks / divisions;

          if (el.querySelector('chord')) {
            // Chord tone shares the previous onset; keep the higher pitch.
            const pitch = el.querySelector('pitch');
            const last = notes[notes.length - 1];
            if (pitch && last) {
              const m = midiFromPitch(pitch);
              if (m > last.midi) { last.midi = m; last.name = midiToNoteName(m); }
            }
            break; // no time advance
          }
          if (el.querySelector('rest')) { pos += durBeat; break; }
          const pitch = el.querySelector('pitch');
          if (!pitch) { pos += durBeat; break; }
          const midi = midiFromPitch(pitch);
          notes.push({ midi, startBeat: pos, durBeat, name: midiToNoteName(midi) });
          pos += durBeat;
          break;
        }
        default:
          break; // ignore backup/forward/barline/print/etc.
      }
    }
  }

  if (!notes.length) throw new Error('乐谱里没有可练习的音符');
  const title = (doc.querySelector('work-title,movement-title')?.textContent
    ?? fallbackTitle).trim() || fallbackTitle;
  return { notes, totalBeats: pos, title, bpm };
}
