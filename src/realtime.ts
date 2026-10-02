import { detectPitch } from './pitch';
import {
  A4_HZ, freqToMidi, midiToFreq, midiToNoteName,
  COMMON_KEYS, DEFAULT_KEY_INDEX, LEGACY_KEY_ORDER, keySignatureText, keyLabel,
  isInScale, targetFreq, type Key, type Mode, type Temperament,
  type TargetNote, type TargetTrack,
} from './music';
import { Drone, type DroneMode } from './drone';
import { analyze, analyzeRhythm, analyzeNotes, type Frame, type NoteAnalysis, type Report, type RhythmReport } from './report';
import { parseMusicXml } from './musicxml';
import { scoresAll, scoresPut, scoresReplace, scoresDelete, type ScoreEntry } from './library';
import { readMxl } from './mxl';
import { sampleEntries, SAMPLE_DIR } from './samples';
import { Staff } from './staff';
import { t, applyI18n, onLangChange, setLang, getLang, LANGS, type Lang, type MsgKey } from './i18n';

// ── Tunables ────────────────────────────────────────────────────────────────
const FFT_SIZE = 2048;                  // pitch detection window (~43ms @ 48kHz)
const DETECT_INTERVAL_MS = 16;          // ~62.5Hz pitch detection (windows overlap ~63%)
const HISTORY_DURATION_S = 3600;        // 1 hour of pitch trajectory
const HISTORY_SIZE = Math.ceil((HISTORY_DURATION_S * 1000) / DETECT_INTERVAL_MS); // ~225k entries → ~1.7MB total
const DEFAULT_VISIBLE_BEATS = 32;       // default beats across canvas (higher = slower scroll)
const MIN_VISIBLE_BEATS = 4;
const MAX_VISIBLE_BEATS = 32;
const PLAYHEAD_RATIO = 0.25;            // playhead x-position (fraction of width)
const LOOKAHEAD_S = 0.2;                // metronome scheduling lookahead

// Fallback pitch range when the selected range yields nothing.
const DEFAULT_MIDI_MIN = freqToMidi(196); // G3
const DEFAULT_MIDI_MAX = freqToMidi(988); // B5

// Reference notes: chromatic MIDI between two user-picked endpoints.
// Picker bounds: G3 (open G, MIDI 55) to E7 (top of violin range, MIDI 100).
const PICKER_MIN_MIDI = 55;        // G3
const PICKER_MAX_MIDI = 100;       // E7
const DEFAULT_LO_MIDI = 55;        // G3 — covers full 1st position
const DEFAULT_HI_MIDI = 79;        // G5

interface RefNote {
  midi: number;
  name: string;
  frequency: number;   // ideal frequency (equal- or just-tempered)
  target: boolean;     // true = a note the player should aim for / be judged against
}

type RefMode = 'scale' | 'score';

// One recorded take, held in memory for the session (blobs are megabytes — too
// big to keep in storage, and a practice take is usually listened to once).
interface Take {
  id: string;
  url: string;        // object URL for the <audio> element
  blob: Blob;
  ext: string;
  at: Date;           // when it was recorded
  seconds: number;
}

// One bar of metronome runway before the first score note reaches the playhead.
const SCORE_LEADIN_BEATS = 4;

function currentKey(): Key {
  const k = COMMON_KEYS[state.keyIndex] ?? COMMON_KEYS[0];
  return { tonicPc: k.tonicPc, mode: k.mode, temperament: state.temperament, a4: A4_HZ };
}

// Reference lanes for the current range. Only the key's scale tones are
// targets (drawn bright + labelled and judged against, with the chosen
// temperament); the rest become faint guide lines.
function buildRefNotes(): RefNote[] {
  const lo = Math.min(state.loMidi, state.hiMidi);
  const hi = Math.max(state.loMidi, state.hiMidi);
  const key = currentKey();
  const out: RefNote[] = [];
  for (let m = lo; m <= hi; m++) {
    const t = isInScale(m, key);
    out.push({ midi: m, name: midiToNoteName(m), frequency: t ? targetFreq(m, key) : midiToFreq(m), target: t });
  }
  return out;
}

function refreshRefNotes(): void {
  state.rangeNotes = buildRefNotes();
}

// A low, unobtrusive octave of the current key's tonic, for the drone.
function tonicDroneMidi(): number {
  const k = COMMON_KEYS[state.keyIndex] ?? COMMON_KEYS[0];
  return k.tonicPc + 48; // C3..B3
}

// Which score note (if any) the playhead beat falls inside. Beats include the
// lead-in offset, so score beat = elapsed beat − lead-in.
function targetNoteAtBeat(beat: number): TargetNote | null {
  const i = targetIndexAtBeat(beat);
  return i < 0 ? null : state.track!.notes[i];
}

function targetIndexAtBeat(beat: number): number {
  const track = state.track;
  if (!track) return -1;
  const b = beat - SCORE_LEADIN_BEATS;
  if (b < 0) return -1;
  const notes = track.notes;
  for (let i = 0; i < notes.length; i++) {
    if (b >= notes[i].startBeat && b < notes[i].startBeat + notes[i].durBeat) return i;
  }
  return -1;
}

const scoreModeActive = (): boolean => state.refMode === 'score' && state.track != null;

// ── Palette — Apple dark-appearance system colors ───────────────────────────
const PALETTE = {
  bgTop:        '#1c1c1e',  // systemGray6 dark — matches the stage chrome
  bgBottom:     '#131315',
  refLine:      '#2c2c30',
  refLineFaint: '#232326',  // non-scale guide lines in scale mode
  refLabel:     '#8eb8d4',  // soft cool blue
  refLabelTgt:  '#30d158',  // scale target labels — systemGreen (dark)
  gridAccent:   '#3d3324',  // warm dark amber
  gridRegular:  '#242428',
  labelAccent:  '#d4b06a',  // warm gold
  labelRegular: '#8e8e93',  // systemGray
  traceGood:    '#30d158',  // systemGreen — ≤ good tolerance
  traceMed:     '#ffd60a',  // systemYellow — ≤ med tolerance
  traceBad:     '#ff453a',  // systemRed — beyond
  traceNoRef:   '#ff9f0a',  // systemOrange — no judging reference
  playhead:     '#64d2ff',  // systemCyan
  scoreBlock:   'rgba(10, 132, 255, 0.20)',   // upcoming score note — systemBlue tint
  scoreBlockNow:'rgba(100, 210, 255, 0.32)',  // note currently under the playhead
  scoreBlockEdge: 'rgba(10, 132, 255, 0.65)',
  scoreLabel:   '#d6e8f7',
} as const;
const DEFAULT_CENTS_TOLERANCE_GOOD = 6;   // ≤6¢ → green (trained musician threshold)
const DEFAULT_CENTS_TOLERANCE_MED  = 15;  // ≤15¢ → yellow (perceptible to average listener)
const MIN_CENTS_TOLERANCE = 1;
const MAX_CENTS_TOLERANCE = 100;

// ── Types ───────────────────────────────────────────────────────────────────
type TimeUnit = 'beat' | 'second';
type SoundKind = 'wood' | 'click' | 'tom' | 'hihat';
type ViewMode = 'practice' | 'tuner';

// Violin open strings: G3, D4, A4, E5.
const OPEN_STRINGS = [55, 62, 69, 76];

// ── State ───────────────────────────────────────────────────────────────────
const state = {
  ctx: null as AudioContext | null,
  micStream: null as MediaStream | null,
  micSource: null as MediaStreamAudioSourceNode | null,
  analyser: null as AnalyserNode | null,
  buffer: null as Float32Array<ArrayBuffer> | null,

  running: false,
  viewMode: 'practice' as ViewMode,
  startTime: 0,                         // clockNow() when started
  heldTotal: 0,                         // seconds the transport has stood still (wait mode)
  waitMode: false,                      // score: hold each note until it's played in tune
  waitIdx: 0,                           // next score note wait mode is waiting for
  waitRun: 0,                           // consecutive in-tune frames on that note
  frozenElapsedBeats: 0,                // last elapsedBeats when stopped (for static display)
  bpm: 80,
  timeUnit: 'beat' as TimeUnit,
  accentEvery: 4,
  countInBeats: 4,                      // empty beats clicked off before the run starts
  runStartBeat: 0,                      // beat this run resumes at; the clock is held here during the count-in
  metronomeOn: false,
  pitchJudge: true,                     // when off, all dots use neutral color
  visibleBeats: DEFAULT_VISIBLE_BEATS,
  centsToleranceGood: DEFAULT_CENTS_TOLERANCE_GOOD,
  centsToleranceMed: DEFAULT_CENTS_TOLERANCE_MED,
  soundKind: 'tom' as SoundKind,
  noiseBuffer: null as AudioBuffer | null,    // shared white-noise source for hihat

  // Reference mode: a chosen scale/key vs an imported score
  refMode: 'scale' as RefMode,
  keyIndex: DEFAULT_KEY_INDEX,          // index into COMMON_KEYS
  temperament: 'equal' as Temperament,
  track: null as TargetTrack | null,    // active score (mirror of the selected library entry)
  library: [] as ScoreEntry[],          // imported scores, sorted by title
  scoreId: null as string | null,       // library id of the active score
  collapsedDirs: new Set<string>(),     // folded folders in the library tree
  staff: null as Staff | null,          // engraved score above the timeline
  staffXml: null as string | null,      // what the staff currently shows
  staffShown: false,
  staffOffset: 0,                       // trimmed lead-in beats: timeline → written score

  // Reference drone (sustained tone to tune against)
  drone: null as Drone | null,
  droneMode: 'off' as DroneMode,
  droneRootMidi: 57,                    // A3
  droneVol: 0.18,

  // Microphone input device (Mac mini has no built-in mic → pick iPhone etc.)
  micDeviceId: null as string | null,
  micError: null as MsgKey | null,      // shown centered on the stage when set

  // Audio recording. Takes stay on the page so you can listen back right away;
  // downloading is a deliberate second step (⬇ on the take).
  recorder: null as MediaRecorder | null,
  recChunks: [] as Blob[],
  recording: false,                     // capture actually running right now
  recordArmed: false,                   // switch is on — record whenever the mic is live
  recStartedAt: 0,                      // performance.now() when the current segment began (0 = not running)
  recElapsed: 0,                        // seconds captured so far, excluding paused time
  takes: [] as Take[],                  // this session's recordings, newest first
  nextAction: null as null | (() => void),   // the report's suggested next step

  // Mic latency (s) between a note sounding and being detected — for rhythm.
  micLatency: 0,
  calibrating: false,

  // Pan when stopped: displayed elapsed = frozenElapsedBeats + viewOffsetBeats.
  // Clamped so the playhead stays inside [0, frozenElapsedBeats].
  viewOffsetBeats: 0,
  lastPxPerBeat: 0,                     // stashed by drawOnce for pointer handler
  refreshPanCursor: null as null | (() => void),

  // Metronome scheduling
  nextTickBeat: 0,
  nextTickTime: 0,

  // Ring buffer for pitch history (freq + RMS amplitude per sample)
  histTime: new Float32Array(HISTORY_SIZE),
  histFreq: new Float32Array(HISTORY_SIZE),
  histVol:  new Float32Array(HISTORY_SIZE),
  histCount: 0,
  histHead: 0,

  rafId: 0,
  detectId: 0 as ReturnType<typeof setInterval> | 0,

  loMidi: DEFAULT_LO_MIDI,
  hiMidi: DEFAULT_HI_MIDI,
  rangeNotes: [] as RefNote[],         // cached reference notes for [loMidi, hiMidi]

  els: null as null | {
    canvas: HTMLCanvasElement;
    staffEl: HTMLElement;
    wrap: HTMLElement;
    bpmInput: HTMLInputElement;
    accentInput: HTMLInputElement;
    countInInput: HTMLInputElement;
    visibleBeatsInput: HTMLInputElement;
    centsGoodInput: HTMLInputElement;
    centsMedInput: HTMLInputElement;
    soundSelect: HTMLSelectElement;
    rangeLoSelect: HTMLSelectElement;
    rangeHiSelect: HTMLSelectElement;
    scaleControls: HTMLElement;
    keySelect: HTMLSelectElement;
    temperamentToggles: NodeListOf<HTMLButtonElement>;
    temperamentRow: HTMLElement;
    rangeRow: HTMLElement;
    scoreControls: HTMLElement;
    dirInput: HTMLInputElement;
    fileInput: HTMLInputElement;
    scoreBtn: HTMLButtonElement;
    scoreName: HTMLElement;
    scorePanel: HTMLElement;
    scoreTree: HTMLElement;
    settingsBtn: HTMLButtonElement;
    settingsPanel: HTMLElement;
    metronomeToggles: NodeListOf<HTMLButtonElement>;
    recordToggles: NodeListOf<HTMLButtonElement>;
    judgeToggles: NodeListOf<HTMLButtonElement>;
    waitToggles: NodeListOf<HTMLButtonElement>;
    scoreGroup: HTMLElement;
    unitToggles: NodeListOf<HTMLButtonElement>;
    droneToggles: NodeListOf<HTMLButtonElement>;
    droneRootSelect: HTMLSelectElement;
    micSelect: HTMLSelectElement;
    startBtn: HTMLButtonElement;
    clearBtn: HTMLButtonElement;
    calibrateBtn: HTMLButtonElement;
    fullscreenBtn: HTMLButtonElement;
    statusEl: HTMLElement;
    pitchEl: HTMLElement;
    reportEl: HTMLElement;
    takesEl: HTMLElement;
    modeTabs: NodeListOf<HTMLButtonElement>;
    practiceView: HTMLElement;
    tunerView: HTMLElement;
    tunerNote: HTMLElement;
    tunerCents: HTMLElement;
    tunerNeedle: HTMLElement;
    tunerStrings: NodeListOf<HTMLElement>;
    tunerStartBtn: HTMLButtonElement;
  },
};

// ── Settings persistence ───────────────────────────────────────────────────
// Single localStorage key holding a JSON snapshot of user-tunable realtime
// settings. Versioned so schema changes can ignore stale payloads.
const SETTINGS_KEY = 'pavlov-cat:realtime-settings:v1';

