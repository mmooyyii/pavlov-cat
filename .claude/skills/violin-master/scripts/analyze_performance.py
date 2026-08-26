#!/usr/bin/env python3
"""Violin performance analyzer — pure numpy, no third-party audio deps.

Input:  mono/stereo PCM WAV (convert other formats first with afconvert).
Output: human-readable report + optional JSON (--json).

Analyzes a monophonic violin recording:
  - pitch track via McLeod/NSDF (same family as the app's pitchy detector)
  - note segmentation, per-note intonation in cents vs 12-TET (A4=442 default, --a4 to override)
  - rhythm evenness (inter-onset intervals)
  - vibrato detection (rate Hz, extent cents)
  - bow steadiness / dynamics (RMS envelope)

Limitations: single melodic line only. Double stops, chords and very fast
passages will confuse the detector.
"""

import json
import struct
import sys

import numpy as np

FRAME = 2048
HOP = 512
CLARITY_MIN = 0.90        # same threshold as src/pitch.ts
FMIN, FMAX = 150.0, 2200.0  # violin: G3≈197Hz up past E7 harmonics
SILENCE_DB = -45.0
MIN_NOTE_SEC = 0.08
A4 = 442.0                # orchestra pitch standard for this project; override with --a4

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def load_wav(path):
    """Manual RIFF parser: handles PCM (1), IEEE float (3) and EXTENSIBLE (0xFFFE),
    which Python's wave module rejects (afconvert emits EXTENSIBLE headers)."""
    with open(path, "rb") as f:
        data = f.read()
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise SystemExit(f"{path} is not a WAV file; convert first: afconvert -f WAVE -d LEI16@44100 -c 1 <in> <out.wav>")
    pos, fmt, raw = 12, None, None
    while pos + 8 <= len(data):
        cid = data[pos:pos + 4]
        size = struct.unpack("<I", data[pos + 4:pos + 8])[0]
        body = data[pos + 8:pos + 8 + size]
        if cid == b"fmt ":
            tag, ch, sr, _br, _ba, bits = struct.unpack("<HHIIHH", body[:16])
            if tag == 0xFFFE and size >= 40:  # EXTENSIBLE: real tag is in SubFormat GUID
                tag = struct.unpack("<H", body[24:26])[0]
            fmt = (tag, ch, sr, bits)
        elif cid == b"data":
            raw = body
        pos += 8 + size + (size & 1)
    if fmt is None or raw is None:
        raise SystemExit("malformed WAV: missing fmt/data chunk")
    tag, ch, sr, bits = fmt
    if tag == 3 and bits == 32:
        x = np.frombuffer(raw, dtype="<f4").astype(np.float64)
    elif tag == 3 and bits == 64:
        x = np.frombuffer(raw, dtype="<f8").astype(np.float64)
    elif tag == 1 and bits == 16:
        x = np.frombuffer(raw, dtype="<i2").astype(np.float64) / 32768.0
    elif tag == 1 and bits == 32:
        x = np.frombuffer(raw, dtype="<i4").astype(np.float64) / 2147483648.0
    elif tag == 1 and bits == 8:
        x = (np.frombuffer(raw, dtype=np.uint8).astype(np.float64) - 128.0) / 128.0
    elif tag == 1 and bits == 24:
        b = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3)
        x = (
            b[:, 0].astype(np.int32)
            | (b[:, 1].astype(np.int32) << 8)
            | (b[:, 2].astype(np.int32) << 16)
        )
        x = np.where(x >= 1 << 23, x - (1 << 24), x).astype(np.float64) / (1 << 23)
    else:
        raise SystemExit(f"unsupported WAV format tag={tag} bits={bits}; run afconvert to LEI16 first")
    if ch > 1:
        x = x[: len(x) - len(x) % ch].reshape(-1, ch).mean(axis=1)
    return x, sr


def nsdf_pitch(frame, sr):
    """McLeod pitch method. Returns (freq_hz, clarity) or (-1, 0)."""
    n = len(frame)
    frame = frame - frame.mean()
    fsize = 1
    while fsize < 2 * n:
        fsize *= 2
    spec = np.fft.rfft(frame, fsize)
    acf = np.fft.irfft(spec * np.conj(spec))[:n]
    sq = frame * frame
    cs = np.concatenate(([0.0], np.cumsum(sq)))
    total = cs[n]
    taus = np.arange(n)
    m = cs[n - taus] + (total - cs[taus])
    nsdf = 2.0 * acf / np.maximum(m, 1e-12)

    tau_min = max(2, int(sr / FMAX))
    tau_max = min(n - 2, int(sr / FMIN))
    if tau_max <= tau_min:
        return -1.0, 0.0

    # key maxima between positive-going and negative-going zero crossings
    seg = nsdf[tau_min:tau_max]
    peaks = []
    i = 0
    # skip until nsdf goes negative once (past the tau=0 lobe)
    while i < len(seg) and seg[i] > 0:
        i += 1
    while i < len(seg):
        while i < len(seg) and seg[i] <= 0:
            i += 1
        start = i
        while i < len(seg) and seg[i] > 0:
            i += 1
        if start < i:
            k = start + int(np.argmax(seg[start:i]))
            peaks.append(k)
    if not peaks:
        return -1.0, 0.0
    nmax = max(seg[k] for k in peaks)
    if nmax < CLARITY_MIN:
        return -1.0, float(nmax)
    thresh = 0.93 * nmax
    for k in peaks:
        if seg[k] >= thresh:
            tau = k + tau_min
            # parabolic interpolation
            if 1 <= tau < n - 1:
                a, b, c = nsdf[tau - 1], nsdf[tau], nsdf[tau + 1]
                denom = a - 2 * b + c
                if abs(denom) > 1e-12:
                    tau = tau + 0.5 * (a - c) / denom
            freq = sr / tau
            if FMIN <= freq <= FMAX:
                return float(freq), float(min(seg[k], 1.0))
            return -1.0, 0.0
    return -1.0, 0.0


