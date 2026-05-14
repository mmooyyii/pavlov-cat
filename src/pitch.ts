// Autocorrelation-based pitch detection (Chris Wilson's algorithm, condensed).
// Returns frequency in Hz, or -1 if signal too weak or unclear.
export function detectPitch(buf: Float32Array, sampleRate: number): number {
  const SIZE = buf.length;

  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return -1;

  let r1 = 0, r2 = SIZE - 1;
  const thres = 0.2;
  for (let i = 0; i < SIZE / 2; i++) if (Math.abs(buf[i]) < thres) { r1 = i; break; }
  for (let i = 1; i < SIZE / 2; i++) if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; }

  const N = r2 - r1;
  if (N < 256) return -1;

  // Limit max lag to what we need (lowest violin pitch ~196Hz → period ~225 samples at 44.1k).
  // Capping lag keeps autocorrelation O(N · maxLag) bounded.
  const maxLag = Math.min(N - 1, Math.floor(sampleRate / 60));
  const c = new Float32Array(maxLag + 1);
  for (let i = 0; i <= maxLag; i++) {
    let sum = 0;
    const end = N - i;
    for (let j = 0; j < end; j++) sum += buf[r1 + j] * buf[r1 + j + i];
    c[i] = sum;
  }

  let d = 0;
  while (d + 1 < c.length && c[d] > c[d + 1]) d++;

  let maxval = -1, maxpos = -1;
  for (let i = d; i < c.length; i++) {
    if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
  }
  if (maxpos <= 0) return -1;

  let T0 = maxpos;
  if (T0 > 0 && T0 + 1 < c.length) {
    const x1 = c[T0 - 1], x2 = c[T0], x3 = c[T0 + 1];
    const a = (x1 + x3 - 2 * x2) / 2;
    const b = (x3 - x1) / 2;
    if (a !== 0) T0 = T0 - b / (2 * a);
  }

  const freq = sampleRate / T0;
  if (freq < 60 || freq > 2000) return -1;
  return freq;
}

export function freqToMidi(f: number): number {
  return 69 + 12 * Math.log2(f / 440);
}

export function cents(f1: number, f2: number): number {
  return 1200 * Math.log2(f1 / f2);
}