const SOUND_KINDS: readonly SoundKind[] = ['wood', 'click', 'tom', 'hihat'];
const TIME_UNITS: readonly TimeUnit[] = ['beat', 'second'];
const DRONE_MODES: readonly DroneMode[] = ['off', 'root', 'fifth'];

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function loadSettings(): void {
  let raw: string | null = null;
  try { raw = localStorage.getItem(SETTINGS_KEY); } catch { return; }
  if (!raw) return;
  let data: Record<string, unknown>;
  try { data = JSON.parse(raw) as Record<string, unknown>; } catch { return; }
  if (!data || typeof data !== 'object') return;

  if ('bpm' in data) state.bpm = clampInt(data.bpm, 40, 220, state.bpm);
  if ('accentEvery' in data) state.accentEvery = clampInt(data.accentEvery, 1, 12, state.accentEvery);
  if ('countInBeats' in data) state.countInBeats = clampInt(data.countInBeats, 0, 8, state.countInBeats);
  if ('visibleBeats' in data) state.visibleBeats = clampInt(data.visibleBeats, MIN_VISIBLE_BEATS, MAX_VISIBLE_BEATS, state.visibleBeats);
  if ('centsToleranceGood' in data) state.centsToleranceGood = clampInt(data.centsToleranceGood, MIN_CENTS_TOLERANCE, MAX_CENTS_TOLERANCE, state.centsToleranceGood);
  if ('centsToleranceMed' in data) state.centsToleranceMed = clampInt(data.centsToleranceMed, MIN_CENTS_TOLERANCE, MAX_CENTS_TOLERANCE, state.centsToleranceMed);
  if (state.centsToleranceMed < state.centsToleranceGood) state.centsToleranceMed = state.centsToleranceGood;
  if (typeof data.soundKind === 'string' && SOUND_KINDS.includes(data.soundKind as SoundKind)) state.soundKind = data.soundKind as SoundKind;
  if (typeof data.timeUnit === 'string' && TIME_UNITS.includes(data.timeUnit as TimeUnit)) state.timeUnit = data.timeUnit as TimeUnit;
  if (typeof data.metronomeOn === 'boolean') state.metronomeOn = data.metronomeOn;
  if (typeof data.pitchJudge === 'boolean') state.pitchJudge = data.pitchJudge;
  if (typeof data.waitMode === 'boolean') state.waitMode = data.waitMode;
  if ('loMidi' in data) state.loMidi = clampInt(data.loMidi, PICKER_MIN_MIDI, PICKER_MAX_MIDI, state.loMidi);
  if ('hiMidi' in data) state.hiMidi = clampInt(data.hiMidi, PICKER_MIN_MIDI, PICKER_MAX_MIDI, state.hiMidi);
  if (state.loMidi > state.hiMidi) [state.loMidi, state.hiMidi] = [state.hiMidi, state.loMidi];
  if (typeof data.droneMode === 'string' && DRONE_MODES.includes(data.droneMode as DroneMode)) state.droneMode = data.droneMode as DroneMode;
  if ('droneRootMidi' in data) state.droneRootMidi = clampInt(data.droneRootMidi, PICKER_MIN_MIDI, PICKER_MAX_MIDI, state.droneRootMidi);
  if (typeof data.micDeviceId === 'string') state.micDeviceId = data.micDeviceId;
  // 'chromatic' was a third mode, removed — stale settings fall back to scale.
  if (data.refMode === 'scale' || data.refMode === 'score') state.refMode = data.refMode;
  // The key is stored by identity (tonic + mode), not by list position — the
  // list grew from 12 to 24 keys and a bare index would silently point at a
  // different key after the upgrade.
  const k = data.key as { tonicPc?: unknown; mode?: unknown } | undefined;
  const findKey = (pc: number, mode: Mode): number =>
    COMMON_KEYS.findIndex(x => x.tonicPc === pc && x.mode === mode);
  if (k && typeof k.tonicPc === 'number' && (k.mode === 'major' || k.mode === 'minor')) {
    const i = findKey(k.tonicPc, k.mode);
    if (i >= 0) state.keyIndex = i;
  } else if ('keyIndex' in data) {
    const legacy = LEGACY_KEY_ORDER[clampInt(data.keyIndex, 0, LEGACY_KEY_ORDER.length - 1, 0)];
    const i = legacy ? findKey(legacy[0], legacy[1]) : -1;
    if (i >= 0) state.keyIndex = i;
  }
  if (data.temperament === 'equal' || data.temperament === 'just') state.temperament = data.temperament;
  if (typeof data.micLatency === 'number' && data.micLatency >= 0 && data.micLatency <= 0.5) state.micLatency = data.micLatency;
  if (typeof data.scoreId === 'string') state.scoreId = data.scoreId;
}

function saveSettings(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      bpm: state.bpm,
      accentEvery: state.accentEvery,
      countInBeats: state.countInBeats,
      visibleBeats: state.visibleBeats,
      centsToleranceGood: state.centsToleranceGood,
      centsToleranceMed: state.centsToleranceMed,
      soundKind: state.soundKind,
      timeUnit: state.timeUnit,
      metronomeOn: state.metronomeOn,
      pitchJudge: state.pitchJudge,
      waitMode: state.waitMode,
      loMidi: state.loMidi,
      hiMidi: state.hiMidi,
      droneMode: state.droneMode,
      droneRootMidi: state.droneRootMidi,
      micDeviceId: state.micDeviceId,
      refMode: state.refMode,
      key: {
        tonicPc: COMMON_KEYS[state.keyIndex]?.tonicPc ?? 2,
        mode: COMMON_KEYS[state.keyIndex]?.mode ?? 'major',
      },
      temperament: state.temperament,
      micLatency: state.micLatency,
      scoreId: state.scoreId,
    }));
  } catch { /* quota / private mode — ignore */ }
}

// ── Ring buffer ────────────────────────────────────────────────────────────
function histPush(t: number, f: number, v: number): void {
  if (state.histCount < HISTORY_SIZE) {
    state.histTime[state.histCount] = t;
    state.histFreq[state.histCount] = f;
    state.histVol[state.histCount] = v;
    state.histCount++;
  } else {
    state.histTime[state.histHead] = t;
    state.histFreq[state.histHead] = f;
    state.histVol[state.histHead] = v;
    state.histHead = (state.histHead + 1) % HISTORY_SIZE;
  }
}

function histClear(): void {
  state.histCount = 0;
  state.histHead = 0;
}

function histForEach(cb: (t: number, f: number, v: number) => void): void {
  if (state.histCount < HISTORY_SIZE) {
    for (let i = 0; i < state.histCount; i++) cb(state.histTime[i], state.histFreq[i], state.histVol[i]);
  } else {
    for (let i = 0; i < HISTORY_SIZE; i++) {
      const idx = (state.histHead + i) % HISTORY_SIZE;
      cb(state.histTime[idx], state.histFreq[idx], state.histVol[idx]);
    }
  }
}

// ── Transport clock ─────────────────────────────────────────────────────────
// The raw clock runs ahead of the run's start beat during a count-in: it sits
// at runStartBeat − N and climbs to runStartBeat as the empty beats tick by.
function rawBeat(): number {
  if (!state.ctx) return 0;
  return (clockNow() - state.startTime) / (60 / state.bpm);
}

// Transport time: the audio clock minus every moment wait mode held the music.
// All timeline math (startTime, history, metronome) runs on this clock; only
// the final audio scheduling adds heldTotal back.
function clockNow(): number {
  return state.ctx ? state.ctx.currentTime - state.heldTotal : 0;
}

// What everything else should treat as "now". Clamping to runStartBeat is what
// keeps the playhead parked during the count-in instead of rewinding.
function currentBeat(): number {
  const b = Math.max(state.runStartBeat, rawBeat());
  const hold = waitHoldBeat();
  return hold == null ? b : Math.min(b, Math.max(hold, state.runStartBeat));
}

/** Beats left in the count-in; 0 once the run is properly under way. */
function countInLeft(): number {
  if (!state.running || !state.ctx) return 0;
  return Math.max(0, state.runStartBeat - rawBeat());
}

// ── Wait mode ───────────────────────────────────────────────────────────────
// Follow-along without the clock: the playhead stops at the start of each
// score note until that note has been heard in tune, then moves on. On time,
// nothing changes — the hold only engages when you're late or searching.
// Rests aren't notes, so the clock runs through them as usual.
const WAIT_HIT_FRAMES = 3;          // ~50ms of the right pitch counts as playing it
const WAIT_EARLY_BEATS = 1;         // a note can be "caught" up to a beat early

const waitActive = (): boolean => state.waitMode && scoreModeActive();

/** Beat (timeline, incl. lead-in) the playhead may not pass, or null. */
function waitHoldBeat(): number | null {
  if (!waitActive()) return null;
  const n = state.track!.notes[state.waitIdx];
  return n ? n.startBeat + SCORE_LEADIN_BEATS : null;
}

// Point waitIdx at the first note not yet behind the given timeline beat —
// used when resuming from somewhere other than the top.
function syncWait(beat: number): void {
  state.waitRun = 0;
  if (!state.track) { state.waitIdx = 0; return; }
  const b = beat - SCORE_LEADIN_BEATS;
  const i = state.track.notes.findIndex(n => n.startBeat >= b - 1e-6);
  state.waitIdx = i < 0 ? state.track.notes.length : i;
}

function waitStep(f: number): void {
  if (!waitActive() || !state.ctx) return;
  const notes = state.track!.notes;
  const n = notes[state.waitIdx];
  if (!n) return;
  const ok = f > 0 && Math.abs(1200 * Math.log2(f / midiToFreq(n.midi))) <= state.centsToleranceMed;
  state.waitRun = ok ? state.waitRun + 1 : 0;
  const sb = rawBeat() - SCORE_LEADIN_BEATS;
  const prev = notes[state.waitIdx - 1];
  const open = Math.max(prev ? prev.startBeat : -Infinity, n.startBeat - WAIT_EARLY_BEATS);
  if (state.waitRun >= WAIT_HIT_FRAMES && sb >= open) {
    state.waitIdx++;
    state.waitRun = 0;
    return;
  }
  // Not played yet and the clock has reached it: stop the transport here.
  if (sb > n.startBeat) {
    const spb = 60 / state.bpm;
    state.heldTotal = state.ctx.currentTime - state.startTime - (n.startBeat + SCORE_LEADIN_BEATS) * spb;
  }
}

// ── Metronome ──────────────────────────────────────────────────────────────
function scheduleMetronome(): void {
  if (!state.ctx) return;
  const ctx = state.ctx;
  const secsPerBeat = 60 / state.bpm;
  const hold = waitHoldBeat();
  while (state.nextTickTime < clockNow() + LOOKAHEAD_S) {
    if (hold != null && state.nextTickBeat > hold) break;   // the music is waiting for you
    // Count-in beats always click, even with the metronome switched off —
    // a silent count-in would count you in on nothing.
    const isCountIn = state.nextTickBeat < state.runStartBeat;
    if (state.metronomeOn || isCountIn) {
      const isAccent = state.nextTickBeat % state.accentEvery === 0;
      const when = state.nextTickTime + state.heldTotal;
      if (isAccent) playSnare(ctx, when);
      else playSound(ctx, when, state.soundKind);
    }
    state.nextTickTime += secsPerBeat;
    state.nextTickBeat++;
  }
}

function playSound(ctx: AudioContext, when: number, kind: SoundKind): void {
  switch (kind) {
    case 'wood': return playWood(ctx, when);
    case 'click': return playClick(ctx, when);
    case 'tom': return playTom(ctx, when);
    case 'hihat': return playHihat(ctx, when);
  }
}

// Snare accent: band-passed noise burst (the "crack") layered with a short
// tonal thud (~190Hz → ~110Hz drop) for the drum body. Fits a jazz-kit feel
// alongside the tom default.
function playSnare(ctx: AudioContext, when: number): void {
  // Noise layer — bandpass around 1.8kHz with moderate Q gives the snare's
  // characteristic snap without too much hiss.
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1800;
  bp.Q.value = 0.9;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0, when);
  noiseGain.gain.linearRampToValueAtTime(0.22, when + 0.002);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, when + 0.13);
  src.connect(bp);
  bp.connect(noiseGain);
  noiseGain.connect(ctx.destination);
  src.start(when);
  src.stop(when + 0.16);

  // Body layer — quick pitch drop, gives the "thump" under the crack.
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(190, when);
  osc.frequency.exponentialRampToValueAtTime(110, when + 0.06);
  const bodyGain = ctx.createGain();
  bodyGain.gain.setValueAtTime(0, when);
  bodyGain.gain.linearRampToValueAtTime(0.16, when + 0.003);
  bodyGain.gain.exponentialRampToValueAtTime(0.001, when + 0.09);
  osc.connect(bodyGain);
  bodyGain.connect(ctx.destination);
  osc.start(when);
  osc.stop(when + 0.11);

  src.onended = () => { src.disconnect(); bp.disconnect(); noiseGain.disconnect(); };
  osc.onended = () => { osc.disconnect(); bodyGain.disconnect(); };
}

// Wood block: sine pop ~2kHz with fast pitch drop, very short tail.
function playWood(ctx: AudioContext, when: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(2200, when);
  osc.frequency.exponentialRampToValueAtTime(1100, when + 0.04);
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(0.18, when + 0.001);
  gain.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(when);
  osc.stop(when + 0.06);
  osc.onended = () => { osc.disconnect(); gain.disconnect(); };
}

// Electronic click: short square wave, sharpest transient.
function playClick(ctx: AudioContext, when: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = 1000;
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(0.14, when + 0.001);
  gain.gain.exponentialRampToValueAtTime(0.001, when + 0.04);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(when);
  osc.stop(when + 0.05);
  osc.onended = () => { osc.disconnect(); gain.disconnect(); };
}

// Low tom: sine pitch sweep from ~180Hz to ~70Hz with body decay ~180ms.
function playTom(ctx: AudioContext, when: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(180, when);
  osc.frequency.exponentialRampToValueAtTime(70, when + 0.12);
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(0.32, when + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, when + 0.2);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(when);
  osc.stop(when + 0.22);
  osc.onended = () => { osc.disconnect(); gain.disconnect(); };
}

// Hi-hat: noise burst through a steep high-pass, very short.
function playHihat(ctx: AudioContext, when: number): void {
  const buf = getNoiseBuffer(ctx);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7000;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(0.18, when + 0.001);
  gain.gain.exponentialRampToValueAtTime(0.001, when + 0.045);
  src.connect(hp);
  hp.connect(gain);
  gain.connect(ctx.destination);
  src.start(when);
  src.stop(when + 0.06);
  src.onended = () => { src.disconnect(); hp.disconnect(); gain.disconnect(); };
}

// 0.3s of white noise, generated once per AudioContext and reused.
function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (state.noiseBuffer && state.noiseBuffer.sampleRate === ctx.sampleRate) {
    return state.noiseBuffer;
  }
  const len = Math.floor(ctx.sampleRate * 0.3);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  state.noiseBuffer = buf;
  return buf;
}

// ── Lifecycle ──────────────────────────────────────────────────────────────
// Create the AudioContext + Drone on first need. Both the drone and the mic
// require an AudioContext; the drone can run with no mic at all, so this is
// separated from mic acquisition.
async function ensureCtx(): Promise<AudioContext> {
  if (!state.ctx) {
    state.ctx = new AudioContext();
    state.drone = new Drone(state.ctx);
  }
  if (state.ctx.state === 'suspended') await state.ctx.resume();
  return state.ctx;
}

// Open a mic stream honouring the chosen input device. echo/noise/gain
// processing is disabled so the raw pitch reaches the detector. If the saved
// device has vanished (e.g. the iPhone continuity mic walked away), fall back
// to the system default instead of failing outright.
async function openMicStream(): Promise<MediaStream> {
  const base = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  const id = state.micDeviceId;
  if (id) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { ...base, deviceId: { exact: id } } });
    } catch {
      state.micDeviceId = null;
      saveSettings();
      if (state.els) state.els.micSelect.value = '';
    }
  }
  return navigator.mediaDevices.getUserMedia({ audio: base });
}

