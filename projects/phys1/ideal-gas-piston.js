/* Ideal gas under a freely moving piston: 2D hard-disk molecular dynamics in the browser.
   A canvas draws the molecules coloured by speed; Plotly draws the velocity distribution,
   and the piston's history.
   Units: molecule mass m = 1 and k_B = 1, so kT is a squared speed. Gravity acts on the
   piston only. Every collision is elastic, so the total energy
   E = sum(v^2)/2 + M V^2/2 + M g Y changes only when you change the load. */
(() => {
  const $ = id => document.getElementById(id);
  const W = 2, H = 2;                 // box width and ceiling height
  const SAMPLE_DT = 0.05;             // history sampling interval
  const HISTORY_MAX = 3000;           // 150 time units of history
  const PRESSURE_TAU = 0.25;          // averaging time of the measured pressure
  const RATE_TAU = 1;                 // averaging time of the collision rate
  const HIST_FRAMES = 40, BINS = 40;  // histogram: animation frames averaged, bins
  const RAMP_TIME = 40;               // duration of a slow mass change
  const PLOT_INTERVAL = 200;          // ms between plot updates while playing
  const MAX_STEPS = 600;              // substeps per animation frame
  const M_MIN = 10, M_MAX = 2000;
  const PISTON_DRAW = 0.06;           // drawn thickness of the piston
  const NEIGHBORS = [[1, 0], [-1, 1], [0, 1], [1, 1]];
  const config = {responsive: true, displaylogo: false, scrollZoom: false,
    modeBarButtonsToRemove: ['lasso2d', 'select2d']};
  const hasPlotly = typeof window.Plotly !== 'undefined';

  // Viridis-like ramp from slow (dark purple) to fast (yellow).
  const STOPS = [[68, 1, 84], [65, 68, 135], [42, 120, 142], [34, 168, 132], [122, 209, 81], [253, 231, 37]];
  const SHADES = 24;
  const PALETTE = Array.from({length: SHADES}, (_, k) => {
    const f = k / (SHADES - 1) * (STOPS.length - 1);
    const i = Math.min(Math.floor(f), STOPS.length - 2), u = f - i;
    return `rgb(${STOPS[i].map((a, n) => Math.round(a + (STOPS[i + 1][n] - a) * u))})`;
  });

  let sim = null, playing = false, frame = null, lastStamp = null, lastPlot = 0;
  let histMode = 'speed', rate = 1;

  // ---------- physics ----------

  function gaussian() {
    let u = 0;
    while (u === 0) u = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
  }

  function createSim({N, T0, r, y0, dist, M, g, collisions, bath, Tbath}) {
    if (!(Number.isInteger(N) && N >= 2 && N <= 1000)) throw new Error('N must be a whole number from 2 to 1000.');
    if (!(T0 >= 0.1 && T0 <= 10)) throw new Error('The starting temperature must be between 0.1 and 10.');
    if (!(r >= 0.002 && r <= 0.03)) throw new Error('The disk radius must be between 0.002 and 0.03.');
    if (!(y0 >= 0.2 && y0 <= H)) throw new Error(`The starting height must be between 0.2 and ${H}.`);
    const packing = N * Math.PI * r * r / (W * y0);
    if (packing > 0.3)
      throw new Error(`The disks would cover ${(100 * packing).toFixed(0)}% of the gas area. Lower N or the radius, or raise the starting height.`);

    const x = new Float64Array(N), y = new Float64Array(N), vx = new Float64Array(N), vy = new Float64Array(N);
    const nx = Math.max(1, Math.floor(W / Math.max(2 * r, W / 120))), cell = W / nx;
    const ny = Math.ceil(H / cell) + 1;
    const head = new Int32Array(nx * ny).fill(-1), next = new Int32Array(N);

    // Random non-overlapping placement below the piston.
    const sep2 = (2.05 * r) ** 2;
    for (let i = 0; i < N; i++) {
      let placed = false;
      for (let attempt = 0; attempt < 500 && !placed; attempt++) {
        const px = r + Math.random() * (W - 2 * r), py = r + Math.random() * (y0 - 2 * r);
        const cx = Math.floor(px / cell), cy = Math.floor(py / cell);
        let clear = true;
        for (let qy = cy - 1; qy <= cy + 1 && clear; qy++) for (let qx = cx - 1; qx <= cx + 1 && clear; qx++) {
          if (qx < 0 || qy < 0 || qx >= nx || qy >= ny) continue;
          for (let j = head[qy * nx + qx]; j !== -1; j = next[j])
            if ((x[j] - px) ** 2 + (y[j] - py) ** 2 < sep2) { clear = false; break; }
        }
        if (clear) {
          x[i] = px; y[i] = py;
          const c = cy * nx + cx;
          next[i] = head[c]; head[c] = i;
          placed = true;
        }
      }
      if (!placed) throw new Error('Could not fit the disks without overlap. Lower N or the radius.');
    }

    if (dist === 'maxwell') {
      let mx = 0, my = 0;
      for (let i = 0; i < N; i++) { vx[i] = gaussian(); vy[i] = gaussian(); mx += vx[i]; my += vy[i]; }
      mx /= N; my /= N;
      let sum = 0;
      for (let i = 0; i < N; i++) { vx[i] -= mx; vy[i] -= my; sum += vx[i] ** 2 + vy[i] ** 2; }
      const scale = Math.sqrt(2 * N * T0 / sum);  // so the kinetic energy is exactly N kT0
      for (let i = 0; i < N; i++) { vx[i] *= scale; vy[i] *= scale; }
    } else {  // every molecule at speed sqrt(2 kT0), random direction
      const speed = Math.sqrt(2 * T0);
      for (let i = 0; i < N; i++) {
        const a = 2 * Math.PI * Math.random();
        vx[i] = speed * Math.cos(a); vy[i] = speed * Math.sin(a);
      }
    }

    const s = {N, T0, r, y0, x, y, vx, vy, nx, ny, cell, head, next, bucket: new Uint8Array(N),
      t: 0, Y: y0, V: 0, M, g, collisions, bath, Tbath, heat: 0, wext: 0, E0: 0, rate: 0, ramp: null, nextSample: 0,
      pressure: N * T0 / ((W - 2 * r) * (y0 - 2 * r)), Tnow: T0, last: null,
      hist: null, rec: {t: [], y: [], yf: [], gas: [], piston: [], total: [], pKin: []}};
    s.E0 = energies(s).total;
    record(s);
    return s;
  }

  function energies(s) {
    let sx = 0, sy = 0;
    for (let i = 0; i < s.N; i++) { sx += s.vx[i] ** 2; sy += s.vy[i] ** 2; }
    const gas = (sx + sy) / 2, piston = s.M * s.V ** 2 / 2 + s.M * s.g * s.Y;
    return {sx, sy, gas, piston, total: gas + piston, T: gas / s.N};
  }

  // Equilibrium the gas and piston settle to with the present energy E. For an ideal gas
  // of N molecules whose centres fill a height Y - 2r, equipartition gives <MgY> = (N+1)kT + 2rMg,
  // the piston's kinetic energy kT/2 and the gas kinetic energy NkT.
  // With the heat bath on, the energy is not fixed and the gas ends at the bath temperature.
  function finalState(s, E) {
    const T = s.bath ? s.Tbath : (E - 2 * s.r * s.M * s.g) / (2 * s.N + 1.5);
    return {T, y: (s.N + 1) * T / (s.M * s.g) + 2 * s.r};
  }

  // Changing the load does work on the system; keep a tally so energy drift stays visible.
  function setLoad(s, M, g) {
    const before = s.M * s.V ** 2 / 2 + s.M * s.g * s.Y;
    s.M = M; s.g = g;
    s.wext += s.M * s.V ** 2 / 2 + s.M * s.g * s.Y - before;
  }

  function pair(s, i, j, d2max) {
    const dx = s.x[j] - s.x[i], dy = s.y[j] - s.y[i], d2 = dx * dx + dy * dy;
    if (d2 >= d2max || d2 === 0) return 0;
    const dot = dx * (s.vx[j] - s.vx[i]) + dy * (s.vy[j] - s.vy[i]);
    if (dot >= 0) return 0;  // already separating
    const k = dot / d2;      // equal masses swap their velocity components along the line of centres
    s.vx[i] += k * dx; s.vy[i] += k * dy;
    s.vx[j] -= k * dx; s.vy[j] -= k * dy;
    return 1;
  }

  function collide(s) {
    const {N, x, y, nx, ny, cell, head, next} = s, d2max = 4 * s.r * s.r;
    head.fill(-1);
    for (let i = 0; i < N; i++) {
      const cx = Math.min(nx - 1, Math.max(0, Math.floor(x[i] / cell)));
      const cy = Math.min(ny - 1, Math.max(0, Math.floor(y[i] / cell)));
      const c = cy * nx + cx;
      next[i] = head[c]; head[c] = i;
    }
    let hits = 0;
    for (let cy = 0; cy < ny; cy++) for (let cx = 0; cx < nx; cx++) {
      for (let i = head[cy * nx + cx]; i !== -1; i = next[i]) {
        for (let j = next[i]; j !== -1; j = next[j]) hits += pair(s, i, j, d2max);
        for (const [ox, oy] of NEIGHBORS) {
          const qx = cx + ox, qy = cy + oy;
          if (qx < 0 || qx >= nx || qy >= ny) continue;
          for (let j = head[qy * nx + qx]; j !== -1; j = next[j]) hits += pair(s, i, j, d2max);
        }
      }
    }
    return hits;
  }

  function step(s, dt) {
    if (s.ramp) {
      const f = Math.min(1, (s.t - s.ramp.t0) / RAMP_TIME);
      setLoad(s, s.ramp.from + (s.ramp.to - s.ramp.from) * f, s.g);
      if (f >= 1) s.ramp = null;
    }
    const {N, r, x, y, vx, vy} = s, M = s.M;
    // The piston falls freely between hits; constant force, so this update is exact.
    s.Y += s.V * dt - s.g * dt * dt / 2;
    s.V -= s.g * dt;
    if (s.Y > H) {  // elastic stop at the ceiling; the speed keeps M V^2/2 + M g Y unchanged
      s.V = -Math.sqrt(s.V ** 2 + 2 * s.g * (s.Y - H));
      s.Y = H;
    }
    if (s.Y < 2 * r) { s.Y = 2 * r; s.V = Math.abs(s.V); }

    let impulse = 0, heat = 0;
    const right = W - r;
    for (let i = 0; i < N; i++) {
      x[i] += vx[i] * dt; y[i] += vy[i] * dt;
      if (x[i] < r) { x[i] = 2 * r - x[i]; vx[i] = Math.abs(vx[i]); }
      else if (x[i] > right) { x[i] = 2 * right - x[i]; vx[i] = -Math.abs(vx[i]); }
      if (y[i] < r) {
        y[i] = 2 * r - y[i];
        if (s.bath) {
          // Thermal wall: the molecule leaves with a fresh velocity from the bath. The normal
          // component follows the flux-weighted (Rayleigh) distribution, the tangential one a Gaussian.
          const before = vx[i] ** 2 + vy[i] ** 2;
          vx[i] = Math.sqrt(s.Tbath) * gaussian();
          vy[i] = Math.sqrt(-2 * s.Tbath * Math.log(1 - Math.random()));
          heat += (vx[i] ** 2 + vy[i] ** 2 - before) / 2;
        } else vy[i] = Math.abs(vy[i]);
      }
      const top = s.Y - r;
      if (y[i] > top && vy[i] > s.V) {  // 1D elastic collision with the piston (masses 1 and M)
        const u = vy[i], U = s.V;
        vy[i] = ((1 - M) * u + 2 * M * U) / (1 + M);
        s.V = ((M - 1) * U + 2 * u) / (1 + M);
        impulse += u - vy[i];
        y[i] = Math.max(r, 2 * top - y[i]);
      }
    }
    s.heat += heat;
    s.pressure += (impulse / W - s.pressure * dt) / PRESSURE_TAU;
    const hits = s.collisions ? collide(s) : 0;
    s.rate += (2 * hits / N - s.rate * dt) / RATE_TAU;
    s.t += dt;
  }

  function record(s) {
    const e = energies(s), rec = s.rec;
    s.Tnow = e.T; s.last = e;
    const area = (W - 2 * s.r) * Math.max(s.Y - 2 * s.r, 1e-6);
    rec.t.push(s.t);
    rec.y.push(s.Y);
    rec.yf.push(Math.min(finalState(s, e.total).y, H));
    rec.gas.push(e.gas);
    rec.piston.push(e.piston);
    rec.total.push(e.total);
    rec.pKin.push(e.sy / area);
    if (rec.t.length > HISTORY_MAX) for (const k in rec) rec[k].shift();
    s.nextSample = s.t + SAMPLE_DT;
  }

  function advance(s, span) {
    const dtMax = Math.min(0.005, 0.125 * s.r / Math.sqrt(s.Tnow));
    let n = Math.ceil(span / dtMax), dt = span / n;
    if (n > MAX_STEPS) { n = MAX_STEPS; dt = dtMax; }  // too slow to keep up: run behind real time
    for (let k = 0; k < n; k++) {
      step(s, dt);
      if (s.t >= s.nextSample) record(s);
    }
  }

  // Histograms averaged over the last HIST_FRAMES animation frames.
  // The temperature the gas is heading to: the bath's, or (without a bath) its current one.
  function targetT(s) {
    return s.bath ? s.Tbath : energies(s).T;
  }

  // The bin range follows the larger of the target and current kT, and is only rebuilt when that
  // scale leaves a generous band, so the axes stay put while the gas approaches its target.
  function sampleHistogram(s) {
    const Tnow = energies(s).T, Tt = targetT(s), T = Math.max(Tnow, Tt);
    if (!s.hist || T > 1.3 * s.hist.T || T < s.hist.T / 1.6) {
      const vmax = 4 * Math.sqrt(T);
      // Fixed y-axis tops: 1.6 times the equilibrium peak at the colder of the two temperatures
      // (2D Maxwell peak e^(-1/2)/sqrt(kT), Gaussian peak 1/sqrt(2 pi kT)). A sharp starting spike gets clipped.
      const Tlow = Math.min(Tnow, Tt);
      s.hist = {T, vmax, ring: [], speed: new Float64Array(BINS), cx: new Float64Array(BINS), cy: new Float64Array(BINS),
        ySpeed: 1.6 * Math.exp(-0.5) / Math.sqrt(Tlow), yComp: 1.6 / Math.sqrt(2 * Math.PI * Tlow)};
    }
    const h = s.hist, speed = new Float64Array(BINS), cx = new Float64Array(BINS), cy = new Float64Array(BINS);
    let sv = 0, sv2 = 0;
    for (let i = 0; i < s.N; i++) {
      const v = Math.hypot(s.vx[i], s.vy[i]);
      sv += v; sv2 += v * v;
      const b = Math.floor(v / h.vmax * BINS);
      if (b < BINS) speed[b]++;
      const bx = Math.floor((s.vx[i] / h.vmax + 1) / 2 * BINS), by = Math.floor((s.vy[i] / h.vmax + 1) / 2 * BINS);
      if (bx >= 0 && bx < BINS) cx[bx]++;
      if (by >= 0 && by < BINS) cy[by]++;
    }
    h.ring.push({speed, cx, cy, sv, sv2});
    h.sv = (h.sv || 0) + sv; h.sv2 = (h.sv2 || 0) + sv2;
    for (let b = 0; b < BINS; b++) { h.speed[b] += speed[b]; h.cx[b] += cx[b]; h.cy[b] += cy[b]; }
    if (h.ring.length > HIST_FRAMES) {
      const old = h.ring.shift();
      h.sv -= old.sv; h.sv2 -= old.sv2;
      for (let b = 0; b < BINS; b++) { h.speed[b] -= old.speed[b]; h.cx[b] -= old.cx[b]; h.cy[b] -= old.cy[b]; }
    }
    updateSpeedMarks(s);
  }

  // Characteristic speeds measured from the gas, not from the Maxwell formulas, so they stay honest
  // when the distribution is not Maxwellian. v_avg and v_rms are moments over the histogram's
  // 40-frame window. The top of a Maxwell curve is flat, so a single highest bin jumps around: v_mp is
  // instead the vertex of a least-squares parabola fitted to the bins near the peak of the lightly
  // smoothed histogram (biased by only ~2% for a Maxwell curve). An exponential average then calms all
  // three: about 0.2 s for the moments and 1.7 s for v_mp, whose finite-N fluctuations are much larger.
  function updateSpeedMarks(s) {
    const h = s.hist, n = h.ring.length * s.N, bw = h.vmax / BINS;
    const avg = h.sv / n, rms = Math.sqrt(h.sv2 / n);
    const smooth = Array.from(h.speed, (_, b) => {
      let sum = 0, wsum = 0;
      for (let k = -2; k <= 2; k++) {
        const w = [1, 4, 6, 4, 1][k + 2], c = h.speed[b + k];
        if (c !== undefined) { sum += w * c; wsum += w; }
      }
      return sum / wsum;
    });
    let peak = 0;
    for (let b = 1; b < BINS; b++) if (smooth[b] > smooth[peak]) peak = b;
    const mp = (peak + 0.5 + parabolaVertex(h.speed, peak, 4)) * bw;
    const m = s.marks;
    if (!m) { s.marks = {mp, avg, rms}; return; }
    m.mp += 0.01 * (mp - m.mp); m.avg += 0.08 * (avg - m.avg); m.rms += 0.08 * (rms - m.rms);
  }

  // Offset (in bins, from bin `centre`) of the vertex of y = a + b u + c u^2 fitted to bins centre±half.
  // Falls back to 0 when the fit is not a downward parabola or puts the vertex outside the window.
  function parabolaVertex(y, centre, half) {
    let S0 = 0, S1 = 0, S2 = 0, S3 = 0, S4 = 0, T0 = 0, T1 = 0, T2 = 0;
    for (let u = -half; u <= half; u++) {
      const c = y[centre + u];
      if (c === undefined) continue;
      const u2 = u * u;
      S0 += 1; S1 += u; S2 += u2; S3 += u2 * u; S4 += u2 * u2;
      T0 += c; T1 += c * u; T2 += c * u2;
    }
    // Solve the 3x3 normal equations by Cramer's rule.
    const det = (a, b, c, d, e, f, g, h, i) => a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    const D = det(S0, S1, S2, S1, S2, S3, S2, S3, S4);
    if (!D) return 0;
    const B = det(S0, T0, S2, S1, T1, S3, S2, T2, S4) / D;
    const C = det(S0, S1, T0, S1, S2, T1, S2, S3, T2) / D;
    if (C >= 0) return 0;
    const u = -B / (2 * C);
    return Math.abs(u) <= half ? u : 0;
  }

  // ---------- drawing ----------

  function speedScale(s) { return 3 * Math.sqrt(s.T0); }

  function draw(s) {
    const c = $('gas'), rect = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
    if (!w || !h) return;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const ctx = c.getContext('2d');
    const pad = 8 * dpr, k = Math.min((w - 2 * pad) / W, (h - 2 * pad) / (H + PISTON_DRAW));
    const ox = (w - W * k) / 2, oy = pad + PISTON_DRAW * k;
    const X = x => ox + x * k, Y = y => oy + (H - y) * k;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#eef2ee';
    ctx.fillRect(X(0), Y(H), W * k, (H - s.Y) * k);
    ctx.fillStyle = '#121720';
    ctx.fillRect(X(0), Y(s.Y), W * k, s.Y * k);

    const vmax = speedScale(s), rad = Math.max(s.r * k, 1.5 * dpr);
    for (let i = 0; i < s.N; i++)
      s.bucket[i] = Math.min(SHADES - 1, Math.floor(Math.hypot(s.vx[i], s.vy[i]) / vmax * SHADES));
    for (let b = 0; b < SHADES; b++) {
      ctx.fillStyle = PALETTE[b];
      ctx.beginPath();
      for (let i = 0; i < s.N; i++) {
        if (s.bucket[i] !== b) continue;
        const px = X(s.x[i]), py = Y(s.y[i]);
        ctx.moveTo(px + rad, py);
        ctx.arc(px, py, rad, 0, 2 * Math.PI);
      }
      ctx.fill();
    }

    // Where the piston will settle, as ticks on both walls.
    const yf = s.rec.yf[s.rec.yf.length - 1];
    ctx.strokeStyle = '#b26a12';
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.moveTo(X(0) - 7 * dpr, Y(yf)); ctx.lineTo(X(0) + 7 * dpr, Y(yf));
    ctx.moveTo(X(W) - 7 * dpr, Y(yf)); ctx.lineTo(X(W) + 7 * dpr, Y(yf));
    ctx.stroke();

    ctx.fillStyle = '#6c7a70';
    ctx.fillRect(X(0), Y(s.Y + PISTON_DRAW), W * k, PISTON_DRAW * k);
    ctx.fillStyle = '#fff';
    ctx.font = `600 ${Math.round(11 * dpr)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`M = ${s.M.toFixed(0)}`, X(W / 2), Y(s.Y + PISTON_DRAW / 2));

    ctx.strokeStyle = '#1a211d';
    ctx.lineWidth = 2.5 * dpr;
    ctx.beginPath();
    ctx.moveTo(X(0), Y(H) - PISTON_DRAW * k); ctx.lineTo(X(0), Y(0)); ctx.lineTo(X(W), Y(0)); ctx.lineTo(X(W), Y(H) - PISTON_DRAW * k);
    ctx.stroke();
    if (s.bath) {  // the floor is the heat bath
      ctx.strokeStyle = '#d0452f';
      ctx.lineWidth = 6 * dpr;
      ctx.beginPath();
      ctx.moveTo(X(0), Y(0) + 3 * dpr); ctx.lineTo(X(W), Y(0) + 3 * dpr);
      ctx.stroke();
    }
  }

  // ---------- plots ----------

  const axis = {gridcolor: '#e8ede8', zeroline: false, linecolor: '#afbeb2', ticks: 'outside', tickcolor: '#afbeb2'};
  const base = {paper_bgcolor: '#fff', plot_bgcolor: '#fff', font: {family: 'system-ui, sans-serif', size: 12, color: '#1a211d'},
    legend: {orientation: 'h', x: 0, y: 1.02, yanchor: 'bottom', font: {size: 11}}};

  function distTraces(s) {
    const h = s.hist, frames = Math.max(1, h.ring.length), T = energies(s).T, Tt = targetT(s);
    const line = n => Array.from({length: n}, (_, k) => k / (n - 1));
    // With the heat bath on: a solid curve at kT_bath (the target) and a dashed one at the current kT.
    // Without it: a single solid curve at the current kT.
    const solid = {type: 'scatter', mode: 'lines', line: {color: '#b26a12', width: 2.5}, hoverinfo: 'skip'};
    const dashed = {type: 'scatter', mode: 'lines', line: {color: '#59645d', width: 1.5, dash: 'dash'}, hoverinfo: 'skip'};
    const curves = (f, kind) => s.bath
      ? [{...solid, y: f(Tt), name: `${kind} at kT<sub>bath</sub> = ${Tt.toFixed(2)}`},
         {...dashed, y: f(T), name: `${kind} at current kT = ${T.toFixed(2)}`}]
      : [{...solid, y: f(T), name: `${kind} at current kT = ${T.toFixed(2)}`}];
    if (histMode === 'speed') {
      const bw = h.vmax / BINS, xs = Array.from({length: BINS}, (_, b) => (b + 0.5) * bw);
      const vs = line(200).map(u => u * h.vmax);
      const maxwell = kT => vs.map(v => v / kT * Math.exp(-v * v / (2 * kT)));
      return [
        {type: 'bar', x: xs, y: Array.from(h.speed, c => c / (frames * s.N * bw)), width: bw * 0.92,
          marker: {color: '#3f6fa8', opacity: 0.6}, name: 'Simulation', hovertemplate: 'v = %{x:.2f}<br>%{y:.3f}<extra></extra>'},
        ...curves(maxwell, 'Maxwell').map(c => ({...c, x: vs})),
      ];
    }
    const bw = 2 * h.vmax / BINS, xs = Array.from({length: BINS}, (_, b) => -h.vmax + (b + 0.5) * bw);
    const vs = line(200).map(u => (2 * u - 1) * h.vmax);
    const gauss = kT => vs.map(v => Math.exp(-v * v / (2 * kT)) / Math.sqrt(2 * Math.PI * kT));
    return [
      {type: 'scatter', mode: 'lines', line: {shape: 'hvh', color: '#3f6fa8', width: 2}, x: xs,
        y: Array.from(h.cx, c => c / (frames * s.N * bw)), name: 'v<sub>x</sub>'},
      {type: 'scatter', mode: 'lines', line: {shape: 'hvh', color: '#2f7d55', width: 2}, x: xs,
        y: Array.from(h.cy, c => c / (frames * s.N * bw)), name: 'v<sub>y</sub>'},
      ...curves(gauss, 'Gaussian').map(c => ({...c, x: vs})),
    ];
  }

  function distLayout(s) {
    const h = s.hist, speed = histMode === 'speed';
    return {...base, margin: {l: 56, r: 14, t: 34, b: 46}, bargap: 0, uirevision: histMode,
      xaxis: {...axis, range: speed ? [0, h.vmax] : [-h.vmax, h.vmax], title: {text: speed ? 'speed v' : 'velocity component'}},
      yaxis: {...axis, range: [0, speed ? h.ySpeed : h.yComp], title: {text: 'probability density'}},
      ...(speed && s.marks ? speedMarks(s.marks) : {})};
  }

  // Vertical lines for v_mp, v_avg and v_rms, labelled at staggered heights so they never overlap.
  function speedMarks(m) {
    const marks = [['mp', m.mp, '#71549e', 0.97], ['avg', m.avg, '#2f7d55', 0.89], ['rms', m.rms, '#b03a30', 0.81]];
    return {
      shapes: marks.map(([, v, color]) => ({type: 'line', xref: 'x', yref: 'paper', x0: v, x1: v, y0: 0, y1: 1,
        line: {color, width: 2}})),
      annotations: marks.map(([name, v, color, y]) => ({xref: 'x', yref: 'paper', x: v, y, xanchor: 'left', xshift: 4,
        showarrow: false, text: `v<sub>${name}</sub> = ${v.toFixed(2)}`, font: {color, size: 12},
        bgcolor: 'rgba(255,255,255,0.85)'})),
    };
  }

  function historyTraces(s) {
    // Copies: Plotly.react skips arrays it has already seen, and the record arrays grow in place.
    const r = Object.fromEntries(Object.entries(s.rec).map(([k, v]) => [k, v.slice()]));
    return [
      {x: r.t, y: r.y, name: 'Piston height y<sub>p</sub>', line: {color: '#3f6fa8', width: 1.8}},
      {x: r.t, y: r.yf, name: 'Predicted final height', line: {color: '#b26a12', width: 1.8, dash: 'dash'}},
      {x: r.t, y: r.gas, yaxis: 'y2', name: 'Gas KE', line: {color: '#b03a30', width: 1.6}},
      {x: r.t, y: r.piston, yaxis: 'y2', name: 'Piston ½MV² + MgY', line: {color: '#2f7d55', width: 1.6}},
      {x: r.t, y: r.total, yaxis: 'y2', name: 'Total E', line: {color: '#1a211d', width: 1.8}},
    ].map(t => ({type: 'scatter', mode: 'lines', hovertemplate: '%{y:.3f}<extra></extra>', ...t}));
  }

  function historyLayout() {
    return {...base, margin: {l: 58, r: 14, t: 52, b: 46}, uirevision: 'history', hovermode: 'x unified',
      xaxis: {...axis, anchor: 'y2', title: {text: 'time t'}},
      yaxis: {...axis, domain: [0.55, 1], range: [0, H * 1.03], title: {text: 'height'}},
      yaxis2: {...axis, domain: [0, 0.43], rangemode: 'tozero', title: {text: 'energy'}}};
  }

  // ---------- page ----------

  const fmt = (v, d = 2) => Number.isFinite(v) ? v.toFixed(d) : '—';

  function refresh(s) {
    const e = energies(s);  // current, so it matches the running heat and work tallies
    $('t-now').textContent = fmt(s.t, 1);
    $('y-now').textContent = fmt(s.Y, 3);
    $('yf-now').textContent = fmt(s.rec.yf[s.rec.yf.length - 1], 3);
    $('T-now').textContent = fmt(e.T, 3);
    $('Txy-now').textContent = `${fmt(e.sx / s.N)} / ${fmt(e.sy / s.N)}`;
    $('rate-now').textContent = s.collisions ? fmt(s.rate, 1) : 'off';
    $('pm-now').textContent = fmt(s.pressure, 1);
    $('pk-now').textContent = fmt(s.rec.pKin[s.rec.pKin.length - 1], 1);
    $('pw-now').textContent = fmt(s.M * s.g / W, 1);
    const drift = e.total - s.E0 - s.wext - s.heat;
    $('heat-now').textContent = fmt(s.heat, 1);
    $('drift-now').textContent = `${fmt(drift, 3)} (${(100 * drift / s.E0).toFixed(3)}%)`;
    $('clock').textContent = `t = ${fmt(s.t, 1)}`;
    if (s.ramp) showMass(s.M);
    $('ramp-note').textContent = s.ramp
      ? `Changing M from ${s.ramp.from.toFixed(0)} to ${s.ramp.to.toFixed(0)}: ${Math.min(100, 100 * (s.t - s.ramp.t0) / RAMP_TIME).toFixed(0)}% done.`
      : '';
    const vmax = speedScale(s);
    $('scale-mid').textContent = fmt(vmax / 2, 2);
    $('scale-max').textContent = `≥ ${fmt(vmax, 2)}`;
    if (!hasPlotly) return;
    Plotly.react('dist', distTraces(s), distLayout(s), config);
    Plotly.react('history', historyTraces(s), historyLayout(), config);
  }

  function setStatus(message, error = false) {
    $('status').hidden = !message;
    $('status').textContent = message;
    $('status').classList.toggle('error', error);
  }

  const num = id => Number($(id).value);
  function settings() {
    return {N: Math.round(num('n-number')), T0: num('temp-number'), r: num('radius-number'),
      y0: num('height-number'), dist: $('start-velocities').value, M: num('mass-number'), g: num('gravity-number'),
      collisions: $('collisions').checked, bath: $('bath').checked, Tbath: num('bath-temp-number')};
  }

  function restart() {
    let next;
    try {
      next = createSim(settings());
    } catch (err) {
      setStatus(err.message, true);
      return;
    }
    sim = next;
    setStatus(hasPlotly ? '' : 'Plotly did not load, so the plots are off. The simulation still runs.', !hasPlotly);
    sampleHistogram(sim);
    draw(sim);
    refresh(sim);
  }

  function tick(stamp) {
    frame = requestAnimationFrame(tick);
    if (lastStamp !== null) {
      advance(sim, Math.min(0.05, (stamp - lastStamp) / 1000) * rate);
      sampleHistogram(sim);
    }
    lastStamp = stamp;
    draw(sim);
    if (stamp - lastPlot > PLOT_INTERVAL) { lastPlot = stamp; refresh(sim); }
  }
  function play() {
    if (playing || !sim) return;
    playing = true;
    $('play').textContent = 'Pause';
    lastStamp = null;
    frame = requestAnimationFrame(tick);
  }
  function pause() {
    playing = false;
    $('play').textContent = 'Play';
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    if (sim) refresh(sim);
  }

  // A range slider and a number box that show the same value.
  function link(name, {digits = 2, toNumber = v => v, toRange = v => v, onChange}) {
    const range = $(name), box = $(`${name}-number`);
    range.addEventListener('input', () => { box.value = toNumber(Number(range.value)).toFixed(digits); onChange(); });
    box.addEventListener('change', () => {
      let v = Number(box.value);
      if (!Number.isFinite(v)) v = toNumber(Number(range.value));
      v = Math.min(Number(box.max), Math.max(Number(box.min), v));
      box.value = v.toFixed(digits);
      range.value = toRange(v);
      onChange();
    });
  }

  function showMass(M) {
    $('mass-number').value = M.toFixed(0);
    $('mass').value = Math.log10(M);
  }
  function setMass(target, slow) {
    if (!sim) return;
    target = Math.min(M_MAX, Math.max(M_MIN, target));
    if (slow) {
      sim.ramp = {from: sim.M, to: target, t0: sim.t};
      play();
    } else {
      sim.ramp = null;
      setLoad(sim, target, sim.g);
      showMass(target);
    }
    draw(sim);
    refresh(sim);
  }

  for (const name of ['n', 'temp', 'radius', 'height'])
    link(name, {digits: name === 'n' ? 0 : name === 'radius' ? 3 : 2, onChange: restart});
  $('start-velocities').addEventListener('change', restart);
  link('mass', {digits: 0, toNumber: v => 10 ** v, toRange: v => Math.log10(v),
    onChange: () => setMass(num('mass-number'), false)});
  link('gravity', {onChange: () => { if (sim) { setLoad(sim, sim.M, num('gravity-number')); draw(sim); refresh(sim); } }});
  link('rate', {onChange: () => { rate = num('rate-number'); }});
  $('collisions').addEventListener('change', () => { if (sim) { sim.collisions = $('collisions').checked; refresh(sim); } });
  // The predicted final height depends on the bath, so update the latest record too.
  function bathChanged() {
    if (!sim) return;
    sim.bath = $('bath').checked;
    sim.Tbath = num('bath-temp-number');
    sim.rec.yf[sim.rec.yf.length - 1] = Math.min(finalState(sim, energies(sim).total).y, H);
    draw(sim);
    refresh(sim);
  }
  $('bath').addEventListener('change', bathChanged);
  link('bath-temp', {onChange: bathChanged});

  $('play').addEventListener('click', () => (playing ? pause() : play()));
  $('reset').addEventListener('click', restart);
  $('balance').addEventListener('click', () => {
    const {N, T0, r, M, g} = settings();
    const y0 = Math.min(H - 0.05, Math.max(0.2, N * T0 / (M * g) + 2 * r));
    $('height-number').value = y0.toFixed(2);
    $('height').value = y0;
    restart();
  });
  $('double-now').addEventListener('click', () => setMass(2 * sim.M, false));
  $('halve-now').addEventListener('click', () => setMass(sim.M / 2, false));
  $('double-slow').addEventListener('click', () => setMass(2 * sim.M, true));
  $('halve-slow').addEventListener('click', () => setMass(sim.M / 2, true));
  for (const [id, mode] of [['mode-speed', 'speed'], ['mode-components', 'components']]) {
    $(id).addEventListener('click', () => {
      histMode = mode;
      $('mode-speed').setAttribute('aria-pressed', String(mode === 'speed'));
      $('mode-components').setAttribute('aria-pressed', String(mode === 'components'));
      if (sim) refresh(sim);
    });
  }

  $('colorbar').style.background = `linear-gradient(to right, ${PALETTE.join(', ')})`;
  new ResizeObserver(() => { if (sim && !playing) draw(sim); }).observe($('gas'));
  rate = num('rate-number');
  restart();
  for (const id of ['play', 'reset']) $(id).disabled = false;
})();
