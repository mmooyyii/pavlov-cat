import type { ScoreEntry } from './library';
import { parseMusicXml } from './musicxml';
import { getLang } from './i18n';

// Built-in public-domain pieces so the score tab has something to play before
// the user imports anything. Written in a compact "note:beats" form and turned
// into real MusicXML, so they go through the same parser (and later renderer)
// as imported scores. Never stored in IndexedDB and never deletable.
//
// Notation: space-separated tokens, "A4:1" = A4 for one beat (a quarter),
// "F#5:0.5" an eighth, "r:1" a quarter rest, "|" a barline (checked only).

export const SAMPLE_DIR = '__samples__';

interface Sample {
  slug: string;
  zh: string;
  en: string;
  fifths: number;     // key signature: + sharps / − flats
  beats: number;      // time signature numerator (quarter-note beats)
  bpm: number;
  music: string;
}

const SAMPLES: readonly Sample[] = [
  {
    slug: 'twinkle', zh: '小星星', en: 'Twinkle, Twinkle, Little Star', fifths: 3, beats: 4, bpm: 80,
    music: `A4:1 A4:1 E5:1 E5:1 | F#5:1 F#5:1 E5:2 | D5:1 D5:1 C#5:1 C#5:1 | B4:1 B4:1 A4:2 |
            E5:1 E5:1 D5:1 D5:1 | C#5:1 C#5:1 B4:2 | E5:1 E5:1 D5:1 D5:1 | C#5:1 C#5:1 B4:2 |
            A4:1 A4:1 E5:1 E5:1 | F#5:1 F#5:1 E5:2 | D5:1 D5:1 C#5:1 C#5:1 | B4:1 B4:1 A4:2`,
  },
  {
    slug: 'lightly-row', zh: '小汉斯 (Lightly Row)', en: 'Lightly Row', fifths: 3, beats: 4, bpm: 88,
    music: `E5:1 C#5:1 C#5:2 | D5:1 B4:1 B4:2 | A4:1 B4:1 C#5:1 D5:1 | E5:1 E5:1 E5:2 |
            E5:1 C#5:1 C#5:2 | D5:1 B4:1 B4:2 | A4:1 C#5:1 E5:1 E5:1 | C#5:4 |
            B4:1 B4:1 B4:1 B4:1 | B4:1 C#5:1 D5:2 | C#5:1 C#5:1 C#5:1 C#5:1 | C#5:1 D5:1 E5:2 |
            E5:1 C#5:1 C#5:2 | D5:1 B4:1 B4:2 | A4:1 C#5:1 E5:1 E5:1 | A4:4`,
  },
  {
    slug: 'ode-to-joy', zh: '欢乐颂', en: 'Ode to Joy', fifths: 2, beats: 4, bpm: 96,
    music: `F#4:1 F#4:1 G4:1 A4:1 | A4:1 G4:1 F#4:1 E4:1 | D4:1 D4:1 E4:1 F#4:1 | F#4:1.5 E4:0.5 E4:2 |
            F#4:1 F#4:1 G4:1 A4:1 | A4:1 G4:1 F#4:1 E4:1 | D4:1 D4:1 E4:1 F#4:1 | E4:1.5 D4:0.5 D4:2 |
            E4:1 E4:1 F#4:1 D4:1 | E4:1 F#4:0.5 G4:0.5 F#4:1 D4:1 | E4:1 F#4:0.5 G4:0.5 F#4:1 E4:1 | D4:1 E4:1 A3:2 |
            F#4:1 F#4:1 G4:1 A4:1 | A4:1 G4:1 F#4:1 E4:1 | D4:1 D4:1 E4:1 F#4:1 | E4:1.5 D4:0.5 D4:2`,
  },
  {
    slug: 'minuet-g', zh: '小步舞曲 G 大调 (巴赫笔记本)', en: 'Minuet in G (Notebook for Anna Magdalena Bach)',
    fifths: 1, beats: 3, bpm: 104,
    music: `D5:1 G4:0.5 A4:0.5 B4:0.5 C5:0.5 | D5:1 G4:1 G4:1 | E5:1 C5:0.5 D5:0.5 E5:0.5 F#5:0.5 | G5:1 G4:1 G4:1 |
            C5:1 D5:0.5 C5:0.5 B4:0.5 A4:0.5 | B4:1 C5:0.5 B4:0.5 A4:0.5 G4:0.5 | F#4:1 G4:0.5 A4:0.5 B4:0.5 G4:0.5 | A4:3 |
            D5:1 G4:0.5 A4:0.5 B4:0.5 C5:0.5 | D5:1 G4:1 G4:1 | E5:1 C5:0.5 D5:0.5 E5:0.5 F#5:0.5 | G5:1 G4:1 G4:1 |
            C5:1 D5:0.5 C5:0.5 B4:0.5 A4:0.5 | B4:1 C5:0.5 B4:0.5 A4:0.5 G4:0.5 | A4:1 B4:0.5 A4:0.5 G4:0.5 F#4:0.5 | G4:3 |
            B5:1 G5:0.5 A5:0.5 B5:0.5 G5:0.5 | A5:1 D5:0.5 E5:0.5 F#5:0.5 D5:0.5 | G5:1 E5:0.5 F#5:0.5 G5:0.5 D5:0.5 | C#5:1 B4:0.5 C#5:0.5 A4:1 |
            A4:0.5 B4:0.5 C#5:0.5 D5:0.5 E5:0.5 F#5:0.5 | G5:1 F#5:1 E5:1 | F#5:1 A4:1 C#5:1 | D5:3 |
            D5:1 G4:0.5 F#4:0.5 G4:1 | E5:1 G4:0.5 F#4:0.5 G4:1 | D5:1 C5:1 B4:1 | A4:1 G4:0.5 F#4:0.5 G4:0.5 A4:0.5 |
            D4:0.5 E4:0.5 F#4:0.5 G4:0.5 A4:0.5 B4:0.5 | C5:1 B4:1 A4:1 | B4:0.5 D5:0.5 G4:1 F#4:1 | G4:3`,
  },
  {
    slug: 'scale-g', zh: 'G 大调音阶 · 两个八度', en: 'G major scale · two octaves', fifths: 1, beats: 4, bpm: 72,
    music: `G3:1 A3:1 B3:1 C4:1 | D4:1 E4:1 F#4:1 G4:1 | A4:1 B4:1 C5:1 D5:1 | E5:1 F#5:1 G5:1 F#5:1 |
            E5:1 D5:1 C5:1 B4:1 | A4:1 G4:1 F#4:1 E4:1 | D4:1 C4:1 B3:1 A3:1 | G3:4`,
  },
  {
    slug: 'scale-a', zh: 'A 大调音阶 · 两个八度', en: 'A major scale · two octaves', fifths: 3, beats: 4, bpm: 72,
    music: `A3:1 B3:1 C#4:1 D4:1 | E4:1 F#4:1 G#4:1 A4:1 | B4:1 C#5:1 D5:1 E5:1 | F#5:1 G#5:1 A5:1 G#5:1 |
            F#5:1 E5:1 D5:1 C#5:1 | B4:1 A4:1 G#4:1 F#4:1 | E4:1 D4:1 C#4:1 B3:1 | A3:4`,
  },
];

