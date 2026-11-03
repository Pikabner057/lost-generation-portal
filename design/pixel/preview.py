# Render rect-only SVGs to one scaled PNG contact sheet (stdlib only)
import re, sys, zlib, struct
files = sys.argv[2:]; out = sys.argv[1]; S = 8; pad = 8
imgs = []
for f in files:
    t = open(f).read()
    w, h = map(int, re.search(r'viewBox="0 0 (\d+) (\d+)"', t).groups())
    px = {}
    for m in re.finditer(r'<rect([^>]*)/>', t):
        a = dict(re.findall(r'(\w+)="([^"]*)"', m.group(1)))
        x, y = int(float(a.get('x', 0))), int(float(a.get('y', 0))); rw, rh = int(float(a['width'])), int(float(a['height']))
        c = a['fill'].lstrip('#'); c = ''.join(ch*2 for ch in c) if len(c) == 3 else c
        for yy in range(y, y+rh):
            for xx in range(x, x+rw): px[(xx, yy)] = bytes.fromhex(c[:6])
    imgs.append((w, h, px))
W = sum(w*S + pad for w, h, _ in imgs) + pad; H = max(h for _, h, _ in imgs)*S + 2*pad
bg = bytes.fromhex('10231b'); buf = bytearray(bg * (W*H)); ox = pad
for w, h, px in imgs:
    for (x, y), c in px.items():
        for dy in range(S):
            row = (pad + y*S + dy)*W
            for dx in range(S): i = (row + ox + x*S + dx)*3; buf[i:i+3] = c
    ox += w*S + pad
def chunk(k, v): return struct.pack('!I', len(v)) + k + v + struct.pack('!I', zlib.crc32(k+v) & 0xffffffff)
raw = b''.join(b'\0' + bytes(buf[y*W*3:(y+1)*W*3]) for y in range(H))
open(out, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', W, H, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))
