#!/usr/bin/env python3
"""Pixel art sprites for Mirror Up, drawn as text and written out as SVG and PNG without PIL.
Run from the icons/ folder."""
import struct, zlib

PALETTE = {
    'K': (0x3a, 0x10, 0x33),  # plum outline
    'P': (0xff, 0x8f, 0xc0),  # pink body
    'H': (0xe0, 0x57, 0x9a),  # pink shade
    'S': (0xff, 0xd9, 0xea),  # pink shine
    'L': (0x7b, 0x3f, 0x8f),  # lens glass
    'D': (0x4a, 0x1d, 0x5c),  # lens deep
    'W': (0xff, 0xff, 0xff),  # glint
    'R': (0xff, 0x3b, 0x6b),  # record dot / heart
    'r': (0xc4, 0x1f, 0x4e),  # heart shade
}
BG = (0xff, 0xc2, 0xdc)

CAMERA = [
    "................",
    "................",
    "....KKKKK.......",
    "...KSSSSSK.KKK..",
    ".KKKKKKKKKKKKKK.",
    ".KSSSSSSSSSSRRK.",
    ".KPPPKKKKKPPRRK.",
    ".KPPKLLLLLKPPPK.",
    ".KPKLWWLLLLKPPK.",
    ".KPKLWLLLLDKPPK.",
    ".KPKLLLLLDDKPPK.",
    ".KPPKLLDDDKPPPK.",
    ".KHHHKKKKKHHHHK.",
    ".KHHHHHHHHHHHHK.",
    ".KKKKKKKKKKKKKK.",
    "................",
]

HEART = [
    ".KK...KK.",
    "KRRK.KRRK",
    "KRWRKRRRK",
    "KRRRRRRRK",
    "KRRRRRRrK",
    ".KRRRRrK.",
    "..KRRrK..",
    "...KrK...",
    "....K....",
]

for sprite in (CAMERA, HEART):
    assert len({len(row) for row in sprite}) == 1, 'ragged sprite'
    assert all(ch == '.' or ch in PALETTE for row in sprite for ch in row)


def hexcol(c):
    return '#%02x%02x%02x' % c


def svg(sprite, background=None, pad=0):
    w, h = len(sprite[0]) + pad * 2, len(sprite) + pad * 2
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" shape-rendering="crispEdges">']
    if background:
        out.append(f'<rect width="{w}" height="{h}" fill="{hexcol(background)}"/>')
    for y, row in enumerate(sprite):
        x = 0
        while x < len(row):       # merge runs of one colour into a single rect
            ch = row[x]
            run = 1
            while x + run < len(row) and row[x + run] == ch:
                run += 1
            if ch != '.':
                out.append(f'<rect x="{x + pad}" y="{y + pad}" width="{run}" height="1" fill="{hexcol(PALETTE[ch])}"/>')
            x += run
    out.append('</svg>')
    return '\n'.join(out) + '\n'


def png(sprite, size, cell):
    """Square PNG with the sprite centred on the pink background, cell pixels per sprite pixel."""
    sw, sh = len(sprite[0]) * cell, len(sprite) * cell
    ox, oy = (size - sw) // 2, (size - sh) // 2
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            col = BG
            sx, sy = (x - ox) // cell, (y - oy) // cell
            if 0 <= sy < len(sprite) and 0 <= sx < len(sprite[0]) and sprite[sy][sx] != '.':
                col = PALETTE[sprite[sy][sx]]
            row += bytes(col)
        rows.append(bytes(row))

    def chunk(tag, data):
        body = tag + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) \
        + chunk(b'IDAT', zlib.compress(b''.join(rows), 9)) + chunk(b'IEND', b'')


files = {
    'icon.svg': svg(CAMERA, background=BG, pad=2).encode(),
    'camera.svg': svg(CAMERA).encode(),
    'heart.svg': svg(HEART).encode(),
    'icon-192.png': png(CAMERA, 192, 10),
    'icon-512.png': png(CAMERA, 512, 26),
    'icon-512-maskable.png': png(CAMERA, 512, 20),   # artwork stays inside the safe circle
}
for name, data in files.items():
    with open(name, 'wb') as f:
        f.write(data)
    print('wrote', name)
