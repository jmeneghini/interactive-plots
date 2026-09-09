#!/usr/bin/env python3
"""
33-141 Week 3 Tuesday recitation, R.1.1 - R.1.3: vectors on a circular track.

Builds three Plotly figures and writes them to a single self-assembled HTML
page in the site tree:

    uv run python projects/phys1/circular_vectors.py            -> site/phys1/circular-vectors.html
    uv run python projects/phys1/circular_vectors.py --inline   -> same, with plotly.js inlined (~5 MB, works offline)

plotly.js comes from a CDN by default, which is what the published page wants;
--inline produces the standalone copy to hand out for offline use.

The controls are plain HTML range inputs driving Plotly.update, not Plotly's own
sliders, so one figure can carry more than one parameter:

    R.1.1  separation A to B',  origin x,  origin y
    R.1.2  separation A to B                         (constant speed)
    R.1.3  separation A to B,   a_tan / a_rad        (speed changing)

Python owns the palette, the layout and the opening state of each figure; the
geometry is mirrored in the emitted JavaScript so the sliders can recompute it
live. Keep the two in step when editing - see GEOMETRY_JS.
"""

import pathlib
import sys

import numpy as np
import plotly.graph_objects as go
import plotly.io as pio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "tools"))
from plotsite import save_html  # noqa: E402

# ---------------------------------------------------------------- palette
INK    = "#1A211D"
MUTED  = "#8A948E"
TRACK  = "#A4AEA7"
POS    = "#3F6FA8"   # position vectors
DISP   = "#B26A12"   # differences: dr, dv
VEL    = "#127A66"   # velocity
ACC    = "#B03A30"   # acceleration
LIMIT  = "#71549E"   # tangent guides, angle marks
GUIDE  = "#C3CBC3"   # faint reference arc
PAPER  = "#FAFBF9"

SERIF = "Georgia, 'Times New Roman', serif"
SANS  = "'IBM Plex Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
MONO  = "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace"

THA = -20.0                          # where A sits on the circle
ORIGIN_0 = np.array([-2.00, -1.60])  # opening position of the R.1.1 origin
SEP_0, RATE_0 = 45.0, 0.60           # opening slider values

# ---------------------------------------------------------------- geometry
def circle_point(th):
    t = np.radians(th)
    return np.array([np.cos(t), np.sin(t)])

def tangent_dir(th):
    """Unit velocity direction for counter-clockwise motion."""
    t = np.radians(th)
    return np.array([-np.sin(t), np.cos(t)])

def unit(v):
    n = np.hypot(*v)
    return v / n if n else v

def perp(v):
    return np.array([-v[1], v[0]])

def arc(centre, r, a0, a1, n=64):
    t = np.linspace(a0, a1, n)
    return centre[0] + r * np.cos(t), centre[1] + r * np.sin(t)

def short_arc(at, a0, a1, r):
    """Arc marking the angle between two directions; returns xs, ys, midangle."""
    d = (a1 - a0 + np.pi) % (2 * np.pi) - np.pi
    xs, ys = arc(at, r, a0, a0 + d)
    return xs, ys, a0 + d / 2

def angle_between(u, v):
    a = np.degrees(np.arctan2(v[1], v[0]) - np.arctan2(u[1], u[0]))
    return abs((a + 540) % 360 - 180)

# ---------------------------------------------------------------- drawing
def arrow(tail, tip, color, axis="", width=2.4):
    """A vector, drawn as an annotation whose tail is in data coordinates."""
    return dict(
        x=tip[0], y=tip[1], ax=tail[0], ay=tail[1],
        xref=f"x{axis}", yref=f"y{axis}", axref=f"x{axis}", ayref=f"y{axis}",
        text="", showarrow=True,
        arrowhead=2, arrowsize=1.3, arrowwidth=width, arrowcolor=color,
    )

def tag(at, text, color, axis="", size=16):
    return dict(
        x=at[0], y=at[1], xref=f"x{axis}", yref=f"y{axis}",
        text=text, showarrow=False, xanchor="center", yanchor="middle",
        font=dict(family=SERIF, size=size, color=color),
    )

def tip_tag(tail, tip, text, color, axis="", off=0.24):
    return tag(tip + unit(tip - tail) * off, text, color, axis)

