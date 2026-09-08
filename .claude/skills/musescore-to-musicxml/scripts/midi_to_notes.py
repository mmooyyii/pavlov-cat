#!/usr/bin/env python3
"""Dump the MIDI as structured, measure-indexed note data — the ground truth.

The MIDI carries exact pitches, onsets, durations, tempo and track split. Vision
OMR on the page images is unreliable for those. So the transcription strategy is:
use THIS output as the authority for pitch + rhythm, and use the page images for
notation the MIDI lacks (clef, key signature, beaming, slurs, articulation,
dynamics, lyrics, voices, repeats).

Usage:
    python3 midi_to_notes.py <score.mid> [--out notes.json] [--max-measures N]

Prints a JSON summary to stdout (and to --out if given).
Requires music21:  pip install music21
"""
import argparse
import json
import sys


def load_music21():
    try:
        from music21 import converter, tempo, meter, key, note, chord  # noqa: F401
        return converter
    except Exception:
        print("需要 music21:  pip install music21", file=sys.stderr)
        sys.exit(2)


def note_entry(el):
    """Serialize a Note / Chord / Rest."""
    from music21 import note, chord
    ql = round(float(el.duration.quarterLength), 4)
    off = round(float(el.offset), 4)
    if isinstance(el, note.Rest):
        return {"type": "rest", "offset": off, "ql": ql}
    if isinstance(el, chord.Chord):
        return {
            "type": "chord",
            "offset": off,
            "ql": ql,
            "pitches": [{"name": p.nameWithOctave, "midi": p.midi} for p in el.pitches],
        }
    # Note
    return {
        "type": "note",
        "offset": off,
        "ql": ql,
        "name": el.pitch.nameWithOctave,
        "midi": el.pitch.midi,
        "tie": el.tie.type if el.tie else None,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("midi")
    ap.add_argument("--out")
    ap.add_argument("--max-measures", type=int, default=0,
                    help="limit measures per part in output (0 = all)")
    args = ap.parse_args()

    converter = load_music21()
    from music21 import tempo, meter, key

    score = converter.parse(args.midi)

    # Global markings.
    tempos = []
    for mm in score.recurse().getElementsByClass(tempo.MetronomeMark):
        tempos.append({"offset": round(float(mm.offset), 4), "bpm": mm.number})
    tsigs = []
    for ts in score.recurse().getElementsByClass(meter.TimeSignature):
        tsigs.append({"offset": round(float(ts.offset), 4), "sig": ts.ratioString})
    keys = []
    for k in score.recurse().getElementsByClass(key.KeySignature):
        keys.append({"offset": round(float(k.offset), 4), "sharps": k.sharps})

    parts_out = []
    for i, part in enumerate(score.parts):
        # Ensure measures exist for indexing.
        try:
            mparts = part.makeMeasures(inPlace=False)
        except Exception:
            mparts = part
        measures = list(mparts.getElementsByClass("Measure"))
        inst = part.getInstrument(returnDefault=True)
        pdata = {
            "index": i,
            "instrument": getattr(inst, "instrumentName", None) or getattr(inst, "partName", None),
            "measureCount": len(measures),
            "measures": [],
        }
        if measures:
            for m in measures:
                if args.max_measures and m.measureNumber and m.measureNumber > args.max_measures:
                    break
                notes = [note_entry(e) for e in m.notesAndRests]
                pdata["measures"].append({"n": m.measureNumber, "events": notes})
        else:
            # No measure structure — emit a flat event stream with offsets.
            pdata["measures"] = [{
                "n": None,
                "events": [note_entry(e) for e in part.recurse().notesAndRests],
            }]
        parts_out.append(pdata)

    summary = {
        "file": args.midi,
        "tempos": tempos,
        "timeSignatures": tsigs,
        "keySignatures": keys,
        "highestTime_quarters": round(float(score.highestTime), 4),
        "parts": parts_out,
    }

    text = json.dumps(summary, ensure_ascii=False, indent=2)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"已写入 {args.out} "
              f"({len(parts_out)} 部分, "
              f"{sum(p['measureCount'] for p in parts_out)} 小节合计)")
    else:
        print(text)


if __name__ == "__main__":
    main()
