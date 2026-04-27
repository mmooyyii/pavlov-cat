let actx: AudioContext | null = null;
let dirHandle: FileSystemDirectoryHandle | null = null;

function getCtx(): AudioContext {
  if (!actx) actx = new AudioContext();
  if (actx.state === 'suspended') actx.resume();
  return actx;
}

export function setAudioDirectory(handle: FileSystemDirectoryHandle): void {
  dirHandle = handle;
  bufferCache.clear();
}

// Cache: null = not tried yet, false = not found, AudioBuffer = loaded
const bufferCache = new Map<string, AudioBuffer | false>();

async function loadBuffer(noteName: string): Promise<AudioBuffer | false> {
  if (bufferCache.has(noteName)) return bufferCache.get(noteName)!;

  const exts = ['mp3', 'm4a', 'ogg', 'wav'];

  if (dirHandle) {
    for (const ext of exts) {
      try {
        const fileHandle = await dirHandle.getFileHandle(`${noteName}.${ext}`);
        const file = await fileHandle.getFile();
        const arrayBuf = await file.arrayBuffer();
        const audioBuf = await getCtx().decodeAudioData(arrayBuf);
        bufferCache.set(noteName, audioBuf);
        return audioBuf;
      } catch {
        // try next ext
      }
    }
  }

  for (const ext of exts) {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}sounds/${noteName}.${ext}`);
      if (!res.ok) continue;
      const arrayBuf = await res.arrayBuffer();
      const audioBuf = await getCtx().decodeAudioData(arrayBuf);
      bufferCache.set(noteName, audioBuf);
      return audioBuf;
    } catch {
      // try next ext or fall through to synthesis
    }
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
