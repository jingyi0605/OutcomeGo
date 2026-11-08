#!/usr/bin/env python3
"""Build the README attention diagrams (SVG + PNG) for every language in labels.json.

Edit docs/images/attention/labels.json to change text or add a language, then run:

    python3 -I scripts/branding/build-attention-diagrams.py

Needs rsvg-convert (librsvg) for PNG output and a font with CJK glyphs for zh.
"""
import json
import subprocess
import sys
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs/images/attention"
LABELS = json.loads((OUT / "labels.json").read_text(encoding="utf-8"))

FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Noto Sans CJK SC', 'Microsoft YaHei', Helvetica, Arial, sans-serif"
BG = "#fcfcfc"
INK = "#1f2328"
MUTED = "#59636e"
LINE = "#9aa4b2"
BLUE_F, BLUE_S, BLUE_T = "#dbeafe", "#7aa7d8", "#13406e"
ORG_F, ORG_S, ORG_T = "#fde6da", "#d9825f", "#7a2f14"
GRN_F, GRN_S, GRN_T = "#e3f3e6", "#7fb88a", "#1f5a2c"
TEAL_F, TEAL_S = "#e8f1f8", "#c2d6e8"


def fit(text, size, maxw):
    """Shrink font size so the text fits maxw; CJK glyphs are about twice as wide as Latin."""
    if not maxw:
        return size
    units = sum(1.0 if ord(c) > 0x2E80 else 0.54 for c in text)
    return min(size, int(maxw / units)) if units else size


def t(x, y, text, size=24, fill=INK, weight=400, anchor="middle", maxw=None):
    size = fit(text, size, maxw)
    return (f'<text x="{x}" y="{y}" font-size="{size}" fill="{fill}" font-weight="{weight}" '
            f'text-anchor="{anchor}">{escape(text)}</text>')


def box(x, y, w, h, fill, stroke, r=22, sw=3):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>'


def svg(w, h, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" '
            f'font-family="{FONT}"><rect width="{w}" height="{h}" fill="{BG}"/>{body}</svg>\n')


def arrow(x, y1, y2, color=LINE):
    return (f'<line x1="{x}" y1="{y1}" x2="{x}" y2="{y2 - 8}" stroke="{color}" stroke-width="3"/>'
            f'<path d="M{x - 9} {y2 - 14} L{x} {y2 - 2} L{x + 9} {y2 - 14}" fill="none" stroke="{color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>')


def bottleneck(L):
    w, h = 1500, 900
    b = []
    n = len(L["roles"])
    bw, gap, x0 = 250, 42, 45
    centers = []
    for i, role in enumerate(L["roles"]):
        x = x0 + i * (bw + gap)
        b.append(box(x, 48, bw, 150, BLUE_F, BLUE_S))
        b.append(t(x + bw / 2, 108, L["agent"], 40, BLUE_T))
        b.append(t(x + bw / 2, 164, role, 36, BLUE_T, maxw=bw - 40))
        centers.append(x + bw / 2)
    for cx in centers:
        b.append(f'<line x1="{cx}" y1="198" x2="750" y2="372" stroke="{LINE}" stroke-width="6" stroke-linecap="round"/>')
    b.append(box(515, 374, 470, 186, ORG_F, ORG_S, 36, 5))
    b.append(t(750, 448, L["center"], 52, ORG_T, 700, maxw=420))
    b.append(t(750, 516, L["centerSub"], 34, ORG_T, maxw=420))
    b.append(arrow(750, 562, 658))
    b.append(box(380, 664, 740, 118, GRN_F, GRN_S, 30, 4))
    b.append(t(750, 740, L["bottom"], 46, GRN_T, 600, maxw=680))
    b.append(t(750, 852, L["caption"], 30, MUTED))
    return svg(w, h, "".join(b))


def allocation(L):
    w, h = 1520, 450
    b = [box(2, 2, w - 4, h - 4, BG, "#e5e7eb", 30, 2)]
    b.append(t(24, 62, L["title"], 34, INK, 700, "start"))
    bw = max(150, int(sum(26 if ord(c) > 0x2E80 else 13.5 for c in L["badge"]) + 44))
    b.append(f'<rect x="{w - 24 - bw}" y="30" width="{bw}" height="44" rx="22" fill="#f0f0f0"/>')
    b.append(t(w - 24 - bw / 2, 61, L["badge"], 24, INK))
    rows = [(L["rows"][0], 1, "#2877cc"), (L["rows"][1], 2, "#e7b96e"), (L["rows"][2], 5, "#79b89b")]
    y = 140
    for row, segs, color in rows:
        b.append(t(24, y, row["label"], 28, INK, 400, "start"))
        b.append(t(w - 24, y, row["value"], 28, INK, 400, "end"))
        total, gapw = w - 48, 10
        sw = (total - gapw * (segs - 1)) / segs
        for i in range(segs):
            b.append(f'<rect x="{24 + i * (sw + gapw)}" y="{y + 22}" width="{sw}" height="26" rx="13" fill="{color}"/>')
        y += 112
    return svg(w, h, "".join(b))