async function start(): Promise<void> {
  if (state.running) return;

  await ensureCtx();

  try {
    state.micStream = await openMicStream();
  } catch (e) {
    const name = e instanceof DOMException ? e.name : '';
    let msg: MsgKey;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      msg = 'mic.denied';
    } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
      msg = 'mic.notFound';
    } else {
      msg = 'mic.failed';
    }
    state.micError = msg;
    setStatus(t(msg), true);
    updateStartBtn();
    drawOnce();
    return;
  }
  state.micError = null;
  setStatus('');

  const ctx = state.ctx!;
  state.micSource = ctx.createMediaStreamSource(state.micStream);
  state.analyser = ctx.createAnalyser();
  state.analyser.fftSize = FFT_SIZE;
  state.buffer = new Float32Array(state.analyser.fftSize);
  state.micSource.connect(state.analyser);
  // NOTE: do NOT connect analyser → destination (would echo mic into speakers)

  histClear();

  // Count-in: the clock starts N beats early so it can climb to beat 0 while
  // the metronome ticks. currentBeat() pins the playhead at 0 meanwhile, so
  // nothing moves on screen until the count-in is done.
  const spb = 60 / state.bpm;
  state.runStartBeat = 0;
  state.startTime = clockNow() + 0.1 + state.countInBeats * spb;
  state.waitIdx = 0;
  state.waitRun = 0;
  state.nextTickBeat = -state.countInBeats;
  state.nextTickTime = state.startTime + state.nextTickBeat * spb;
  state.viewOffsetBeats = 0;
  state.running = true;

  state.detectId = setInterval(detectStep, DETECT_INTERVAL_MS);
  if (state.recordArmed) beginRecording();   // switch was armed before the mic came up
  // Device labels are only exposed after permission is granted — refresh now.
  void populateMicList();
  hideReport();
  updateStartBtn();
  drawLoop();
}

// Apply the current drone settings (creating the ctx on demand so pressing a
// drone button also works before the mic has ever been started).
async function applyDrone(): Promise<void> {
  await ensureCtx();
  state.drone?.set(state.droneMode, state.droneRootMidi, state.droneVol);
}

// ── Score library (MusicXML) ─────────────────────────────────────────────────
// Scores are imported a folder at a time and kept in IndexedDB, so the picker
// in the toolbar is the only thing the user touches when switching pieces.
// Where showDirectoryPicker exists (desktop Chrome / Edge) a folder is only
// indexed — file names and handles — and each score is read when first opened.
const LEGACY_SCORE_KEY = 'pavlov-cat:score:v1';   // pre-library single score
const SCORE_EXT = /\.(musicxml|xml|mxl)$/i;

// Path relative to the picked folder — the library key, so re-importing the
// same folder updates entries in place instead of piling up duplicates. Falls
// back to the bare name when there's no path (a multi-file pick, which is the
// only way to import on Android builds without folder support).
//
// Android hands back a Storage Access Framework path like
// "primary:Download/scores/x.musicxml"; strip the volume prefix so the tree
// doesn't grow a bogus "primary:Download" root.
function scoreIdOf(file: File): string {
  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  if (!rel) return file.name;
  return rel.replace(/\\/g, '/').replace(/^[A-Za-z0-9_-]+:/, '').replace(/^\/+/, '') || file.name;
}

// Neither the picker nor handle permissions are in lib.dom yet.
type DirPickerWindow = Window & {
  showDirectoryPicker?: (opts?: { id?: string; mode?: 'read' }) => Promise<FileSystemDirectoryHandle>;
};
type ReadableHandle = FileSystemFileHandle & {
  queryPermission?: (d: { mode: 'read' }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: 'read' }) => Promise<PermissionState>;
};

const titleOfPath = (id: string): string => id.slice(id.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, c => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

// Built-in samples sit in front of whatever the user imported. They're rebuilt
// on a language switch, since their titles are localized.
let samples: ScoreEntry[] = [];

async function withSamples(): Promise<ScoreEntry[]> {
  return [...samples, ...await scoresAll()];
}

function refreshSamples(): void {
  samples = sampleEntries();
  state.library = [...samples, ...state.library.filter(e => !e.builtin)];
  const active = samples.find(e => e.id === state.scoreId);
  if (active) state.track = active.track!;
}

const scoreLabel = (e: ScoreEntry): string => e.builtin ? `⭐ ${e.title}` : e.title;

// ── Library browser: the folder tree ─────────────────────────────────────────
// Entry ids are folder-relative paths, so the tree the user picked on disk can
// be rebuilt verbatim — practice folders ("音阶/", "巴赫/") stay meaningful
// instead of collapsing into one long list.
interface DirNode {
  name: string;
  path: string;
  dirs: Map<string, DirNode>;
  files: ScoreEntry[];
}

function newDir(name: string, path: string): DirNode {
  return { name, path, dirs: new Map(), files: [] };
}

function buildTree(entries: readonly ScoreEntry[]): DirNode {
  const root = newDir('', '');
  for (const e of entries) {
    const segs = e.id.split('/');
    let node = root;
    for (const seg of segs.slice(0, -1)) {
      let child = node.dirs.get(seg);
      if (!child) { child = newDir(seg, node.path ? `${node.path}/${seg}` : seg); node.dirs.set(seg, child); }
      node = child;
    }
    node.files.push(e);
  }
  return root;
}

// A lone root folder (the common case — one import) adds a level of nesting
// that says nothing, so unwrap it.
function treeRoots(root: DirNode): DirNode {
  return root.files.length === 0 && root.dirs.size === 1
    ? treeRoots([...root.dirs.values()][0])
    : root;
}

function renderDir(node: DirNode, depth: number): string {
  const out: string[] = [];
  // The samples folder always comes first.
  const dirs = [...node.dirs.values()].sort((a, b) =>
    Number(b.path === SAMPLE_DIR) - Number(a.path === SAMPLE_DIR) || a.name.localeCompare(b.name, 'zh'));
  for (const d of dirs) {
    const open = !state.collapsedDirs.has(d.path);
    const count = countFiles(d);
    out.push(
      `<div class="tree-row tree-dir" data-dir="${escapeAttr(d.path)}" style="--depth:${depth}">` +
        `<span class="tree-caret${open ? ' open' : ''}">▸</span>` +
        `<span class="tree-name">${escapeHtml(d.path === SAMPLE_DIR ? t('lib.samples') : d.name)}</span>` +
        `<span class="tree-count">${count}</span>` +
      `</div>`,
    );
    if (open) out.push(renderDir(d, depth + 1));
  }
  for (const f of [...node.files].sort((a, b) => a.title.localeCompare(b.title, getLang()))) {
    const active = f.id === state.scoreId;
    out.push(
      `<div class="tree-row tree-file${active ? ' active' : ''}" data-id="${escapeAttr(f.id)}" style="--depth:${depth}" title="${escapeAttr(f.id)}">` +
        `<span class="tree-name">${escapeHtml(scoreLabel(f))}</span>` +
        `<span class="tree-count">${f.track ? t('lib.noteCount', { n: f.track.notes.length }) : ''}</span>` +
        (f.builtin ? '' : `<button class="tree-del" type="button" data-del="${escapeAttr(f.id)}" title="${escapeAttr(t('lib.remove'))}" aria-label="${escapeAttr(t('lib.removeAria', { title: f.title }))}">✕</button>`) +
      `</div>`,
    );
  }
  return out.join('');
}

function countFiles(node: DirNode): number {
  let n = node.files.length;
  for (const d of node.dirs.values()) n += countFiles(d);
  return n;
}

function refreshScoreUi(): void {
  if (!state.els) return;
  const active = state.library.find(e => e.id === state.scoreId) ?? null;
  state.els.scoreName.textContent = active
    ? scoreLabel(active)
    : state.library.length ? t('lib.pick') : t('lib.empty');
  state.els.scoreBtn.classList.toggle('placeholder', !active);

  state.els.scoreTree.innerHTML = state.library.length
    ? renderDir(treeRoots(buildTree(state.library)), 0)
    : `<p class="tree-empty">${escapeHtml(t('lib.emptyHint'))}</p>`;
}

function toggleScorePanel(show?: boolean): void {
  if (!state.els) return;
  const panel = state.els.scorePanel;
  const next = show ?? panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !next);
  state.els.scoreBtn.setAttribute('aria-expanded', String(next));
  if (next) {
    // Reveal the active score: expand its ancestors, then scroll it into view.
    if (state.scoreId) {
      const segs = state.scoreId.split('/').slice(0, -1);
      let path = '';
      for (const seg of segs) { path = path ? `${path}/${seg}` : seg; state.collapsedDirs.delete(path); }
      refreshScoreUi();
    }
    // The panel only gets a layout after this frame, so scroll on the next one.
    requestAnimationFrame(() => {
      state.els?.scoreTree.querySelector('.tree-file.active')?.scrollIntoView({ block: 'nearest' });
    });
  }
}

// Make an entry the active score: adopt its notes, follow its tempo, rewind.
function selectScore(id: string | null, { rewind = true } = {}): void {
  const entry = id == null ? null : state.library.find(e => e.id === id) ?? null;
  state.scoreId = entry?.id ?? null;
  state.track = entry?.track ?? null;
  if (entry?.track?.bpm) {
    state.bpm = Math.max(40, Math.min(220, Math.round(entry.track.bpm)));
    if (state.els) state.els.bpmInput.value = String(state.bpm);
  }
  refreshScoreUi();
  saveSettings();
  if (rewind) clearData();     // play the new piece from the top
  void refreshStaff();
  drawOnce();
}

// Open a score from the tree, reading it first if it was only indexed. The
// parsed track is cached on the entry, so each file is read once; re-picking
// the folder drops the cache and re-reads on next open.
async function openScore(id: string, { rewind = true } = {}): Promise<void> {
  const entry = state.library.find(e => e.id === id);
  if (!entry) return;
  if (!entry.track && !(await loadTrack(entry))) return;
  await scoreXml(entry, true);   // the click is what lets us ask for file access
  selectScore(id, { rewind });
}

async function loadTrack(entry: ScoreEntry): Promise<boolean> {
  const h = entry.handle as ReadableHandle | undefined;
  if (!h) return false;
  // Permission to a picked folder lasts for the page session; after a reload
  // Chrome asks again, which needs the click that got us here.
  if (h.queryPermission && (await h.queryPermission({ mode: 'read' })) !== 'granted'
    && (await h.requestPermission?.({ mode: 'read' })) !== 'granted') {
    setStatus(t('lib.noPermission'), true);
    return false;
  }
  let file: File;
  try { file = await h.getFile(); } catch {
    setStatus(t('lib.loadFailed', { title: entry.title }), true);
    return false;
  }
  try {
    const text = await scoreTextOf(file);
    entry.track = parseMusicXml(text, entry.title);
    entry.xml = text;
  } catch (e) {
    setStatus(`${entry.title}: ${e instanceof Error ? e.message : t('err.xmlInvalid')}`, true);
    return false;
  }
  entry.title = entry.track.title;
  try {
    await scoresPut([entry]);
    state.library = await withSamples();   // the real title may sort differently
  } catch { /* cache is best-effort: the piece still plays this session */ }
  return true;
}

// Index a folder: walk it for score files, store one handle each, read none.
// Ids keep the "<folder>/<path>" shape webkitdirectory used, so re-picking a
// folder imported the old way replaces those entries instead of doubling them.
async function pickScoreFolder(): Promise<void> {
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await (window as DirPickerWindow).showDirectoryPicker!({ id: 'scores', mode: 'read' });
  } catch { return; }   // picker dismissed

  setStatus(t('lib.scanning'));
  const found: { id: string; handle: FileSystemFileHandle }[] = [];
  const walk = async (d: FileSystemDirectoryHandle, path: string): Promise<void> => {
    for await (const h of d.values()) {
      if (h.name.startsWith('.')) continue;
      const p = `${path}/${h.name}`;
      if (h.kind === 'directory') await walk(h as FileSystemDirectoryHandle, p);
      else if (SCORE_EXT.test(h.name)) found.push({ id: p, handle: h as FileSystemFileHandle });
    }
  };
  try { await walk(dir, dir.name); } catch {
    setStatus(t('lib.scanFailed'), true);
    return;
  }
  if (!found.length) { setStatus(t('lib.noScores')); return; }

  const prev = new Map(state.library.map(e => [e.id, e]));
  const fresh = new Set(found.map(f => f.id));
  const now = Date.now();
  const put: ScoreEntry[] = found.map(({ id, handle }) =>
    ({ id, title: titleOfPath(id), handle, addedAt: prev.get(id)?.addedAt ?? now }));
  // Scores deleted from the folder on disk leave the library with it.
  const del = state.library.filter(e => e.id.startsWith(`${dir.name}/`) && !fresh.has(e.id)).map(e => e.id);
  try {
    await scoresReplace(put, del);
    state.library = await withSamples();
  } catch (e) {
    setStatus(e instanceof Error ? e.message : t('lib.writeFailed'));
    return;
  }

  // Refreshing the folder you're practicing from keeps you on your piece;
  // otherwise land on its first score so something plays at once.
  const target = state.scoreId && fresh.has(state.scoreId)
    ? state.scoreId
    : state.library.find(e => fresh.has(e.id))?.id;
  if (target) await openScore(target, { rewind: target !== state.scoreId });
  else refreshScoreUi();
  if (!state.els?.statusEl.classList.contains('error')) {
    setStatus(`${t('lib.indexed', { n: found.length })} · ${t('lib.total', { n: state.library.length })}`);
  }
}

// .mxl is a zip around the same XML, so unwrap it before parsing.
async function scoreTextOf(file: File): Promise<string> {
  return /\.mxl$/i.test(file.name) ? readMxl(await file.arrayBuffer()) : file.text();
}

// Parse a batch of files into library entries, reporting what didn't make it.
// One bad file in a folder of fifty must not sink the import.
async function importScoreFiles(files: readonly File[]): Promise<void> {
  const candidates = files.filter(f => SCORE_EXT.test(f.name));
  if (!candidates.length) {
    setStatus(t('lib.noScores'));
    return;
  }

  setStatus(t('lib.importing', { n: candidates.length }));
  const entries: ScoreEntry[] = [];
  const failed: string[] = [];
  for (const file of candidates) {
    try {
      const xml = await scoreTextOf(file);
      const track = parseMusicXml(xml, file.name.replace(/\.[^.]+$/, ''));
      entries.push({ id: scoreIdOf(file), title: track.title, track, xml, addedAt: Date.now() });
    } catch {
      failed.push(file.name);
    }
  }
  if (!entries.length) {
    setStatus(t('lib.importAllFailed', { n: failed.length }));
    return;
  }

  try {
    await scoresPut(entries);
    state.library = await withSamples();
  } catch (e) {
    setStatus(e instanceof Error ? e.message : t('lib.writeFailed'));
    return;
  }

  // Land on the first newly imported piece so the user hears something at once.
  const firstId = state.library.find(e => entries.some(n => n.id === e.id))?.id ?? entries[0].id;
  selectScore(firstId);

  const parts = [t('lib.imported', { n: entries.length })];
  if (failed.length) parts.push(t('lib.parseFailed', { n: failed.length }));
  setStatus(`${parts.join(t('lib.listSep'))} · ${t('lib.total', { n: state.library.length })}`);
}