def side_tag(a, b, away_from, off, text, color, axis="", flip=False):
    """Label beside the middle of a vector, on the side away from a point.
    flip=True puts it on the near side instead."""
    m = (a + b) / 2
    n = unit(perp(b - a))
    if np.hypot(*(m + n * off - away_from)) < np.hypot(*(m - n * off - away_from)):
        n = -n
    if flip:
        n = -n
    return tag(m + n * off, text, color, axis)

def note(text, x=0.5, y=1.0, size=13, color=INK, align="center"):
    return dict(x=x, y=y, xref="paper", yref="paper", text=text, showarrow=False,
                xanchor=align, yanchor="top",
                font=dict(family=MONO, size=size, color=color))

def square_range(points, pad=0.3):
    pts = np.asarray(points, dtype=float)
    lo, hi = pts.min(axis=0) - pad, pts.max(axis=0) + pad
    half = max(hi - lo) / 2
    mid = (lo + hi) / 2
    return [mid[0] - half, mid[0] + half], [mid[1] - half, mid[1] + half]

def blank_axis(rng, anchor=None, domain=None):
    ax = dict(range=rng, visible=False, showgrid=False, zeroline=False, fixedrange=True)
    if anchor:
        ax["scaleanchor"] = anchor
        ax["scaleratio"] = 1
    if domain:
        ax["domain"] = domain
    return ax

BASE_LAYOUT = dict(
    paper_bgcolor=PAPER, plot_bgcolor=PAPER,
    showlegend=False, hovermode=False, dragmode=False,
    margin=dict(l=20, r=20, t=112, b=24),
    font=dict(family=SANS, size=13, color=INK),
)

def titled(text, sub):
    return dict(
        text=f"<b>{text}</b><br><span style='font-size:13px;color:{MUTED}'>{sub}</span>",
        x=0.02, xanchor="left", y=0.93, yanchor="top",
        font=dict(family=SERIF, size=20, color=INK),
    )

def scatter(x, y, **style):
    return go.Scatter(x=x, y=y, hoverinfo="skip", **style)

# ================================================================ R.1.1
def state_r11(d, origin):
    A, tA = circle_point(THA), tangent_dir(THA)
    B = circle_point(THA + d)
    chord = B - A
    clen = np.hypot(*chord)
    cu = unit(chord)
    ann = [
        arrow(origin, A, POS, width=2.0), arrow(origin, B, POS, width=2.0),
        side_tag(origin, A, np.zeros(2), 0.20, "<b><i>r</i></b><sub>A</sub>", POS),
        side_tag(origin, B, np.zeros(2), 0.20, "<b><i>r</i></b><sub>B</sub>", POS),
        tag(origin + [-0.24, -0.22], "O", POS, size=15),
        arrow(A, B, DISP, width=2.8),
        tag(A + unit(A) * 0.20, "A", INK, size=14),
        tag(B + unit(B) * 0.20, "B'", INK, size=14),
        tag(A + tA * 1.62, "tangent at A", LIMIT, size=12),
        note(f"|Δ<b>r</b>| = {clen:0.3f} R      "
             f"|<b>v</b><sub>avg</sub>| = {clen / np.radians(d):0.4f} |<b>v</b>|      "
             f"angle off the tangent = {d / 2:0.1f}°",
             x=0.0, y=1.055, align="left", color=LIMIT),
    ]
    if d > 8:
        ann.append(side_tag(A, B, np.zeros(2), 0.22,
                            "Δ<b><i>r</i></b>", DISP, flip=True))
    ax, ay, mid = short_arc(A, np.arctan2(*tA[::-1]), np.arctan2(*cu[::-1]), 0.44)
    if d > 5:
        ann.append(tag(A + np.array([np.cos(mid), np.sin(mid)]) * 0.64,
                       f"{d / 2:0.1f}°", LIMIT, size=13))

    cx, cy = arc(np.zeros(2), 1.0, 0, 2 * np.pi, 160)
    xs = [list(cx), [A[0] - tA[0] * 0.55, A[0] + tA[0] * 1.40],
          list(ax), [A[0], B[0]], [origin[0]]]
    ys = [list(cy), [A[1] - tA[1] * 0.55, A[1] + tA[1] * 1.40],
          list(ay), [A[1], B[1]], [origin[1]]]
    rng = square_range([[-1, -1], [1, 1], B, origin - 0.4, A + tA * 1.75], 0.25)
    return xs, ys, ann, rng

