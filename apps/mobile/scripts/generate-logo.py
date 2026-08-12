"""Render the JOVO wordmark and pin mark as PNGs.

Geometric construction on a 100-unit cap height, drawn at a high supersample
factor and downsampled, so the curves stay clean at 24px.
"""
import math
from PIL import Image, ImageDraw

ORANGE = (0xF4, 0x5A, 0x00)
SS = 8  # supersample factor

H = 100.0          # cap height
W_STROKE = 21.0    # stroke weight
OVERSHOOT = 2.0    # optical overshoot for round shapes

W_J = 60.0
W_O = 90.0
TRACK = 17.0


class Canvas:
    """Two-layer mask: shapes are added, counters are subtracted at the end."""

    def __init__(self, w_units, h_units, pad):
        self.pad = pad
        self.w_units = w_units + 2 * pad
        self.h_units = h_units + 2 * pad
        size = (round(self.w_units * SS), round(self.h_units * SS))
        self.add = Image.new("L", size, 0)
        self.sub = Image.new("L", size, 0)
        self.da = ImageDraw.Draw(self.add)
        self.ds = ImageDraw.Draw(self.sub)

    def _d(self, v):
        return self.da if v else self.ds

    def _p(self, x, y):
        return ((x + self.pad) * SS, (y + self.pad) * SS)

    def rect(self, x0, y0, x1, y1, v=1):
        self._d(v).rectangle([self._p(x0, y0), self._p(x1, y1)], fill=255)

    def ellipse(self, x0, y0, x1, y1, v=1):
        self._d(v).ellipse([self._p(x0, y0), self._p(x1, y1)], fill=255)

    def pie(self, x0, y0, x1, y1, a0, a1, v=1):
        self._d(v).pieslice([self._p(x0, y0), self._p(x1, y1)], a0, a1, fill=255)

    def poly(self, pts, v=1):
        self._d(v).polygon([self._p(x, y) for x, y in pts], fill=255)

    def mask(self):
        m = self.add.copy()
        m.paste(0, (0, 0), self.sub)
        return m.resize((round(self.w_units), round(self.h_units)), Image.LANCZOS)

    def finish(self, color, background=None):
        m = self.mask()
        base = background if background else color + (0,)
        out = Image.new("RGBA", m.size, base)
        out.paste(Image.new("RGBA", m.size, color + (255,)), (0, 0), m)
        return out


def draw_j(c, x):
    """Geometric J: right stem dropping into a half-round hook."""
    r = W_J / 2.0
    bottom = H + OVERSHOOT
    c.rect(x + W_J - W_STROKE, 0, x + W_J, bottom - r)
    c.pie(x, bottom - 2 * r, x + W_J, bottom, 0, 180)
    c.pie(
        x + W_STROKE,
        bottom - 2 * r + W_STROKE,
        x + W_J - W_STROKE,
        bottom - W_STROKE,
        0,
        180,
        v=0,
    )


def draw_o(c, x):
    c.ellipse(x, -OVERSHOOT, x + W_O, H + OVERSHOOT)
    c.ellipse(
        x + W_STROKE,
        -OVERSHOOT + W_STROKE,
        x + W_O - W_STROKE,
        H + OVERSHOOT - W_STROKE,
        v=0,
    )


def draw_v_pin(c, x, width, gap_ratio, flat=0.0, head_y=None, apex_drop=None,
               stroke=None):
    """A V whose outer contour is a location pin.

    The two lower edges are tangents running from a single apex up to a round
    head; a wedge cut out of the top opens the head into the V's counter, and a
    flat cut at the cap line removes the shoulders' inward curl so the shape
    reads as a V rather than a heart.
    """
    w = stroke if stroke is not None else W_STROKE
    r = width / 2.0
    cx = x + r
    cy = r if head_y is None else head_y
    apex_y = H + (OVERSHOOT if apex_drop is None else apex_drop)
    d = apex_y - cy
    gamma = math.acos(r / d)
    alpha = math.asin(r / d)
    tx, ty = r * math.sin(gamma), r * math.cos(gamma)

    c.ellipse(cx - r, cy - r, cx + r, cy + r)
    c.poly([(cx - tx, cy + ty), (cx + tx, cy + ty), (cx, apex_y)])

    inner_apex_y = apex_y - w / math.sin(alpha)
    g = r * gap_ratio
    c.poly(
        [
            (cx, inner_apex_y),
            (cx - g, flat),
            (cx - g, -60.0),
            (cx + g, -60.0),
            (cx + g, flat),
        ],
        v=0,
    )
    c.rect(cx - r, -60.0, cx + r, flat, v=0)


