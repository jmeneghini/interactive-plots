// Neutral mesons as vectors in (uū, dd̄, ss̄) flavor space.
// Every figure is rebuilt with Plotly.react on each change; uirevision keeps the
// camera where the reader left it.

const C = {
  ink: "#1A211D", muted: "#8A948E", faint: "#C3CBC3", paper: "#FAFBF9",
  pi: "#3F6FA8", e8: "#127A66", e1: "#B26A12",
  phys1: "#B03A30", phys2: "#71549E",
  plane: "#127A66",
};
const SERIF = "Georgia, 'Times New Roman', serif";
const MONO = "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace";
const DEG = Math.PI / 180;
const U = "uū", D = "dd̄", S = "ss̄";

// ------------------------------------------------------------- vector algebra
const add = (a, b) => a.map((x, i) => x + b[i]);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const mul = (a, s) => a.map((x) => x * s);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.sqrt(dot(a, a));
const unit = (a) => mul(a, 1 / (norm(a) || 1));
const lin = (pairs) => pairs.reduce((acc, [s, v]) => add(acc, mul(v, s)), [0, 0, 0]);

const EU = [1, 0, 0], ED = [0, 1, 0], ES = [0, 0, 1];
const PI0 = unit([1, -1, 0]);
const ETA8 = unit([1, 1, -2]);
const ETA1 = unit([1, 1, 1]);

// Rodrigues rotation of v about unit axis k by angle a.
function rotate(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c)));
}

// Axis and angle of the rotation R whose columns are π⁰, η₈, η₁ (det R = +1),
// i.e. the rotation taking (uū, dd̄, ss̄) onto (π⁰, η₈, η₁).
const R_AXIS_ANGLE = (() => {
  const R = [0, 1, 2].map((r) => [PI0[r], ETA8[r], ETA1[r]]);
  const angle = Math.acos((R[0][0] + R[1][1] + R[2][2] - 1) / 2);
  const axis = unit([R[2][1] - R[1][2], R[0][2] - R[2][0], R[1][0] - R[0][1]]);
  return { axis, angle };
})();

// ------------------------------------------------------------- formatting
const f = (x, n = 3) => (Math.abs(x) < 5e-4 ? 0 : x).toFixed(n).replace(/^(-?)0\./, "$10.");
const sgn = (x, n = 3) => (x < -5e-4 ? "−" : "+") + Math.abs(x).toFixed(n);
function combo(v) {
  // "0.707 uū − 0.707 dd̄" style text, dropping zero terms.
  const parts = [];
  [[v[0], U], [v[1], D], [v[2], S]].forEach(([c, name]) => {
    if (Math.abs(c) < 5e-4) return;
    const mag = Math.abs(c).toFixed(3);
    parts.push(parts.length ? `${c < 0 ? "−" : "+"} ${mag} ${name}` : `${c < 0 ? "−" : ""}${mag} ${name}`);
  });
  return parts.join(" ") || "0";
}