def figure_r11():
    xs, ys, ann, (xr, yr) = state_r11(SEP_0, ORIGIN_0)
    fig = go.Figure([
        scatter(xs[0], ys[0], mode="lines", line=dict(color=TRACK, width=1.8)),
        scatter(xs[1], ys[1], mode="lines", line=dict(color=LIMIT, width=1.3, dash="dash")),
        scatter(xs[2], ys[2], mode="lines", line=dict(color=LIMIT, width=1.4)),
        scatter(xs[3], ys[3], mode="markers", marker=dict(color=INK, size=9)),
        scatter(xs[4], ys[4], mode="markers", marker=dict(color=POS, size=9)),
    ])
    fig.update_layout(
        **BASE_LAYOUT,
        title=titled("R.1.1  Displacement and average velocity",
                     "Close the gap and the chord pivots onto the tangent. "
                     "Move O and only the position vectors change."),
        xaxis=blank_axis(xr), yaxis=blank_axis(yr, "x"),
        annotations=ann,
    )
    return fig

# ================================================================ R.1.2 / R.1.3
def state_dv(d, p, show_accel):
    thB = THA + d
    A, B = circle_point(THA), circle_point(thB)
    dA, dB = tangent_dir(THA), tangent_dir(thB)
    sB = 1.0 + p * np.radians(d)              # constant tangential acceleration
    VS = 0.95
    a_tip, b_tip = A + dA * VS, B + dB * VS * sB
    T = np.zeros(2)
    tip_a, tip_b = T + dA * VS, T + dB * VS * sB
    dv = tip_b - tip_a
    ang = angle_between(dA, dv)

    corner = A + unit(-A) * 0.62
    a_end = corner + dA * 0.62 * p

    ra_x, ra_y = arc(T, VS, np.arctan2(*dA[::-1]), np.arctan2(*dB[::-1]))
    arc_x, arc_y, mid = short_arc(tip_a, np.arctan2(*dA[::-1]),
                                  np.arctan2(*dv[::-1]), 0.30)
    cx, cy = arc(np.zeros(2), 1.0, 0, 2 * np.pi, 160)
    blank = [None, None]

    xs = [list(cx), [A[0], B[0]],
          [A[0], corner[0]] if show_accel else blank,
          [corner[0], a_end[0]] if show_accel else blank,
          list(ra_x), [tip_a[0], tip_a[0] + dA[0] * 0.42], list(arc_x), [T[0]]]
    ys = [list(cy), [A[1], B[1]],
          [A[1], corner[1]] if show_accel else blank,
          [corner[1], a_end[1]] if show_accel else blank,
          list(ra_y), [tip_a[1], tip_a[1] + dA[1] * 0.42], list(arc_y), [T[1]]]

    ann = [
        arrow(A, a_tip, VEL, width=2.8), arrow(B, b_tip, VEL, width=2.8),
        tip_tag(A, a_tip, "<b><i>v</i></b><sub>A</sub>", VEL),
        tip_tag(B, b_tip, "<b><i>v</i></b><sub>B</sub>", VEL),
        tag(A + unit(A) * 0.20, "A", INK, size=14),
        tag(B + unit(B) * 0.20, "B", INK, size=14),
        arrow(T, tip_a, VEL, "2", 2.8), arrow(T, tip_b, VEL, "2", 2.8),
        arrow(tip_a, tip_b, DISP, "2", 3.0),
        tip_tag(T, tip_a, "<b><i>v</i></b><sub>A</sub>", VEL, "2"),
        tip_tag(T, tip_b, "<b><i>v</i></b><sub>B</sub>", VEL, "2"),
        tag(tip_a + np.array([np.cos(mid), np.sin(mid)]) * 0.46,
            f"{ang:0.0f}°", LIMIT, "2", 13),
        note("on the track", x=0.20, y=0.995, size=11, color=MUTED),
        note("copied tail to tail", x=0.80, y=0.995, size=11, color=MUTED),
    ]
    if np.hypot(*dv) > 0.16:
        ann.append(side_tag(tip_a, tip_b, T, 0.22, "Δ<b><i>v</i></b>", DISP, "2"))
    if show_accel:
        ann += [arrow(A, a_end, ACC, width=2.6),
                tip_tag(A, a_end, "<b><i>a</i></b>", ACC, "", 0.20)]

    if p == 0:
        rest = f"90° + Δθ/2 = {90 + d / 2:0.1f}°"
    else:
        what = "speeding up" if p > 0 else "slowing down"
        rest = (f"|<b>v</b><sub>B</sub>|/|<b>v</b><sub>A</sub>| = {sB:0.2f} ({what})      "
                f"limit as B→A = {np.degrees(np.arctan2(1.0, p)):0.1f}°")
    ann.append(note(f"Δθ = {d:0.0f}°      "
                    f"angle(<b>v</b><sub>A</sub>, Δ<b>v</b>) = {ang:0.1f}°      {rest}",
                    x=0.0, y=1.055, align="left", color=LIMIT))

    r1 = square_range([[-1.3, -1.3], [1.3, 1.3], a_tip, b_tip] +
                      ([a_end] if show_accel else []), 0.30)
    r2 = square_range([T, tip_a, tip_b, tip_a + dA * 0.5], 0.40)
    return xs, ys, ann, r1, r2

