import { detectPitch } from './pitch';
import {
  A4_HZ, freqToMidi, midiToFreq, midiToNoteName,
  COMMON_KEYS, isInScale, targetFreq, type Key, type Temperament,
  type TargetNote, type TargetTrack,
} from './music';
import { Drone, type DroneMode } from './drone';
import { analyze, type CentsEntry, type Report } from './report';
import { parseMusicXml } from './musicxml';

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

type RefMode = 'chromatic' | 'scale' | 'score';

// One bar of metronome runway before the first score note reaches the playhead.
const SCORE_LEADIN_BEATS = 4;

function currentKey(): Key {
  const k = COMMON_KEYS[state.keyIndex] ?? COMMON_KEYS[0];
  return { tonicPc: k.tonicPc, mode: k.mode, temperament: state.temperament, a4: A4_HZ };
}

// Reference lanes for the current range and mode. In chromatic mode every
// semitone is a target. In scale mode only the key's scale tones are targets
// (drawn bright + labelled and judged against, with the chosen temperament);
// the rest become faint guide lines.
function buildRefNotes(): RefNote[] {
  let lo = Math.min(state.loMidi, state.hiMidi);
  let hi = Math.max(state.loMidi, state.hiMidi);
  const out: RefNote[] = [];
  if (state.refMode === 'chromatic') {
    for (let m = lo; m <= hi; m++) {
      out.push({ midi: m, name: midiToNoteName(m), frequency: midiToFreq(m), target: true });
    }
  } else {
    const key = currentKey();
    for (let m = lo; m <= hi; m++) {
      const t = isInScale(m, key);
      out.push({ midi: m, name: midiToNoteName(m), frequency: t ? targetFreq(m, key) : midiToFreq(m), target: t });
    }
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
  const track = state.track;
  if (!track) return null;
  const b = beat - SCORE_LEADIN_BEATS;
  if (b < 0) return null;
  for (const n of track.notes) {
    if (b >= n.startBeat && b < n.startBeat + n.durBeat) return n;
  }
  return null;
}

const scoreModeActive = (): boolean => state.refMode === 'score' && state.track != null;

// ── Palette ─────────────────────────────────────────────────────────────────
const PALETTE = {
  bgTop:        '#1d2128',
  bgBottom:     '#14161b',
  refLine:      '#2c333d',
  refLineFaint: '#20262e',  // non-scale guide lines in scale mode
  refLabel:     '#7eb4cf',  // soft cool blue
  refLabelTgt:  '#8ad0a0',  // scale target labels — soft green
  gridAccent:   '#3e2f1a',  // warm dark amber
  gridRegular:  '#22272d',  // cool dark gray
  labelAccent:  '#d4a96a',  // warm gold
  labelRegular: '#7a8590',
  traceGood:    '#5dc97a',  // ≤6 cents — trained-ear threshold
  traceMed:     '#e6b450',  // ≤20 cents — average listener notices "a bit off"
  traceBad:     '#ff7a5c',  // >20 cents
  traceNoRef:   '#ff9a3c',  // when no reference notes are selected
  playhead:     '#5dd4d4',  // cyan-teal
  scoreBlock:   'rgba(126, 180, 207, 0.22)',  // upcoming score note
  scoreBlockNow:'rgba(93, 212, 212, 0.34)',   // note currently under the playhead
  scoreBlockEdge: 'rgba(126, 180, 207, 0.7)',
  scoreLabel:   '#cfe4ef',
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
  startTime: 0,                         // ctx.currentTime when started
  frozenElapsedBeats: 0,                // last elapsedBeats when stopped (for static display)
  bpm: 80,
  timeUnit: 'beat' as TimeUnit,
  accentEvery: 4,
  metronomeOn: false,
  pitchJudge: true,                     // when off, all dots use neutral color
  visibleBeats: DEFAULT_VISIBLE_BEATS,
  centsToleranceGood: DEFAULT_CENTS_TOLERANCE_GOOD,
  centsToleranceMed: DEFAULT_CENTS_TOLERANCE_MED,
  soundKind: 'tom' as SoundKind,
  noiseBuffer: null as AudioBuffer | null,    // shared white-noise source for hihat

  // Reference mode: chromatic lanes vs a chosen scale/key vs an imported score
  refMode: 'chromatic' as RefMode,
  keyIndex: 0,                          // index into COMMON_KEYS
  temperament: 'equal' as Temperament,
  track: null as TargetTrack | null,    // loaded MusicXML score

  // Reference drone (sustained tone to tune against)
  drone: null as Drone | null,
  droneMode: 'off' as DroneMode,
  droneRootMidi: 57,                    // A3
  droneVol: 0.18,

  // Microphone input device (Mac mini has no built-in mic → pick iPhone etc.)
  micDeviceId: null as string | null,

  // Audio recording (download a take to keep / send to a teacher)
  recorder: null as MediaRecorder | null,
  recChunks: [] as Blob[],
  recording: false,

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
    wrap: HTMLElement;
    bpmInput: HTMLInputElement;
    accentInput: HTMLInputElement;
    visibleBeatsInput: HTMLInputElement;
    centsGoodInput: HTMLInputElement;
    centsMedInput: HTMLInputElement;
    soundSelect: HTMLSelectElement;
    rangeLoSelect: HTMLSelectElement;
    rangeHiSelect: HTMLSelectElement;
    refModeToggles: NodeListOf<HTMLButtonElement>;
    scaleControls: HTMLElement;
    keySelect: HTMLSelectElement;
    temperamentToggles: NodeListOf<HTMLButtonElement>;
    scoreControls: HTMLElement;
    fileInput: HTMLInputElement;
    scoreTitle: HTMLElement;
    metronomeToggles: NodeListOf<HTMLButtonElement>;
    judgeToggles: NodeListOf<HTMLButtonElement>;
    unitToggles: NodeListOf<HTMLButtonElement>;
    droneToggles: NodeListOf<HTMLButtonElement>;
    droneRootSelect: HTMLSelectElement;
    micSelect: HTMLSelectElement;
    startBtn: HTMLButtonElement;
    clearBtn: HTMLButtonElement;
    exportBtn: HTMLButtonElement;
    recordBtn: HTMLButtonElement;
    fullscreenBtn: HTMLButtonElement;
    statusEl: HTMLElement;
    pitchEl: HTMLElement;
    reportEl: HTMLElement;
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
  if ('visibleBeats' in data) state.visibleBeats = clampInt(data.visibleBeats, MIN_VISIBLE_BEATS, MAX_VISIBLE_BEATS, state.visibleBeats);
  if ('centsToleranceGood' in data) state.centsToleranceGood = clampInt(data.centsToleranceGood, MIN_CENTS_TOLERANCE, MAX_CENTS_TOLERANCE, state.centsToleranceGood);
  if ('centsToleranceMed' in data) state.centsToleranceMed = clampInt(data.centsToleranceMed, MIN_CENTS_TOLERANCE, MAX_CENTS_TOLERANCE, state.centsToleranceMed);
  if (state.centsToleranceMed < state.centsToleranceGood) state.centsToleranceMed = state.centsToleranceGood;
  if (typeof data.soundKind === 'string' && SOUND_KINDS.includes(data.soundKind as SoundKind)) state.soundKind = data.soundKind as SoundKind;
  if (typeof data.timeUnit === 'string' && TIME_UNITS.includes(data.timeUnit as TimeUnit)) state.timeUnit = data.timeUnit as TimeUnit;
  if (typeof data.metronomeOn === 'boolean') state.metronomeOn = data.metronomeOn;
  if (typeof data.pitchJudge === 'boolean') state.pitchJudge = data.pitchJudge;
  if ('loMidi' in data) state.loMidi = clampInt(data.loMidi, PICKER_MIN_MIDI, PICKER_MAX_MIDI, state.loMidi);
  if ('hiMidi' in data) state.hiMidi = clampInt(data.hiMidi, PICKER_MIN_MIDI, PICKER_MAX_MIDI, state.hiMidi);
  if (state.loMidi > state.hiMidi) [state.loMidi, state.hiMidi] = [state.hiMidi, state.loMidi];
  if (typeof data.droneMode === 'string' && DRONE_MODES.includes(data.droneMode as DroneMode)) state.droneMode = data.droneMode as DroneMode;
  if ('droneRootMidi' in data) state.droneRootMidi = clampInt(data.droneRootMidi, PICKER_MIN_MIDI, PICKER_MAX_MIDI, state.droneRootMidi);
  if (typeof data.micDeviceId === 'string') state.micDeviceId = data.micDeviceId;
  if (data.refMode === 'chromatic' || data.refMode === 'scale') state.refMode = data.refMode;
  if ('keyIndex' in data) state.keyIndex = clampInt(data.keyIndex, 0, COMMON_KEYS.length - 1, 0);
  if (data.temperament === 'equal' || data.temperament === 'just') state.temperament = data.temperament;
}

function saveSettings(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      bpm: state.bpm,
      accentEvery: state.accentEvery,
      visibleBeats: state.visibleBeats,
      centsToleranceGood: state.centsToleranceGood,
      centsToleranceMed: state.centsToleranceMed,
      soundKind: state.soundKind,
      timeUnit: state.timeUnit,
      metronomeOn: state.metronomeOn,
      pitchJudge: state.pitchJudge,
      loMidi: state.loMidi,
      hiMidi: state.hiMidi,
      droneMode: state.droneMode,
      droneRootMidi: state.droneRootMidi,
      micDeviceId: state.micDeviceId,
      refMode: state.refMode,
      keyIndex: state.keyIndex,
      temperament: state.temperament,
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

// ── Metronome ──────────────────────────────────────────────────────────────
function scheduleMetronome(): void {
  if (!state.ctx) return;
  const ctx = state.ctx;
  const secsPerBeat = 60 / state.bpm;
  while (state.nextTickTime < ctx.currentTime + LOOKAHEAD_S) {
    if (state.metronomeOn) {
      const isAccent = state.nextTickBeat % state.accentEvery === 0;
      if (isAccent) playSnare(ctx, state.nextTickTime);
      else playSound(ctx, state.nextTickTime, state.soundKind);
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
// processing is disabled so the raw pitch reaches the detector.
function openMicStream(): Promise<MediaStream> {
  const id = state.micDeviceId;
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: id ? { exact: id } : undefined,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
}

async function start(): Promise<void> {
  if (state.running) return;

  await ensureCtx();

  try {
    state.micStream = await openMicStream();
  } catch {
    setStatus('无法访问麦克风,请检查权限或换一个输入设备');
    return;
  }

  const ctx = state.ctx!;
  state.micSource = ctx.createMediaStreamSource(state.micStream);
  state.analyser = ctx.createAnalyser();
  state.analyser.fftSize = FFT_SIZE;
  state.buffer = new Float32Array(state.analyser.fftSize);
  state.micSource.connect(state.analyser);
  // NOTE: do NOT connect analyser → destination (would echo mic into speakers)

  histClear();

  state.startTime = ctx.currentTime + 0.1;
  state.nextTickBeat = 0;
  state.nextTickTime = state.startTime;
  state.viewOffsetBeats = 0;
  state.running = true;

  state.detectId = setInterval(detectStep, DETECT_INTERVAL_MS);
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

// ── Score import (MusicXML) ──────────────────────────────────────────────────
const SCORE_KEY = 'pavlov-cat:score:v1';

function setScoreTitle(): void {
  if (!state.els) return;
  state.els.scoreTitle.textContent = state.track
    ? `${state.track.title} · ${state.track.notes.length} 音`
    : '未导入';
}

async function loadScoreFile(file: File): Promise<void> {
  if (/\.mxl$/i.test(file.name)) {
    setStatus('暂不支持 .mxl 压缩谱,请在打谱软件里导出「未压缩的 MusicXML(.musicxml)」');
    return;
  }
  let track;
  try {
    const text = await file.text();
    track = parseMusicXml(text, file.name.replace(/\.[^.]+$/, ''));
  } catch (e) {
    setStatus(e instanceof Error ? e.message : '乐谱导入失败');
    return;
  }
  state.track = track;
  setScoreTitle();
  if (track.bpm) {
    state.bpm = Math.max(40, Math.min(220, Math.round(track.bpm)));
    state.els!.bpmInput.value = String(state.bpm);
  }
  try { localStorage.setItem(SCORE_KEY, JSON.stringify(track)); } catch { /* */ }
  saveSettings();
  clearData();               // play from the top
  setStatus(`已导入:${track.title}`);
  drawOnce();
}

function loadSavedScore(): void {
  let raw: string | null = null;
  try { raw = localStorage.getItem(SCORE_KEY); } catch { return; }
  if (!raw) return;
  try {
    const t = JSON.parse(raw) as TargetTrack;
    if (t && Array.isArray(t.notes) && t.notes.length) state.track = t;
  } catch { /* */ }
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
      setStatus('已自动选择 iPhone 麦克风');
    }
  }

  sel.innerHTML = '';
  const def = document.createElement('option');
  def.value = '';
  def.textContent = '系统默认输入';
  sel.appendChild(def);
  for (const d of inputs) {
    const o = document.createElement('option');
    o.value = d.deviceId;
    o.textContent = d.label || '麦克风';
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
    setStatus('无法切换到该输入设备');
    return;
  }
  state.micSource = state.ctx.createMediaStreamSource(state.micStream);
  state.micSource.connect(state.analyser);
  setStatus('');
}

// Pause: keep mic + ctx + pitch history so resume() can continue from here.
// Suspending the AudioContext freezes its currentTime, so on resume the
// startTime math doesn't need to compensate for paused wall-clock.
async function pause(): Promise<void> {
  if (!state.running || !state.ctx) return;
  state.frozenElapsedBeats = (state.ctx.currentTime - state.startTime) / (60 / state.bpm);
  state.running = false;

  if (state.detectId) { clearInterval(state.detectId as ReturnType<typeof setInterval>); state.detectId = 0; }
  if (state.rafId) { cancelAnimationFrame(state.rafId); state.rafId = 0; }

  try { await state.ctx.suspend(); } catch { /* */ }

  setStatus('已暂停');
  updatePitchReadout(-1);
  updateStartBtn();
  drawOnce();
  if (state.viewMode === 'practice') showReport();
}

async function resume(): Promise<void> {
  if (state.running || !state.ctx) return;
  try { await state.ctx.resume(); } catch { /* */ }

  const spb = 60 / state.bpm;
  state.startTime = state.ctx.currentTime - state.frozenElapsedBeats * spb;
  state.viewOffsetBeats = 0;
  // Next tick = first whole beat after where we paused, but never in the past
  // (otherwise scheduleMetronome would burst-fire all missed beats at once).
  const nextBeat = Math.max(0, Math.floor(state.frozenElapsedBeats) + 1);
  state.nextTickBeat = nextBeat;
  state.nextTickTime = state.startTime + nextBeat * spb;
  if (state.nextTickTime < state.ctx.currentTime + 0.05) {
    state.nextTickTime = state.ctx.currentTime + 0.05;
  }
  state.running = true;

  state.detectId = setInterval(detectStep, DETECT_INTERVAL_MS);
  setStatus('');
  hideReport();
  updateStartBtn();
  drawLoop();
}

// Wipe the pitch trail and rewind the timeline to beat 0. Keeps the session
// alive (mic/ctx untouched) so it works while running, paused, or idle.
function clearData(): void {
  histClear();
  state.frozenElapsedBeats = 0;
  state.viewOffsetBeats = 0;
  if (state.ctx) {
    const spb = 60 / state.bpm;
    state.startTime = state.ctx.currentTime;
    state.nextTickBeat = 0;
    state.nextTickTime = state.startTime + spb;
  }
  updatePitchReadout(-1);
  hideReport();
  drawOnce();
}

// Full release of mic/audio resources. Used when leaving the panel.
async function teardown(): Promise<void> {
  if (!state.running && !state.ctx) return;
  if (state.ctx) {
    state.frozenElapsedBeats = (state.ctx.currentTime - state.startTime) / (60 / state.bpm);
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
  histPush(state.ctx.currentTime, f, rms);
  updatePitchReadout(f);
  if (state.viewMode === 'tuner') updateTuner(f);
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
    ? (state.ctx.currentTime - state.startTime) / secsPerBeat
    : state.frozenElapsedBeats + state.viewOffsetBeats;

  // Pitch range + reference lanes. Score mode derives a chromatic lane set from
  // the loaded score's note range; otherwise use the chromatic/scale preset.
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
      const r = Math.min(4, blockH / 2, w / 2);
      ctx2d.roundRect(left, yy, w, blockH, r);
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
  // Judge only against target notes (all notes in chromatic mode; scale tones
  // in scale mode) so trace colour reflects the scale the player is practising.
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
    const y = midiToY(m);
    const p = buckets[pickBucket(f, beat)].path;
    p.moveTo(x + dotR, y);
    p.arc(x, y, dotR, 0, Math.PI * 2);
  });

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
}

// ── UI helpers ─────────────────────────────────────────────────────────────
function setStatus(msg: string): void {
  if (state.els) state.els.statusEl.textContent = msg;
}

function updateStartBtn(): void {
  if (!state.els) return;
  let label: string;
  if (state.running) label = '⏸ 暂停';
  else if (state.ctx) label = '▶ 继续';
  else label = '▶ 开始';
  state.els.startBtn.textContent = label;
  // Tuner has its own start button; when tuning, "暂停" reads oddly, so show 停止.
  state.els.tunerStartBtn.textContent = state.running ? '⏸ 停止' : (state.ctx ? '▶ 继续' : '▶ 开始');
  state.refreshPanCursor?.();
}

// ── Practice report ──────────────────────────────────────────────────────────
// Walk the recorded history, snap each voiced frame to its nearest target note,
// and hand the (name, cents) list to the analyzer. Frames more than ~150¢ from
// any target are dropped as transitions/noise rather than counted as a note.
function computeReport(): Report | null {
  const entries: CentsEntry[] = [];
  if (scoreModeActive()) {
    // Judge each frame against the score note under its beat.
    const spb = 60 / state.bpm;
    histForEach((ts, f) => {
      if (f <= 0) return;
      const beat = (ts - state.startTime) / spb;
      const tn = targetNoteAtBeat(beat);
      if (!tn) return;
      const c = 1200 * Math.log2(f / midiToFreq(tn.midi));
      if (Math.abs(c) > 150) return;
      entries.push({ name: tn.name, cents: Math.round(c) });
    });
  } else {
    const targets = state.rangeNotes.filter(n => n.target);
    if (!targets.length) return null;
    histForEach((_ts, f) => {
      if (f <= 0) return;
      let bestAbs = Infinity, bestSigned = 0, bestName = '';
      for (const t of targets) {
        const c = 1200 * Math.log2(f / t.frequency);
        const a = Math.abs(c);
        if (a < bestAbs) { bestAbs = a; bestSigned = c; bestName = t.name; }
      }
      if (bestAbs > 150) return;
      entries.push({ name: bestName, cents: Math.round(bestSigned) });
    });
  }
  if (entries.length < 20) return null; // not enough to say anything useful
  return analyze(entries, state.centsToleranceGood, state.centsToleranceMed);
}

function hideReport(): void {
  state.els?.reportEl.classList.add('hidden');
}

function showReport(): void {
  const el = state.els?.reportEl;
  if (!el) return;
  const r = computeReport();
  if (!r) { hideReport(); return; }

  const round = (n: number): string => `${n < 0 ? '−' : ''}${Math.abs(Math.round(n))}`;
  let tendency = '';
  if (r.tendency > state.centsToleranceGood) tendency = `<span class="report-note">整体偏高 ${round(r.tendency)}¢,容易拉高</span>`;
  else if (r.tendency < -state.centsToleranceGood) tendency = `<span class="report-note">整体偏低 ${round(r.tendency)}¢,容易拉低</span>`;

  let worst: string;
  if (r.worst.length === 0) {
    worst = '<div class="report-good">音准很稳,继续保持!</div>';
  } else {
    worst = '<div class="report-worst-title">最需要注意</div><ul class="report-worst">' + r.worst.map(w => {
      const dir = w.meanCents > 0 ? '偏高' : '偏低';
      const tip = w.meanCents > 0 ? '手指往下挪一点点' : '手指往上挪一点点';
      return `<li><b>${w.name}</b> 平均${dir} ${round(w.meanCents)}¢ · ${tip}</li>`;
    }).join('') + '</ul>';
  }

  el.innerHTML = `
    <div class="report-head">
      <span class="report-score">评分 <b>${r.score}</b></span>
      <span class="report-bars">在调 ${Math.round(r.inTunePct)}% · 接近 ${Math.round(r.closePct)}% · 跑调 ${Math.round(r.offPct)}%</span>
      ${tendency}
    </div>
    ${worst}`;
  el.classList.remove('hidden');
}

// ── Tuner view ───────────────────────────────────────────────────────────────
// Big single-note tuner for tuning the open strings. Shows the nearest note,
// how many cents off, a needle, and which of G/D/A/E you're closest to.
function updateTuner(freq: number): void {
  if (!state.els) return;
  const { tunerNote, tunerCents, tunerNeedle, tunerStrings } = state.els;
  if (freq <= 0) {
    tunerNote.textContent = '—';
    tunerCents.textContent = '拉一个音…';
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

  const absC = Math.abs(cents);
  const band = absC <= state.centsToleranceGood ? 'good'
    : absC <= state.centsToleranceMed ? 'med' : 'bad';
  const word = absC <= state.centsToleranceGood ? '准 ✓'
    : cents < 0 ? `偏低 ${cents}¢ · 调紧一点` : `偏高 +${cents}¢ · 调松一点`;
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

// Switch between the practice scope and the tuner. Entering the tuner starts
// the mic automatically so a beginner just sees a working tuner.
function setViewMode(mode: ViewMode): void {
  if (!state.els) return;
  state.viewMode = mode;
  state.els.modeTabs.forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  state.els.practiceView.classList.toggle('hidden', mode !== 'practice');
  state.els.tunerView.classList.toggle('hidden', mode !== 'tuner');
  if (mode === 'tuner') {
    if (!state.running && !state.ctx) {
      void start().then(() => { if (!state.running) state.els!.tunerCents.textContent = '无法访问麦克风,请检查权限或设备'; });
    }
    resizeCanvas();
  }
}

// Cycle through the three button states: idle → running → paused → running …
function togglePlayPause(): void {
  if (state.running) pause();
  else if (state.ctx) resume();
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

// ── Public init ────────────────────────────────────────────────────────────
export function initRealtime(): void {
  loadSettings();   // hydrate state from localStorage before binding UI

  state.els = {
    canvas: document.getElementById('realtime-canvas') as HTMLCanvasElement,
    wrap: document.getElementById('rt-canvas-wrap') as HTMLElement,
    bpmInput: document.getElementById('rt-bpm') as HTMLInputElement,
    accentInput: document.getElementById('rt-accent') as HTMLInputElement,
    visibleBeatsInput: document.getElementById('rt-visible-beats') as HTMLInputElement,
    centsGoodInput: document.getElementById('rt-cents-good') as HTMLInputElement,
    centsMedInput: document.getElementById('rt-cents-med') as HTMLInputElement,
    soundSelect: document.getElementById('rt-sound') as HTMLSelectElement,
    rangeLoSelect: document.getElementById('rt-range-lo') as HTMLSelectElement,
    rangeHiSelect: document.getElementById('rt-range-hi') as HTMLSelectElement,
    refModeToggles: document.querySelectorAll<HTMLButtonElement>('#rt-refmode-toggles .toggle'),
    scaleControls: document.getElementById('rt-scale-controls') as HTMLElement,
    keySelect: document.getElementById('rt-key') as HTMLSelectElement,
    temperamentToggles: document.querySelectorAll<HTMLButtonElement>('#rt-temperament-toggles .toggle'),
    scoreControls: document.getElementById('rt-score-controls') as HTMLElement,
    fileInput: document.getElementById('rt-file') as HTMLInputElement,
    scoreTitle: document.getElementById('rt-score-title') as HTMLElement,
    metronomeToggles: document.querySelectorAll<HTMLButtonElement>('#rt-metronome-toggles .toggle'),
    judgeToggles: document.querySelectorAll<HTMLButtonElement>('#rt-judge-toggles .toggle'),
    unitToggles: document.querySelectorAll<HTMLButtonElement>('#rt-unit-toggles .toggle'),
    droneToggles: document.querySelectorAll<HTMLButtonElement>('#rt-drone-toggles .toggle'),
    droneRootSelect: document.getElementById('rt-drone-root') as HTMLSelectElement,
    micSelect: document.getElementById('rt-mic') as HTMLSelectElement,
    startBtn: document.getElementById('rt-start') as HTMLButtonElement,
    clearBtn: document.getElementById('rt-clear') as HTMLButtonElement,
    exportBtn: document.getElementById('rt-export') as HTMLButtonElement,
    recordBtn: document.getElementById('rt-record') as HTMLButtonElement,
    fullscreenBtn: document.getElementById('rt-fullscreen') as HTMLButtonElement,
    statusEl: document.getElementById('rt-status') as HTMLElement,
    pitchEl: document.getElementById('rt-pitch') as HTMLElement,
    reportEl: document.getElementById('rt-report') as HTMLElement,
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

  // Reference mode (chromatic vs scale), key, and temperament.
  state.els.keySelect.innerHTML = COMMON_KEYS
    .map((k, i) => `<option value="${i}">${k.label}</option>`).join('');
  state.els.keySelect.value = String(state.keyIndex);

  const syncModeUi = (): void => {
    state.els!.scaleControls.classList.toggle('hidden', state.refMode !== 'scale');
    state.els!.scoreControls.classList.toggle('hidden', state.refMode !== 'score');
  };
  syncModeUi();
  loadSavedScore();
  setScoreTitle();

  state.els.refModeToggles.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === state.refMode);
    btn.addEventListener('click', () => {
      state.refMode = btn.dataset.value as RefMode;
      state.els!.refModeToggles.forEach(b => b.classList.toggle('active', b === btn));
      syncModeUi();
      refreshRefNotes();
      saveSettings();
      if (state.refMode === 'score') clearData();   // start the score from the top
      drawOnce();
    });
  });

  state.els.fileInput.addEventListener('change', () => {
    const f = state.els!.fileInput.files?.[0];
    if (f) void loadScoreFile(f);
    state.els!.fileInput.value = '';   // allow re-importing the same file
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
  if (navigator.mediaDevices) {
    navigator.mediaDevices.addEventListener?.('devicechange', () => { void populateMicList(); });
  }

  state.els.startBtn.addEventListener('click', togglePlayPause);
  state.els.clearBtn.addEventListener('click', clearData);
  state.els.exportBtn.addEventListener('click', exportPng);
  state.els.recordBtn.addEventListener('click', () => { void toggleRecord(); });
  state.els.tunerStartBtn.addEventListener('click', togglePlayPause);

  state.els.modeTabs.forEach(tab => {
    tab.addEventListener('click', () => setViewMode(tab.dataset.mode as ViewMode));
  });

  state.els.fullscreenBtn.addEventListener('click', toggleFullscreen);

  setupPan(state.els.canvas);

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  document.addEventListener('fullscreenchange', resizeCanvas);

  // Fullscreen-only shortcuts: Space toggles play/pause (preserving the
  // trail), K clears the trail. Scoped to fullscreen so they don't hijack
  // typing in BPM/accent inputs elsewhere on the page.
  document.addEventListener('keydown', (e) => {
    if (document.fullscreenElement !== state.els?.wrap) return;
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
function timestamp(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Save the current scope (pitch trail + targets) as a PNG to show a teacher.
function exportPng(): void {
  if (!state.els) return;
  state.els.canvas.toBlob(blob => {
    if (blob) downloadBlob(blob, `pavlov-cat-${timestamp()}.png`);
  }, 'image/png');
}

function pickRecMime(): string {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  for (const t of types) if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
  return '';
}

function updateRecordBtn(): void {
  if (state.els) state.els.recordBtn.textContent = state.recording ? '⏹ 停止录音' : '🎙 录音';
}

// Record the raw microphone (just the playing, not metronome/drone) to a file.
async function toggleRecord(): Promise<void> {
  if (state.recording) {
    state.recorder?.stop();
    return;
  }
  if (!state.running) await start();      // recording needs a live mic
  if (!state.micStream) { setStatus('无法录音:麦克风未就绪'); return; }

  const mime = pickRecMime();
  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(state.micStream, mime ? { mimeType: mime } : undefined);
  } catch {
    setStatus('当前浏览器不支持录音');
    return;
  }
  state.recorder = rec;
  state.recChunks = [];
  rec.ondataavailable = e => { if (e.data.size > 0) state.recChunks.push(e.data); };
  rec.onstop = () => {
    state.recording = false;
    updateRecordBtn();
    if (!state.recChunks.length) return;
    const type = rec.mimeType || 'audio/webm';
    const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
    downloadBlob(new Blob(state.recChunks, { type }), `pavlov-cat-${timestamp()}.${ext}`);
    state.recChunks = [];
  };
  rec.start();
  state.recording = true;
  updateRecordBtn();
  setStatus('录音中…');
}

function toggleFullscreen(): void {
  if (!state.els) return;
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => { /* ignore */ });
  } else {
    state.els.wrap.requestFullscreen().catch(() => {
      setStatus('当前浏览器不支持全屏');
    });
  }
}

function resizeCanvas(): void {
  if (!state.els) return;
  const c = state.els.canvas;
  const wrap = state.els.wrap;
  const w = Math.max(320, wrap.clientWidth);
  const h = Math.max(320, wrap.clientHeight);
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