def wordmark(width_v=84.0, gap_ratio=0.62, pad=10, **kw):
    total = W_J + W_O + width_v + W_O + 3 * TRACK
    c = Canvas(total, H, pad)
    x = 0.0
    draw_j(c, x)
    x += W_J + TRACK
    draw_o(c, x)
    x += W_O + TRACK
    draw_v_pin(c, x, width_v, gap_ratio, **kw)
    x += width_v + TRACK
    draw_o(c, x)
    return c


def mark(width_v=84.0, gap_ratio=0.62, pad=10, **kw):
    c = Canvas(width_v, H, pad)
    draw_v_pin(c, 0.0, width_v, gap_ratio, **kw)
    return c


def render(canvas, color, height_px, background=None):
    img = canvas.finish(color, background)
    scale = height_px / img.height
    return img.resize((max(1, round(img.width * scale)), height_px), Image.LANCZOS)


# The chosen V. The outer edges are tangents to a round head and converge on a
# single point that drops below the baseline, which is the pin's profile. The
# shoulders are cut flat well above the head's widest point: let them curl over
# and the shape stops reading as a V and starts reading as a heart.
V = dict(width_v=82.0, gap_ratio=0.76, flat=22.0, head_y=36.0, apex_drop=10.0,
         pad=18)

WHITE = (255, 255, 255, 255)


def trimmed(canvas, color, height_px):
    """Render, then crop to the ink so padding cannot skew the centring."""
    img = canvas.finish(color)
    box = img.getchannel("A").getbbox()
    img = img.crop(box)
    scale = height_px / img.height
    return img.resize((max(1, round(img.width * scale)), height_px), Image.LANCZOS)


def centred(canvas, size, coverage, color, background):
    """Fit a mark inside a square canvas at a given fraction of the edge."""
    art = trimmed(canvas, color, round(size * coverage))
    if art.width > size * coverage:
        scale = (size * coverage) / art.width
        art = art.resize(
            (round(art.width * scale), max(1, round(art.height * scale))),
            Image.LANCZOS,
        )
    out = Image.new("RGBA", (size, size), background)
    out.alpha_composite(art, ((size - art.width) // 2, (size - art.height) // 2))
    return out


if __name__ == "__main__":
    import os

    here = os.path.dirname(os.path.abspath(__file__))
    logo = os.path.join(here, "..", "assets", "logo")
    store = os.path.join(here, "..", "assets", "store")

    def save(img, *parts):
        path = os.path.normpath(os.path.join(*parts))
        img.save(path, optimize=True)
        print("wrote", path, img.size)

    # In-app wordmark: 3x headroom for a 260pt splash and any header use.
    save(trimmed(wordmark(**V), ORANGE, 360), logo, "jovo-wordmark.png")

    # Standalone mark for square slots (badges, favicon).
    save(trimmed(mark(**V), ORANGE, 256), logo, "jovo-mark.png")

    # Store icon: the mark on white, since a wordmark is unreadable at 48px.
    save(centred(mark(**V), 1024, 0.62, ORANGE, WHITE), store, "app-icon-1024.png")

    # Adaptive foreground: content kept inside the centre 66% safe zone.
    save(
        centred(mark(**V), 1024, 0.42, ORANGE, (0, 0, 0, 0)),
        store,
        "adaptive-icon-foreground.png",
    )