def dv_figure(d, p, show_accel, title, sub):
    xs, ys, ann, (xr1, yr1), (xr2, yr2) = state_dv(d, p, show_accel)
    styles = [
        dict(mode="lines", line=dict(color=TRACK, width=1.8), xaxis="x", yaxis="y"),
        dict(mode="markers", marker=dict(color=INK, size=9), xaxis="x", yaxis="y"),
        dict(mode="lines", line=dict(color=ACC, width=1.2, dash="dot"), xaxis="x", yaxis="y"),
        dict(mode="lines", line=dict(color=ACC, width=1.2, dash="dot"), xaxis="x", yaxis="y"),
        dict(mode="lines", line=dict(color=GUIDE, width=1.1, dash="dot"), xaxis="x2", yaxis="y2"),
        dict(mode="lines", line=dict(color=LIMIT, width=1.1, dash="dash"), xaxis="x2", yaxis="y2"),
        dict(mode="lines", line=dict(color=LIMIT, width=1.4), xaxis="x2", yaxis="y2"),
        dict(mode="markers", marker=dict(color=INK, size=7), xaxis="x2", yaxis="y2"),
    ]
    fig = go.Figure([scatter(xs[i], ys[i], **styles[i]) for i in range(len(styles))])
    fig.update_layout(
        **BASE_LAYOUT,
        title=titled(title, sub),
        xaxis=blank_axis(xr1, None, [0.0, 0.47]),
        yaxis=blank_axis(yr1, "x", [0.0, 1.0]),
        xaxis2=blank_axis(xr2, None, [0.53, 1.0]),
        yaxis2=blank_axis(yr2, "x2", [0.0, 1.0]),
        annotations=ann,
    )
    return fig

def figure_r12():
    return dv_figure(
        SEP_0, 0.0, False,
        "R.1.2  Δv at constant speed",
        "Equal lengths, isosceles triangle: the angle is exactly 90° + Δθ/2.",
    )

def figure_r13():
    return dv_figure(
        SEP_0, RATE_0, True,
        "R.1.3  Δv while the speed changes",
        "Two sliders. Close the gap and the angle tends to "
        "arctan(a<sub>rad</sub>/a<sub>tan</sub>); slide the rate through zero "
        "and it crosses 90°.",
    )

# ---------------------------------------------------------------- controls
CONTROLS = {
    "fig0": [
        dict(key="d",  label="separation A to B'", lo=2,    hi=90,  step=1,    val=SEP_0,       unit="°"),
        dict(key="ox", label="origin O, x",        lo=-3.0, hi=3.0, step=0.05, val=ORIGIN_0[0], unit=""),
        dict(key="oy", label="origin O, y",        lo=-3.0, hi=3.0, step=0.05, val=ORIGIN_0[1], unit=""),
    ],
    "fig1": [
        dict(key="d",  label="separation A to B",  lo=2,    hi=90,  step=1,    val=SEP_0,       unit="°"),
    ],
    "fig2": [
        dict(key="d",  label="separation A to B",  lo=2,    hi=90,  step=1,    val=SEP_0,       unit="°"),
        dict(key="p",  label="a_tan / a_rad",      lo=-1.5, hi=1.5, step=0.05, val=RATE_0,      unit=""),
    ],
}

