import { PitchDetector } from 'pitchy';

let detector: PitchDetector<Float32Array> | null = null;
let detectorSize = 0;

export function detectPitch(buf: Float32Array, sampleRate: number): number {
  if (!detector || detectorSize !== buf.length) {
    detector = PitchDetector.forFloat32Array(buf.length);
    detector.minVolumeDecibels = -40;
    detectorSize = buf.length;
  }
  const [freq, clarity] = detector.findPitch(buf, sampleRate);
  if (clarity < 0.9) return -1;
  if (freq < 60 || freq > 2000) return -1;
  return freq;
}

export function freqToMidi(f: number): number {
  return 69 + 12 * Math.log2(f / 440);
}

export function cents(f1: number, f2: number): number {
  return 1200 * Math.log2(f1 / f2);
}