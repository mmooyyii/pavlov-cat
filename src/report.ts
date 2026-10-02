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

export interface RhythmReport {
  onsets: number;
  onTimePct: number;   // within the on-time window
  meanAbsMs: number;   // average absolute timing error
  tendencyMs: number;  // + late, − early
}

// Timing errors are already latency-compensated, in milliseconds (+ = late).
export function analyzeRhythm(errorsMs: number[], onTimeMs: number): RhythmReport {
  const n = errorsMs.length;
  let sumAbs = 0, sum = 0, on = 0;
  for (const e of errorsMs) {
    sumAbs += Math.abs(e);
    sum += e;
    if (Math.abs(e) <= onTimeMs) on++;
  }
  return {
    onsets: n,
    onTimePct: n ? (on / n) * 100 : 0,
    meanAbsMs: n ? sumAbs / n : 0,
    tendencyMs: n ? sum / n : 0,
  };
}

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

// ── Note-level analysis: vibrato + onsets ───────────────────────────────────
// Frame-by-frame judging treats vibrato as bad intonation: a ±20¢ wobble
// flickers between green and red even when the note is centred perfectly. So
// the caller hands us every voiced frame tagged with which target note it was
// heard against, we split those into held notes, and for a note played with
// vibrato we judge the *centre* of the oscillation (what the ear hears as the
// pitch), not each frame. The same split gives us the note's first instant —
// whether the finger landed in tune or slid into the note.

export interface Frame {
  t: number;      // seconds
  note: number;   // identity of the target this frame was judged against
  name: string;
  cents: number;  // signed cents from that target
}

export interface VibratoStats {
  notes: number;        // held notes that carried vibrato
  rateHz: number;       // mean oscillation rate
  widthCents: number;   // mean half-width (±¢)
}

export interface OnsetStats {
  notes: number;        // notes long enough to judge the attack
  inTunePct: number;    // attack already within the "med" tolerance
  slideCents: number;   // mean (attack − settled pitch): − = lands flat and slides up
}

export interface NoteAnalysis {
  entries: CentsEntry[];          // frames with vibrato notes replaced by their centre
  vibrato: VibratoStats | null;
  onset: OnsetStats | null;
}

const MAX_GAP_S = 0.06;           // a dropout longer than this ends the note
const VIB_MIN_DUR_S = 0.35;       // need ~2 cycles to call it vibrato
const VIB_MIN_HZ = 3.5;
const VIB_MAX_HZ = 9;
const VIB_MIN_WIDTH = 6;          // ±¢; narrower is just noise
const ONSET_WIN_S = 0.1;          // the attack: first 100ms of the note
const ONSET_MIN_DUR_S = 0.25;     // shorter notes have no "settled" part to compare

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function splitNotes(frames: readonly Frame[]): Frame[][] {
  const out: Frame[][] = [];
  let cur: Frame[] = [];
  for (const f of frames) {
    const last = cur[cur.length - 1];
    if (last && (f.note !== last.note || f.t - last.t > MAX_GAP_S)) { out.push(cur); cur = []; }
    cur.push(f);
  }
  if (cur.length) out.push(cur);
  return out;
}

// Rate and half-width of a periodic wobble, or null if there isn't one. The
// slow drift of the note is removed with a moving mean about one vibrato
// period wide; the residual's zero crossings give the rate and the swing
// between successive extremes the width.
function detectVibrato(seg: readonly Frame[]): { rateHz: number; width: number } | null {
  const dur = seg[seg.length - 1].t - seg[0].t;
  if (dur < VIB_MIN_DUR_S) return null;
  const n = seg.length;
  const resid: number[] = new Array(n);
  let lo = 0, hi = 0, sum = 0;
  for (let i = 0; i < n; i++) {
    while (seg[hi] && seg[hi].t <= seg[i].t + 0.1) { sum += seg[hi].cents; hi++; }
    while (seg[lo].t < seg[i].t - 0.1) { sum -= seg[lo].cents; lo++; }
    resid[i] = seg[i].cents - sum / (hi - lo);
  }
  // Hysteresis keeps detector jitter from counting as crossings.
  const HYST = 2;
  let sign = 0, crossings = 0, ext = 0;
  const swings: number[] = [];
  let lastExt: number | null = null;
  for (const r of resid) {
    const s = r > HYST ? 1 : r < -HYST ? -1 : 0;
    if (s === 0) continue;
    if (sign === 0) { sign = s; ext = r; continue; }
    if (s !== sign) {
      crossings++;
      if (lastExt !== null) swings.push(Math.abs(ext - lastExt));
      lastExt = ext;
      sign = s;
      ext = r;
    } else if (Math.abs(r) > Math.abs(ext)) {
      ext = r;
    }
  }
  if (crossings < 4 || !swings.length) return null;
  const rateHz = crossings / 2 / dur;
  const width = median(swings) / 2;
  if (rateHz < VIB_MIN_HZ || rateHz > VIB_MAX_HZ || width < VIB_MIN_WIDTH) return null;
  return { rateHz, width };
}

export function analyzeNotes(frames: readonly Frame[], med: number): NoteAnalysis {
  const entries: CentsEntry[] = [];
  let vibN = 0, vibRate = 0, vibWidth = 0;
  let onN = 0, onGood = 0, slide = 0;

  for (const seg of splitNotes(frames)) {
    const vib = detectVibrato(seg);
    if (vib) {
      vibN++;
      vibRate += vib.rateHz;
      vibWidth += vib.width;
      let c = 0;
      for (const f of seg) c += f.cents;
      const centre = Math.round(c / seg.length);
      for (const f of seg) entries.push({ name: f.name, cents: centre });
    } else {
      for (const f of seg) entries.push({ name: f.name, cents: f.cents });
    }

    const t0 = seg[0].t;
    if (seg[seg.length - 1].t - t0 >= ONSET_MIN_DUR_S) {
      // Skip the very first frame — it often catches the bow's scratch.
      const attack = seg.slice(1).filter(f => f.t - t0 <= ONSET_WIN_S).map(f => f.cents);
      const settled = seg.filter(f => f.t - t0 > ONSET_WIN_S).map(f => f.cents);
      if (attack.length >= 2 && settled.length >= 3) {
        const a = median(attack);
        // With vibrato the settled pitch is the centre, not any single frame.
        const s = settled.reduce((x, y) => x + y, 0) / settled.length;
        onN++;
        if (Math.abs(a) <= med) onGood++;
        slide += a - s;
      }
    }
  }

  return {
    entries,
    vibrato: vibN ? { notes: vibN, rateHz: vibRate / vibN, widthCents: vibWidth / vibN } : null,
    onset: onN ? { notes: onN, inTunePct: onGood / onN * 100, slideCents: slide / onN } : null,
  };
}