def controls_html(div):
    rows = []
    for c in CONTROLS[div]:
        dec = 0 if c["step"] >= 1 else 2
        rows.append(
            f'<label class="ctl"><span class="name">{c["label"]}</span>'
            f'<input type="range" data-fig="{div}" data-key="{c["key"]}" '
            f'min="{c["lo"]}" max="{c["hi"]}" step="{c["step"]}" value="{c["val"]}" '
            f'data-dec="{dec}" data-unit="{c["unit"]}">'
            f'<output>{c["val"]:.{dec}f}{c["unit"]}</output></label>'
        )
    return f'<div class="controls">{"".join(rows)}</div>'

# ---------------------------------------------------------------- emitted JS
# Mirrors the geometry above so the sliders can recompute it in the browser.
GEOMETRY_JS = r"""
const C = {INK:"__INK__", MUTED:"__MUTED__", TRACK:"__TRACK__", POS:"__POS__",
           DISP:"__DISP__", VEL:"__VEL__", ACC:"__ACC__", LIMIT:"__LIMIT__"};
const SERIF = "__SERIF__", MONO = "__MONO__";
const RAD = Math.PI / 180, THA = __THA__;

const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const subv = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mul = (a, s) => [a[0] * s, a[1] * s];
const len = (a) => Math.hypot(a[0], a[1]);
const unit = (a) => { const n = len(a) || 1; return [a[0] / n, a[1] / n]; };
const perp = (a) => [-a[1], a[0]];
const cpt = (th) => [Math.cos(th * RAD), Math.sin(th * RAD)];
const tdir = (th) => [-Math.sin(th * RAD), Math.cos(th * RAD)];
const ang2 = (v) => Math.atan2(v[1], v[0]);
const f1 = (v, n) => v.toFixed(n);

function arcPts(c, r, a0, a1, n){
  const xs = [], ys = [];
  n = n || 64;
  for (let i = 0; i < n; i++){
    const t = a0 + (a1 - a0) * i / (n - 1);
    xs.push(c[0] + r * Math.cos(t));
    ys.push(c[1] + r * Math.sin(t));
  }
  return [xs, ys];
}
function shortArc(at, a0, a1, r){
  const two = 2 * Math.PI;
  const d = ((a1 - a0 + Math.PI) % two + two) % two - Math.PI;
  const [xs, ys] = arcPts(at, r, a0, a0 + d);
  return [xs, ys, a0 + d / 2];
}
function angleBetween(u, v){
  const a = (ang2(v) - ang2(u)) * 180 / Math.PI;
  return Math.abs(((a + 540) % 360) - 180);
}
function arrow(tail, tip, color, axis, width){
  axis = axis || "";
  return {x: tip[0], y: tip[1], ax: tail[0], ay: tail[1],
          xref: "x" + axis, yref: "y" + axis, axref: "x" + axis, ayref: "y" + axis,
          text: "", showarrow: true, arrowhead: 2, arrowsize: 1.3,
          arrowwidth: width || 2.4, arrowcolor: color};
}
function tag(at, text, color, axis, size){
  return {x: at[0], y: at[1], xref: "x" + (axis || ""), yref: "y" + (axis || ""),
          text: text, showarrow: false, xanchor: "center", yanchor: "middle",
          font: {family: SERIF, size: size || 16, color: color}};
}
function tipTag(tail, tip, text, color, axis, off){
  return tag(add(tip, mul(unit(subv(tip, tail)), off === undefined ? 0.24 : off)),
             text, color, axis);
}
function sideTag(a, b, awayFrom, off, text, color, axis, flip){
  const m = mul(add(a, b), 0.5);
  let n = unit(perp(subv(b, a)));
  if (len(subv(add(m, mul(n, off)), awayFrom)) < len(subv(subv(m, mul(n, off)), awayFrom)))
    n = mul(n, -1);
  if (flip) n = mul(n, -1);
  return tag(add(m, mul(n, off)), text, color, axis);
}
function note(text, x, y, size, color, align){
  return {x: x, y: y, xref: "paper", yref: "paper", text: text, showarrow: false,
          xanchor: align || "center", yanchor: "top",
          font: {family: MONO, size: size || 13, color: color || C.INK}};
}
function squareRange(pts, pad){
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad;
  const y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
  const h = Math.max(x1 - x0, y1 - y0) / 2;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return [[cx - h, cx + h], [cy - h, cy + h]];
}
const CIRCLE = arcPts([0, 0], 1, 0, 2 * Math.PI, 160);

/* ---------------- R.1.1 ---------------- */
function stateR11(d, ox, oy){
  const O = [ox, oy];
  const A = cpt(THA), tA = tdir(THA), B = cpt(THA + d);
  const chord = subv(B, A), clen = len(chord), cu = unit(chord);

  const ann = [
    arrow(O, A, C.POS, "", 2.0), arrow(O, B, C.POS, "", 2.0),
    sideTag(O, A, [0, 0], 0.20, "<b><i>r</i></b><sub>A</sub>", C.POS),
    sideTag(O, B, [0, 0], 0.20, "<b><i>r</i></b><sub>B</sub>", C.POS),
    tag([O[0] - 0.24, O[1] - 0.22], "O", C.POS, "", 15),
    arrow(A, B, C.DISP, "", 2.8),
    tag(add(A, mul(unit(A), 0.20)), "A", C.INK, "", 14),
    tag(add(B, mul(unit(B), 0.20)), "B'", C.INK, "", 14),
    tag(add(A, mul(tA, 1.62)), "tangent at A", C.LIMIT, "", 12),
    note("|Δ<b>r</b>| = " + f1(clen, 3) + " R      |<b>v</b><sub>avg</sub>| = " +
         f1(clen / (d * RAD), 4) + " |<b>v</b>|      angle off the tangent = " +
         f1(d / 2, 1) + "°", 0.0, 1.055, 13, C.LIMIT, "left"),
  ];
  if (d > 8) ann.push(sideTag(A, B, [0, 0], 0.22, "Δ<b><i>r</i></b>", C.DISP, "", true));
  const [ax, ay, mid] = shortArc(A, ang2(tA), ang2(cu), 0.44);
  if (d > 5) ann.push(tag(add(A, mul([Math.cos(mid), Math.sin(mid)], 0.64)),
                          f1(d / 2, 1) + "°", C.LIMIT, "", 13));

  const [xr, yr] = squareRange([[-1, -1], [1, 1], B, [O[0] - 0.4, O[1] - 0.4],
                                add(A, mul(tA, 1.75))], 0.25);
  return {
    data: {
      x: [CIRCLE[0], [A[0] - tA[0] * 0.55, A[0] + tA[0] * 1.40], ax, [A[0], B[0]], [O[0]]],
      y: [CIRCLE[1], [A[1] - tA[1] * 0.55, A[1] + tA[1] * 1.40], ay, [A[1], B[1]], [O[1]]],
    },
    layout: {annotations: ann, "xaxis.range": xr, "yaxis.range": yr},
  };
}

/* ---------------- R.1.2 / R.1.3 ---------------- */
function stateDV(d, p, showAccel){
  const A = cpt(THA), B = cpt(THA + d);
  const dA = tdir(THA), dB = tdir(THA + d);
  const sB = 1 + p * d * RAD, VS = 0.95;
  const aTip = add(A, mul(dA, VS)), bTip = add(B, mul(dB, VS * sB));
  const T = [0, 0];
  const tipA = mul(dA, VS), tipB = mul(dB, VS * sB);
  const dv = subv(tipB, tipA), ang = angleBetween(dA, dv);

  const corner = add(A, mul(unit(mul(A, -1)), 0.62));
  const aEnd = add(corner, mul(dA, 0.62 * p));
  const ref = arcPts(T, VS, ang2(dA), ang2(dB));
  const [arcX, arcY, mid] = shortArc(tipA, ang2(dA), ang2(dv), 0.30);
  const blank = [null, null];

  const ann = [
    arrow(A, aTip, C.VEL, "", 2.8), arrow(B, bTip, C.VEL, "", 2.8),
    tipTag(A, aTip, "<b><i>v</i></b><sub>A</sub>", C.VEL),
    tipTag(B, bTip, "<b><i>v</i></b><sub>B</sub>", C.VEL),
    tag(add(A, mul(unit(A), 0.20)), "A", C.INK, "", 14),
    tag(add(B, mul(unit(B), 0.20)), "B", C.INK, "", 14),
    arrow(T, tipA, C.VEL, "2", 2.8), arrow(T, tipB, C.VEL, "2", 2.8),
    arrow(tipA, tipB, C.DISP, "2", 3.0),
    tipTag(T, tipA, "<b><i>v</i></b><sub>A</sub>", C.VEL, "2"),
    tipTag(T, tipB, "<b><i>v</i></b><sub>B</sub>", C.VEL, "2"),
    tag(add(tipA, mul([Math.cos(mid), Math.sin(mid)], 0.46)),
        Math.round(ang) + "°", C.LIMIT, "2", 13),
    note("on the track", 0.20, 0.995, 11, C.MUTED),
    note("copied tail to tail", 0.80, 0.995, 11, C.MUTED),
  ];
  if (len(dv) > 0.16)
    ann.push(sideTag(tipA, tipB, T, 0.22, "Δ<b><i>v</i></b>", C.DISP, "2"));
  if (showAccel){
    ann.push(arrow(A, aEnd, C.ACC, "", 2.6));
    ann.push(tipTag(A, aEnd, "<b><i>a</i></b>", C.ACC, "", 0.20));
  }

  let rest;
  if (p === 0){
    rest = "90° + Δθ/2 = " + f1(90 + d / 2, 1) + "°";
  } else {
    const what = p > 0 ? "speeding up" : "slowing down";
    rest = "|<b>v</b><sub>B</sub>|/|<b>v</b><sub>A</sub>| = " + f1(sB, 2) + " (" + what +
           ")      limit as B→A = " + f1(Math.atan2(1, p) * 180 / Math.PI, 1) + "°";
  }
  ann.push(note("Δθ = " + Math.round(d) +
                "°      angle(<b>v</b><sub>A</sub>, Δ<b>v</b>) = " +
                f1(ang, 1) + "°      " + rest, 0.0, 1.055, 13, C.LIMIT, "left"));

  const probe1 = [[-1.3, -1.3], [1.3, 1.3], aTip, bTip];
  if (showAccel) probe1.push(aEnd);
  const [xr1, yr1] = squareRange(probe1, 0.30);
  const [xr2, yr2] = squareRange([T, tipA, tipB, add(tipA, mul(dA, 0.5))], 0.40);

  return {
    data: {
      x: [CIRCLE[0], [A[0], B[0]],
          showAccel ? [A[0], corner[0]] : blank,
          showAccel ? [corner[0], aEnd[0]] : blank,
          ref[0], [tipA[0], tipA[0] + dA[0] * 0.42], arcX, [T[0]]],
      y: [CIRCLE[1], [A[1], B[1]],
          showAccel ? [A[1], corner[1]] : blank,
          showAccel ? [corner[1], aEnd[1]] : blank,
          ref[1], [tipA[1], tipA[1] + dA[1] * 0.42], arcY, [T[1]]],
    },
    layout: {annotations: ann, "xaxis.range": xr1, "yaxis.range": yr1,
             "xaxis2.range": xr2, "yaxis2.range": yr2},
  };
}

/* ---------------- wiring ---------------- */
const PARAMS = {
  fig0: {d: __SEP0__, ox: __OX0__, oy: __OY0__},
  fig1: {d: __SEP0__},
  fig2: {d: __SEP0__, p: __RATE0__},
};
const BUILD = {
  fig0: (v) => stateR11(v.d, v.ox, v.oy),
  fig1: (v) => stateDV(v.d, 0, false),
  fig2: (v) => stateDV(v.d, v.p, true),
};

function redraw(div){
  const s = BUILD[div](PARAMS[div]);
  Plotly.update(div, s.data, s.layout);
}

document.querySelectorAll("input[type=range]").forEach((el) => {
  const out = el.parentElement.querySelector("output");
  const dec = +el.dataset.dec, unit = el.dataset.unit;
  el.addEventListener("input", () => {
    const v = +el.value;
    PARAMS[el.dataset.fig][el.dataset.key] = v;
    out.innerHTML = v.toFixed(dec) + unit;
    redraw(el.dataset.fig);
  });
});
"""