async function removeScore(id: string): Promise<void> {
  const gone = state.library.find(e => e.id === id);
  try {
    await scoresDelete(id);
    state.library = await withSamples();
  } catch {
    setStatus(t('lib.deleteFailed'));
    return;
  }
  // Only the active piece needs re-picking; removing any other just redraws.
  if (state.scoreId === id) selectScore(state.library.find(e => e.track)?.id ?? null);
  else refreshScoreUi();
  setStatus(gone ? t('lib.removedTitle', { title: gone.title }) : t('lib.removed'));
}

// Load the library at boot, migrating the single score older versions kept in
// localStorage so an upgrading user doesn't lose the piece they were on.
async function initLibrary(): Promise<void> {
  samples = sampleEntries();
  let legacy: ScoreEntry | null = null;
  try {
    const raw = localStorage.getItem(LEGACY_SCORE_KEY);
    if (raw) {
      const t = JSON.parse(raw) as TargetTrack;
      if (t && Array.isArray(t.notes) && t.notes.length) {
        legacy = { id: `${t.title}.musicxml`, title: t.title, track: t, addedAt: Date.now() };
      }
    }
  } catch { /* unreadable legacy payload — nothing to migrate */ }

  try {
    if (legacy) await scoresPut([legacy]);
    state.library = await withSamples();
  } catch {
    state.library = [...samples];   // private mode / blocked IndexedDB — samples only
  }
  if (legacy) { try { localStorage.removeItem(LEGACY_SCORE_KEY); } catch { /* */ } }

  // Only a score that has been read can be restored without a click.
  const pick = state.library.find(e => e.id === state.scoreId && e.track)?.id
    ?? legacy?.id
    ?? state.library.find(e => e.track)?.id
    ?? null;
  // Boot-time restore: don't rewind, the session hasn't started yet.
  selectScore(pick, { rewind: false });
}

// ── Staff ────────────────────────────────────────────────────────────────────
// The MusicXML behind a library entry. Imports made before the staff existed
// only kept the parsed notes; folder-indexed ones can be re-read from their
// file handle (asking for access only when the user clicked), and the text is
// then cached on the entry.
async function scoreXml(entry: ScoreEntry, interactive: boolean): Promise<string | null> {
  if (entry.xml) return entry.xml;
  const h = entry.handle as ReadableHandle | undefined;
  if (!h) return null;
  if (h.queryPermission && (await h.queryPermission({ mode: 'read' })) !== 'granted') {
    if (!interactive || (await h.requestPermission?.({ mode: 'read' })) !== 'granted') return null;
  }
  try {
    entry.xml = await scoreTextOf(await h.getFile());
  } catch { return null; }
  if (!entry.builtin) void scoresPut([entry]).catch(() => { /* cache is best-effort */ });
  return entry.xml;
}

function setStaffShown(on: boolean): void {
  state.staffShown = on;
  if (!state.els) return;
  state.els.staffEl.classList.toggle('hidden', !on);
  state.els.wrap.classList.toggle('has-staff', on);
  state.els.wrap.style.setProperty('--staff-h', `${on ? state.els.staffEl.offsetHeight : 0}px`);
  resizeCanvas();
}

// Show the active score's staff in score mode, hide it otherwise. Re-renders
// only when the score itself changed — switching tabs just toggles visibility.
async function refreshStaff(): Promise<void> {
  if (!state.els) return;
  const entry = state.refMode === 'score' ? state.library.find(e => e.id === state.scoreId) : undefined;
  if (!entry) { setStaffShown(false); return; }
  const xml = await scoreXml(entry, false);
  if (entry.id !== state.scoreId || state.refMode !== 'score') return;
  if (xml === state.staffXml) { setStaffShown(xml != null); return; }
  state.staffXml = xml;
  state.staffOffset = 0;
  if (xml) {
    try { state.staffOffset = parseMusicXml(xml, entry.title).offsetBeats ?? 0; } catch { /* */ }
  }
  setStaffShown(xml != null);    // visible before rendering: OSMD lays out to the box width
  state.staff ??= new Staff(state.els.staffEl);
  const ok = await state.staff.load(xml);
  if (state.staffXml === xml) setStaffShown(ok);   // again: the box now has the line's real height
  drawOnce();
}

// ── Microphone device picker ────────────────────────────────────────────────
// Fill the input-device dropdown. Device *labels* are only revealed after mic
// permission is granted, so this is called both at init (generic names) and
// again after start()/devicechange (real names). When the user hasn't picked a
// device and an iPhone (Continuity Microphone) is present, prefer it — that's
// the common case on a Mac mini with no built-in mic.
async function populateMicList(): Promise<void> {
  const sel = state.els?.micSelect;
  if (!sel || !navigator.mediaDevices?.enumerateDevices) return;
  let devices: MediaDeviceInfo[];
  try { devices = await navigator.mediaDevices.enumerateDevices(); } catch { return; }
  const inputs = devices.filter(d => d.kind === 'audioinput');

  if (!state.micDeviceId) {
    const iphone = inputs.find(d => /iphone|连续互通|continuity/i.test(d.label));
    if (iphone && iphone.deviceId) {
      state.micDeviceId = iphone.deviceId;
      saveSettings();
      setStatus(t('mic.autoIphone'));
    }
  }

  sel.innerHTML = '';
  const def = document.createElement('option');
  def.value = '';
  def.textContent = t('mic.default');
  sel.appendChild(def);
  for (const d of inputs) {
    const o = document.createElement('option');
    o.value = d.deviceId;
    o.textContent = d.label || t('mic.unnamed');
    sel.appendChild(o);
  }
  sel.value = state.micDeviceId ?? '';
}

// Switch the active input device. Rebuilds the mic source live when running.
async function switchMic(deviceId: string): Promise<void> {
  state.micDeviceId = deviceId || null;
  saveSettings();
  if (!state.running || !state.ctx || !state.analyser) return;
  try { state.micSource?.disconnect(); } catch { /* */ }
  state.micStream?.getTracks().forEach(t => t.stop());
  try {
    state.micStream = await openMicStream();
  } catch {
    setStatus(t('mic.switchFailed'));
    return;
  }
  state.micSource = state.ctx.createMediaStreamSource(state.micStream);
  state.micSource.connect(state.analyser);
  setStatus('');
}

// Pause: keep mic + ctx + pitch history so resume() can continue from here.
// Suspending the AudioContext freezes its currentTime, so on resume the
// startTime math doesn't need to compensate for paused wall-clock.
// `summary: false` suppresses the status line and the practice report — used
// by 重来, which pauses only as a step on its way back to the top.
async function pause({ summary = true } = {}): Promise<void> {
  if (!state.running || !state.ctx) return;
  state.frozenElapsedBeats = currentBeat();   // never freeze mid-count-in
  state.running = false;

  if (state.detectId) { clearInterval(state.detectId as ReturnType<typeof setInterval>); state.detectId = 0; }
  if (state.rafId) { cancelAnimationFrame(state.rafId); state.rafId = 0; }

  const wasRecording = state.recording;
  pauseRecording();
  try { await state.ctx.suspend(); } catch { /* */ }

  if (summary) {
    // The take is paused, not lost — 继续 resumes into it, 重来 files it.
    setStatus(wasRecording ? t('status.pausedRec') : t('status.paused'));
  }
  updatePitchReadout(-1);
  updateStartBtn();
  drawOnce();
  if (summary && state.viewMode === 'practice') showReport();
}

async function resume(): Promise<void> {
  if (state.running || !state.ctx) return;
  try { await state.ctx.resume(); } catch { /* */ }

  const spb = 60 / state.bpm;
  // Count-in holds the playhead where it was paused and clicks off N beats
  // before letting the clock through — it counts you in on the spot rather
  // than replaying music you already played.
  state.runStartBeat = state.frozenElapsedBeats;
  const from = state.frozenElapsedBeats - state.countInBeats;
  state.startTime = clockNow() - from * spb;
  syncWait(state.frozenElapsedBeats);
  state.viewOffsetBeats = 0;
  // Next tick = first whole beat after the resume point, but never in the past
  // (otherwise scheduleMetronome would burst-fire all missed beats at once).
  const nextBeat = Math.floor(from) + 1;
  state.nextTickBeat = nextBeat;
  state.nextTickTime = state.startTime + nextBeat * spb;
  if (state.nextTickTime < clockNow() + 0.05) {
    state.nextTickTime = clockNow() + 0.05;
  }
  state.running = true;

  state.detectId = setInterval(detectStep, DETECT_INTERVAL_MS);
  resumeRecording();
  setStatus('');
  hideReport();
  updateStartBtn();
  drawLoop();
}

// Wipe the pitch trail and rewind the timeline to beat 0. Keeps the session
// alive (mic/ctx untouched) so it works while running, paused, or idle.
//
// 重来 also closes the current take: a recording belongs to one run-through,
// so ending the run files it. rec.onstop then opens the next take by itself
// when the switch is still armed.
function clearData(): void {
  if (state.recording) { try { state.recorder?.stop(); } catch { /* */ } }
  histClear();
  state.waitIdx = 0;
  state.waitRun = 0;
  state.frozenElapsedBeats = 0;
  state.viewOffsetBeats = 0;
  if (state.ctx) {
    const spb = 60 / state.bpm;
    state.startTime = clockNow();
    state.nextTickBeat = 0;
    state.nextTickTime = state.startTime + spb;
  }
  updatePitchReadout(-1);
  hideReport();
  drawOnce();
}

// 重来 — end this run: stop the clock, file the take, rewind to beat 0. It
// pauses rather than rolling straight on, so you can get the bow back to its
// starting position before pressing 继续.
async function redo(): Promise<void> {
  const hadTake = state.recording;
  await pause({ summary: false });   // report would only describe a trail we're about to wipe
  clearData();
  // With a take in flight, rec.onstop posts its own "录好了 …" status.
  if (!hadTake) setStatus(t('status.rewound'));
}

// Full release of mic/audio resources. Used when leaving the panel.
async function teardown(): Promise<void> {
  if (!state.running && !state.ctx) return;
  if (state.ctx) {
    state.frozenElapsedBeats = currentBeat();
  }
  state.running = false;

  if (state.detectId) { clearInterval(state.detectId as ReturnType<typeof setInterval>); state.detectId = 0; }
  if (state.rafId) { cancelAnimationFrame(state.rafId); state.rafId = 0; }

  if (state.recording) { try { state.recorder?.stop(); } catch { /* */ } }
  try { state.micSource?.disconnect(); } catch { /* */ }
  try { state.analyser?.disconnect(); } catch { /* */ }
  state.micStream?.getTracks().forEach(t => t.stop());
  state.drone?.dispose();

  state.micSource = null;
  state.analyser = null;
  state.micStream = null;
  state.buffer = null;
  state.noiseBuffer = null;
  state.drone = null;

  if (state.ctx) { await state.ctx.close(); state.ctx = null; }

  setStatus('');
  updatePitchReadout(-1);
  updateStartBtn();
  drawOnce();
}

// ── Detection loop ─────────────────────────────────────────────────────────
function detectStep(): void {
  if (!state.running || !state.analyser || !state.buffer || !state.ctx) return;

  state.analyser.getFloatTimeDomainData(state.buffer);
  const buf = state.buffer;
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / buf.length);
  const f = detectPitch(buf, state.ctx.sampleRate);
  updatePitchReadout(f);
  // Tuner mode: readout + needle only — no trail recording, no metronome.
  // The practice timeline is frozen by setViewMode while tuning.
  if (state.viewMode === 'tuner') {
    updateTuner(f);
    return;
  }
  // During a count-in the clock is parked, so anything captured now would pile
  // up on a single beat — tick the metronome but don't record the trail.
  if (countInLeft() <= 0) {
    waitStep(f);
    histPush(clockNow(), f, rms);
  }
  scheduleMetronome();
}

// ── Drawing ────────────────────────────────────────────────────────────────
function drawLoop(): void {
  drawOnce();
  if (state.running) state.rafId = requestAnimationFrame(drawLoop);
}