const DIVISIONS = 2;   // ticks per quarter — eighths are the shortest value used
const TYPE_OF: Record<number, [string, boolean]> = {
  1: ['eighth', false], 2: ['quarter', false], 3: ['quarter', true],
  4: ['half', false], 6: ['half', true], 8: ['whole', false],
};

function noteXml(tok: string): { xml: string; ticks: number } {
  const [name, beatsStr] = tok.split(':');
  const ticks = Math.round(parseFloat(beatsStr) * DIVISIONS);
  const type = TYPE_OF[ticks];
  if (!type) throw new Error(`sample: unsupported duration in "${tok}"`);
  const dot = type[1] ? '<dot/>' : '';
  if (name === 'r') {
    return { xml: `<note><rest/><duration>${ticks}</duration><voice>1</voice><type>${type[0]}</type>${dot}</note>`, ticks };
  }
  const m = /^([A-G])(#|b)?(\d)$/.exec(name);
  if (!m) throw new Error(`sample: bad pitch "${tok}"`);
  const alter = m[2] === '#' ? '<alter>1</alter>' : m[2] === 'b' ? '<alter>-1</alter>' : '';
  return {
    xml: `<note><pitch><step>${m[1]}</step>${alter}<octave>${m[3]}</octave></pitch>` +
      `<duration>${ticks}</duration><voice>1</voice><type>${type[0]}</type>${dot}</note>`,
    ticks,
  };
}

function sampleXml(s: Sample, title: string): string {
  const perBar = s.beats * DIVISIONS;
  const bars = s.music.split('|').map(b => b.trim().split(/\s+/).filter(Boolean)).filter(b => b.length);
  const measures = bars.map((toks, i) => {
    let ticks = 0;
    const notes = toks.map(tok => { const n = noteXml(tok); ticks += n.ticks; return n.xml; }).join('');
    if (ticks !== perBar) throw new Error(`sample ${s.slug}: bar ${i + 1} has ${ticks / DIVISIONS} beats`);
    const head = i === 0
      ? `<attributes><divisions>${DIVISIONS}</divisions><key><fifths>${s.fifths}</fifths></key>` +
        `<time><beats>${s.beats}</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>` +
        `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit>` +
        `<per-minute>${s.bpm}</per-minute></metronome></direction-type><sound tempo="${s.bpm}"/></direction>`
      : '';
    const end = i === bars.length - 1 ? '<barline location="right"><bar-style>light-heavy</bar-style></barline>' : '';
    return `<measure number="${i + 1}">${head}${notes}${end}</measure>`;
  }).join('');
  const esc = title.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1">` +
    `<work><work-title>${esc}</work-title></work>` +
    `<part-list><score-part id="P1"><part-name>Violin</part-name></score-part></part-list>` +
    `<part id="P1">${measures}</part></score-partwise>`;
}

// Fresh entries in the current language (titles are localized; ids are not,
// so a remembered sample survives a language switch).
export function sampleEntries(): ScoreEntry[] {
  const lang = getLang();
  return SAMPLES.map(s => {
    const title = lang === 'zh' ? s.zh : s.en;
    const xml = sampleXml(s, title);
    return { id: `${SAMPLE_DIR}/${s.slug}`, title, track: parseMusicXml(xml, title), xml, builtin: true, addedAt: 0 };
  });
}
