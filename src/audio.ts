let actx: AudioContext | null = null;
let dirHandle: FileSystemDirectoryHandle | null = null;

// noteName → ext, populated by scanning the directory once
const dirFileMap = new Map<string, string>();

// HTTP manifest: noteName → ext, loaded once from sounds/manifest.json
// null = not yet fetched, Map = loaded (may be empty if no sounds deployed)
let httpManifest: Map<string, string> | null = null;

const AUDIO_EXTS = new Set(['mp3', 'm4a', 'ogg', 'wav']);

function getCtx(): AudioContext {
  if (!actx) actx = new AudioContext();
  if (actx.state === 'suspended') actx.resume();
  return actx;
}

async function scanDirectory(): Promise<void> {
  if (!dirHandle) return;
  dirFileMap.clear();
  for await (const [name, entry] of (dirHandle as any).entries()) {
    if (entry.kind !== 'file') continue;
    const dot = name.lastIndexOf('.');
    if (dot === -1) continue;
    const ext = name.slice(dot + 1).toLowerCase();
    if (AUDIO_EXTS.has(ext)) dirFileMap.set(name.slice(0, dot), ext);
  }
}

async function ensureHttpManifest(): Promise<void> {
  if (httpManifest !== null) return;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}sounds/manifest.json`);
    if (!res.ok) { httpManifest = new Map(); return; }
    const data: Record<string, string> = await res.json();
    httpManifest = new Map(Object.entries(data));
  } catch {
    httpManifest = new Map();
  }
}

// Fire off manifest fetch immediately so it's ready before first playback
ensureHttpManifest();

export function setAudioDirectory(handle: FileSystemDirectoryHandle): void {
  dirHandle = handle;
  bufferCache.clear();
  scanDirectory();
}

// Cache: null = not tried yet, false = not found, AudioBuffer = loaded
const bufferCache = new Map<string, AudioBuffer | false>();

async function loadBuffer(noteName: string): Promise<AudioBuffer | false> {
  if (bufferCache.has(noteName)) return bufferCache.get(noteName)!;

  if (dirHandle) {
    const ext = dirFileMap.get(noteName);
    if (ext) {
      try {
        const fileHandle = await dirHandle.getFileHandle(`${noteName}.${ext}`);
        const file = await fileHandle.getFile();
        const audioBuf = await getCtx().decodeAudioData(await file.arrayBuffer());
        bufferCache.set(noteName, audioBuf);
        return audioBuf;
      } catch { /* fall through */ }
    }
    bufferCache.set(noteName, false);
    return false;
  }

  await ensureHttpManifest();
  const ext = httpManifest!.get(noteName);
  if (ext) {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}sounds/${noteName}.${ext}`);
      if (res.ok) {
        const audioBuf = await getCtx().decodeAudioData(await res.arrayBuffer());
        bufferCache.set(noteName, audioBuf);
        return audioBuf;
      }
    } catch { /* fall through */ }
  }

  bufferCache.set(noteName, false);
  return false;
}

// Preload all notes at startup (fire-and-forget)
export function preloadSounds(noteNames: string[]): void {
  noteNames.forEach(n => loadBuffer(n));
}

export async function playNote(noteName: string, frequency: number): Promise<void> {
  const ctx = getCtx();

  const buf = await loadBuffer(noteName);
  if (buf) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start();
    return;
  }

  // Synthesized fallback
  playSynth(ctx, frequency);
}

function playSynth(ctx: AudioContext, frequency: number, duration = 1.5): void {
  const master = ctx.createGain();
  master.connect(ctx.destination);

  const harmonics = [1, 2, 3, 4, 5, 6];
  const amps      = [0.45, 0.30, 0.18, 0.10, 0.06, 0.03];

  harmonics.forEach((h, i) => {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency * h, ctx.currentTime);
    gain.gain.setValueAtTime(amps[i], ctx.currentTime);
    osc.connect(gain);
    gain.connect(master);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  });

  // Vibrato on fundamental
  const fundOsc  = ctx.createOscillator();
  const fundGain = ctx.createGain();
  const vibOsc   = ctx.createOscillator();
  const vibGain  = ctx.createGain();
  fundOsc.type = 'sine';
  fundOsc.frequency.setValueAtTime(frequency, ctx.currentTime);
  fundGain.gain.setValueAtTime(amps[0], ctx.currentTime);
  vibOsc.frequency.setValueAtTime(5.5, ctx.currentTime);
  vibGain.gain.setValueAtTime(0, ctx.currentTime);
  vibGain.gain.linearRampToValueAtTime(3, ctx.currentTime + 0.4);
  vibOsc.connect(vibGain);
  vibGain.connect(fundOsc.frequency);
  fundOsc.connect(fundGain);
  fundGain.connect(master);
  fundOsc.start(ctx.currentTime);
  fundOsc.stop(ctx.currentTime + duration);
  vibOsc.start(ctx.currentTime + 0.25);
  vibOsc.stop(ctx.currentTime + duration);

  const t = ctx.currentTime;
  master.gain.setValueAtTime(0, t);
  master.gain.linearRampToValueAtTime(0.25, t + 0.06);
  master.gain.linearRampToValueAtTime(0.20, t + 0.20);
  master.gain.setValueAtTime(0.20, t + duration - 0.25);
  master.gain.linearRampToValueAtTime(0, t + duration);
}