def control_plane(L):
    w, h = 1520, 1130
    b = []
    n = len(L["sources"])
    colw = w / n
    for i, s in enumerate(L["sources"]):
        cx = colw * i + colw / 2
        b.append(box(cx - 200, 40, 400, 120, "#ffffff", "#d0d7de", 22, 2))
        b.append(t(cx, 98, s["t"], 30, INK, 600, maxw=370))
        b.append(t(cx, 138, s["s"], 22, MUTED, maxw=370))
    b.append(arrow(w / 2, 168, 238))
    b.append(box(16, 244, w - 32, 842, "none", "#8fb0d0", 36, 3).replace('fill="none"', 'fill="none" stroke-dasharray="14 10"'))
    b.append(t(w / 2, 292, L["frame"], 26, "#2c5d8a", 600))
    ys = [330, 520, 710, 900]
    fills = [("#ffffff", "#d0d7de"), (TEAL_F, TEAL_S), ("#ecf4ef", "#cfe3d6"), ("#ffffff", "#d0d7de")]
    for i, (layer, y) in enumerate(zip(L["layers"], ys)):
        f, s = fills[i]
        b.append(box(40, y, w - 80, 150, f, s, 28, 2))
        b.append(t(w / 2, y + 62, layer["t"], 36, INK, 700))
        b.append(t(w / 2, y + 112, layer["s"], 24, MUTED, maxw=w - 140))
        if i < len(ys) - 1:
            b.append(arrow(w / 2, y + 150, ys[i + 1], "#8a8f98"))
    return svg(w, h, "".join(b))


def layers(L):
    w, h = 1520, 1300
    b = []
    b.append(box(16, 16, w - 32, 170, TEAL_F, TEAL_S, 30, 2))
    b.append(t(w / 2, 92, L["entry"]["t"], 40, INK, 700))
    b.append(t(w / 2, 148, L["entry"]["s"], 26, MUTED, maxw=w - 140))
    b.append(arrow(w / 2, 190, 262, "#8a8f98"))
    b.append(box(16, 268, w - 32, 150, "#ffffff", "#d9dee4", 28, 2))
    b.append(t(w / 2, 340, L["coordinator"]["t"], 36, INK, 700))
    b.append(t(w / 2, 390, L["coordinator"]["s"], 24, MUTED, maxw=w - 140))
    b.append(arrow(w / 2, 422, 486, "#8a8f98"))
    b.append(box(16, 492, w - 32, 372, "none", "#8fb0d0", 34, 3).replace('fill="none"', 'fill="none" stroke-dasharray="14 10"'))
    b.append(t(w / 2, 536, L["frame"], 24, "#2c5d8a", 600))
    sv = L["services"]
    cols = [w * 0.25, w * 0.75]
    rows_y = [610, 760]
    for i, s in enumerate(sv):
        cx, cy = cols[i % 2], rows_y[i // 2]
        b.append(t(cx, cy, s["t"], 32, INK, 700, maxw=680))
        b.append(t(cx, cy + 40, s["s"], 22, MUTED, maxw=680))
    b.append(arrow(w / 2, 868, 960, "#8a8f98"))
    b.append(box(16, 966, w - 32, 190, "#ffffff", "#d9dee4", 28, 2))
    b.append(t(w / 2, 1022, L["execution"]["t"], 34, INK, 700))
    items = L["execution"]["items"]
    for i, it in enumerate(items):
        b.append(t(w * (i + 0.5) / len(items), 1100, it, 26, INK, maxw=420))
    b.append(arrow(w / 2, 1160, 1214, "#8a8f98"))
    b.append(t(w / 2, 1262, L["adapters"]["t"], 34, INK, 700))
    b.append(t(w / 2, 1296, L["adapters"]["s"], 22, MUTED, maxw=w - 100))
    return svg(w, h + 20, "".join(b))


BUILDERS = {
    "attention-bottleneck": ("bottleneck", bottleneck),
    "attention-allocation": ("allocation", allocation),
    "work-control-plane": ("controlPlane", control_plane),
    "architecture-layers": ("layers", layers),
}


def main():
    for lang, data in LABELS.items():
        for stem, (key, fn) in BUILDERS.items():
            name = f"{stem}.{lang}"
            svg_path = OUT / f"{name}.svg"
            svg_path.write_text(fn(data[key]), encoding="utf-8")
            subprocess.run(["rsvg-convert", "-w", "1500", "-o", str(OUT / f"{name}.png"), str(svg_path)], check=True)
            print("wrote", name)


if __name__ == "__main__":
    sys.exit(main())