// ------------------------------------------------------------- traces
function line(pts, color, width = 3, dash = "solid", name = "") {
  return {
    type: "scatter3d", mode: "lines", hoverinfo: name ? "name" : "skip", name,
    x: pts.map((p) => p[0]), y: pts.map((p) => p[1]), z: pts.map((p) => p[2]),
    line: { color, width, dash }, showlegend: false,
  };
}
// Labels are scene annotations rather than scatter3d text: WebGL text renders
// some glyphs (ω, φ, ρ, subscripts) at inconsistent sizes. render() sorts them out.
function label(at, text, color, size = 17) {
  return {
    _ann: {
      x: at[0], y: at[1], z: at[2], text, showarrow: false,
      xanchor: "center", yanchor: "middle", font: { family: SERIF, size, color },
    },
  };
}
function render(div, items, layout) {
  layout.scene.annotations = items.filter((t) => t._ann).map((t) => t._ann);
  Plotly.react(div, items.filter((t) => !t._ann), layout, CONFIG);
}
function arrow(tail, tip, color, text, opts = {}) {
  const width = opts.width ?? 6, head = opts.head ?? 0.11;
  const d = sub(tip, tail), L = norm(d);
  const out = [];
  if (L < 1e-6) return out;
  const u = mul(d, 1 / L);
  const shaft = sub(tip, mul(u, Math.min(head * 0.8, L * 0.5)));
  out.push(line([tail, shaft], color, width, opts.dash ?? "solid", opts.hover ?? text ?? ""));
  out.push({
    type: "cone", anchor: "tip", hoverinfo: "skip", showscale: false,
    x: [tip[0]], y: [tip[1]], z: [tip[2]], u: [u[0]], v: [u[1]], w: [u[2]],
    sizemode: "absolute", sizeref: head, colorscale: [[0, color], [1, color]],
    lighting: { ambient: 0.9, diffuse: 0.3, specular: 0 },
  });
  if (text) {
    // Label past the tip, or beside the middle of the shaft when the tip is shared.
    const at = opts.mid ? add(mul(add(tail, tip), 0.5), opts.mid) : add(tip, mul(u, opts.labelOff ?? 0.13));
    out.push(label(at, text, color, opts.size));
  }
  return out;
}
function disc(normal, radius, color, opacity = 0.12, n = 72) {
  // Translucent disc through the origin, plus its rim.
  const a = unit(cross(normal, Math.abs(normal[0]) < 0.9 ? EU : ED));
  const b = cross(normal, a);
  const rim = [];
  for (let i = 0; i <= n; i++) {
    const t = (2 * Math.PI * i) / n;
    rim.push(add(mul(a, radius * Math.cos(t)), mul(b, radius * Math.sin(t))));
  }
  const pts = [[0, 0, 0], ...rim.slice(0, n)];
  const I = [], J = [], K = [];
  for (let i = 1; i <= n; i++) { I.push(0); J.push(i); K.push((i % n) + 1); }
  return [
    {
      type: "mesh3d", hoverinfo: "skip", color, opacity, flatshading: true,
      x: pts.map((p) => p[0]), y: pts.map((p) => p[1]), z: pts.map((p) => p[2]),
      i: I, j: J, k: K, lighting: { ambient: 1, diffuse: 0, specular: 0 },
    },
    line(rim, color, 1.5, "solid"),
  ];
}
function arcBetween(p, q, r, color, n = 40) {
  // Arc of radius r from direction p to direction q (both in a common plane).
  const a = unit(p), qq = unit(q);
  const ang = Math.acos(Math.max(-1, Math.min(1, dot(a, qq))));
  if (ang < 1e-3) return [];
  const b = unit(sub(qq, mul(a, dot(a, qq))));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = (ang * i) / n;
    pts.push(add(mul(a, r * Math.cos(t)), mul(b, r * Math.sin(t))));
  }
  return [line(pts, color, 2.5)];
}
function quarkAxes(len = 1, withLabels = true) {
  const out = [];
  [[EU, U], [ED, D], [ES, S]].forEach(([e, name]) => {
    out.push(line([mul(e, -len), [0, 0, 0]], C.faint, 2, "dot"));
    out.push(...arrow([0, 0, 0], mul(e, len), C.muted, withLabels ? name : "", { width: 3, head: 0.08, size: 15 }));
  });
  return out;
}

// ------------------------------------------------------------- layout & views
const VIEWS = {
  iso: { eye: viewFrom(50, 0.35, 1.6), up: { x: ETA1[0], y: ETA1[1], z: ETA1[2] } },
  charge: { eye: viewFrom(60, 1.1, 1.6), up: { x: ETA1[0], y: ETA1[1], z: ETA1[2] } },
  // Mostly down π⁰ so the η₈–η₁ mixing plane faces the reader.
  mix: { eye: vec(mul(unit(add(add(mul(ETA8, Math.cos(-40 * DEG)), mul(ETA1, Math.sin(-40 * DEG))), mul(PI0, 3))), 1.6)),
         up: { x: ETA1[0], y: ETA1[1], z: ETA1[2] } },
  down: { eye: vec(mul(ETA1, 1.6)), up: { x: ETA8[0], y: ETA8[1], z: ETA8[2] } },
  side: { eye: vec(mul(PI0, 1.6)), up: { x: ETA1[0], y: ETA1[1], z: ETA1[2] } },
};
function vec(v) { return { x: v[0], y: v[1], z: v[2] }; }
function viewFrom(azDeg, elev, r) {
  // Azimuth measured in the octet plane from π⁰ toward η₈, then raised along η₁.
  const az = azDeg * DEG;
  const d = unit(add(add(mul(PI0, Math.cos(az)), mul(ETA8, Math.sin(az))), mul(ETA1, elev)));
  return vec(mul(d, r));
}
function sceneLayout(range = 1.15, view = "iso") {
  const ax = { visible: false, range: [-range, range], showspikes: false };
  return {
    paper_bgcolor: C.paper, margin: { l: 0, r: 0, t: 0, b: 0 },
    showlegend: false, uirevision: "keep", hovermode: "closest",
    font: { family: SERIF, color: C.ink },
    scene: {
      xaxis: ax, yaxis: ax, zaxis: ax, aspectmode: "cube",
      bgcolor: C.paper, dragmode: "orbit",
      camera: { eye: VIEWS[view].eye, up: VIEWS[view].up, center: { x: 0, y: 0, z: 0 } },
    },
  };
}
const CONFIG = { displaylogo: false, responsive: true, modeBarButtonsToRemove: ["resetCameraLastSave3d"] };