function drawOnce(): void {
  const els = state.els;
  if (!els) return;
  const c = els.canvas;
  const W = c.width;
  const H = c.height;
  const ctx2d = c.getContext('2d');
  if (!ctx2d) return;

  const bg = ctx2d.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, PALETTE.bgTop);
  bg.addColorStop(1, PALETTE.bgBottom);
  ctx2d.fillStyle = bg;
  ctx2d.fillRect(0, 0, W, H);

  const secsPerBeat = 60 / state.bpm;
  const elapsedBeats = state.running && state.ctx
    ? currentBeat()                                       // parked during a count-in
    : state.frozenElapsedBeats + state.viewOffsetBeats;

  // Pitch range + reference lanes. Score mode derives its lanes (every
  // semitone) from the loaded score's note range; otherwise use the key preset.
  const scoreMode = scoreModeActive();
  let refNotes = state.rangeNotes;
  if (scoreMode) {
    let lo = Infinity, hi = -Infinity;
    for (const n of state.track!.notes) { if (n.midi < lo) lo = n.midi; if (n.midi > hi) hi = n.midi; }
    lo = Math.floor(lo) - 1;
    hi = Math.ceil(hi) + 1;
    const lanes: RefNote[] = [];
    for (let m = lo; m <= hi; m++) lanes.push({ midi: m, name: midiToNoteName(m), frequency: midiToFreq(m), target: true });
    refNotes = lanes;
  }
  let mMin = Infinity, mMax = -Infinity;
  for (const n of refNotes) {
    const m = freqToMidi(n.frequency);
    if (m < mMin) mMin = m;
    if (m > mMax) mMax = m;
  }
  if (!isFinite(mMin) || !isFinite(mMax)) {
    mMin = DEFAULT_MIDI_MIN;
    mMax = DEFAULT_MIDI_MAX;
  } else {
    mMin -= 2;
    mMax += 2;
  }

  // Scale layout pixel values so things look right on both 320px and 1080px canvases.
  const scale = Math.max(1, Math.min(2.6, Math.min(W, H) / 480));
  const fontSm = Math.round(11 * scale);
  const fontMd = Math.round(13 * scale);
  const leftMargin = Math.round(44 * scale);
  const playheadX = leftMargin + (W - leftMargin) * PLAYHEAD_RATIO;
  const pxPerBeat = (W - playheadX - 10 * scale) / (state.visibleBeats - state.visibleBeats * PLAYHEAD_RATIO);
  state.lastPxPerBeat = pxPerBeat;
  // The staff's cursor lines up with the playhead, so the eye can drop
  // straight from the written note to the pitch trace below it.
  if (state.staffShown && state.track) {
    state.staff?.follow(elapsedBeats - SCORE_LEADIN_BEATS + state.staffOffset, playheadX);
  }

  const topY = Math.round(24 * scale);
  const bottomY = H - Math.round(28 * scale);
  const usableH = bottomY - topY;

  const midiToY = (m: number): number =>
    topY + (mMax - m) / (mMax - mMin) * usableH;
  const beatToX = (b: number): number =>
    playheadX + (b - elapsedBeats) * pxPerBeat;

  // Reference lanes. Chromatic mode: a line per semitone, labels on naturals.
  // Scale mode: scale tones are bright + labelled (with octave), non-scale
  // tones fade to faint guide lines so the target notes stand out.
  const scaleMode = state.refMode === 'scale';
  ctx2d.lineWidth = 1;
  ctx2d.font = `${fontMd}px system-ui, sans-serif`;
  ctx2d.textBaseline = 'middle';
  ctx2d.textAlign = 'right';
  for (const n of refNotes) {
    const y = midiToY(freqToMidi(n.frequency));
    const isSharp = n.name.includes('#');
    if (scaleMode && !n.target) {
      ctx2d.strokeStyle = PALETTE.refLineFaint;
      ctx2d.beginPath();
      ctx2d.moveTo(leftMargin, y);
      ctx2d.lineTo(W, y);
      ctx2d.stroke();
      continue;
    }
    ctx2d.strokeStyle = PALETTE.refLine;
    ctx2d.beginPath();
    ctx2d.moveTo(leftMargin, y);
    ctx2d.lineTo(W, y);
    ctx2d.stroke();
    // Chromatic mode labels naturals only; scale mode labels every scale tone.
    if (scaleMode) {
      ctx2d.fillStyle = PALETTE.refLabelTgt;
      ctx2d.fillText(n.name, leftMargin - 4, y);
    } else if (!isSharp) {
      ctx2d.fillStyle = PALETTE.refLabel;
      ctx2d.fillText(n.name, leftMargin - 4, y);
    }
  }

  // Beat / second grid
  ctx2d.font = `${fontSm}px system-ui, sans-serif`;
  ctx2d.textAlign = 'left';
  ctx2d.textBaseline = 'top';
  if (state.timeUnit === 'beat') {
    const firstBeat = Math.floor(elapsedBeats - state.visibleBeats * PLAYHEAD_RATIO);
    const lastBeat = Math.ceil(elapsedBeats + state.visibleBeats * (1 - PLAYHEAD_RATIO));
    for (let b = firstBeat; b <= lastBeat; b++) {
      const x = beatToX(b);
      if (x < leftMargin || x > W) continue;
      const isAccent = b >= 0 && b % state.accentEvery === 0;
      ctx2d.strokeStyle = isAccent ? PALETTE.gridAccent : PALETTE.gridRegular;
      ctx2d.lineWidth = isAccent ? 1.2 * scale : 1;
      ctx2d.beginPath();
      ctx2d.moveTo(x, topY);
      ctx2d.lineTo(x, bottomY);
      ctx2d.stroke();
      ctx2d.fillStyle = isAccent ? PALETTE.labelAccent : PALETTE.labelRegular;
      ctx2d.fillText(`${b + 1}`, x + 2, bottomY + 4);
    }
  } else {
    // Adaptive grid step in seconds: pick the smallest ladder value that keeps
    // each label at least MIN_LABEL_PX apart, independent of BPM/visibleBeats.
    const pxPerSec = pxPerBeat / secsPerBeat;
    const MIN_LABEL_PX = 60 * scale;
    const STEP_LADDER = [0.5, 1, 2, 5, 10, 30, 60];
    let secStep = STEP_LADDER[STEP_LADDER.length - 1];
    for (const s of STEP_LADDER) {
      if (s * pxPerSec >= MIN_LABEL_PX) { secStep = s; break; }
    }
    const elapsedSec = elapsedBeats * secsPerBeat;
    const visSpanLeft = state.visibleBeats * PLAYHEAD_RATIO * secsPerBeat;
    const visSpanRight = state.visibleBeats * (1 - PLAYHEAD_RATIO) * secsPerBeat;
    const firstStep = Math.floor((elapsedSec - visSpanLeft) / secStep);
    const lastStep = Math.ceil((elapsedSec + visSpanRight) / secStep);
    for (let s = firstStep; s <= lastStep; s++) {
      const t = s * secStep;
      const x = beatToX(t / secsPerBeat);
      if (x < leftMargin || x > W) continue;
      const isAccent = s >= 0 && s % 2 === 0;
      ctx2d.strokeStyle = isAccent ? PALETTE.gridAccent : PALETTE.gridRegular;
      ctx2d.lineWidth = isAccent ? 1.2 * scale : 1;
      ctx2d.beginPath();
      ctx2d.moveTo(x, topY);
      ctx2d.lineTo(x, bottomY);
      ctx2d.stroke();
      ctx2d.fillStyle = isAccent ? PALETTE.labelAccent : PALETTE.labelRegular;
      const label = secStep < 1 ? `${t.toFixed(1)}s` : `${Math.round(t)}s`;
      ctx2d.fillText(label, x + 2, bottomY + 4);
    }
  }

  // Score note blocks (follow-along). Each note is a rounded bar at its pitch
  // spanning its time; the bar under the playhead is highlighted "now".
  if (scoreMode) {
    const semiPx = Math.abs(midiToY(60) - midiToY(61));
    const blockH = Math.max(6, semiPx * 0.82);
    ctx2d.textAlign = 'left';
    ctx2d.textBaseline = 'middle';
    ctx2d.font = `${fontSm}px system-ui, sans-serif`;
    const scoreBeat = elapsedBeats - SCORE_LEADIN_BEATS;
    for (const n of state.track!.notes) {
      const x0 = beatToX(n.startBeat + SCORE_LEADIN_BEATS);
      const x1 = beatToX(n.startBeat + n.durBeat + SCORE_LEADIN_BEATS);
      if (x1 < leftMargin || x0 > W) continue;
      const y = midiToY(n.midi);
      const now = scoreBeat >= n.startBeat && scoreBeat < n.startBeat + n.durBeat;
      const left = Math.max(leftMargin, x0);
      const w = Math.max(2, Math.min(W, x1) - left - 1);
      ctx2d.fillStyle = now ? PALETTE.scoreBlockNow : PALETTE.scoreBlock;
      ctx2d.strokeStyle = PALETTE.scoreBlockEdge;
      ctx2d.lineWidth = 1;
      const yy = y - blockH / 2;
      ctx2d.beginPath();
      // roundRect is missing on older Safari (< 16) — fall back to plain rect.
      if (typeof ctx2d.roundRect === 'function') {
        ctx2d.roundRect(left, yy, w, blockH, Math.min(4, blockH / 2, w / 2));
      } else {
        ctx2d.rect(left, yy, w, blockH);
      }
      ctx2d.fill();
      ctx2d.stroke();
      if (w > 22 * scale) {
        ctx2d.fillStyle = PALETTE.scoreLabel;
        ctx2d.fillText(n.name, left + 4, y);
      }
    }
  }

  // Pitch trace + volume waveform. We keep this hot loop cheap by rejecting on
  // the visible-time window before any log/midi math, batching pitch segments
  // into per-color Path2D buckets (one stroke per color), and accumulating
  // volume points into a single mirrored polygon drawn beneath the dots.
  const visibleStartT = state.startTime + (elapsedBeats - state.visibleBeats * PLAYHEAD_RATIO) * secsPerBeat;
  const visibleEndT   = state.startTime + (elapsedBeats + state.visibleBeats * (1 - PLAYHEAD_RATIO)) * secsPerBeat;

  // Tri-color buckets when reference notes are available; otherwise a single
  // fallback bucket. Order matches pickBucket() return values.
  const buckets: { color: string; path: Path2D }[] = [
    { color: PALETTE.traceGood,  path: new Path2D() },
    { color: PALETTE.traceMed,   path: new Path2D() },
    { color: PALETTE.traceBad,   path: new Path2D() },
    { color: PALETTE.traceNoRef, path: new Path2D() },
  ];
  // Judge only against target notes (the key's scale tones) so trace colour
  // reflects the scale the player is practising.
  const refFreqs: number[] = [];
  for (const n of refNotes) if (n.target) refFreqs.push(n.frequency);
  const hasRef = refFreqs.length > 0;

  const bucketForCents = (absCents: number): number =>
    absCents <= state.centsToleranceGood ? 0 : absCents <= state.centsToleranceMed ? 1 : 2;

  // Colour a sample. Score mode judges against the note under that sample's
  // beat (neutral during rests / lead-in); otherwise against the nearest of the
  // static reference frequencies.
  const pickBucket = (f: number, beat: number): number => {
    if (!state.pitchJudge) return 3;
    if (scoreMode) {
      const tn = targetNoteAtBeat(beat);
      if (!tn) return 3;
      return bucketForCents(Math.abs(1200 * Math.log2(f / midiToFreq(tn.midi))));
    }
    if (!hasRef) return 3;
    let bestCents = Infinity;
    for (let i = 0; i < refFreqs.length; i++) {
      const c = Math.abs(1200 * Math.log2(f / refFreqs[i]));
      if (c < bestCents) bestCents = c;
    }
    return bucketForCents(bestCents);
  };

  // Volume waveform: each visible sample contributes (x, top-y); we mirror
  // about volCenterY when building the closed polygon below. sqrt mapping
  // gives a perceptually closer-to-loudness curve than raw RMS.
  const volCenterY = (topY + bottomY) / 2;
  const volHalfH = usableH * 0.48;
  const volXs: number[] = [];
  const volYs: number[] = [];

  const dotR = 1.8 * scale;
  const pts: { ts: number; x: number; y: number; m: number; beat: number }[] = [];
  histForEach((ts, f, v) => {
    if (ts < visibleStartT || ts > visibleEndT) return;
    const beat = (ts - state.startTime) / secsPerBeat;
    const x = beatToX(beat);
    if (x < leftMargin || x > W) return;

    const a = Math.min(1, Math.sqrt(v * 3));
    volXs.push(x);
    volYs.push(volCenterY - a * volHalfH);

    if (f <= 0) return;
    const m = freqToMidi(f);
    if (m < mMin || m > mMax) return;
    pts.push({ ts, x, y: midiToY(m), m, beat });
  });

  // Colour by the pitch the ear hears: the mean over about one vibrato cycle
  // (±JUDGE_WIN_S) of the same held note. A dot still sits where it was sung,
  // but a well-centred vibrato no longer flickers red at its troughs. The
  // window stops at a dropout or a jump to another note.
  const JUDGE_WIN_S = 0.1;
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[i];
    let sum = p0.m, n = 1;
    for (let j = i - 1; j >= 0; j--) {
      const q = pts[j], nb = pts[j + 1];
      if (p0.ts - q.ts > JUDGE_WIN_S || nb.ts - q.ts > 0.06 || Math.abs(q.m - nb.m) > 0.8) break;
      sum += q.m; n++;
    }
    for (let j = i + 1; j < pts.length; j++) {
      const q = pts[j], pb = pts[j - 1];
      if (q.ts - p0.ts > JUDGE_WIN_S || q.ts - pb.ts > 0.06 || Math.abs(q.m - pb.m) > 0.8) break;
      sum += q.m; n++;
    }
    const p = buckets[pickBucket(midiToFreq(sum / n), p0.beat)].path;
    p.moveTo(p0.x + dotR, p0.y);
    p.arc(p0.x, p0.y, dotR, 0, Math.PI * 2);
  }

  if (volXs.length >= 2) {
    ctx2d.beginPath();
    ctx2d.moveTo(volXs[0], volCenterY);
    for (let i = 0; i < volXs.length; i++) ctx2d.lineTo(volXs[i], volYs[i]);
    for (let i = volXs.length - 1; i >= 0; i--) {
      ctx2d.lineTo(volXs[i], 2 * volCenterY - volYs[i]);
    }
    ctx2d.closePath();
    ctx2d.fillStyle = 'rgba(126, 180, 207, 0.22)';
    ctx2d.fill();
  }

  for (const b of buckets) {
    ctx2d.fillStyle = b.color;
    ctx2d.fill(b.path);
  }

  // Playhead with a soft cyan glow.
  ctx2d.save();
  ctx2d.shadowColor = PALETTE.playhead;
  ctx2d.shadowBlur = 8 * scale;
  ctx2d.strokeStyle = PALETTE.playhead;
  ctx2d.lineWidth = 2 * scale;
  ctx2d.beginPath();
  ctx2d.moveTo(playheadX, topY - 4);
  ctx2d.lineTo(playheadX, bottomY + 4);
  ctx2d.stroke();
  ctx2d.restore();

  // Count-in: big 4·3·2·1 on the playhead, so you can take your eyes off the
  // toolbar and still know when to come in.
  const left = countInLeft();
  if (left > 0) {
    const n = Math.ceil(left);
    const frac = n - left;                    // 0 → 1 across the current beat
    ctx2d.save();
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';
    const midY = (topY + bottomY) / 2;
    // Each number fades and shrinks slightly as its beat runs out.
    ctx2d.globalAlpha = 0.25 + 0.75 * (1 - frac);
    const size = Math.round((64 - 8 * frac) * scale);
    ctx2d.font = `700 ${size}px -apple-system, system-ui, sans-serif`;
    ctx2d.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx2d.shadowBlur = 12 * scale;
    ctx2d.fillStyle = PALETTE.playhead;
    ctx2d.fillText(String(n), playheadX, midY);
    ctx2d.restore();
  }

  // Mic failure: say it loudly where the user is actually looking.
  if (state.micError && !state.running) {
    ctx2d.save();
    ctx2d.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx2d.fillRect(0, 0, W, H);
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';
    ctx2d.font = `600 ${Math.round(15 * scale)}px -apple-system, system-ui, sans-serif`;
    ctx2d.fillStyle = '#ff9f0a';
    ctx2d.fillText(t('canvas.cannotStart'), W / 2, H / 2 - 16 * scale);
    ctx2d.font = `${Math.round(13 * scale)}px -apple-system, system-ui, sans-serif`;
    ctx2d.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx2d.fillText(t(state.micError), W / 2, H / 2 + 10 * scale);
    ctx2d.restore();
  }
}

// ── UI helpers ─────────────────────────────────────────────────────────────
function setStatus(msg: string, isError = false): void {
  if (!state.els) return;
  state.els.statusEl.textContent = msg;
  state.els.statusEl.classList.toggle('error', isError && !!msg);
}

function updateStartBtn(): void {
  if (!state.els) return;
  // A ctx without an analyser = mic never opened (failed start / drone-only) —
  // that's still "开始", not "继续".
  const resumable = !!state.ctx && !!state.analyser;
  let label: string;
  if (state.running) label = t('btn.pause');
  else if (resumable) label = t('btn.resume');
  else label = t('btn.start');
  state.els.startBtn.textContent = label;
  // Tuner has its own start button; when tuning, "暂停" reads oddly, so show 停止.
  state.els.tunerStartBtn.textContent = state.running ? t('btn.stop') : (resumable ? t('btn.resume') : t('btn.start'));
  state.refreshPanCursor?.();
}

// ── Practice report ──────────────────────────────────────────────────────────
// Walk the recorded history, snap each voiced frame to its nearest target note,
// and hand the frames to the analyzer. Frames more than ~150¢ from any target
// are dropped as transitions/noise rather than counted as a note. Each frame
// carries which target it was judged against, so the analyzer can regroup them
// into held notes (vibrato centre, attack).
interface SessionReport {
  report: Report;
  notes: NoteAnalysis;
  midiOf: Map<string, number>;   // note name → midi, for acting on a worst note
}

