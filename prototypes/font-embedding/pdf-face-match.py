"""Identify which font file each PowerPoint PDF font subset came from.

PowerPoint for Mac names fonts rendered from embedded payloads "1", "2", ...
in its PDF export, so BaseFont names cannot prove face identity. This tool
compares glyph outlines in each embedded PDF font program against candidate
font files and reports the best match.

Usage: python pdf-face-match.py export.pdf candidate.ttf [candidate.otf ...]
       [--pptx deck.pptx]  (adds the deck's uncompressed EOT/raw payloads)
Requires: fonttools, pypdf (see requirements.txt).
"""
import hashlib
import io
import json
import struct
import sys
import zipfile

from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.ttLib import TTFont
from pypdf import PdfReader


def signature(glyphset, name):
    pen = DecomposingRecordingPen(glyphset)
    glyphset[name].draw(pen)
    if not pen.value:
        return None
    # Normalize: convert quadratic/cubic segment ops to point lists, rounded.
    flat = []
    for op, pts in pen.value:
        flat.append((op, tuple((round(x), round(y)) for x, y in pts)))
    return hashlib.sha1(repr(flat).encode()).hexdigest()


def font_signatures(font):
    gs = font.getGlyphSet()
    sigs = set()
    for name in font.getGlyphOrder():
        try:
            s = signature(gs, name)
        except Exception:
            continue
        if s:
            sigs.add(s)
    return sigs


def cff_signatures(data):
    from fontTools.cffLib import CFFFontSet

    cff = CFFFontSet()
    cff.decompile(io.BytesIO(data), None)
    charstrings = cff[cff.fontNames[0]].CharStrings
    sigs = set()
    for name in charstrings.keys():
        try:
            s = signature(charstrings, name)
        except Exception:
            continue
        if s:
            sigs.add(s)
    return sigs


def eot_or_raw(data):
    if data[:4] in (b"\x00\x01\x00\x00", b"OTTO", b"true"):
        return data
    if len(data) > 36 and struct.unpack_from("<H", data, 34)[0] == 0x504C:
        flags = struct.unpack_from("<I", data, 12)[0]
        if flags & 0x4:
            return None  # MTX-compressed; not decodable here
        size = struct.unpack_from("<I", data, 4)[0]
        return data[len(data) - size:]
    return None


def candidates(paths, pptx):
    out = []
    for p in paths:
        out.append((p, TTFont(p)))
    if pptx:
        z = zipfile.ZipFile(pptx)
        for n in sorted(z.namelist()):
            if n.startswith("ppt/fonts/"):
                sfnt = eot_or_raw(z.read(n))
                if sfnt:
                    out.append((f"{pptx}:{n}", TTFont(io.BytesIO(sfnt))))
    return [(label, font, font_signatures(font)) for label, font in out]


def pdf_fonts(path):
    reader = PdfReader(path)
    seen = {}
    for page in reader.pages:
        fonts = page["/Resources"].get_object().get("/Font", {})
        for key, ref in fonts.items():
            f = ref.get_object()
            base = f.get("/BaseFont")
            desc = f.get("/FontDescriptor")
            if desc is None and "/DescendantFonts" in f:
                desc = f["/DescendantFonts"][0].get_object().get("/FontDescriptor")
            desc = desc.get_object() if desc is not None else {}
            for k in ("/FontFile2", "/FontFile3"):
                if k in desc:
                    seen[str(base)] = (k, desc[k].get_object().get_data())
    return seen


def main(argv):
    pptx = None
    if "--pptx" in argv:
        i = argv.index("--pptx")
        pptx = argv[i + 1]
        argv = argv[:i] + argv[i + 2:]
    pdf, cand_paths = argv[0], argv[1:]
    cands = candidates(cand_paths, pptx)
    result = []
    for base, (kind, data) in sorted(pdf_fonts(pdf).items()):
        try:
            if kind == "/FontFile2" or data[:4] == b"OTTO":
                sub = TTFont(io.BytesIO(data))
                sigs = font_signatures(sub)
            else:  # bare CFF (FontFile3 /Type1C or /CIDFontType0C)
                sub = None
                sigs = cff_signatures(data)
        except Exception as exc:
            result.append({"pdfFont": base, "program": kind, "matchedFraction": None, "note": f"unparsed program: {exc}"})
            continue
        scored = sorted(((len(sigs & s) / max(1, len(sigs)), label) for label, _, s in cands), reverse=True)
        best = scored[0][0] if scored else 0
        tied = [label for score, label in scored if score == best]
        below = [(score, label) for score, label in scored if score < best]
        names = {r.nameID: r.toUnicode() for r in sub["name"].names} if sub is not None and "name" in sub else {}
        result.append({
            "pdfFont": base,
            "program": kind,
            "subsetGlyphOutlines": len(sigs),
            "matchedFraction": round(best, 4),
            "bestMatches": tied,
            "nextBest": below[0][1] if below else None,
            "nextBestFraction": round(below[0][0], 4) if below else None,
            "subsetNameIds": {k: names[k] for k in (1, 2, 4, 6) if k in names},
        })
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main(sys.argv[1:])
