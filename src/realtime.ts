import { detectPitch, freqToMidi } from './pitch';
import type { Note } from './notes';

// ── Tunables ────────────────────────────────────────────────────────────────
const FFT_SIZE = 2048;                  // pitch detection window (~43ms @ 48kHz)
const DETECT_INTERVAL_MS = 16;          // ~62.5Hz pitch detection (windows overlap ~63%)
const HISTORY_DURATION_S = 3600;        // 1 hour of pitch trajectory
const HISTORY_SIZE = Math.ceil((HISTORY_DURATION_S * 1000) / DETECT_INTERVAL_MS); // ~225k entries → ~1.7MB total
const VISIBLE_BEATS = 8;                // total beats visible across canvas
const PLAYHEAD_RATIO = 0.25;            // playhead x-position (fraction of width)
const LOOKAHEAD_S = 0.2;                // metronome scheduling lookahead

// Fallback pitch range when no notes are selected (covers most of the violin)
const DEFAULT_MIDI_MIN = freqToMidi(196); // G3
const DEFAULT_MIDI_MAX = freqToMidi(988); // B5

// ── Palette ─────────────────────────────────────────────────────────────────
const PALETTE = {
  bgTop:        '#1d2128',
  bgBottom:     '#14161b',
  refLine:      '#2c333d',
  refLabel:     '#7eb4cf',  // soft cool blue
  gridAccent:   '#3e2f1a',  // warm dark amber
  gridRegular:  '#22272d',  // cool dark gray
  labelAccent:  '#d4a96a',  // warm gold
  labelRegular: '#7a8590',
  traceGood:    '#5dc97a',  // <10 cents off
  traceMed:     '#e6b450',  // <25 cents off
  traceBad:     '#ff7a5c',  // >=25 cents off
  traceNoRef:   '#ff9a3c',  // when no reference notes are selected
  playhead:     '#5dd4d4',  // cyan-teal
} as const;
const CENTS_GOOD = 10;
const CENTS_MED = 25;

// ── Types ───────────────────────────────────────────────────────────────────
type TimeUnit = 'beat' | 'second';
type SoundKind = 'wood' | 'click' | 'tom' | 'hihat';

interface Hooks {
  getNotes: () => Note[];
}

// ── State ───────────────────────────────────────────────────────────────────
const state = {
  ctx: null as AudioContext | null,
  micStream: null as MediaStream | null,
  micSource: null as MediaStreamAudioSourceNode | null,
  analyser: null as AnalyserNode | null,
  buffer: null as Float32Array<ArrayBuffer> | null,

  running: false,
  startTime: 0,                         // ctx.currentTime when started
  frozenElapsedBeats: 0,                // last elapsedBeats when stopped (for static display)
  bpm: 80,
  timeUnit: 'beat' as TimeUnit,
  accentEvery: 4,
  soundKind: 'wood' as SoundKind,
  noiseBuffer: null as AudioBuffer | null,    // shared white-noise source for hihat

  // Pan when stopped: displayed elapsed = frozenElapsedBeats + viewOffsetBeats.
  // Clamped so the playhead stays inside [0, frozenElapsedBeats].
  viewOffsetBeats: 0,
  lastPxPerBeat: 0,                     // stashed by drawOnce for pointer handler
  refreshPanCursor: null as null | (() => void),

  // Metronome scheduling
  nextTickBeat: 0,
  nextTickTime: 0,

  // Ring buffer for pitch history
  histTime: new Float32Array(HISTORY_SIZE),
  histFreq: new Float32Array(HISTORY_SIZE),
  histCount: 0,
  histHead: 0,

  rafId: 0,
  detectId: 0 as ReturnType<typeof setInterval> | 0,

  hooks: null as Hooks | null,
  els: null as null | {
    canvas: HTMLCanvasElement;
    wrap: HTMLElement;
    bpmInput: HTMLInputElement;
    accentInput: HTMLInputElement;
    soundSelect: HTMLSelectElement;
    unitToggles: NodeListOf<HTMLButtonElement>;
    startBtn: HTMLButtonElement;
    fullscreenBtn: HTMLButtonElement;
    statusEl: HTMLElement;
    pitchEl: HTMLElement;
  },
};

