#!/usr/bin/env python3
"""Rasterize MuseScore page SVGs to high-resolution PNG for vision OMR.

Claude's Read tool can view PNG but not SVG, so every page_*.svg must become a
PNG before transcription. Tries several backends in order and reports which one
worked.

Usage:
    python3 rasterize_svg.py <dir-or-file> [--scale 2.0]

- <dir>  : rasterize every *.svg in the directory (skips ones already done)
- <file> : rasterize that single .svg
Output PNGs sit next to the SVGs (page_00.svg -> page_00.png).
"""
import argparse
import os
import shutil
import subprocess
import sys


def find_svgs(path):
    if os.path.isfile(path):
        return [path]
    return sorted(
        os.path.join(path, f) for f in os.listdir(path) if f.lower().endswith(".svg")
    )


def out_png(svg):
    return os.path.splitext(svg)[0] + ".png"


def via_cairosvg(svg, png, scale):
    try:
        import cairosvg  # type: ignore
    except Exception:
        return False, "cairosvg-not-installed"
    try:
        cairosvg.svg2png(url=svg, write_to=png, scale=scale)
        return True, "cairosvg"
    except Exception as e:  # noqa: BLE001
        return False, f"cairosvg-error: {e}"


def via_cli(tool, svg, png, scale):
    """rsvg-convert / resvg / inkscape fallbacks."""
    exe = shutil.which(tool)
    if not exe:
        return False, f"{tool}-not-found"
    try:
        if tool == "rsvg-convert":
            cmd = [exe, "-z", str(scale), "-o", png, svg]
        elif tool == "resvg":
            cmd = [exe, "--zoom", str(scale), svg, png]
        elif tool == "inkscape":
            cmd = [exe, svg, "--export-type=png", f"--export-filename={png}",
                   f"--export-dpi={int(96 * scale)}"]
        else:
            return False, f"unknown-tool-{tool}"
        subprocess.run(cmd, check=True, capture_output=True)
        return os.path.exists(png), tool
    except subprocess.CalledProcessError as e:  # noqa: BLE001
        return False, f"{tool}-error: {e.stderr.decode(errors='ignore')[:200]}"


def rasterize_one(svg, scale):
    png = out_png(svg)
    for backend in (
        lambda: via_cairosvg(svg, png, scale),
        lambda: via_cli("rsvg-convert", svg, png, scale),
        lambda: via_cli("resvg", svg, png, scale),
        lambda: via_cli("inkscape", svg, png, scale),
    ):
        ok, how = backend()
        if ok:
            return png, how
    return None, "no-backend"


HELP = """
无法栅格化 SVG:没有可用的转换后端。任选其一安装:

  # 最省事(纯 Python,推荐):
  pip install cairosvg
  # 若 cairosvg 报缺少 libcairo:
  brew install cairo pango           # macOS

  # 或用命令行工具:
  brew install librsvg               # 提供 rsvg-convert
  brew install --cask inkscape       # 提供 inkscape
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path", help="directory of SVGs or a single .svg file")
    ap.add_argument("--scale", type=float, default=2.0,
                    help="raster scale factor (default 2.0 ≈ 192 dpi)")
    args = ap.parse_args()

    svgs = find_svgs(args.path)
    if not svgs:
        print(f"没有找到 SVG:{args.path}", file=sys.stderr)
        sys.exit(2)

    done, failed = [], []
    for svg in svgs:
        png = out_png(svg)
        if os.path.exists(png) and os.path.getmtime(png) >= os.path.getmtime(svg):
            done.append((svg, png, "cached"))
            continue
        out, how = rasterize_one(svg, args.scale)
        (done if out else failed).append((svg, out, how))
        print(f"{'OK ' if out else 'ERR'} {os.path.basename(svg)} -> "
              f"{os.path.basename(out) if out else how}")

    if failed:
        print(HELP, file=sys.stderr)
        sys.exit(1)
    print(f"\n共 {len(done)} 个 PNG 就绪:{os.path.dirname(os.path.abspath(svgs[0]))}")


if __name__ == "__main__":
    main()
