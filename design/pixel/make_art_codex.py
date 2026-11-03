#!/usr/bin/env python3
"""Original hand-placed pixel art for an Emerald fan portal.

Edit the ASCII grids and palettes below, then run: python3 make_art.py
One character is one pixel; '.' is transparent. Each SVG uses the grid's
native viewBox and combines adjacent pixels of the same color into runs.
Only the Python 3 standard library is used. No external assets are loaded.
"""

from pathlib import Path
from xml.sax.saxutils import quoteattr
import json

# All grids are stored at their exact native dimensions.
SPRITES = {
    'treecko': {
        "size": (24, 24),
        "palette": {
            'o': '#10231b',
            'g': '#55b951',
            'l': '#96dd68',
            's': '#318949',
            't': '#236941',
            'v': '#3f9650',
            'd': '#184d37',
            'Y': '#f5d85b',
            'y': '#c99e39',
            'p': '#19352a',
            'r': '#df6454',
            'R': '#ad403f',
        },
        "grid": """\
........................
..............oooooo....
.............oggggggo...
............ogllllgggo..
............oglllgYYYgo.
............oglllgYpYgo.
...oo.......ogggggYpYgo.
..otvo......oggggggYgggo
.otvvto......ogggggggggo
.otvvtto......ogsgooooo.
otvvvttdo.....ogsgo.....
otvovttdo....ogggrgo....
otvovttdo...ogglrrgo....
otvovttdo..ogggrrrggooo.
otvvvttdoooggsgrrgglllo.
.otvvttdttsgsgrrsooooo..
.ottttddtssggrrrso......
..ottdddoooggRrrso......
...ooooo..oggsRrso......
..........ogssoosgo.....
.........ogso..osggo....
........ogglo...osglo...
........ooooo...ooooo...
........................
""",
    },
    'torchic': {
        "size": (24, 24),
        "palette": {
            'o': '#10231b',
            'a': '#ef963e',
            'b': '#c96932',
            'h': '#ffd06b',
            'y': '#f9d65e',
            's': '#dba742',
            'w': '#fff2c4',
            'e': '#23352a',
            'k': '#eaba59',
            't': '#bb853b',
        },
        "grid": """\
........................
..........oo...oo.......
.........oyyo.oyyo......
.........oyyoo.yso......
..........oyyyysso......
.........ooayyysoo......
........oahhaaaao.......
.......oahhhaaaaao......
.......ohhhaaaawaao.....
......oahhaaaaaeeao.....
......oahhaaaaaeeaooo...
......oaaaaaaaaaoykko...
.......oaaaaaaaabooo....
......ooahaaabbbbbo.....
.....ohaahaaabbbbbo.....
....oaaoaaaabbbbbao.....
....obaoaaaabbbbaao.....
.....oobaaaaaaaabo......
.......obbaaaabbo.......
........ooobbooo........
.........otko.otko......
........okkko.okkko.....
........ooooo.ooooo.....
........................
""",
    },
    'mudkip': {
        "size": (24, 24),
        "palette": {
            'o': '#10231b',
            'b': '#4daede',
            'h': '#91d8ef',
            's': '#2c78b4',
            'f': '#3c8cc5',
            'a': '#f4a45a',
            'c': '#cd733d',
            'w': '#f5f1d5',
            'v': '#c9dce0',
            'e': '#1d3440',
        },
        "grid": """\
........................
.............oo.........
............ohbo........
............ohbbo.......
............ohbsbo......
............obssbo......
...........ooobbso......
..........obhhbbbboo....
..ooo....obhhhbbbbbbo...
.ohhbo..obhhbbbbbwbbbo..
.ohhbbo.obhbbbbbbeeabbo.
.ohbbsboobhbbbbbbeeaco..
.ohbbssoobhbbbbbbbboaco.
..ohbssoobbbbbbbooaacco.
..ohbssobbbbbbbboaccco..
...obsobbbbwwwwbboaco...
....oobbbwwwwwwwbooo....
.....obbbwwwwwwvbbo.....
.....obbbwvvvvvbsbo.....
......obbboooobbbbo.....
......obhbo...obhbo.....
.....obhbbo..obhbbo.....
.....oooooo..oooooo.....
........................
""",
    },
    'pokeball': {
        "size": (12, 12),
        "palette": {
            'o': '#10231b',
            'r': '#df4e4b',
            's': '#ac343d',
            'h': '#ff9990',
            'w': '#fff6dd',
            'v': '#b8c9c5',
        },
        "grid": """\
....oooo....
..oorrrroo..
.orhrrrrrro.
.orwrrrrrso.
orrrroorrsso
ooooowwooooo
ooooowvooooo
ovvvvoovvvvo
.ovwwwwwvvo.
.ovwwwwwvvo.
..oowwwvoo..
....oooo....
""",
    },
    'emerald': {
        "size": (12, 12),
        "palette": {
            'o': '#10231b',
            'd': '#17633f',
            'g': '#28995a',
            'l': '#62d786',
            'h': '#b7f59d',
            'w': '#fffbe0',
        },
        "grid": """\
.....w......
...oooo.....
..ohlllooo..
.ohhllglgdo.
ohhllgglgddo
olllggglgddo
.olgggglgdo.
..olgglgdo..
...olgddo...
....oddo....
.....oo..w..
............
""",
    },
    'rayquaza': {
        "size": (48, 16),
        "palette": {
            'o': '#10231b',
            'g': '#4aaa65',
            'G': '#25754d',
            'y': '#e6cc62',
            'r': '#e3825d',
            'e': '#183a2b',
        },
        "grid": """\
................................................
..........oooooooo....................oo...oo...
........ooGGGGGGGoo..................oGo..oGo...
.......oGgggyygggGoo................oGgo.oGgo...
......oGgggyGyggggGo...............oGgGooooGgGo.
.....oGgGooGGyggggGo..............oGggggggggGGo.
....oGgGo..oooGggggGo............oGgggyyggreggGo
...oGgGo......oGgggyGo..........oGgggyGygggGooo.
.ooGgGo........oGggyGyGo.......oGgggyyggGoo.....
oGGgGo..........oGgggyGgGo....oGgggGooooGo......
.oooo............oGggggggGoo.oGggGoooGgGo.......
..................ooGgggyyggGooGggGo.oGGo.......
....................ooGggyGGygggggGoo.oo........
......................ooGGyyggggGGoo............
........................oooooooooo..............
................................................
""",
    },
}