function setView(div, name) {
  const v = VIEWS[name];
  Plotly.relayout(div, { "scene.camera": { eye: v.eye, up: v.up, center: { x: 0, y: 0, z: 0 } } });
}

// ------------------------------------------------------------- tables
function table(head, rows) {
  const th = head.map((h) => `<th>${h}</th>`).join("");
  const tr = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("");
  return `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}
function probBar(p, color) {
  return `<span class="bar" style="width:${Math.round(60 * p)}px;background:${color}"></span> ${p.toFixed(2)}`;
}

// ============================================================= figure 1
function drawFig1() {
  const t = +document.getElementById("t1").value;
  const showPlane = document.getElementById("plane1").getAttribute("aria-pressed") === "true";
  document.getElementById("t1o").textContent = `${Math.round(t * 100)}%`;

  const { axis, angle } = R_AXIS_ANGLE;
  const frame = [EU, ED, ES].map((e) => rotate(e, axis, t * angle));
  const finals = [PI0, ETA8, ETA1];
  const names = ["π⁰", "η₈", "η₁"], cols = [C.pi, C.e8, C.e1];

  const tr = [];
  if (showPlane) tr.push(...disc(ETA1, 1.05, C.plane, 0.1));
  tr.push(...quarkAxes());
  // The triangle through the quark-axis tips sits in a plane parallel to the octet plane.
  tr.push(line([EU, ED, ES, EU], C.faint, 2, "dash"));
  // Rotation axis.
  tr.push(line([mul(axis, -1.1), mul(axis, 1.1)], C.muted, 1.5, "dashdot", "rotation axis"));
  if (t < 0.999) finals.forEach((v, i) => tr.push(line([[0, 0, 0], v], cols[i], 2, "dot")));
  frame.forEach((v, i) => tr.push(...arrow([0, 0, 0], v, cols[i], names[i], { size: 20 })));

  render("fig1", tr, sceneLayout());

  const rows = frame.map((v, i) => [`<b style="color:${cols[i]}">${names[i]}</b>`, f(v[0]), f(v[1]), f(v[2])]);
  const gram = frame.map((v, i) => [names[i], ...frame.map((w) => f(dot(v, w), 2))]);
  document.getElementById("panel1").innerHTML =
    `<div class="cap">components (rotation ${Math.round(t * 100)}%)</div>` +
    table(["", U, D, S], rows) +
    `<div class="cap">overlaps ⟨a|b⟩</div>` +
    table(["", ...names], gram) +
    `<div class="cap">the rotation</div>` +
    `<div>angle ${(angle / DEG).toFixed(1)}°<br>axis (${axis.map((x) => f(x)).join(", ")})</div>` +
    `<div class="cap">orthogonality ⇒ inverse is the transpose</div>` +
    `<div>uū = π⁰/√2 + η₈/√6 + η₁/√3<br>dd̄ = −π⁰/√2 + η₈/√6 + η₁/√3<br>ss̄ = −2η₈/√6 + η₁/√3</div>`;
}

// ============================================================= figure 2
const PRESETS = {
  P: { theta: -11.3, family: "P" },
  V: { theta: 36.5, family: "V" },
  ideal: { theta: Math.atan(1 / Math.SQRT2) / DEG, family: "V" },
  zero: { theta: 0, family: null },
};
const FAMILY = {
  P: { iso: "π⁰", oct: "η₈", sing: "η₁", a: "η", b: "η′" },
  V: { iso: "ρ⁰", oct: "ω₈", sing: "ω₁", a: "φ", b: "ω" },
};
let family = "P";

function drawFig2() {
  const th = +document.getElementById("th2").value;
  document.getElementById("th2o").textContent = `${th.toFixed(1)}°`;
  const N = FAMILY[family];
  const c = Math.cos(th * DEG), s = Math.sin(th * DEG);
  const A = lin([[c, ETA8], [-s, ETA1]]);   // η  (or φ)
  const B = lin([[s, ETA8], [c, ETA1]]);    // η′ (or ω)

  document.getElementById("mixeq").innerHTML =
    `${N.a} = cos θ ${N.oct} − sin θ ${N.sing}, &nbsp; ${N.b} = sin θ ${N.oct} + cos θ ${N.sing}`;

  const tr = [];
  tr.push(...disc(PI0, 1.05, C.plane, 0.08));       // the η₈–η₁ plane
  tr.push(...quarkAxes());
  tr.push(line([[0, 0, 0], mul(unit([1, 1, 0]), 1.0)], C.muted, 2, "dash", "(uū + dd̄)/√2"));
  tr.push(label(add(mul(unit([1, 1, 0]), 0.62), mul(PI0, 0.16)), "(uū+dd̄)/√2", C.muted, 13));
  tr.push(...arrow([0, 0, 0], PI0, C.pi, N.iso, { size: 19 }));
  tr.push(...arrow([0, 0, 0], ETA8, C.e8, N.oct, { width: 3, head: 0.08, dash: "dash", size: 15 }));
  tr.push(...arrow([0, 0, 0], ETA1, C.e1, N.sing, { width: 3, head: 0.08, dash: "dash", size: 15 }));
  tr.push(...arcBetween(ETA8, A, 0.42, C.ink));
  if (Math.abs(th) > 2) {
    const mid = rotate(ETA8, PI0, (th * DEG) / 2 * -1);
    tr.push(label(mul(unit(mid), 0.52), "θ", C.ink, 16));
  }
  tr.push(...arrow([0, 0, 0], A, C.phys1, N.a, { width: 8, size: 22 }));
  tr.push(...arrow([0, 0, 0], B, C.phys2, N.b, { width: 8, size: 22 }));

  render("fig2", tr, sceneLayout(1.15, "mix"));

  const states = [[N.iso, PI0, C.pi], [N.a, A, C.phys1], [N.b, B, C.phys2]];
  const amp = states.map(([n, v, col]) => [`<b style="color:${col}">${n}</b>`, f(v[0]), f(v[1]), f(v[2])]);
  const prob = states.map(([n, v, col]) => [
    `<b style="color:${col}">${n}</b>`,
    probBar(v[0] * v[0] + v[1] * v[1], col),
    probBar(v[2] * v[2], col),
  ]);
  const ideal = Math.atan(1 / Math.SQRT2) / DEG;
  document.getElementById("panel2").innerHTML =
    `<div class="cap">amplitudes</div>` + table(["", U, D, S], amp) +
    `<div class="cap">quark content</div>` + table(["", "uū+dd̄", "ss̄"], prob) +
    `<div class="cap">states</div>` +
    `<div>${N.a} = ${combo(A)}<br>${N.b} = ${combo(B)}</div>` +
    `<div class="cap">from ideal mixing</div><div>θ − θ<sub>ideal</sub> = ${sgn(th - ideal, 1)}°</div>`;
}

// ============================================================= figure 3
const Q3 = {
  I3: [0.5, -0.5, 0], Y: [1 / 3, 1 / 3, -2 / 3], B: [1 / 3, 1 / 3, 1 / 3],
  S: [0, 0, -1], Q: [2 / 3, -1 / 3, -1 / 3], Q2: [4 / 9, 1 / 9, 1 / 9],
};
const QC = { I3: C.pi, Y: C.e8, B: C.e1, S: "#5C6B63", Q: C.phys1, Q2: C.phys2 };
let relation = "gmn";

function frameLines() {
  // Faint full-length guides along π⁰, η₈, η₁.
  const out = [];
  [[PI0, "π⁰", C.pi], [ETA8, "η₈", C.e8], [ETA1, "η₁", C.e1]].forEach(([v, n, col]) => {
    out.push(line([mul(v, -1.1), mul(v, 1.1)], col, 1.5, "dot", n + " axis"));
    out.push(label(mul(v, 1.2), n + " axis", col, 13));
  });
  return out;
}

function drawFig3() {
  const tr = [];
  tr.push(...disc(ETA1, 1.0, C.plane, 0.07));
  tr.push(...quarkAxes(1));
  tr.push(...frameLines());

  let text = "";
  if (relation === "gmn") {
    const halfY = mul(Q3.Y, 0.5);
    tr.push(...arrow([0, 0, 0], Q3.I3, QC.I3, "I₃", { size: 18 }));
    tr.push(...arrow([0, 0, 0], Q3.Y, QC.Y, "Y", { width: 3, head: 0.07, dash: "dash", size: 16 }));
    tr.push(...arrow(Q3.I3, add(Q3.I3, halfY), QC.Y, "Y/2", { width: 5, head: 0.08, size: 16, mid: mul(ETA1, 0.12) }));
    tr.push(line([halfY, Q3.Q], C.faint, 2, "dash"));
    tr.push(line([[0, 0, 0], halfY], C.faint, 2, "dash"));
    tr.push(...arrow([0, 0, 0], Q3.Q, QC.Q, "Q", { width: 8, size: 21 }));
    text = `<div class="cap">Gell-Mann–Nishijima</div><div class="eq">Q = I₃ + Y/2</div>` +
      `<div>I₃ ∥ π⁰ and Y ∥ η₈, so Q lies in the octet plane: q<sub>u</sub> + q<sub>d</sub> + q<sub>s</sub> = 0.</div>`;
  } else if (relation === "ybs") {
    tr.push(...arrow([0, 0, 0], Q3.B, QC.B, "B", { size: 18 }));
    tr.push(...arrow(Q3.B, add(Q3.B, Q3.S), QC.S, "S", { size: 18, mid: mul(PI0, 0.12) }));
    tr.push(line([[0, 0, 0], Q3.S], C.faint, 2, "dash"));
    tr.push(line([Q3.S, Q3.Y], C.faint, 2, "dash"));
    tr.push(...arrow([0, 0, 0], Q3.Y, QC.Y, "Y", { width: 8, size: 21 }));
    text = `<div class="cap">hypercharge</div><div class="eq">Y = B + S</div>` +
      `<div>S = −ss̄ has a singlet part; adding B cancels it, leaving Y along η₈.</div>`;
  } else {
    const comps = [[PI0, "π⁰", C.pi], [ETA8, "η₈", C.e8], [ETA1, "η₁", C.e1]];
    comps.forEach(([v, n, col]) => {
      const p = mul(v, dot(Q3.Q2, v));
      tr.push(...arrow([0, 0, 0], p, col, "", { width: 7, head: 0.06 }));
      tr.push(line([Q3.Q2, p], C.faint, 2, "dash"));
    });
    tr.push(...arrow([0, 0, 0], Q3.Q2, QC.Q2, "Q²", { width: 8, size: 21 }));
    const pr = comps.map(([v]) => dot(Q3.Q2, v));
    text = `<div class="cap">two-photon couplings ∝ ⟨M|Q²⟩</div>` +
      table(["", "⟨M|Q²⟩", "÷ π⁰"], comps.map(([, n, col], i) => [
        `<b style="color:${col}">${n}</b>`, f(pr[i]), f(pr[i] / pr[0])])) +
      `<div>1 : 1/√3 : 2√2/√3. The η₁ entry is nonzero because Tr Q² ≠ 0.</div>`;
  }

  render("fig3", tr, sceneLayout(1.15, "charge"));

  const keys = ["I3", "Y", "B", "S", "Q", "Q2"];
  const nm = { I3: "I₃", Y: "Y", B: "B", S: "S", Q: "Q", Q2: "Q²" };
  const rows = keys.map((k) => [`<b style="color:${QC[k]}">${nm[k]}</b>`,
    ...Q3[k].map((x) => f(x, 2)), f(dot(Q3[k], PI0), 2), f(dot(Q3[k], ETA8), 2), f(dot(Q3[k], ETA1), 2)]);
  document.getElementById("panel3").innerHTML = text +
    `<div class="cap">charges per quark, and their π⁰, η₈, η₁ projections</div>` +
    table(["", "u", "d", "s", "π⁰", "η₈", "η₁"], rows);
}

// ============================================================= wiring
function pressOnly(buttons, active) {
  buttons.forEach((b) => b.setAttribute("aria-pressed", b === active ? "true" : "false"));
}

function init() {
  document.getElementById("t1").addEventListener("input", drawFig1);
  const plane = document.getElementById("plane1");
  plane.addEventListener("click", () => {
    plane.setAttribute("aria-pressed", plane.getAttribute("aria-pressed") === "true" ? "false" : "true");
    drawFig1();
  });

  const presetButtons = [...document.querySelectorAll("[data-preset]")];
  const th2 = document.getElementById("th2");
  th2.addEventListener("input", () => { pressOnly(presetButtons, null); drawFig2(); });
  presetButtons.forEach((b) => b.addEventListener("click", () => {
    const p = PRESETS[b.dataset.preset];
    th2.value = p.theta.toFixed(2);
    if (p.family) family = p.family;
    pressOnly(presetButtons, b);
    drawFig2();
  }));

  const relButtons = [...document.querySelectorAll("[data-rel]")];
  relButtons.forEach((b) => b.addEventListener("click", () => {
    relation = b.dataset.rel;
    pressOnly(relButtons, b);
    drawFig3();
  }));

  document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => {
    const [div, view] = b.dataset.view.split(":");
    setView(div, view);
  }));

  drawFig1();
  drawFig2();
  drawFig3();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
