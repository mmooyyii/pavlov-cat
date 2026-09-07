import { PitchDetector } from 'pitchy';

// Pitch *detection* only. All frequency/MIDI/cents math lives in music.ts so
// there is a single tuning source (A4 = 442). Re-exported here for callers that
// already import from './pitch'.
export { freqToMidi, centsBetween as cents } from './music';

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
