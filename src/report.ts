// Turn a session's pitch samples into a plain-language practice report. Pure
// (no DOM, no audio) so it's easy to reason about and reuse. The caller feeds
// one entry per voiced frame: which target note it was nearest to, and how many
// cents sharp(+)/flat(−) it was from that target.

export interface CentsEntry {
  name: string;   // nearest target note, e.g. "F#4"
  cents: number;  // signed cents from that target
}

export interface NoteStat {
  name: string;
  meanCents: number;  // + sharp, − flat
  count: number;
}

export interface Report {
  voicedFrames: number;
  inTunePct: number;   // within the "good" tolerance
  closePct: number;    // within "med"
  offPct: number;      // beyond "med"
  score: number;       // 0..100
  meanAbsCents: number;
  tendency: number;    // mean signed cents across the session
  worst: NoteStat[];   // notes most in need of attention (worst first)
}

// Minimum frames (~0.25s at the 16ms detect interval) before a note is worth
// commenting on — avoids flagging a note that was only brushed in passing.
const MIN_NOTE_FRAMES = 15;

export function analyze(entries: CentsEntry[], good: number, med: number): Report {
  const voiced = entries.length;
  let green = 0, close = 0, off = 0, sumSigned = 0, sumAbs = 0;
  const byName = new Map<string, { sum: number; n: number }>();

  for (const e of entries) {
    const a = Math.abs(e.cents);
    if (a <= good) green++;
    else if (a <= med) close++;
    else off++;
    sumSigned += e.cents;
    sumAbs += a;
    const g = byName.get(e.name) ?? { sum: 0, n: 0 };
    g.sum += e.cents;
    g.n++;
    byName.set(e.name, g);
  }

  const worst: NoteStat[] = [...byName.entries()]
    .map(([name, s]) => ({ name, meanCents: s.sum / s.n, count: s.n }))
    .filter(x => x.count >= MIN_NOTE_FRAMES && Math.abs(x.meanCents) > good)
    .sort((a, b) => Math.abs(b.meanCents) - Math.abs(a.meanCents))
    .slice(0, 3);

  return {
    voicedFrames: voiced,
    inTunePct: voiced ? (green / voiced) * 100 : 0,
    closePct: voiced ? (close / voiced) * 100 : 0,
    offPct: voiced ? (off / voiced) * 100 : 0,
    // Full credit for in-tune, half for close. Intuitive 0..100.
    score: voiced ? Math.round((green + 0.5 * close) / voiced * 100) : 0,
    meanAbsCents: voiced ? sumAbs / voiced : 0,
    tendency: voiced ? sumSigned / voiced : 0,
    worst,
  };
}