function computeReport(): SessionReport | null {
  const frames: Frame[] = [];
  const midiOf = new Map<string, number>();
  if (scoreModeActive()) {
    // Judge each frame against the score note under its beat.
    const spb = 60 / state.bpm;
    const notes = state.track!.notes;
    histForEach((ts, f) => {
      if (f <= 0) return;
      const i = targetIndexAtBeat((ts - state.startTime) / spb);
      if (i < 0) return;
      const tn = notes[i];
      const c = 1200 * Math.log2(f / midiToFreq(tn.midi));
      if (Math.abs(c) > 150) return;
      midiOf.set(tn.name, tn.midi);
      frames.push({ t: ts, note: i, name: tn.name, cents: Math.round(c) });
    });
  } else {
    const targets = state.rangeNotes.filter(n => n.target);
    if (!targets.length) return null;
    histForEach((ts, f) => {
      if (f <= 0) return;
      let bestAbs = Infinity, bestSigned = 0, best = 0;
      for (let i = 0; i < targets.length; i++) {
        const c = 1200 * Math.log2(f / targets[i].frequency);
        const a = Math.abs(c);
        if (a < bestAbs) { bestAbs = a; bestSigned = c; best = i; }
      }
      if (bestAbs > 150) return;
      midiOf.set(targets[best].name, targets[best].midi);
      frames.push({ t: ts, note: best, name: targets[best].name, cents: Math.round(bestSigned) });
    });
  }
  if (frames.length < 20) return null; // not enough to say anything useful
  const notes = analyzeNotes(frames, state.centsToleranceMed);
  return { report: analyze(notes.entries, state.centsToleranceGood, state.centsToleranceMed), notes, midiOf };
}

// Approximate rhythm timing. Detect note onsets (note-change transitions above
// a volume floor), then measure each onset against the nearest expected time —
// score-note starts in score mode, otherwise the beat grid. Latency-compensated.
// Only meaningful when there's a timing reference (metronome on or a score).
function computeRhythm(): { errorsMs: number[]; onTimeMs: number } | null {
  const scoreMode = scoreModeActive();
  if (!scoreMode && !state.metronomeOn) return null;
  if (waitActive()) return null;   // the music waited for you — there's no pulse to be on
  const spb = 60 / state.bpm;

  const onsets: number[] = [];
  let prevMidi: number | null = null;
  let lastOnset = -1;
  histForEach((ts, f, v) => {
    if (f <= 0 || v < 0.012) { prevMidi = null; return; }
    const m = Math.round(freqToMidi(f));
    if (prevMidi === null || m !== prevMidi) {
      if (ts - lastOnset > 0.09) { onsets.push(ts); lastOnset = ts; }
      prevMidi = m;
    }
  });
  if (onsets.length < 3) return null;

  const expected: number[] = [];
  if (scoreMode && state.track) {
    for (const n of state.track.notes) expected.push((n.startBeat + SCORE_LEADIN_BEATS) * spb);
  }

  const errorsMs: number[] = [];
  for (const ot of onsets) {
    const t = (ot - state.startTime) - state.micLatency;  // play-time, from start
    let expT: number;
    if (scoreMode && expected.length) {
      let best = expected[0], bestD = Infinity;
      for (const e of expected) { const d = Math.abs(e - t); if (d < bestD) { bestD = d; best = e; } }
      expT = best;
    } else {
      expT = Math.round(t / spb) * spb;  // nearest beat
    }
    const err = (t - expT) * 1000;
    if (Math.abs(err) <= 300) errorsMs.push(err);
  }
  if (errorsMs.length < 3) return null;
  return { errorsMs, onTimeMs: 60 };
}

function hideReport(): void {
  state.els?.reportEl.classList.add('hidden');
}

function showReport(): void {
  const el = state.els?.reportEl;
  if (!el) return;
  const sr = computeReport();
  if (!sr) { hideReport(); return; }
  const r = sr.report;

  const round = (n: number): string => `${n < 0 ? '−' : ''}${Math.abs(Math.round(n))}`;
  let tendency = '';
  if (r.tendency > state.centsToleranceGood) tendency = `<span class="report-note">${t('rep.tendHigh', { c: round(r.tendency) })}</span>`;
  else if (r.tendency < -state.centsToleranceGood) tendency = `<span class="report-note">${t('rep.tendLow', { c: round(r.tendency) })}</span>`;

  let worst: string;
  if (r.worst.length === 0) {
    worst = `<div class="report-good">${t('rep.allGood')}</div>`;
  } else {
    worst = `<div class="report-worst-title">${t('rep.worstTitle')}</div><ul class="report-worst">` + r.worst.map(w =>
      `<li>${t(w.meanCents > 0 ? 'rep.noteHigh' : 'rep.noteLow', { name: w.name, c: round(w.meanCents) })}</li>`,
    ).join('') + '</ul>';
  }

  const rh = computeRhythm();
  const r2 = rh ? analyzeRhythm(rh.errorsMs, rh.onTimeMs) : null;
  let rhythmHtml = '';
  if (r2) {
    const tend = r2.tendencyMs > 20 ? t('rep.late', { ms: Math.round(r2.tendencyMs) })
      : r2.tendencyMs < -20 ? t('rep.early', { ms: Math.round(-r2.tendencyMs) }) : t('rep.onTime');
    const cal = state.micLatency > 0 ? '' : ` <span class="report-hint">${t('rep.uncalibrated')}</span>`;
    const line = t('rep.rhythm', { pct: Math.round(r2.onTimePct), ms: Math.round(r2.meanAbsMs), tend });
    rhythmHtml = `<div class="report-rhythm">${line}${cal}</div>`;
  }

  // Attack and vibrato: one line each, only when there were enough notes.
  const lines: string[] = [];
  const on = sr.notes.onset;
  if (on && on.notes >= 3) {
    let slide = '';
    if (on.slideCents <= -5) slide = ` · ${t('rep.slideUp', { c: Math.round(-on.slideCents) })}`;
    else if (on.slideCents >= 5) slide = ` · ${t('rep.slideDown', { c: Math.round(on.slideCents) })}`;
    lines.push(t('rep.onset', { pct: Math.round(on.inTunePct), n: on.notes }) + slide);
  }
  const vib = sr.notes.vibrato;
  if (vib) {
    const tags: string[] = [];
    if (vib.rateHz < 4.5) tags.push(t('rep.vibSlow'));
    else if (vib.rateHz > 7.5) tags.push(t('rep.vibFast'));
    if (vib.widthCents > 30) tags.push(t('rep.vibWide'));
    const tag = tags.length ? ` · ${tags.join(t('lib.listSep'))}` : '';
    lines.push(t('rep.vibrato', { n: vib.notes, hz: vib.rateHz.toFixed(1), w: Math.round(vib.widthCents) }) + tag);
  }
  const notesHtml = lines.map(l => `<div class="report-rhythm">${l}</div>`).join('');

  const next = nextStep(sr, r2);
  state.nextAction = next?.run ?? null;
  const nextHtml = next
    ? `<div class="report-next"><span>${next.text}</span>` +
      (next.run ? `<button class="rt-mini-btn" type="button" data-next>${escapeHtml(next.label!)}</button>` : '') +
      '</div>'
    : '';

  el.innerHTML = `
    <div class="report-head">
      <span class="report-score">${t('rep.score')} <b>${r.score}</b></span>
      <span class="report-bars">${t('rep.bars', { a: Math.round(r.inTunePct), b: Math.round(r.closePct), c: Math.round(r.offPct) })}</span>
      ${tendency}
    </div>
    ${rhythmHtml}
    ${notesHtml}
    ${worst}
    ${nextHtml}`;
  el.classList.remove('hidden');
}

// ── Next step ────────────────────────────────────────────────────────────────
// One concrete thing to do with the next run-through, picked from the
// report's biggest problem, plus a button that sets it up. Order matters: a
// shaky pulse or groping attacks make every pitch number noisy, so those come
// before intonation; a clean run earns a faster tempo.
interface NextStep {
  text: string;
  label?: string;
  run?: () => void;
}

function setBpm(v: number): void {
  state.bpm = Math.max(40, Math.min(220, Math.round(v)));
  if (state.els) state.els.bpmInput.value = String(state.bpm);
  saveSettings();
}

function setMetronome(on: boolean): void {
  state.metronomeOn = on;
  state.els?.metronomeToggles.forEach(b => b.classList.toggle('active', (b.dataset.value === 'on') === on));
  saveSettings();
}

function setDrone(mode: DroneMode, rootMidi?: number): void {
  state.droneMode = mode;
  if (rootMidi != null) {
    state.droneRootMidi = rootMidi;
    if (state.els) state.els.droneRootSelect.value = String(rootMidi);
  }
  state.els?.droneToggles.forEach(b => b.classList.toggle('active', b.dataset.value === mode));
  saveSettings();
  void applyDrone();
}

function nextStep(sr: SessionReport, rh: RhythmReport | null): NextStep | null {
  const r = sr.report;
  const on = sr.notes.onset;
  const slower = Math.max(40, Math.round(state.bpm * 0.85));

  if (rh && rh.onsets >= 6 && rh.onTimePct < 60 && state.bpm > 40) {
    return {
      text: t('next.rhythm', { bpm: slower }),
      label: t('next.rhythmBtn', { bpm: slower }),
      run: () => { setBpm(slower); setMetronome(true); void redo(); },
    };
  }
  if (on && on.notes >= 5 && on.inTunePct < 60) {
    return {
      text: t('next.onset', { bpm: slower }),
      label: t('next.slowerBtn', { bpm: slower }),
      run: () => { setBpm(slower); void redo(); },
    };
  }
  if (Math.abs(r.tendency) > state.centsToleranceGood) {
    const root = state.refMode === 'scale' ? tonicDroneMidi() : undefined;
    return {
      text: t(r.tendency > 0 ? 'next.tendHigh' : 'next.tendLow'),
      label: t('next.droneBtn'),
      run: () => { setDrone('fifth', root); void redo(); },
    };
  }
  const w = r.worst[0];
  const wm = w ? sr.midiOf.get(w.name) : undefined;
  if (w && wm != null) {
    // A low, comfortable octave of that note for the drone (G3..F#4).
    let m = wm;
    while (m - 12 >= PICKER_MIN_MIDI) m -= 12;
    return {
      text: t('next.note', { name: w.name }),
      label: t('next.noteBtn', { name: midiToNoteName(m) }),
      run: () => { setDrone('root', m); },
    };
  }
  if (r.score >= 85 && (!rh || rh.onTimePct >= 75) && state.bpm < 220) {
    const faster = Math.min(220, Math.round(state.bpm * 1.08));
    return {
      text: t('next.faster', { bpm: faster }),
      label: t('next.fasterBtn', { bpm: faster }),
      run: () => { setBpm(faster); void redo(); },
    };
  }
  return null;
}

// ── Tuner view ───────────────────────────────────────────────────────────────
// Big single-note tuner for tuning the open strings. Shows the nearest note,
// how many cents off, a needle, and which of G/D/A/E you're closest to.
function updateTuner(freq: number): void {
  if (!state.els) return;
  const { tunerNote, tunerCents, tunerNeedle, tunerStrings } = state.els;
  if (freq <= 0) {
    tunerNote.textContent = '—';
    tunerNote.classList.add('placeholder');
    tunerCents.textContent = t('tuner.play');
    tunerCents.className = 'tuner-cents';
    tunerNeedle.style.left = '50%';
    tunerNeedle.className = 'tuner-needle';
    tunerStrings.forEach(s => s.classList.remove('active'));
    return;
  }
  const midi = freqToMidi(freq);
  const nearest = Math.round(midi);
  const cents = Math.round((midi - nearest) * 100);
  tunerNote.textContent = midiToNoteName(nearest);
  tunerNote.classList.remove('placeholder');

  const absC = Math.abs(cents);
  const band = absC <= state.centsToleranceGood ? 'good'
    : absC <= state.centsToleranceMed ? 'med' : 'bad';
  const word = absC <= state.centsToleranceGood ? t('tuner.good')
    : cents < 0 ? t('tuner.low', { c: cents }) : t('tuner.high', { c: cents });
  tunerCents.textContent = word;
  tunerCents.className = `tuner-cents ${band}`;

  // Needle: map ±50¢ across the bar width.
  const pct = Math.max(0, Math.min(100, 50 + Math.max(-50, Math.min(50, cents))));
  tunerNeedle.style.left = `${pct}%`;
  tunerNeedle.className = `tuner-needle ${band}`;

  // Highlight nearest open string.
  let nearestStr = OPEN_STRINGS[0];
  for (const s of OPEN_STRINGS) if (Math.abs(midi - s) < Math.abs(midi - nearestStr)) nearestStr = s;
  tunerStrings.forEach(el => {
    el.classList.toggle('active', Number(el.dataset.midi) === nearestStr);
  });
}

// One top-level mode switcher: the three practice reference modes plus the
// tuner all live in the header tabs.
type TabMode = RefMode | 'tuner';

// Sync every mode-dependent piece of UI: active tab, visible view, and the
// contextual controls (调 + 音准标准 in scale mode, 曲目 in score mode, 音域
// hidden for scores where the range comes from the music).
function updateModeUi(): void {
  if (!state.els) return;
  const tab: TabMode = state.viewMode === 'tuner' ? 'tuner' : state.refMode;
  state.els.modeTabs.forEach(t => t.classList.toggle('active', t.dataset.mode === tab));
  state.els.practiceView.classList.toggle('hidden', state.viewMode !== 'practice');
  state.els.tunerView.classList.toggle('hidden', state.viewMode !== 'tuner');
  state.els.scaleControls.classList.toggle('hidden', state.refMode !== 'scale');
  state.els.scoreControls.classList.toggle('hidden', state.refMode !== 'score');
  if (state.refMode !== 'score') toggleScorePanel(false);   // don't reopen on return
  state.els.temperamentRow.classList.toggle('hidden', state.refMode !== 'scale');
  state.els.rangeRow.classList.toggle('hidden', state.refMode === 'score');
  state.els.scoreGroup.classList.toggle('hidden', state.refMode !== 'score');
  void refreshStaff();
}

// Entering the tuner starts the mic automatically so a beginner just sees a
// working tuner. The practice timeline is frozen while tuning (detectStep also
// skips histPush/metronome in tuner mode) so tuning noise neither pollutes the
// trail nor advances the clock.
function selectMode(tab: TabMode): void {
  if (!state.els) return;
  const spb = 60 / state.bpm;

  if (tab === 'tuner') {
    if (state.viewMode !== 'tuner') {
      if (state.running && state.ctx) {
        state.frozenElapsedBeats = currentBeat();
      }
      state.viewMode = 'tuner';
      if (!state.running && !state.ctx) {
        void start().then(() => {
          if (!state.running) {
            state.els!.tunerCents.textContent = t(state.micError ?? 'mic.failedShort');
            state.els!.tunerCents.className = 'tuner-cents bad';
          }
        });
      }
    }
  } else {
    if (state.viewMode === 'tuner' && state.running && state.ctx) {
      // Continue from where the practice clock was frozen (same math as
      // resume()). A fresh session started in the tuner has frozen=0 → begin at
      // beat 0 so the first metronome accent isn't skipped.
      state.startTime = clockNow() - state.frozenElapsedBeats * spb;
      const nextBeat = state.frozenElapsedBeats <= 0 ? 0 : Math.floor(state.frozenElapsedBeats) + 1;
      state.nextTickBeat = nextBeat;
      state.nextTickTime = Math.max(state.startTime + nextBeat * spb, clockNow() + 0.05);
    }
    state.viewMode = 'practice';
    if (state.refMode !== tab) {
      state.refMode = tab;
      refreshRefNotes();
      saveSettings();
      if (tab === 'score') clearData();   // start the score from the top
      drawOnce();
    }
  }

  updateModeUi();
  // Canvas sizes to whichever view is visible now; while practice was hidden
  // its wrap measured 0 and the canvas fell to the 320px floor.
  resizeCanvas();
}