def freq_to_midi(f):
    return 69.0 + 12.0 * np.log2(f / A4)


def midi_to_name(m):
    m = int(round(m))
    return f"{NOTE_NAMES[m % 12]}{m // 12 - 1}"


def track(x, sr):
    """Frame-wise (time, freq, rms_db) arrays."""
    times, freqs, rmsdb = [], [], []
    for start in range(0, len(x) - FRAME, HOP):
        fr = x[start:start + FRAME]
        rms = float(np.sqrt(np.mean(fr * fr)))
        db = 20 * np.log10(rms) if rms > 1e-9 else -120.0
        t = (start + FRAME / 2) / sr
        if db < SILENCE_DB:
            times.append(t); freqs.append(-1.0); rmsdb.append(db)
            continue
        f, _clarity = nsdf_pitch(fr, sr)
        times.append(t); freqs.append(f); rmsdb.append(db)
    return np.array(times), np.array(freqs), np.array(rmsdb)


def segment_notes(times, freqs, rmsdb, sr):
    """Group voiced frames into notes by nearest semitone (gap tolerance 2 frames)."""
    notes = []
    cur = None  # dict with midi, idx list
    gap = 0
    for i, f in enumerate(freqs):
        if f > 0:
            m = freq_to_midi(f)
            nearest = int(round(m))
            if cur is not None and nearest == cur["nearest"]:
                cur["idx"].append(i)
                gap = 0
            else:
                if cur is not None:
                    notes.append(cur)
                cur = {"nearest": nearest, "idx": [i]}
                gap = 0
        else:
            if cur is not None:
                gap += 1
                if gap > 2:
                    notes.append(cur)
                    cur = None
                    gap = 0
    if cur is not None:
        notes.append(cur)

    frame_dt = HOP / sr
    out = []
    for nt in notes:
        idx = nt["idx"]
        dur = len(idx) * frame_dt
        if dur < MIN_NOTE_SEC:
            continue
        fs = freqs[idx]
        cents_dev = 1200.0 * np.log2(fs / (A4 * 2 ** ((nt["nearest"] - 69) / 12.0)))
        rms = rmsdb[idx]
        out.append({
            "start": float(times[idx[0]]),
            "dur": float(dur),
            "midi": nt["nearest"],
            "name": midi_to_name(nt["nearest"]),
            "freq_median": float(np.median(fs)),
            "cents_median": float(np.median(cents_dev)),
            "cents_std": float(np.std(cents_dev)),
            "cents_track": cents_dev.tolist(),
            "rms_db_mean": float(np.mean(rms)),
            "rms_db_std": float(np.std(rms)),
        })
    return out


def detect_vibrato(note, frame_rate):
    """FFT of the detrended cents track; look for a dominant 3.5–9 Hz component."""
    c = np.array(note["cents_track"])
    if len(c) < int(0.4 * frame_rate):
        return None
    t = np.arange(len(c))
    c = c - np.polyval(np.polyfit(t, c, 1), t)
    win = np.hanning(len(c))
    spec = np.abs(np.fft.rfft(c * win))
    fbin = np.fft.rfftfreq(len(c), d=1.0 / frame_rate)
    band = (fbin >= 3.5) & (fbin <= 9.0)
    if not band.any() or spec.sum() < 1e-9:
        return None
    k = np.argmax(np.where(band, spec, 0))
    peak_ratio = spec[k] / spec.sum()
    p2p = float(np.percentile(c, 97) - np.percentile(c, 3))
    if peak_ratio < 0.18 or p2p < 15.0:
        return None
    return {"rate_hz": float(fbin[k]), "extent_cents": p2p / 2.0}