// ── Ring buffer ────────────────────────────────────────────────────────────
function histPush(t: number, f: number): void {
  if (state.histCount < HISTORY_SIZE) {
    state.histTime[state.histCount] = t;
    state.histFreq[state.histCount] = f;
    state.histCount++;
  } else {
    state.histTime[state.histHead] = t;
    state.histFreq[state.histHead] = f;
    state.histHead = (state.histHead + 1) % HISTORY_SIZE;
  }
}

function histClear(): void {
  state.histCount = 0;
  state.histHead = 0;
}

function histForEach(cb: (t: number, f: number) => void): void {
  if (state.histCount < HISTORY_SIZE) {
    for (let i = 0; i < state.histCount; i++) cb(state.histTime[i], state.histFreq[i]);
  } else {
    for (let i = 0; i < HISTORY_SIZE; i++) {
      const idx = (state.histHead + i) % HISTORY_SIZE;
      cb(state.histTime[idx], state.histFreq[idx]);
    }
  }
}

// ── Metronome ──────────────────────────────────────────────────────────────
function scheduleMetronome(): void {
  if (!state.ctx) return;
  const ctx = state.ctx;
  const secsPerBeat = 60 / state.bpm;
  while (state.nextTickTime < ctx.currentTime + LOOKAHEAD_S) {
    const isAccent = state.nextTickBeat % state.accentEvery === 0;
    if (isAccent) playBell(ctx, state.nextTickTime);
    else playSound(ctx, state.nextTickTime, state.soundKind);
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

// Bell-like accent: two sine partials with longer decay, recognisable as "ding".
function playBell(ctx: AudioContext, when: number): void {
  const fundamentals = [1318.5, 1975.5];  // E6 + B6, simple consonant fifth
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(0.22, when + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.001, when + 0.35);
  gain.connect(ctx.destination);
  const oscs: OscillatorNode[] = [];
  for (const f of fundamentals) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    o.connect(gain);
    o.start(when);
    o.stop(when + 0.4);
    oscs.push(o);
  }
  let stopped = 0;
  const cleanup = () => {
    if (++stopped < oscs.length) return;
    for (const o of oscs) o.disconnect();
    gain.disconnect();
  };
  for (const o of oscs) o.onended = cleanup;
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
async function start(): Promise<void> {
  if (state.running) return;

  try {
    state.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch {
    setStatus('无法访问麦克风');
    return;
  }

  state.ctx = new AudioContext();
  if (state.ctx.state === 'suspended') await state.ctx.resume();

  state.micSource = state.ctx.createMediaStreamSource(state.micStream);
  state.analyser = state.ctx.createAnalyser();
  state.analyser.fftSize = FFT_SIZE;
  state.buffer = new Float32Array(state.analyser.fftSize);
  state.micSource.connect(state.analyser);
  // NOTE: do NOT connect analyser → destination (would echo mic into speakers)

  histClear();

  state.startTime = state.ctx.currentTime + 0.1;
  state.nextTickBeat = 0;
  state.nextTickTime = state.startTime;
  state.viewOffsetBeats = 0;
  state.running = true;

  state.detectId = setInterval(detectStep, DETECT_INTERVAL_MS);
  updateStartBtn();
  drawLoop();
}

async function stop(): Promise<void> {
  if (!state.running && !state.ctx) return;
  if (state.ctx) {
    state.frozenElapsedBeats = (state.ctx.currentTime - state.startTime) / (60 / state.bpm);
  }
  state.running = false;

  if (state.detectId) { clearInterval(state.detectId as ReturnType<typeof setInterval>); state.detectId = 0; }
  if (state.rafId) { cancelAnimationFrame(state.rafId); state.rafId = 0; }

  try { state.micSource?.disconnect(); } catch { /* */ }
  try { state.analyser?.disconnect(); } catch { /* */ }
  state.micStream?.getTracks().forEach(t => t.stop());

  state.micSource = null;
  state.analyser = null;
  state.micStream = null;
  state.buffer = null;
  state.noiseBuffer = null;

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
  const f = detectPitch(state.buffer, state.ctx.sampleRate);
  histPush(state.ctx.currentTime, f);
  updatePitchReadout(f);
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

  // Pitch range from filtered notes (reference lanes), with padding.
  const refNotes = state.hooks?.getNotes() ?? [];
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
  const pxPerBeat = (W - playheadX - 10 * scale) / (VISIBLE_BEATS - VISIBLE_BEATS * PLAYHEAD_RATIO);
  state.lastPxPerBeat = pxPerBeat;

  const topY = Math.round(24 * scale);
  const bottomY = H - Math.round(28 * scale);
  const usableH = bottomY - topY;

  const midiToY = (m: number): number =>
    topY + (mMax - m) / (mMax - mMin) * usableH;
  const beatToX = (b: number): number =>
    playheadX + (b - elapsedBeats) * pxPerBeat;

  // Reference lanes: one per filtered note
  ctx2d.lineWidth = 1;
  ctx2d.font = `${fontMd}px system-ui, sans-serif`;
  ctx2d.textBaseline = 'middle';
  ctx2d.textAlign = 'right';
  for (const n of refNotes) {
    const y = midiToY(freqToMidi(n.frequency));
    ctx2d.strokeStyle = PALETTE.refLine;
    ctx2d.beginPath();
    ctx2d.moveTo(leftMargin, y);
    ctx2d.lineTo(W, y);
    ctx2d.stroke();
    ctx2d.fillStyle = PALETTE.refLabel;
    ctx2d.fillText(n.name, leftMargin - 4, y);
  }

  // Beat / second grid
  const firstBeat = Math.floor(elapsedBeats - VISIBLE_BEATS * PLAYHEAD_RATIO);
  const lastBeat = Math.ceil(elapsedBeats + VISIBLE_BEATS * (1 - PLAYHEAD_RATIO));
  ctx2d.font = `${fontSm}px system-ui, sans-serif`;
  ctx2d.textAlign = 'left';
  ctx2d.textBaseline = 'top';
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
    const label = state.timeUnit === 'beat'
      ? `${b + 1}`
      : `${(b * secsPerBeat).toFixed(2)}s`;
    ctx2d.fillText(label, x + 2, bottomY + 4);
  }

  // Pitch trace. With up to ~109k history entries we keep this hot loop cheap
  // by rejecting on the visible-time window before any log/midi math, and by
  // batching segments into per-color Path2D buckets (one stroke per color).
  const visibleStartT = state.startTime + (elapsedBeats - VISIBLE_BEATS * PLAYHEAD_RATIO) * secsPerBeat;
  const visibleEndT   = state.startTime + (elapsedBeats + VISIBLE_BEATS * (1 - PLAYHEAD_RATIO)) * secsPerBeat;

  // Tri-color buckets when reference notes are available; otherwise a single
  // fallback bucket. Order matches pickBucket() return values.
  const buckets: { color: string; path: Path2D }[] = [
    { color: PALETTE.traceGood,  path: new Path2D() },
    { color: PALETTE.traceMed,   path: new Path2D() },
    { color: PALETTE.traceBad,   path: new Path2D() },
    { color: PALETTE.traceNoRef, path: new Path2D() },
  ];
  const refMidis: number[] = [];
  for (const n of refNotes) refMidis.push(freqToMidi(n.frequency));
  const hasRef = refMidis.length > 0;

  const pickBucket = (m: number): number => {
    if (!hasRef) return 3;
    let best = Infinity;
    for (let i = 0; i < refMidis.length; i++) {
      const d = Math.abs(m - refMidis[i]);
      if (d < best) best = d;
    }
    const cents = best * 100;
    if (cents < CENTS_GOOD) return 0;
    if (cents < CENTS_MED) return 1;
    return 2;
  };

  let prevX = 0, prevY = 0;
  let hasPrev = false;
  histForEach((ts, f) => {
    if (ts < visibleStartT || ts > visibleEndT) { hasPrev = false; return; }
    if (f <= 0) { hasPrev = false; return; }
    const m = freqToMidi(f);
    if (m < mMin || m > mMax) { hasPrev = false; return; }
    const beat = (ts - state.startTime) / secsPerBeat;
    const x = beatToX(beat);
    if (x < leftMargin || x > W) { hasPrev = false; return; }
    const y = midiToY(m);
    if (hasPrev) {
      const p = buckets[pickBucket(m)].path;
      p.moveTo(prevX, prevY);
      p.lineTo(x, y);
    }
    prevX = x; prevY = y; hasPrev = true;
  });

  ctx2d.lineWidth = 2 * scale;
  ctx2d.lineCap = 'round';
  ctx2d.lineJoin = 'round';
  for (const b of buckets) {
    ctx2d.strokeStyle = b.color;
    ctx2d.stroke(b.path);
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
  state.els.startBtn.textContent = state.running ? '⏹ 停止' : '▶ 开始';
  state.refreshPanCursor?.();
}

// Map a frequency to the nearest note name + cents offset, for the readout.
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function updatePitchReadout(freq: number): void {
  if (!state.els) return;
  if (freq <= 0) {
    state.els.pitchEl.textContent = '— Hz';
    return;
  }
  const midi = freqToMidi(freq);
  const midiRound = Math.round(midi);
  const cents = Math.round((midi - midiRound) * 100);
  const noteName = NOTE_NAMES[((midiRound % 12) + 12) % 12];
  const octave = Math.floor(midiRound / 12) - 1;
  const sign = cents > 0 ? '+' : '';
  state.els.pitchEl.textContent = `${freq.toFixed(1)} Hz · ${noteName}${octave} ${sign}${cents}¢`;
}

// ── Public init ────────────────────────────────────────────────────────────
export function initRealtime(hooks: Hooks): void {
  state.hooks = hooks;

  state.els = {
    canvas: document.getElementById('realtime-canvas') as HTMLCanvasElement,
    wrap: document.getElementById('rt-canvas-wrap') as HTMLElement,
    bpmInput: document.getElementById('rt-bpm') as HTMLInputElement,
    accentInput: document.getElementById('rt-accent') as HTMLInputElement,
    soundSelect: document.getElementById('rt-sound') as HTMLSelectElement,
    unitToggles: document.querySelectorAll<HTMLButtonElement>('#rt-unit-toggles .toggle'),
    startBtn: document.getElementById('rt-start') as HTMLButtonElement,
    fullscreenBtn: document.getElementById('rt-fullscreen') as HTMLButtonElement,
    statusEl: document.getElementById('rt-status') as HTMLElement,
    pitchEl: document.getElementById('rt-pitch') as HTMLElement,
  };

  state.els.bpmInput.value = String(state.bpm);
  state.els.bpmInput.addEventListener('change', () => {
    const v = Math.max(40, Math.min(220, Number(state.els!.bpmInput.value) || 80));
    state.bpm = v;
    state.els!.bpmInput.value = String(v);
    if (!state.running) drawOnce();
  });

  state.els.accentInput.value = String(state.accentEvery);
  state.els.accentInput.addEventListener('change', () => {
    const v = Math.max(1, Math.min(12, Math.floor(Number(state.els!.accentInput.value)) || 4));
    state.accentEvery = v;
    state.els!.accentInput.value = String(v);
    drawOnce();
  });

  state.els.soundSelect.value = state.soundKind;
  state.els.soundSelect.addEventListener('change', () => {
    state.soundKind = state.els!.soundSelect.value as SoundKind;
  });

  state.els.unitToggles.forEach(btn => {
    btn.addEventListener('click', () => {
      state.timeUnit = btn.dataset.value as TimeUnit;
      state.els!.unitToggles.forEach(b => b.classList.toggle('active', b === btn));
      drawOnce();
    });
  });

  state.els.startBtn.addEventListener('click', () => {
    if (state.running) stop();
    else start();
  });

  state.els.fullscreenBtn.addEventListener('click', toggleFullscreen);

  setupPan(state.els.canvas);

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  document.addEventListener('fullscreenchange', resizeCanvas);

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

// Called by main.ts on config change (filter notes changed)
export function realtimeOnConfigChanged(): void {
  drawOnce();
}

// Called by main.ts when switching away from this tab
export function realtimeOnLeave(): void {
  if (state.running) stop();
}

// Called by main.ts when switching to this tab
export function realtimeOnEnter(): void {
  resizeCanvas();
}