// Cycle through the three button states: idle → running → paused → running …
// A ctx without an analyser means the last start() failed at mic acquisition
// (e.g. pressing the drone created the ctx) — retry the mic instead of
// "resuming" into a session that would record nothing.
function togglePlayPause(): void {
  if (state.running) pause();
  else if (state.ctx && state.analyser) resume();
  else start();
}

// Map a frequency to the nearest note name + cents offset, for the readout.
// All math is A4=442 via music.ts, so the cents here agree with the trace color.
function updatePitchReadout(freq: number): void {
  if (!state.els) return;
  if (freq <= 0) {
    state.els.pitchEl.textContent = '— Hz';
    return;
  }
  const midi = freqToMidi(freq);
  const midiRound = Math.round(midi);
  const cents = Math.round((midi - midiRound) * 100);
  const sign = cents > 0 ? '+' : '';
  state.els.pitchEl.textContent = `${freq.toFixed(1)} Hz · ${midiToNoteName(midiRound)} ${sign}${cents}¢`;
}

// Key + temperament for scale mode. Each option spells out its key signature
// ("D 大调 · F♯ C♯") so picking a key doesn't require knowing it by heart.
function renderKeyOptions(): void {
  if (!state.els) return;
  const keyOptions = (mode: Mode): string => COMMON_KEYS
    .map((k, i) => ({ k, i }))
    .filter(x => x.k.mode === mode)
    .map(({ k, i }) => `<option value="${i}">${keyLabel(k)} · ${keySignatureText(k.sharps)}</option>`)
    .join('');
  state.els.keySelect.innerHTML =
    `<optgroup label="${t('key.majorGroup')}">${keyOptions('major')}</optgroup>` +
    `<optgroup label="${t('key.minorGroup')}">${keyOptions('minor')}</optgroup>`;
  state.els.keySelect.value = String(state.keyIndex);
}

// Language switch: static markup is re-filled by applyI18n(); everything
// built in code is redrawn here. A status line in the old language would
// linger, so it's cleared.
function onLanguageChanged(): void {
  if (!state.els) return;
  renderKeyOptions();
  refreshSamples();
  refreshScoreUi();
  refreshTakes();
  updateStartBtn();
  void populateMicList();
  if (state.viewMode === 'tuner' && state.running) updateTuner(-1);
  if (!state.els.reportEl.classList.contains('hidden')) showReport();
  setStatus('');
  drawOnce();
}

// ── Public init ────────────────────────────────────────────────────────────
export function initRealtime(): void {
  loadSettings();   // hydrate state from localStorage before binding UI
  applyI18n();

  state.els = {
    canvas: document.getElementById('realtime-canvas') as HTMLCanvasElement,
    staffEl: document.getElementById('rt-staff') as HTMLElement,
    wrap: document.getElementById('rt-canvas-wrap') as HTMLElement,
    bpmInput: document.getElementById('rt-bpm') as HTMLInputElement,
    accentInput: document.getElementById('rt-accent') as HTMLInputElement,
    countInInput: document.getElementById('rt-countin') as HTMLInputElement,
    visibleBeatsInput: document.getElementById('rt-visible-beats') as HTMLInputElement,
    centsGoodInput: document.getElementById('rt-cents-good') as HTMLInputElement,
    centsMedInput: document.getElementById('rt-cents-med') as HTMLInputElement,
    soundSelect: document.getElementById('rt-sound') as HTMLSelectElement,
    rangeLoSelect: document.getElementById('rt-range-lo') as HTMLSelectElement,
    rangeHiSelect: document.getElementById('rt-range-hi') as HTMLSelectElement,
    scaleControls: document.getElementById('rt-scale-controls') as HTMLElement,
    keySelect: document.getElementById('rt-key') as HTMLSelectElement,
    temperamentToggles: document.querySelectorAll<HTMLButtonElement>('#rt-temperament-toggles .toggle'),
    temperamentRow: document.getElementById('rt-temperament-row') as HTMLElement,
    rangeRow: document.getElementById('rt-range-row') as HTMLElement,
    scoreControls: document.getElementById('rt-score-controls') as HTMLElement,
    dirInput: document.getElementById('rt-dir') as HTMLInputElement,
    fileInput: document.getElementById('rt-file') as HTMLInputElement,
    scoreBtn: document.getElementById('rt-score-btn') as HTMLButtonElement,
    scoreName: document.getElementById('rt-score-name') as HTMLElement,
    scorePanel: document.getElementById('rt-score-panel') as HTMLElement,
    scoreTree: document.getElementById('rt-score-tree') as HTMLElement,
    settingsBtn: document.getElementById('rt-settings-btn') as HTMLButtonElement,
    settingsPanel: document.getElementById('rt-settings-panel') as HTMLElement,
    metronomeToggles: document.querySelectorAll<HTMLButtonElement>('#rt-metronome-toggles .toggle'),
    recordToggles: document.querySelectorAll<HTMLButtonElement>('#rt-record-toggles .toggle'),
    judgeToggles: document.querySelectorAll<HTMLButtonElement>('#rt-judge-toggles .toggle'),
    waitToggles: document.querySelectorAll<HTMLButtonElement>('#rt-wait-toggles .toggle'),
    scoreGroup: document.getElementById('rt-score-group') as HTMLElement,
    unitToggles: document.querySelectorAll<HTMLButtonElement>('#rt-unit-toggles .toggle'),
    droneToggles: document.querySelectorAll<HTMLButtonElement>('#rt-drone-toggles .toggle'),
    droneRootSelect: document.getElementById('rt-drone-root') as HTMLSelectElement,
    micSelect: document.getElementById('rt-mic') as HTMLSelectElement,
    startBtn: document.getElementById('rt-start') as HTMLButtonElement,
    clearBtn: document.getElementById('rt-clear') as HTMLButtonElement,
    calibrateBtn: document.getElementById('rt-calibrate') as HTMLButtonElement,
    fullscreenBtn: document.getElementById('rt-fullscreen') as HTMLButtonElement,
    statusEl: document.getElementById('rt-status') as HTMLElement,
    pitchEl: document.getElementById('rt-pitch') as HTMLElement,
    reportEl: document.getElementById('rt-report') as HTMLElement,
    takesEl: document.getElementById('rt-takes') as HTMLElement,
    modeTabs: document.querySelectorAll<HTMLButtonElement>('#mode-tabs .mode-tab'),
    practiceView: document.getElementById('practice-view') as HTMLElement,
    tunerView: document.getElementById('tuner-view') as HTMLElement,
    tunerNote: document.getElementById('tuner-note') as HTMLElement,
    tunerCents: document.getElementById('tuner-cents') as HTMLElement,
    tunerNeedle: document.getElementById('tuner-needle') as HTMLElement,
    tunerStrings: document.querySelectorAll<HTMLElement>('#tuner-strings .tuner-string'),
    tunerStartBtn: document.getElementById('tuner-start') as HTMLButtonElement,
  };

  const rangeOptionsHtml: string[] = [];
  for (let m = PICKER_MIN_MIDI; m <= PICKER_MAX_MIDI; m++) {
    rangeOptionsHtml.push(`<option value="${m}">${midiToNoteName(m)}</option>`);
  }
  state.els.rangeLoSelect.innerHTML = rangeOptionsHtml.join('');
  state.els.rangeHiSelect.innerHTML = rangeOptionsHtml.join('');
  state.els.rangeLoSelect.value = String(state.loMidi);
  state.els.rangeHiSelect.value = String(state.hiMidi);
  refreshRefNotes();

  const onRangeChange = (): void => {
    let lo = Number(state.els!.rangeLoSelect.value);
    let hi = Number(state.els!.rangeHiSelect.value);
    if (lo > hi) [lo, hi] = [hi, lo];   // swap if user inverted them
    state.loMidi = lo;
    state.hiMidi = hi;
    state.els!.rangeLoSelect.value = String(lo);
    state.els!.rangeHiSelect.value = String(hi);
    refreshRefNotes();
    saveSettings();
    drawOnce();
  };
  state.els.rangeLoSelect.addEventListener('change', onRangeChange);
  state.els.rangeHiSelect.addEventListener('change', onRangeChange);

  renderKeyOptions();

  const langSelect = document.getElementById('rt-lang') as HTMLSelectElement;
  langSelect.innerHTML = LANGS.map(l => `<option value="${l.code}">${l.label}</option>`).join('');
  langSelect.value = getLang();
  langSelect.addEventListener('change', () => setLang(langSelect.value as Lang));
  onLangChange(onLanguageChanged);

  refreshScoreUi();    // empty-state placeholder until IndexedDB answers
  void initLibrary();
  updateModeUi();   // reflect the persisted refMode in tabs + contextual controls

  // ⚙ settings popover: toggle on the gear, dismiss on outside click / Esc.
  state.els.settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleScorePanel(false);   // never two popovers at once
    state.els!.settingsPanel.classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    const panel = state.els!.settingsPanel;
    if (!panel.classList.contains('hidden')) {
      const t = e.target as Node;
      if (!panel.contains(t) && t !== state.els!.settingsBtn) panel.classList.add('hidden');
    }
    toggleScorePanel(false);   // its own clicks stop propagating before this
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    state.els!.settingsPanel.classList.add('hidden');
    toggleScorePanel(false);
  });

  // Folder pick and multi-file pick feed the same importer — Android Chrome
  // only got folder support very recently (and silently does nothing on older
  // builds), so the file picker has to stay as the fallback. Clearing .value
  // lets the same folder be re-picked to pull in newly added scores.
  const onPicked = (input: HTMLInputElement) => () => {
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length) void importScoreFiles(files);
  };
  state.els.dirInput.addEventListener('change', onPicked(state.els.dirInput));
  // With showDirectoryPicker the folder is indexed instead of read in full;
  // the webkitdirectory input stays as the fallback (Safari, Firefox).
  if ((window as DirPickerWindow).showDirectoryPicker) {
    state.els.dirInput.closest('label')?.addEventListener('click', (e) => {
      e.preventDefault();
      void pickScoreFolder();
    });
  }
  state.els.fileInput.addEventListener('change', onPicked(state.els.fileInput));

  state.els.scoreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    state.els!.settingsPanel.classList.add('hidden');
    toggleScorePanel();
  });
  // Keep clicks inside the panel (import labels, tree rows) from dismissing it.
  state.els.scorePanel.addEventListener('click', e => e.stopPropagation());

  // One delegated handler for the whole tree: remove ✕, fold a folder, or pick.
  state.els.scoreTree.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const del = target.closest<HTMLElement>('.tree-del');
    if (del?.dataset.del) { void removeScore(del.dataset.del); return; }

    const row = target.closest<HTMLElement>('.tree-row');
    if (!row) return;
    if (row.dataset.dir != null) {
      const path = row.dataset.dir;
      if (state.collapsedDirs.has(path)) state.collapsedDirs.delete(path);
      else state.collapsedDirs.add(path);
      refreshScoreUi();
    } else if (row.dataset.id) {
      void openScore(row.dataset.id);
      toggleScorePanel(false);
    }
  });

  state.els.keySelect.addEventListener('change', () => {
    state.keyIndex = Number(state.els!.keySelect.value) || 0;
    // Follow the tonic with the drone so "跟音阶" + "参考音" line up automatically.
    state.droneRootMidi = tonicDroneMidi();
    state.els!.droneRootSelect.value = String(state.droneRootMidi);
    refreshRefNotes();
    saveSettings();
    if (state.droneMode !== 'off') void applyDrone();
    drawOnce();
  });

  state.els.temperamentToggles.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === state.temperament);
    btn.addEventListener('click', () => {
      state.temperament = btn.dataset.value as Temperament;
      state.els!.temperamentToggles.forEach(b => b.classList.toggle('active', b === btn));
      refreshRefNotes();
      saveSettings();
      if (state.droneMode !== 'off') void applyDrone();
      drawOnce();
    });
  });

  state.els.bpmInput.value = String(state.bpm);
  state.els.bpmInput.addEventListener('change', () => {
    const v = Math.max(40, Math.min(220, Number(state.els!.bpmInput.value) || 80));
    state.bpm = v;
    state.els!.bpmInput.value = String(v);
    saveSettings();
    if (!state.running) drawOnce();
  });

  state.els.accentInput.value = String(state.accentEvery);
  state.els.accentInput.addEventListener('change', () => {
    const v = Math.max(1, Math.min(12, Math.floor(Number(state.els!.accentInput.value)) || 4));
    state.accentEvery = v;
    state.els!.accentInput.value = String(v);
    saveSettings();
    drawOnce();
  });

  state.els.countInInput.value = String(state.countInBeats);
  state.els.countInInput.addEventListener('change', () => {
    const v = Math.max(0, Math.min(8, Math.floor(Number(state.els!.countInInput.value)) || 0));
    state.countInBeats = v;
    state.els!.countInInput.value = String(v);
    saveSettings();
  });

  state.els.visibleBeatsInput.value = String(state.visibleBeats);
  state.els.visibleBeatsInput.addEventListener('change', () => {
    const raw = Math.floor(Number(state.els!.visibleBeatsInput.value)) || DEFAULT_VISIBLE_BEATS;
    const v = Math.max(MIN_VISIBLE_BEATS, Math.min(MAX_VISIBLE_BEATS, raw));
    state.visibleBeats = v;
    state.els!.visibleBeatsInput.value = String(v);
    saveSettings();
    drawOnce();
  });

  const clampCents = (n: number): number =>
    Math.max(MIN_CENTS_TOLERANCE, Math.min(MAX_CENTS_TOLERANCE, n));

  state.els.centsGoodInput.value = String(state.centsToleranceGood);
  state.els.centsMedInput.value = String(state.centsToleranceMed);
  const onCentsChange = (): void => {
    const els = state.els!;
    let good = clampCents(Math.floor(Number(els.centsGoodInput.value)) || DEFAULT_CENTS_TOLERANCE_GOOD);
    let med  = clampCents(Math.floor(Number(els.centsMedInput.value))  || DEFAULT_CENTS_TOLERANCE_MED);
    if (med < good) med = good;        // keep yellow band ≥ green band
    state.centsToleranceGood = good;
    state.centsToleranceMed = med;
    els.centsGoodInput.value = String(good);
    els.centsMedInput.value = String(med);
    saveSettings();
    drawOnce();
  };
  state.els.centsGoodInput.addEventListener('change', onCentsChange);
  state.els.centsMedInput.addEventListener('change', onCentsChange);

  state.els.soundSelect.value = state.soundKind;
  state.els.soundSelect.addEventListener('change', () => {
    state.soundKind = state.els!.soundSelect.value as SoundKind;
    saveSettings();
  });

  state.els.metronomeToggles.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === (state.metronomeOn ? 'on' : 'off'));
    btn.addEventListener('click', () => {
      state.metronomeOn = btn.dataset.value === 'on';
      state.els!.metronomeToggles.forEach(b => b.classList.toggle('active', b === btn));
      saveSettings();
    });
  });

  state.els.waitToggles.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === (state.waitMode ? 'on' : 'off'));
    btn.addEventListener('click', () => {
      state.waitMode = btn.dataset.value === 'on';
      state.els!.waitToggles.forEach(b => b.classList.toggle('active', b === btn));
      // Switching mid-run: wait for the next note ahead, not one already passed.
      syncWait(state.running ? Math.max(state.runStartBeat, rawBeat()) : state.frozenElapsedBeats);
      saveSettings();
      drawOnce();
    });
  });

  state.els.judgeToggles.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === (state.pitchJudge ? 'on' : 'off'));
    btn.addEventListener('click', () => {
      state.pitchJudge = btn.dataset.value === 'on';
      state.els!.judgeToggles.forEach(b => b.classList.toggle('active', b === btn));
      saveSettings();
      drawOnce();
    });
  });

  state.els.unitToggles.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === state.timeUnit);
    btn.addEventListener('click', () => {
      state.timeUnit = btn.dataset.value as TimeUnit;
      state.els!.unitToggles.forEach(b => b.classList.toggle('active', b === btn));
      saveSettings();
      drawOnce();
    });
  });

  // Drone (reference tone). Root note picker spans the violin range.
  const droneOptsHtml: string[] = [];
  for (let m = PICKER_MIN_MIDI; m <= PICKER_MAX_MIDI; m++) {
    droneOptsHtml.push(`<option value="${m}">${midiToNoteName(m)}</option>`);
  }
  state.els.droneRootSelect.innerHTML = droneOptsHtml.join('');
  state.els.droneRootSelect.value = String(state.droneRootMidi);
  state.els.droneRootSelect.addEventListener('change', () => {
    state.droneRootMidi = Number(state.els!.droneRootSelect.value) || state.droneRootMidi;
    saveSettings();
    if (state.droneMode !== 'off') void applyDrone();
  });

  state.els.droneToggles.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === state.droneMode);
    btn.addEventListener('click', () => {
      state.droneMode = btn.dataset.value as DroneMode;
      state.els!.droneToggles.forEach(b => b.classList.toggle('active', b === btn));
      saveSettings();
      void applyDrone();
    });
  });

  // Microphone input device picker.
  void populateMicList();
  state.els.micSelect.addEventListener('change', () => {
    void switchMic(state.els!.micSelect.value);
  });
  // Tiny "?" beside the picker toggles the mic-setup help panel.
  document.getElementById('rt-mic-help-btn')?.addEventListener('click', () => {
    document.getElementById('rt-mic-help')?.classList.toggle('hidden');
  });
  if (navigator.mediaDevices) {
    navigator.mediaDevices.addEventListener?.('devicechange', () => { void populateMicList(); });
  }

  state.els.startBtn.addEventListener('click', togglePlayPause);
  state.els.clearBtn.addEventListener('click', () => { void redo(); });
  state.els.recordToggles.forEach(btn => {
    btn.addEventListener('click', () => {
      const on = btn.dataset.value === 'on';
      if (on !== state.recordArmed) setRecordArmed(on);
    });
  });

  // The report's "next step" button.
  state.els.reportEl.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-next]')) state.nextAction?.();
  });

  // Takes list: download / delete one, or clear them all.
  state.els.takesEl.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-clear-takes]')) { clearTakes(); return; }
    const dl = t.closest<HTMLElement>('[data-dl]')?.dataset.dl;
    if (dl) {
      const take = state.takes.find(x => x.id === dl);
      if (take) downloadBlob(take.blob, takeFilename(take));
      return;
    }
    const del = t.closest<HTMLElement>('[data-del]')?.dataset.del;
    if (del) dropTake(del);
  });
  state.els.calibrateBtn.addEventListener('click', () => { void calibrateLatency(); });
  state.els.tunerStartBtn.addEventListener('click', togglePlayPause);

  state.els.modeTabs.forEach(tab => {
    tab.addEventListener('click', () => selectMode(tab.dataset.mode as TabMode));
  });

  state.els.fullscreenBtn.addEventListener('click', toggleFullscreen);

  setupPan(state.els.canvas);

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  document.addEventListener('fullscreenchange', resizeCanvas);
  document.addEventListener('webkitfullscreenchange' as keyof DocumentEventMap, resizeCanvas);

  // Fullscreen-only shortcuts: Space toggles play/pause (preserving the
  // trail), K clears the trail. Scoped to fullscreen so they don't hijack
  // typing in BPM/accent inputs elsewhere on the page.
  document.addEventListener('keydown', (e) => {
    if (fullscreenElement() !== state.els?.wrap) return;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlayPause();
    } else if (e.code === 'KeyK') {
      e.preventDefault();
      clearData();
    }
  });

  updatePitchReadout(-1);
  drawOnce();

  // Dev-only handle on the live state. Almost everything here lives in a
  // canvas, so without this there's no way to inspect the clock, the take
  // list or the loaded track from the console. Stripped from prod builds.
  if (import.meta.env.DEV) {
    (window as unknown as { __pavlov?: typeof state }).__pavlov = state;
  }
}