def analyze(path):
    x, sr = load_wav(path)
    times, freqs, rmsdb = track(x, sr)
    notes = segment_notes(times, freqs, rmsdb, sr)
    frame_rate = sr / HOP

    result = {
        "file": path,
        "duration_sec": round(len(x) / sr, 2),
        "sample_rate": sr,
        "a4_hz": A4,
        "n_notes": len(notes),
    }
    if not notes:
        result["error"] = "no notes detected — check recording level / format"
        return result, notes

    devs = np.array([abs(n["cents_median"]) for n in notes])
    result["intonation"] = {
        "mean_abs_cents": round(float(devs.mean()), 1),
        "median_abs_cents": round(float(np.median(devs)), 1),
        "pct_within_10c": round(100.0 * float((devs <= 10).mean()), 1),
        "pct_within_25c": round(100.0 * float((devs <= 25).mean()), 1),
        "worst": [
            {"name": n["name"], "cents": round(n["cents_median"], 1), "t": round(n["start"], 2)}
            for n in sorted(notes, key=lambda n: -abs(n["cents_median"]))[:5]
        ],
    }

    onsets = [n["start"] for n in notes]
    if len(onsets) >= 4:
        ioi = np.diff(onsets)
        med = float(np.median(ioi))
        # fold each IOI to its nearest simple multiple of the median (1x, 2x, 0.5x ...)
        mult = np.maximum(np.round(ioi / med), 1.0)
        folded = ioi / mult
        cv = float(np.std(folded) / np.mean(folded)) if np.mean(folded) > 0 else 0.0
        result["rhythm"] = {
            "n_onsets": len(onsets),
            "median_ioi_sec": round(med, 3),
            "approx_notes_per_min": round(60.0 / med, 0),
            "ioi_cv_pct": round(100.0 * cv, 1),
        }

    vibs = []
    for n in notes:
        v = detect_vibrato(n, frame_rate)
        if v:
            vibs.append(v)
        n.pop("cents_track")
    long_notes = sum(1 for n in notes if n["dur"] >= 0.4)
    result["vibrato"] = {
        "long_notes": long_notes,
        "notes_with_vibrato": len(vibs),
        "avg_rate_hz": round(float(np.mean([v["rate_hz"] for v in vibs])), 1) if vibs else None,
        "avg_extent_cents": round(float(np.mean([v["extent_cents"] for v in vibs])), 1) if vibs else None,
    }

    voiced_rms = rmsdb[freqs > 0]
    stab = np.array([n["rms_db_std"] for n in notes])
    pitch_stab = np.array([n["cents_std"] for n in notes])
    result["tone"] = {
        "dynamic_range_db": round(float(np.percentile(voiced_rms, 95) - np.percentile(voiced_rms, 10)), 1),
        "avg_note_rms_std_db": round(float(stab.mean()), 2),
        "avg_note_pitch_std_cents": round(float(pitch_stab.mean()), 1),
    }
    return result, notes


def print_report(result, notes):
    print("=== Violin Performance Analysis ===")
    print(f"file: {result['file']}")
    print(f"duration: {result['duration_sec']}s @ {result['sample_rate']}Hz | notes detected: {result['n_notes']}")
    if "error" in result:
        print("ERROR:", result["error"])
        return
    i = result["intonation"]
    print(f"\n--- Intonation (vs 12-TET, A4={result['a4_hz']:g}) ---")
    print(f"mean |dev|: {i['mean_abs_cents']}c  median: {i['median_abs_cents']}c")
    print(f"within ±10c: {i['pct_within_10c']}%   within ±25c: {i['pct_within_25c']}%")
    print("worst notes: " + ", ".join(f"{w['name']} {w['cents']:+.1f}c @{w['t']}s" for w in i["worst"]))
    if "rhythm" in result:
        r = result["rhythm"]
        print("\n--- Rhythm ---")
        print(f"onsets: {r['n_onsets']}  median IOI: {r['median_ioi_sec']}s (~{r['approx_notes_per_min']:.0f} notes/min)")
        print(f"IOI unevenness (CV, folded): {r['ioi_cv_pct']}%")
    v = result["vibrato"]
    print("\n--- Vibrato ---")
    if v["notes_with_vibrato"]:
        print(f"{v['notes_with_vibrato']}/{v['long_notes']} long notes, rate {v['avg_rate_hz']}Hz, extent ±{v['avg_extent_cents']}c")
    else:
        print(f"none detected on {v['long_notes']} long notes")
    t = result["tone"]
    print("\n--- Tone / bow steadiness ---")
    print(f"dynamic range: {t['dynamic_range_db']}dB | within-note RMS std: {t['avg_note_rms_std_db']}dB | within-note pitch std: {t['avg_note_pitch_std_cents']}c")
    print("\n--- Notes ---")
    for n in notes:
        print(f"t={n['start']:6.2f}s  {n['name']:<4} {n['freq_median']:7.1f}Hz  {n['cents_median']:+6.1f}c  dur {n['dur']:.2f}s")


def main():
    global A4
    args = []
    as_json = False
    it = iter(sys.argv[1:])
    for a in it:
        if a == "--json":
            as_json = True
        elif a == "--a4":
            A4 = float(next(it, "442"))
        else:
            args.append(a)
    if not args:
        raise SystemExit("usage: analyze_performance.py <file.wav> [--json] [--a4 442]")
    result, notes = analyze(args[0])
    if as_json:
        result["notes"] = notes
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print_report(result, notes)


if __name__ == "__main__":
    main()
