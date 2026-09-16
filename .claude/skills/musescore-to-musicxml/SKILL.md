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

## 经验(2026-09 Tori no Uta 实测)

**SVG 里有精确几何,别只靠看图。** MuseScore 导出的 SVG 每个 `<path>` 带类名
(`Note` `TieSegment` `SlurSegment` `Beam` `Accidental` `Rest` `Dynamic` `StaffText`
`TimeSig` `KeySig` `BarLine` `StaffLines` ...),用
`python3.13 <skill>/scripts/svg_geometry.py page_NN.svg geo_NN.json` 拿到每个图元的
包围盒,然后:
- 符头按谱表(StaffLines 每 5 条一组)分组、按 x 排序,与 MIDI 音符顺序一一对齐;
  符头 y 相对中线换算音级,可 100% 校验同音异名拼写(本例"升号方向"规则零错位)。
- `TieSegment` 与 `SlurSegment` 类名直接区分延音线/连线;弧线左右端点对到最近符头。
  同音高的弧连的符头就是"谱面把一个音写成两个连音符头"(MIDI 里是一个音),要按图拆分。
  跨行/跨页的延音线是两段,右端无符头即接下一行第一个符头。
- `Beam` 子路径按 x 重叠聚成组 → 每组覆盖哪些符头 = 谱面符杠分组;music21 默认按拍分
  组,MuseScore 默认八分按半拍组、十六分按拍组,不一致时以图为准,手动设 `note.beams`
  并置 `streamStatus.beams=True`。
- 变音记号/力度/文字按 x 找右侧最近符头定位到小节与拍。
- 起拍小节:music21 用 `Measure.paddingLeft`,导出后手动把 `implicit="no"` 改 `"yes"`。
- `part.makeAccidentals(inPlace=True, cautionaryNotImmediateRepeat=False)` 才和
  MuseScore 的显示规则一致。
- 本机有 `/opt/homebrew/bin/mscore`(MuseScore 4):`mscore -o out.png in.musicxml` 可
  渲染成 PNG 与原谱逐页对比(输出 out-1.png…,10200×13200 透明底,先缩放再看)。
- 没有 `mido`,解析 MIDI 元事件用 `music21.midi.MidiFile`(事件 type 是数字:0x58 拍号
  0x59 调号 0x51 速度)。