// ── Pan interaction (only active when stopped) ─────────────────────────────
function setupPan(canvas: HTMLCanvasElement): void {
  canvas.style.touchAction = 'none';   // prevent page scroll on touch drag
  let dragStartX = 0;
  let dragStartOffset = 0;
  let dragging = false;

  const updateCursor = () => {
    canvas.style.cursor = state.running
      ? 'default'
      : (dragging ? 'grabbing' : 'grab');
  };
  updateCursor();

  canvas.addEventListener('pointerdown', (e) => {
    if (state.running) return;
    if (state.frozenElapsedBeats <= 0) return;  // nothing recorded yet
    canvas.setPointerCapture(e.pointerId);
    dragStartX = e.clientX;
    dragStartOffset = state.viewOffsetBeats;
    dragging = true;
    updateCursor();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const px = state.lastPxPerBeat;
    if (px <= 0) return;
    // Drag right = see earlier content → decrease elapsedBeats → decrease offset.
    const dBeats = (e.clientX - dragStartX) / px;
    let next = dragStartOffset - dBeats;
    if (next < -state.frozenElapsedBeats) next = -state.frozenElapsedBeats;
    if (next > 0) next = 0;
    state.viewOffsetBeats = next;
    drawOnce();
  });

  const endDrag = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* */ }
    updateCursor();
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // Expose the cursor refresher so start()/stop() can flip it.
  state.refreshPanCursor = updateCursor;
}

// ── Export & recording ───────────────────────────────────────────────────────
function pad2(n: number): string { return String(n).padStart(2, '0'); }

function timestamp(d: Date = new Date()): string {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`
    + `-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pickRecMime(): string {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  for (const t of types) if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
  return '';
}

// The switch shows the *armed* state, not whether capture is running right
// now: it stays on 开 across pauses, so resuming keeps recording.
function updateRecordBtn(): void {
  const want = state.recordArmed ? 'on' : 'off';
  state.els?.recordToggles.forEach(b => b.classList.toggle('active', b.dataset.value === want));
}

// The 录音 switch is armed state, not a start button: turning it on while the
// session is stopped just means "record the next run". Actual capture begins
// when the mic is live — here if it already is, otherwise from start().
function setRecordArmed(on: boolean): void {
  state.recordArmed = on;
  updateRecordBtn();
  if (on) {
    if (state.running) beginRecording();
    else setStatus(t('rec.armed'));
  } else if (state.recording) {
    state.recorder?.stop();               // onstop files the take
  } else {
    setStatus('');
  }
}

// Record the raw microphone (just the playing, not metronome/drone).
function beginRecording(): void {
  if (state.recording) return;
  if (!state.micStream) { setStatus(t('rec.micNotReady')); return; }

  const mime = pickRecMime();
  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(state.micStream, mime ? { mimeType: mime } : undefined);
  } catch {
    setStatus(t('rec.unsupported'));
    state.recordArmed = false;            // disarm: it will never work here
    updateRecordBtn();
    return;
  }
  state.recorder = rec;
  state.recChunks = [];
  rec.ondataavailable = e => { if (e.data.size > 0) state.recChunks.push(e.data); };
  rec.onstop = () => {
    state.recording = false;              // armed state is left alone
    recTick();
    const chunks = state.recChunks;
    state.recChunks = [];
    if (chunks.length) {
      const type = rec.mimeType || 'audio/webm';
      const blob = new Blob(chunks, { type });
      const take: Take = {
        id: `take-${Date.now()}`,
        url: URL.createObjectURL(blob),
        blob,
        ext: type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm',
        at: new Date(),
        seconds: Math.max(0, state.recElapsed),
      };
      state.takes.unshift(take);       // newest on top
      refreshTakes();
      setStatus(t('rec.saved', { dur: fmtDuration(take.seconds) }));
    }
    // 重来 ends a run, not the recording session: if the switch is still on
    // and the mic is live, roll straight into the next take.
    if (state.recordArmed && state.running && state.micStream) beginRecording();
  };
  rec.start();
  state.recElapsed = 0;
  state.recStartedAt = performance.now();
  state.recording = true;
  setStatus(t('rec.recording'));
}

// Fold the running segment into the total and stop the clock. Paused time
// must not count, so this runs on every pause and before filing the take.
function recTick(): void {
  if (state.recStartedAt > 0) {
    state.recElapsed += (performance.now() - state.recStartedAt) / 1000;
    state.recStartedAt = 0;
  }
}

// Pausing practice pauses the take rather than ending it — one run through a
// piece stays one file even if you stop to rewind.
function pauseRecording(): void {
  if (!state.recording || state.recorder?.state !== 'recording') return;
  try { state.recorder.pause(); recTick(); } catch { /* */ }
}

function resumeRecording(): void {
  if (!state.recordArmed) return;
  if (state.recording && state.recorder?.state === 'paused') {
    try { state.recorder.resume(); state.recStartedAt = performance.now(); } catch { /* */ }
  } else if (!state.recording) {
    beginRecording();                   // armed before the mic was live
  }
}

// ── Recorded takes list ──────────────────────────────────────────────────────
function fmtDuration(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function takeFilename(take: Take): string {
  return `pavlov-cat-${timestamp(take.at)}.${take.ext}`;
}

function refreshTakes(): void {
  const el = state.els?.takesEl;
  if (!el) return;
  el.classList.toggle('hidden', !state.takes.length);
  if (!state.takes.length) { el.innerHTML = ''; return; }

  el.innerHTML =
    `<div class="takes-head"><span class="sp-title">${t('rec.title')}</span>` +
    `<button class="rt-mini-btn" type="button" data-clear-takes>${t('rec.clear')}</button></div>` +
    state.takes.map(take => {
      // Duration is already in the player's own readout — show only the clock.
      const time = `${pad2(take.at.getHours())}:${pad2(take.at.getMinutes())}`;
      return `<div class="take" data-take="${take.id}">` +
        `<audio class="take-audio" controls preload="metadata" src="${take.url}"></audio>` +
        `<span class="take-meta">${time}</span>` +
        `<button class="take-btn" type="button" data-dl="${take.id}" title="${t('rec.download')}" aria-label="${t('rec.downloadAria')}">⬇</button>` +
        `<button class="take-btn" type="button" data-del="${take.id}" title="${t('rec.delete')}" aria-label="${t('rec.deleteAria')}">✕</button>` +
      `</div>`;
    }).join('');
}

function dropTake(id: string): void {
  const i = state.takes.findIndex(t => t.id === id);
  if (i < 0) return;
  URL.revokeObjectURL(state.takes[i].url);
  state.takes.splice(i, 1);
  refreshTakes();
}

function clearTakes(): void {
  for (const t of state.takes) URL.revokeObjectURL(t.url);
  state.takes = [];
  refreshTakes();
}

// Measure mic latency by clicking through the speakers and finding when each
// click arrives back in the mic. Best-effort: needs the click audible to the
// mic. Fails gracefully with guidance if nothing is heard (e.g. headphones).
async function calibrateLatency(): Promise<void> {
  if (state.calibrating) return;
  await ensureCtx();
  if (!state.running) await start();
  const ctx = state.ctx, analyser = state.analyser, buffer = state.buffer;
  if (!ctx || !analyser || !buffer) { setStatus(t('cal.micNotReady')); return; }

  state.calibrating = true;
  setStatus(t('cal.running'));

  const clicks = 8, gap = 0.7;
  const t0 = ctx.currentTime + 0.5;
  const clickTimes: number[] = [];
  for (let i = 0; i < clicks; i++) { const t = t0 + i * gap; playClick(ctx, t); clickTimes.push(t); }

  const samples: { t: number; rms: number }[] = [];
  const iv = setInterval(() => {
    analyser.getFloatTimeDomainData(buffer);
    let s = 0; for (let i = 0; i < buffer.length; i++) s += buffer[i] * buffer[i];
    samples.push({ t: ctx.currentTime, rms: Math.sqrt(s / buffer.length) });
  }, 6);

  await new Promise(r => setTimeout(r, (clicks * gap + 0.6) * 1000));
  clearInterval(iv);
  state.calibrating = false;

  const delays: number[] = [];
  for (const ct of clickTimes.slice(1)) {   // skip first (warm-up)
    let best = -1, bestT = 0;
    for (const s of samples) if (s.t >= ct && s.t <= ct + 0.4 && s.rms > best) { best = s.rms; bestT = s.t; }
    if (best > 0.02) delays.push(bestT - ct);
  }
  if (delays.length < 3) {
    setStatus(t('cal.noClick'));
    return;
  }
  delays.sort((a, b) => a - b);
  state.micLatency = Math.max(0, Math.min(0.4, delays[Math.floor(delays.length / 2)]));
  saveSettings();
  setStatus(t('cal.done', { ms: Math.round(state.micLatency * 1000) }));
}

// Fullscreen with webkit fallbacks (older macOS Safari exposes only the
// prefixed API; some Android WebViews expose neither).
type WebkitDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type WebkitEl = HTMLElement & { webkitRequestFullscreen?: () => void };

function fullscreenElement(): Element | null {
  return document.fullscreenElement ?? (document as WebkitDoc).webkitFullscreenElement ?? null;
}

function toggleFullscreen(): void {
  if (!state.els) return;
  const doc = document as WebkitDoc;
  const wrap = state.els.wrap as WebkitEl;
  if (fullscreenElement()) {
    if (document.exitFullscreen) document.exitFullscreen().catch(() => { /* ignore */ });
    else doc.webkitExitFullscreen?.();
  } else if (wrap.requestFullscreen) {
    wrap.requestFullscreen().catch(() => setStatus(t('status.noFullscreen')));
  } else if (wrap.webkitRequestFullscreen) {
    wrap.webkitRequestFullscreen();
  } else {
    setStatus(t('status.noFullscreen'));
  }
}

function resizeCanvas(): void {
  if (!state.els) return;
  const c = state.els.canvas;
  // The canvas box, not the stage: in score mode the staff takes the top.
  const w = c.clientWidth;
  const h = c.clientHeight;
  if (w <= 0 || h <= 0) return;   // hidden (tuner tab) — keep the last size
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  drawOnce();
}

// Called by main.ts when switching away from this tab. Fully release mic +
// AudioContext (a paused session would otherwise keep the mic indicator on).
export function realtimeOnLeave(): void {
  if (state.running || state.ctx) teardown();
}

// Called by main.ts when switching to this tab
export function realtimeOnEnter(): void {
  resizeCanvas();
}
