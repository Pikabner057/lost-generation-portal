#!/usr/bin/env python3
"""Spark's hand-built pixel layers for the portal header scene (dark + light palettes).
Each layer is a small SVG; the page scales pixels up with CSS (crisp, no smoothing)."""
import math, os
OUT = os.path.join(os.path.dirname(__file__), "out"); os.makedirs(OUT, exist_ok=True)

PAL = {
  "dark":  dict(star="#cfeedd", star2="#6fbf93", hill="#123828", hill_top="#1b4d36", tree="#0e4429", tree_hi="#1d6a43",
                tree_trunk="#3a2a1a", rock="#2b3a33", rock_hi="#3e5247", rock_dk="#1a2520", lava="#ff8a3d", lava2="#ffd166",
                smoke="#4f6b5e", smoke2="#6d8a7c", grass="#1f9a5c", grass_hi="#6fdc95", grass_dk="#0b5e3a", moon="#f4f1d0", moon_dk="#c9c49a"),
  "light": dict(star="#ffffff", star2="#ffffff", hill="#8cc7a2", hill_top="#a8d9b9", tree="#2f7d52", tree_hi="#4ea472",
                tree_trunk="#7a5a3a", rock="#8a8f7c", rock_hi="#a9ae99", rock_dk="#6b705f", lava="#e8692b", lava2="#ffb347",
                smoke="#c9d3cc", smoke2="#e6ece8", grass="#2fa866", grass_hi="#7fe0a2", grass_dk="#177a45", moon="#fffbe0", moon_dk="#f1e7b0"),
}

def svg(name, w, h, px):
    # merge horizontal runs of one colour into a single rect
    rows = {}
    for (x, y), c in px.items():
        if 0 <= x < w and 0 <= y < h: rows.setdefault(y, {})[x] = c
    rects = []
    for y in sorted(rows):
        xs = sorted(rows[y]); i = 0
        while i < len(xs):
            x0, c = xs[i], rows[y][xs[i]]; j = i
            while j + 1 < len(xs) and xs[j + 1] == xs[j] + 1 and rows[y][xs[j + 1]] == c: j += 1
            rects.append(f'<rect x="{x0}" y="{y}" width="{xs[j]-x0+1}" height="1" fill="{c}"/>'); i = j + 1
    open(os.path.join(OUT, name), "w").write(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" shape-rendering="crispEdges">'
        + "".join(rects) + "</svg>\n")

def stars(p):                       # 96x20 tile: dots + a few 4-point twinkles
    px = {}
    for x, y in [(5,3),(22,9),(37,2),(51,12),(66,5),(83,10),(90,1),(14,15),(73,16),(44,7)]: px[(x,y)] = p["star2"]
    for cx, cy in [(29,4),(78,3),(58,14)]:
        px[(cx,cy)] = p["star"]
        for dx, dy in [(1,0),(-1,0),(0,1),(0,-1)]: px[(cx+dx,cy+dy)] = p["star2"]
    return 96, 20, px

def hills(p):                       # 160x12 rolling far hills, seamless (period divides 160)
    W, H = 160, 12; px = {}
    for x in range(W):
        t = 2*math.pi*x/W
        h = 5 + 2.6*math.sin(t) + 1.6*math.sin(3*t+1) + .8*math.sin(5*t+2)
        top = H - round(h)
        for y in range(top, H): px[(x,y)] = p["hill"]
        px[(x,top)] = p["hill_top"]
    return W, H, px

def trees(p):                       # 64x16 tree line: pines + round bushes, seamless
    W, H = 64, 16; px = {}
    for x in range(W):
        for y in range(H-3, H): px[(x,y)] = p["tree"]
    def pine(cx, h):
        for i in range(h):
            y = H-3-h+i; half = i//2
            for x in range(cx-half, cx+half+1): px[(x % W, y)] = p["tree"]
            px[((cx-half) % W, y)] = p["tree_hi"]
        px[(cx, H-3)] = p["tree_trunk"]
    def bush(cx, r):
        for y in range(H-3-r*2, H-2):
            for x in range(cx-r-1, cx+r+2):
                if (x-cx)**2/(r+1.2)**2 + (y-(H-3-r))**2/(r**2) <= 1: px[(x % W, y)] = p["tree"]
        for x in range(cx-r+1, cx): px[(x % W, H-3-r*2+1)] = p["tree_hi"]
    for cx, h in [(4,11),(15,8),(27,12),(40,9),(52,11),(60,7)]: pine(cx, h)
    for cx, r in [(9,3),(21,4),(34,3),(46,4),(57,3)]: bush(cx, r)
    return W, H, px

def chimney(p):                     # 44x26 volcano with lava glow + smoke
    W, H = 44, 26; px = {}
    base, top = H-1, 9
    for y in range(top, H):
        half = 4 + (y-top)*1.15
        for x in range(round(22-half), round(22+half)+1):
            px[(x,y)] = p["rock_hi"] if x < 22 - half*0.35 else (p["rock_dk"] if x > 22 + half*0.45 else p["rock"])
    for x in range(19, 26): px[(x, top)] = p["lava"]                  # crater rim glow
    for x in range(20, 25): px[(x, top+1)] = p["lava2"] if x in (21,23) else p["lava"]
    for y, x in [(top+2,22),(top+3,22),(top+3,21),(top+5,23),(top+6,23)]: px[(x,y)] = p["lava"]   # lava trickle
    for cx, cy, r in [(23,6,2),(26,4,2),(24,1,2),(29,2,1)]:           # smoke puffs
        for y in range(cy-r, cy+r+1):
            for x in range(cx-r, cx+r+1):
                if (x-cx)**2+(y-cy)**2 <= r*r+1: px[(x,y)] = p["smoke"]
        px[(cx-1, cy-1)] = p["smoke2"]
    return W, H, px

def moon(p):                        # 10x10 crescent
    px = {}
    for y in range(10):
        for x in range(10):
            if (x-4.5)**2+(y-4.5)**2 <= 20 and not ((x-6.5)**2+(y-3.5)**2 <= 13): px[(x,y)] = p["moon"]
    for x, y in [(1,5),(2,7),(3,8)]:
        if (x,y) in px: px[(x,y)] = p["moon_dk"]
    return 10, 10, px

def grass(p):                       # 32x10 tall grass, two rows of blades
    W, H = 32, 10; px = {}
    for x in range(W):
        px[(x,H-1)] = p["grass_dk"]; px[(x,H-2)] = p["grass_dk"]
    blades = [(0,6),(2,8),(3,5),(5,7),(7,9),(8,6),(10,4),(12,8),(13,6),(15,9),(17,5),(19,7),(20,9),(22,6),(24,8),(25,4),(27,7),(29,9),(30,5)]
    for x, h in blades:
        for y in range(H-2-h, H-2): px[(x,y)] = p["grass"] if y > H-2-h+1 else p["grass_hi"]
        if h >= 7: px[((x+1) % W, H-3)] = p["grass"]; px[((x+1) % W, H-4)] = p["grass"]
    return W, H, px

for theme, p in PAL.items():
    sfx = "" if theme == "dark" else "-light"
    for fn in (stars, hills, trees, chimney, moon, grass):
        w, h, px = fn(p); svg(f"{fn.__name__}{sfx}.svg", w, h, px)
print(sorted(os.listdir(OUT)))