def validate(name, sprite):
    width, height = sprite["size"]
    rows = sprite["grid"].splitlines()
    palette = sprite["palette"]
    if len(rows) != height or any(len(row) != width for row in rows):
        raise ValueError(f"{name}: grid must be exactly {width}x{height}")
    unknown = set("".join(rows)) - set(palette) - {"."}
    if unknown:
        raise ValueError(f"{name}: undefined palette symbols: {unknown}")
    for color in palette.values():
        if (len(color) != 7 or color[0] != "#"
                or any(c not in "0123456789abcdefABCDEF" for c in color[1:])):
            raise ValueError(f"{name}: invalid RGB color {color!r}")
        if color.lower() == "#000000":
            raise ValueError(f"{name}: use a colored dark outline, never pure black")
    return rows


def svg_for(name, sprite, rows):
    width, height = sprite["size"]
    palette = sprite["palette"]
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" shape-rendering="crispEdges">',
        f'  <title>{name.capitalize()} — original pixel art</title>',
    ]
    for y, row in enumerate(rows):
        x = 0
        while x < width:
            symbol = row[x]
            end = x + 1
            while end < width and row[end] == symbol:
                end += 1
            if symbol != ".":
                fill = quoteattr(palette[symbol])
                lines.append(f'  <rect x="{x}" y="{y}" width="{end-x}" '
                             f'height="1" fill={fill}/>')
            x = end
    lines.append('</svg>')
    return "\n".join(lines) + "\n"


def main():
    # Output beside this script; no downloads, dependencies, or background rects.
    output = Path(__file__).resolve().parent
    checked = {name: validate(name, sprite) for name, sprite in SPRITES.items()}
    notes = ["ORIGINAL EMERALD FAN-PORTAL PIXEL ART",
             "One character per pixel. '.' = transparent. Edit make_art.py and rerun.",
             "All sprites face right where directional. No official sprites traced.", ""]
    files = [Path(__file__).name]
    for name, sprite in SPRITES.items():
        rows = checked[name]
        filename = name + ".svg"
        (output / filename).write_text(svg_for(name, sprite, rows), encoding="utf-8")
        width, height = sprite["size"]
        notes.extend([f"{name} ({width}x{height})",
                      "Palette: " + json.dumps(sprite["palette"], sort_keys=True),
                      *rows, ""])
        files.append(filename)
    (output / "grids.txt").write_text("\n".join(notes) + "\n", encoding="utf-8")
    files.append("grids.txt")
    print("\n".join(files))


if __name__ == "__main__":
    main()
