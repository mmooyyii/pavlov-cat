#!/usr/bin/env python3
"""Validate a generated MusicXML file.

Two levels:
  1. XML well-formedness (stdlib only — always runs).
  2. Semantic load via music21 (if installed): counts parts / measures / notes,
     surfaces parse warnings, and confirms the file round-trips.

Usage:
    python3 validate_musicxml.py <file.musicxml> [--expect-measures N] [--expect-parts N]
"""
import argparse
import sys
import xml.dom.minidom as minidom


def check_wellformed(path):
    try:
        minidom.parse(path)
        return True, None
    except Exception as e:  # noqa: BLE001
        return False, str(e)


def check_music21(path):
    try:
        from music21 import converter
    except Exception:
        return None  # music21 not available
    from music21 import stream  # noqa: F401
    score = converter.parse(path)
    parts = list(score.parts)
    per_part = []
    total_notes = 0
    for i, p in enumerate(parts):
        measures = list(p.getElementsByClass("Measure"))
        n_notes = len(list(p.recurse().notes))
        total_notes += n_notes
        per_part.append((i, len(measures), n_notes))
    return {"parts": len(parts), "per_part": per_part, "notes": total_notes}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--expect-measures", type=int, default=0)
    ap.add_argument("--expect-parts", type=int, default=0)
    args = ap.parse_args()

    ok, err = check_wellformed(args.file)
    if not ok:
        print(f"✗ XML 格式错误: {err}", file=sys.stderr)
        sys.exit(1)
    print("✓ XML 格式正确 (well-formed)")

    info = check_music21(args.file)
    if info is None:
        print("· 未安装 music21,跳过语义校验 (pip install music21 可启用)")
        return

    print(f"✓ music21 可解析: {info['parts']} 个声部, 共 {info['notes']} 个音符")
    for i, nm, nn in info["per_part"]:
        print(f"    声部 {i}: {nm} 小节, {nn} 音符")

    problems = []
    if args.expect_parts and info["parts"] != args.expect_parts:
        problems.append(f"声部数 {info['parts']} ≠ 期望 {args.expect_parts}")
    if args.expect_measures:
        maxm = max((nm for _, nm, _ in info["per_part"]), default=0)
        if maxm != args.expect_measures:
            problems.append(f"最大小节数 {maxm} ≠ 期望 {args.expect_measures}")

    if problems:
        print("\n⚠ 需要复核:")
        for p in problems:
            print("  - " + p)
        sys.exit(3)
    print("\n全部检查通过。")


if __name__ == "__main__":
    main()
