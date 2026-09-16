#!/usr/bin/env python3
"""Stage MuseScore assets into a throwaway temp workdir.

Disk hygiene: nothing is written to the user's real folders. The zip is read
and extracted into a fresh temp directory under the system tmp dir; all
intermediate artifacts (rasterized PNGs, midi_notes.json) also live there. The
skill deletes the workdir at the very end — the ONLY lasting write is the final
.musicxml.

Precedence for the source:
  1. arg is a directory  -> copy its assets into the temp workdir (original
                            folder is left untouched).
  2. arg is a .zip       -> extract into the temp workdir.
  3. no arg              -> newest ~/Downloads/musescore-dl_*.zip, extracted.

Prints progress to stderr and, as the LAST stdout line, a JSON object:
  {"workdir": "...", "source": "...", "title": "...",
   "output": "<suggested .musicxml path>", "pages": N, "hasMidi": bool}

Usage:
    python3 prepare_input.py [path-or-zip]
"""
import glob
import json
import os
import shutil
import sys
import tempfile
import zipfile

PREFIX_GLOB = os.path.expanduser("~/Downloads/musescore-dl_*.zip")
SCORES_DIR = os.path.expanduser(
    "~/Library/Mobile Documents/com~apple~CloudDocs/Documents/MuseScore4/Scores")
ASSET_SUFFIXES = (".svg", ".png", ".mid", ".midi", ".json")


def newest_download():
    matches = glob.glob(PREFIX_GLOB)
    return max(matches, key=os.path.getmtime) if matches else None


def title_from(workdir, source):
    info = os.path.join(workdir, "score-info.json")
    if os.path.isfile(info):
        try:
            with open(info, encoding="utf-8") as f:
                t = json.load(f).get("title")
            if t:
                return t
        except Exception:
            pass
    base = os.path.basename(source.rstrip("/"))
    base = base[:-4] if base.lower().endswith(".zip") else base
    return base.replace("musescore-dl_", "") or "score"


def stage(arg):
    workdir = tempfile.mkdtemp(prefix="musescore-mxl-")

    if arg:
        arg = os.path.expanduser(arg)
        if os.path.isdir(arg):
            source = arg
            for name in os.listdir(arg):
                if name.lower().endswith(ASSET_SUFFIXES):
                    shutil.copy2(os.path.join(arg, name), os.path.join(workdir, name))
            print(f"已把 {os.path.basename(arg)} 的素材拷入临时目录(原目录不动)", file=sys.stderr)
        elif arg.lower().endswith(".zip") and os.path.isfile(arg):
            source = arg
            with zipfile.ZipFile(arg) as z:
                z.extractall(workdir)
            print(f"已在内存读取并解压 {os.path.basename(arg)} 到临时目录", file=sys.stderr)
        else:
            shutil.rmtree(workdir, ignore_errors=True)
            print(f"路径不存在或不是 目录/.zip: {arg}", file=sys.stderr)
            sys.exit(2)
    else:
        z = newest_download()
        if not z:
            shutil.rmtree(workdir, ignore_errors=True)
            print(f"在 {PREFIX_GLOB} 没找到 zip。\n"
                  f"请先用油猴脚本在 musescore 曲谱页点「⬇ 下载谱面素材」,"
                  f"或把文件夹/zip 路径作为参数传入。", file=sys.stderr)
            sys.exit(2)
        source = z
        print(f"自动选中最近的下载: {os.path.basename(z)}", file=sys.stderr)
        with zipfile.ZipFile(z) as zf:
            zf.extractall(workdir)
        print("已解压到临时目录", file=sys.stderr)

    return workdir, source


def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else None
    workdir, source = stage(arg)

    files = sorted(os.listdir(workdir))
    pages = [f for f in files if f.startswith("page_")]
    has_midi = any(f.lower().endswith((".mid", ".midi")) for f in files)
    title = title_from(workdir, source)

    # Output goes to the MuseScore 4 iCloud score library (where the user keeps
    # all scores). Fall back to the source directory if that library is absent.
    src_dir = os.path.dirname(os.path.abspath(source if os.path.isfile(source) else source))
    out_dir = SCORES_DIR if os.path.isdir(SCORES_DIR) else src_dir
    safe_title = "".join(c for c in title if c not in '\\/:*?"<>|').strip() or "score"
    output = os.path.join(out_dir, safe_title + ".musicxml")

    print(f"临时目录: {workdir}", file=sys.stderr)
    print(f"页面 {len(pages)} 张, MIDI {'有' if has_midi else '无'}, 建议成品: {output}", file=sys.stderr)

    print(json.dumps({
        "workdir": workdir,
        "source": os.path.abspath(source),
        "title": title,
        "output": output,
        "pages": len(pages),
        "hasMidi": has_midi,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