def geometry_js():
    subs = {
        "__INK__": INK, "__MUTED__": MUTED, "__TRACK__": TRACK, "__POS__": POS,
        "__DISP__": DISP, "__VEL__": VEL, "__ACC__": ACC, "__LIMIT__": LIMIT,
        "__SERIF__": SERIF, "__MONO__": MONO,
        "__THA__": repr(float(THA)), "__SEP0__": repr(float(SEP_0)),
        "__RATE0__": repr(float(RATE_0)),
        "__OX0__": repr(float(ORIGIN_0[0])), "__OY0__": repr(float(ORIGIN_0[1])),
    }
    js = GEOMETRY_JS
    for k, v in subs.items():
        js = js.replace(k, str(v))
    return js

# ---------------------------------------------------------------- output
PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>33-141 Week 3 — Vectors on a Circular Track</title>
<style>
  body {{ margin:0; padding:26px 18px 60px; background:{paper}; color:{ink}; font-family:{sans}; }}
  .stack {{ max-width:1000px; margin:0 auto; display:flex; flex-direction:column; gap:40px; }}
  .controls {{ display:flex; flex-wrap:wrap; gap:12px 34px; padding:14px 8px 2px;
               border-top:1px solid #DCE2DC; }}
  .ctl {{ display:grid; grid-template-columns:auto 190px auto; align-items:center; gap:12px;
          font-family:{mono}; font-size:11.5px; letter-spacing:.06em; color:{muted}; }}
  .ctl .name {{ text-transform:uppercase; }}
  .ctl output {{ font-size:13px; font-weight:600; color:{ink}; font-variant-numeric:tabular-nums;
                 min-width:56px; text-align:right; }}
  input[type=range] {{ -webkit-appearance:none; appearance:none; width:190px; height:18px;
                       background:transparent; cursor:pointer; margin:0; }}
  input[type=range]::-webkit-slider-runnable-track {{ height:2px; background:#C3CBC3; border-radius:2px; }}
  input[type=range]::-moz-range-track {{ height:2px; background:#C3CBC3; border-radius:2px; }}
  input[type=range]::-webkit-slider-thumb {{ -webkit-appearance:none; width:14px; height:14px;
      border-radius:50%; background:{vel}; border:2px solid {paper}; margin-top:-6px; }}
  input[type=range]::-moz-range-thumb {{ width:14px; height:14px; border-radius:50%;
      background:{vel}; border:2px solid {paper}; }}
  input[type=range]:focus-visible {{ outline:2px solid {vel}; outline-offset:3px; border-radius:4px; }}
</style>
</head>
<body>
<div class="stack">
{blocks}
</div>
<script>
{js}
</script>
</body>
</html>
"""

def main():
    inline = "--inline" in sys.argv

    figs = [figure_r11(), figure_r12(), figure_r13()]
    blocks = []
    for i, fig in enumerate(figs):
        div = f"fig{i}"
        plot = pio.to_html(
            fig, full_html=False, div_id=div,
            include_plotlyjs=(True if inline else "cdn") if i == 0 else False,
            config=dict(displayModeBar=False, responsive=True),
            default_height="520px",
        )
        blocks.append(f"<section>{plot}{controls_html(div)}</section>")

    html = PAGE.format(paper=PAPER, ink=INK, muted=MUTED, vel=VEL, sans=SANS, mono=MONO,
                       blocks="\n".join(blocks), js=geometry_js())
    # save_html() puts the page at site/phys1/circular-vectors.html no matter
    # which directory this runs from, and keeps the <title> set in PAGE.
    save_html(html, "circular-vectors")
    print(f"  ({len(html) / 1e6:0.1f} MB, plotly {'inlined' if inline else 'from CDN'})")

if __name__ == "__main__":
    main()
