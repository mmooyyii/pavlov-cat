---
name: musescore-to-musicxml
description: Convert downloaded MuseScore assets (page images + MIDI) into MusicXML via AI vision OMR fused with MIDI ground-truth. Manual only — invoke with /musescore-to-musicxml.
disable-model-invocation: true
---

# MuseScore assets → MusicXML

Parse locally-downloaded MuseScore pages + MIDI into a MusicXML score. Nothing
here hits the network (musescore.com is behind Cloudflare) — the companion
Tampermonkey userscript downloads the assets as `~/Downloads/musescore-dl_*.zip`.
The userscript lives at `<skill>/musescore-dl.user.js`; if no zip is found (or
the user hasn't set it up), tell them to install that file into Tampermonkey,
then click the "⬇ 下载谱面素材" button on the musescore.com score page.

**Tools:** use **`python3.13`** (has `music21`); `rsvg-convert` for SVG raster.
**Disk hygiene:** all intermediates live in a temp workdir that you delete at the
end (step 8). The ONLY lasting write is the final `.musicxml`.

**Fidelity:** pitch, rhythm, tempo, key/time, parts come from the MIDI (high
confidence). Slurs, dynamics, articulations, beaming, lyrics, layout are inferred
from the images and may be incomplete — always tell the user what was inferred.

## Procedure

**1. Stage.** `python3.13 <skill>/scripts/prepare_input.py "$ARG"` (`$ARG`
optional → newest `~/Downloads/musescore-dl_*.zip`). Parse the JSON on its last
stdout line: keep `workdir`, `output`, `title`, `pages`, `hasMidi`. Read
`workdir/score-info.json` for expected measures/key/tempo.

**2. Rasterize** (if pages are SVG): `python3.13 <skill>/scripts/rasterize_svg.py "$workdir" --scale 2.0`
→ PNGs in the workdir. (Needs `rsvg-convert` or `pip install cairosvg`.)

**3. MIDI truth:** `python3.13 <skill>/scripts/midi_to_notes.py "$workdir/score.mid" --out "$workdir/midi_notes.json"`.
Read it — per-part/measure exact pitches, offsets, durations, ties, tempo, time,
key. Authoritative for pitch + rhythm.

**4. Read pages.** Read each `workdir/page_NN.png`. Note clef, key, time, and the
markings MIDI lacks: slurs/ties, articulations, dynamics, tempo text, repeats,
voices, lyrics.

**5. Transcribe (fusion).** Per measure: pitches/durations from `midi_notes.json`;
use the image for clef/octave, enharmonic spelling matching the key, voices,
slurs, dynamics. For a clean quantized MIDI (MuseScore's own), the fastest solid
backbone is a music21 render:
```
python3.13 - <<'PY'
from music21 import converter, instrument, metadata
s = converter.parse("WORKDIR/score.mid", quantizePost=True)
for p in s.parts: p.partName="INSTR"; p.insert(0, instrument.fromString("INSTR"))
s.insert(0, metadata.Metadata()); s.metadata.title="TITLE"
# respell sharps->flats when key has flats:
for n in s.recurse().notes:
    for pt in (n.pitches if n.isChord else [n.pitch]):
        if pt.accidental and pt.accidental.alter==1:
            e=pt.getEnharmonic(); pt.step,pt.octave,pt.accidental=e.step,e.octave,e.accidental
s.write("musicxml", fp="OUTPUT")
PY
```
Then diff against the images and fix spelling/rhythm outliers. Cross-check the
measure count against `score-info.json` / the last page's final barline.

**6. MusicXML rules.** `divisions` = LCM so every `quarterLength` is integer
(`duration=round(ql*divisions)`); map MIDI `sharps`→`<fifths>`; spell
step/alter/octave to match both the sounding pitch and the key; multiple voices →
`<voice>`+`<backup>`; add `<tie>`/`<slur>`/`<dynamics>`/`<lyric>` from images.

**7. Validate.** `python3.13 <skill>/scripts/validate_musicxml.py "$output" --expect-measures N --expect-parts N`. Fix any errors.

**8. Report & clean up.** Tell the user the `output` path, measures/parts/notes,
what's MIDI-certain vs image-inferred, and any conflicts. Then `rm -rf "$workdir"`
(leave the source zip). 

Notes: no MIDI → OMR from images alone, lower accuracy (say so). Dense scores →
transcribe in small chunks. This is assistive OMR: deliver a solid first pass plus
a list of what to double-check.
