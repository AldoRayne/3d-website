import json
import sys
from pathlib import Path

from fontTools.pens.basePen import BasePen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

SOURCE = Path(sys.argv[1])
OUT = Path(__file__).resolve().parent.parent / 'src' / 'assets' / 'fonts'
WEIGHTS = (300, 400, 700)
RANGES = [(0x20, 0x7E), (0xA0, 0xFF), (0x400, 0x45F), (0x490, 0x491), (0x2010, 0x2027), (0x2030, 0x203A), (0x20AC, 0x20AC), (0x20B4, 0x20B4), (0x2116, 0x2116), (0x2122, 0x2122), (0x2190, 0x2193)]


def fmt(value):
    return str(round(value))


class TypefacePen(BasePen):
    def __init__(self, glyph_set):
        super().__init__(glyph_set)
        self.commands = []

    def _moveTo(self, pt):
        self.commands += ['m', fmt(pt[0]), fmt(pt[1])]

    def _lineTo(self, pt):
        self.commands += ['l', fmt(pt[0]), fmt(pt[1])]

    def _qCurveToOne(self, pt1, pt2):
        self.commands += ['q', fmt(pt2[0]), fmt(pt2[1]), fmt(pt1[0]), fmt(pt1[1])]

    def _curveToOne(self, pt1, pt2, pt3):
        self.commands += ['b', fmt(pt3[0]), fmt(pt3[1]), fmt(pt1[0]), fmt(pt1[1]), fmt(pt2[0]), fmt(pt2[1])]


def build(weight):
    font = instantiateVariableFont(TTFont(SOURCE), {'wght': weight})
    cmap = font.getBestCmap()
    glyph_set = font.getGlyphSet()
    hmtx = font['hmtx']
    glyphs = {}
    for start, end in RANGES:
        for code in range(start, end + 1):
            name = cmap.get(code)
            if not name:
                continue
            pen = TypefacePen(glyph_set)
            glyph_set[name].draw(pen)
            glyphs[chr(code)] = {'ha': hmtx[name][0], 'x_min': 0, 'x_max': hmtx[name][0], 'o': ' '.join(pen.commands)}
    head = font['head']
    hhea = font['hhea']
    data = {
        'glyphs': glyphs,
        'familyName': 'Manrope',
        'ascender': hhea.ascent,
        'descender': hhea.descent,
        'underlinePosition': font['post'].underlinePosition,
        'underlineThickness': font['post'].underlineThickness,
        'boundingBox': {'xMin': head.xMin, 'yMin': head.yMin, 'xMax': head.xMax, 'yMax': head.yMax},
        'resolution': head.unitsPerEm,
        'original_font_information': {'format': 0, 'fontFamily': 'Manrope'},
    }
    target = OUT / f'manrope-{weight}.json'
    target.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')))
    print(target.name, len(glyphs), 'glyphs', target.stat().st_size // 1024, 'KB')


for weight in WEIGHTS:
    build(weight)
