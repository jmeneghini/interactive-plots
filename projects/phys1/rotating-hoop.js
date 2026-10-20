/* Bead-on-a-rotating-hoop physics and browser controls.
   Three.js draws the hoop scene; Plotly draws the energy diagram and beta(tau). */

// A classic script with dynamic imports, so the page also works from file://,
// where browsers refuse to load <script type="module"> files.
(async () => {
  const [THREE, {OrbitControls}, {Line2}, {LineGeometry}, {LineMaterial}] = await Promise.all([
    import('three'),
    import('three/addons/controls/OrbitControls.js'),
    import('three/addons/lines/Line2.js'),
    import('three/addons/lines/LineGeometry.js'),
    import('three/addons/lines/LineMaterial.js'),
  ]);

  const $ = id => document.getElementById(id);
  const TAU_MAX = 20, SAMPLES = 1201, SUBSTEPS = 10, DEG = Math.PI / 180;
  const TRAIL_POINTS = 25, TRAIL_LENGTH = 0.7, FLOOR_Z = -1.3;
  const config = {responsive: true, displaylogo: false, scrollZoom: false,
    modeBarButtonsToRemove: ['lasso2d', 'select2d']};
  const controls = {spin: $('spin'), spinNumber: $('spin-number'), angle: $('initial-angle'),
    angleNumber: $('angle-number'), perturbation: $('perturbation'),
    friction: $('friction'), frictionNumber: $('friction-number')};
  let data, tau = 0, playing = false, rotating = false, forces = false;
  let frame = null, lastStamp = null, restartTimer = null, forceScale = 0.25;
  const history = $('history');

  // beta is signed from the bottom, tau = t sqrt(g/r), and Omega = 2 pi f sqrt(r/g).
  function stableAngle(omega) {
    return omega <= 1 ? 0 : Math.acos(1 / omega ** 2) / DEG;
  }
  // gamma is a linear drag coefficient: a tangential friction force -gamma * dbeta/dtau
  // (in units of mg), so the total energy decays at the rate gamma * (dbeta/dtau)^2.
  function simulate(omega, beta0, gamma = 0) {
    if (!(Number.isFinite(omega) && omega >= 0 && omega <= 3))
      throw new Error('Omega must be between 0 and 3');
    if (!(Number.isFinite(beta0) && beta0 >= -180 && beta0 <= 180))
      throw new Error('Starting angle must be between -180 and 180 degrees');
    if (!(Number.isFinite(gamma) && gamma >= 0 && gamma <= 2))
      throw new Error('Friction must be between 0 and 2');
    const accel = (b, w) => Math.sin(b) * (omega ** 2 * Math.cos(b) - 1) - gamma * w;
    const h = TAU_MAX / (SAMPLES - 1) / SUBSTEPS;
    const out = {omega, beta0, gamma, equilibrium:stableAngle(omega), tau:[], beta:[], rate:[],
      gravity:[], centrifugal:[], normal:[], friction:[]};
    let b = beta0 * DEG, w = 0;
    for (let n = 0; n < SAMPLES; n++) {
      const s = Math.sin(b), c = Math.cos(b);
      // Force components in the rotating hoop plane, in units of mg.
      const normal = -(w ** 2 + c + omega ** 2 * s ** 2);
      out.tau.push(n * TAU_MAX / (SAMPLES - 1));
      out.beta.push(b / DEG);
      out.rate.push(w);
      out.gravity.push([0, -1]);
      out.centrifugal.push([omega ** 2 * s, 0]);
      out.normal.push([normal * s, -normal * c]);
      out.friction.push([-gamma * w * c, -gamma * w * s]);  // along the hoop tangent
      for (let k = 0; k < SUBSTEPS; k++) {  // classic RK4
        const k1b = w, k1w = accel(b, w);
        const k2b = w + h / 2 * k1w, k2w = accel(b + h / 2 * k1b, k2b);
        const k3b = w + h / 2 * k2w, k3w = accel(b + h / 2 * k2b, k3b);
        const k4b = w + h * k3w, k4w = accel(b + h * k3b, k4b);
        b += h / 6 * (k1b + 2 * k2b + 2 * k3b + k4b);
        w += h / 6 * (k1w + 2 * k2w + 2 * k3w + k4w);
      }
    }
    return out;
  }

  function setStatus(message, error = false) {
    $('status').hidden = false;
    $('status').textContent = message;
    $('status').classList.toggle('error', error);
  }
  function enableControls() {
    for (const id of ['play', 'reset', 'center-start', 'frame-toggle', 'time']) $(id).disabled = false;
  }
  function stop() {
    playing = false;
    lastStamp = null;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    $('play').textContent = 'Play';
    $('play').setAttribute('aria-label', 'Play simulation');
  }
  function sample(time) {
    const position = Math.min(data.tau.length - 1, Math.max(0, time / TAU_MAX * (data.tau.length - 1)));
    const i = Math.floor(position), j = Math.min(i + 1, data.tau.length - 1), q = position - i;
    const lerp = (a, b) => a * (1 - q) + b * q;
    const pair = name => [lerp(data[name][i][0], data[name][j][0]),
                          lerp(data[name][i][1], data[name][j][1])];
    return {beta:lerp(data.beta[i], data.beta[j]), rate:lerp(data.rate[i], data.rate[j]),
      gravity:pair('gravity'), centrifugal:pair('centrifugal'), normal:pair('normal'),
      friction:pair('friction')};
  }

  // ---- Three.js scene. World z is the rotation axis; the hoop lies in its group's xz plane.
  const view = (() => {
    const container = $('scene');
    const renderer = new THREE.WebGLRenderer({antialias:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#ffffff');
    scene.add(new THREE.HemisphereLight('#ffffff', '#c9d3cb', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 1.8);
    sun.position.set(2, -3, 4);
    scene.add(sun);

    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
    camera.up.set(0, 0, 1);
    const presets = {lab:new THREE.Vector3(3.5, 3.5, 1.5), rotating:new THREE.Vector3(0, -5.2, 0)};
    camera.position.copy(presets.lab);
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.set(0, 0, -0.1);
    orbit.enablePan = false;
    orbit.enableZoom = false;  // keep the mouse wheel for page scrolling
    orbit.update();
    orbit.addEventListener('change', draw);

    const standard = (color, roughness = 0.5) => new THREE.MeshStandardMaterial({color, roughness});
    const fatLine = (color, width, dashed = false) => {
      const material = new LineMaterial({color, linewidth:width, dashed, dashSize:0.06, gapSize:0.05});
      const line = new Line2(new LineGeometry(), material);
      line.frustumCulled = false;
      return line;
    };

    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.2, 96),
      new THREE.MeshBasicMaterial({color:'#eef3ee'}));
    floor.position.z = FLOOR_Z;
    scene.add(floor);

    const axis = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 2.6, 16), standard('#b8c6bb'));
    axis.rotation.x = Math.PI / 2;
    scene.add(axis);

    // The hoop, bead, and in-plane force arrows rotate together by phi about z.
    const hoopGroup = new THREE.Group();
    scene.add(hoopGroup);
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(1, 0.022, 16, 160), standard('#718b78', 0.4));
    hoop.rotation.x = Math.PI / 2;
    hoopGroup.add(hoop);
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.07, 32, 16), standard('#b26a12', 0.35));
    hoopGroup.add(bead);

    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.07, 32),
      new THREE.MeshBasicMaterial({color:'#1a211d', transparent:true, opacity:0.18}));
    scene.add(shadow);

    // Horizontal circle the bead sweeps in the lab frame: a unit circle scaled to rho.
    const orbitCircle = fatLine('#b5c7bb', 1.5, true);
    orbitCircle.geometry.setPositions(Array.from({length:97}, (_, i) =>
      [Math.cos(i * Math.PI / 48), Math.sin(i * Math.PI / 48), 0]).flat());
    orbitCircle.computeLineDistances();
    scene.add(orbitCircle);

    const trail = fatLine('#e6b66d', 4);
    scene.add(trail);

    const up = new THREE.Vector3(0, 1, 0), direction = new THREE.Vector3();
    function arrow(color) {
      const group = new THREE.Group(), material = standard(color, 0.45);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 1, 12), material);
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.045, 1, 20), material);
      group.add(shaft, head);
      group.set = (origin, dx, dz) => {
        const length = Math.hypot(dx, dz), headLength = Math.min(0.09, length * 0.5);
        direction.set(dx, 0, dz).normalize();
        group.position.copy(origin);
        group.quaternion.setFromUnitVectors(up, direction);
        shaft.scale.y = length - headLength;
        shaft.position.y = (length - headLength) / 2;
        head.scale.y = headLength;
        head.position.y = length - headLength / 2;
      };
      hoopGroup.add(group);
      return group;
    }
    const arrows = {gravity:arrow('#2f7d55'), centrifugal:arrow('#b03a30'), normal:arrow('#1f7a80'),
      friction:arrow('#5b4636')};

    function resize() {
      const {clientWidth:width, clientHeight:height} = container;
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      for (const line of [orbitCircle, trail]) line.material.resolution.set(width, height);
      draw();
    }
    new ResizeObserver(resize).observe(container);

    const beadOnHoop = (beta, target) => target.set(Math.sin(beta), 0, -Math.cos(beta));
    const world = (beta, phi) => [Math.sin(beta) * Math.cos(phi), Math.sin(beta) * Math.sin(phi), -Math.cos(beta)];

    function update() {
      const state = sample(tau), beta = state.beta * DEG;
      const phi = rotating ? 0 : data.omega * tau;
      hoopGroup.rotation.z = phi;
      beadOnHoop(beta, bead.position);

      const [x, y, z] = world(beta, phi), rho = Math.abs(Math.sin(beta));
      shadow.position.set(x, y, FLOOR_Z + 0.002);
      orbitCircle.visible = !rotating && rho > 0.015;
      orbitCircle.scale.set(rho, rho, 1);
      orbitCircle.position.z = z;

      const start = Math.max(0, tau - TRAIL_LENGTH), points = [];
      for (let i = 0; i < TRAIL_POINTS; i++) {
        const t = start + (tau - start) * i / (TRAIL_POINTS - 1);
        points.push(...world(sample(t).beta * DEG, rotating ? 0 : data.omega * t));
      }
      trail.geometry.setPositions(points);

      for (const [name, group] of Object.entries(arrows)) {
        const [fx, fz] = state[name];
        group.visible = rotating && forces && Math.hypot(fx, fz) > 0.025;
        if (group.visible) group.set(bead.position, forceScale * fx, forceScale * fz);
      }
      draw();
    }
    function draw() { renderer.render(scene, camera); }
    function setFrame(isRotating) {
      camera.position.copy(isRotating ? presets.rotating : presets.lab);
      orbit.update();
    }
    return {update, setFrame};
  })();

  // Effective potential in the rotating frame, in units of mgr, shifted so its
  // minimum is zero: U(beta) = 1 - cos(beta) at Omega <= 1, and above that the
  // side wells at cos(beta) = 1/Omega^2 sit at U = 0.
  function potential(beta, omega) {
    const shift = omega <= 1 ? 1 : (omega ** 2 + omega ** -2) / 2;
    return shift - Math.cos(beta) - omega ** 2 / 2 * Math.sin(beta) ** 2;
  }
  // Top panel: U(beta), the total energy E, and the bead riding on U with a bar
  // up to E whose length is the kinetic energy K = (dbeta/dtau)^2 / 2. Without
  // friction E is fixed; with it, the E line drops and E0 marks where it started.
  // Bottom panel: the same beta(tau) path with tau running down from the shared
  // beta axis.
  const TRACE = {E:1, Kbar:2, bead:3, tauPath:5, tauDot:6, linkTop:7, linkBottom:8};
  function historyLayout(lo, hi, top) {
    const eq = data.equilibrium;
    const values = eq === 0 ? [0] : [-eq, eq];
    const grid = '#e8eee8';
    return {margin:{l:62, r:15, t:24, b:12}, paper_bgcolor:'#fff', plot_bgcolor:'#fff',
      xaxis:{anchor:'y', range:[lo, hi], fixedrange:true, gridcolor:grid, zeroline:false,
        title:{text:'β (degrees)', standoff:4}, showline:true, linecolor:'#8a948e'},
      yaxis:{domain:[0.55, 1], range:[0, top], fixedrange:true, gridcolor:grid,
        zeroline:false, title:{text:'energy / mgr'}},
      xaxis2:{anchor:'y2', matches:'x', showticklabels:false, fixedrange:true, gridcolor:grid,
        zeroline:false},
      yaxis2:{domain:[0, 0.43], range:[TAU_MAX, 0], fixedrange:true, gridcolor:grid,
        zeroline:false, title:{text:'𝜏 (increasing downward)'}},
      shapes:values.flatMap(x => ['y', 'y2'].map(yref => ({type:'line', x0:x, x1:x,
        xref:yref === 'y' ? 'x' : 'x2', yref:`${yref} domain`, y0:0, y1:1,
        line:{color:'#9e81b3', width:1.2, dash:'dash'}}))),
      annotations:[
        ...values.filter(x => x >= lo && x <= hi).map(x => ({x, y:1, xref:'x', yref:'y domain',
          text:`${x < 0 ? '−' : ''}β<sub>eq</sub>`, showarrow:false, yanchor:'bottom',
          font:{color:'#71549e', size:12}})),
      ],
      showlegend:false, uirevision:'history', hovermode:'closest'};
  }
  async function drawHistory() {
    const omega = data.omega;
    data.energy = potential(data.beta0 * DEG, omega);  // starts at rest
    const span = Math.max(...data.beta) - Math.min(...data.beta);
    const pad = Math.max(25, span * 0.25);
    const lo = Math.max(Math.min(...data.beta) - pad, Math.min(-180, Math.min(...data.beta))),
          hi = Math.min(Math.max(...data.beta) + pad, Math.max(180, Math.max(...data.beta)));
    const curve = Array.from({length:601}, (_, i) => lo + (hi - lo) * i / 600);
    const U = curve.map(b => potential(b * DEG, omega));
    const top = Math.max(data.energy, ...U) * 1.08 || 1;
    const hover = (label, axis) => `β = %{x:.1f}°<br>${label} = %{y:.${axis === 'y2' ? 2 : 3}f}<extra></extra>`;
    await Plotly.react(history, [
      {type:'scatter', mode:'lines', x:curve, y:U, line:{color:'#71549e', width:2.2},
        hovertemplate:hover('U')},
      {type:'scatter', mode:'lines+text', x:[lo, hi], y:[data.energy, data.energy], text:['', 'E'],
        textposition:'top left', textfont:{color:'#1a211d', size:13},
        line:{color:'#1a211d', width:1.6, dash:'dot'}, hovertemplate:hover('E')},
      // Seeded with placeholder points: Plotly only builds a trace's text nodes on a
      // full draw, so restyle cannot add the K label to a trace that started empty.
      {type:'scatter', mode:'lines+text', x:[lo, lo, lo], y:[0, 0, 0], text:['', 'K', ''],
        textposition:'middle right',
        line:{color:'#b26a12', width:4}, textfont:{color:'#b26a12', size:13}, hoverinfo:'skip'},
      {type:'scatter', mode:'markers', x:[], y:[], hoverinfo:'skip',
        marker:{color:'#b26a12', size:11, line:{color:'#fff', width:2}}},
      {type:'scatter', mode:'lines', x:data.beta, y:data.tau, xaxis:'x2', yaxis:'y2',
        line:{color:'#c9d6e6', width:1.5}, hoverinfo:'skip'},
      {type:'scatter', mode:'lines', x:[], y:[], xaxis:'x2', yaxis:'y2',
        line:{color:'#3f6fa8', width:2.5}, hovertemplate:'β = %{x:.1f}°<br>𝜏 = %{y:.2f}<extra></extra>'},
      {type:'scatter', mode:'markers', x:[], y:[], xaxis:'x2', yaxis:'y2', hoverinfo:'skip',
        marker:{color:'#b26a12', size:11, line:{color:'#fff', width:2}}},
      {type:'scatter', mode:'lines', x:[], y:[], hoverinfo:'skip',
        line:{color:'#b26a12', width:1, dash:'dot'}},
      {type:'scatter', mode:'lines', x:[], y:[], xaxis:'x2', yaxis:'y2', hoverinfo:'skip',
        line:{color:'#b26a12', width:1, dash:'dot'}},
      {type:'scatter', mode:'lines+text', x:[lo, hi], y:[data.energy, data.energy], text:['', 'E₀'],
        textposition:'top left', textfont:{color:'#9aa49e', size:12}, visible:data.gamma > 0,
        line:{color:'#c3cbc3', width:1.2, dash:'dot'}, hoverinfo:'skip'},
    ], historyLayout(lo, hi, top), config);
  }
  function drawHistoryState(state) {
    // Path so far: every stored sample up to tau, then the interpolated present.
    const n = Math.min(data.tau.length, Math.floor(tau / TAU_MAX * (data.tau.length - 1)) + 1);
    const beta = [...data.beta.slice(0, n), state.beta];
    const U = potential(state.beta * DEG, data.omega), b = state.beta;
    // The K bar runs from the bead on U up to the E line; its label sits at mid-height.
    const K = state.rate ** 2 / 2, E = U + K;
    const top = history.layout.yaxis.range[1];
    const label = K > 0.06 * top ? 'K' : '';
    // A zero-length bar still draws a dot (Plotly's round line joins), so blank it
    // out with nulls when K is negligible. Nulls keep the three text nodes alive.
    const bar = K > 1e-3 * top ? [U, (U + E) / 2, E] : [null, null, null];
    const [lo, hi] = history.layout.xaxis.range;
    Plotly.restyle(history, {
      x:[[lo, hi], [b, b, b], [b], beta, [b], [b, b], [b, b]],
      y:[[E, E], bar, [U], [...data.tau.slice(0, n), tau], [tau], [U, 0], [0, tau]],
    }, [TRACE.E, TRACE.Kbar, TRACE.bead, TRACE.tauPath, TRACE.tauDot, TRACE.linkTop, TRACE.linkBottom]);
    Plotly.restyle(history, {text:[['', label, '']]}, [TRACE.Kbar]);
    $('potential-now').textContent = U.toFixed(3);
    $('kinetic-now').textContent = K.toFixed(3);
    $('energy-now').textContent = E.toFixed(3);
    $('lost-now').textContent = (data.energy - E).toFixed(3);
  }
  // ---- Standalone potential panel with its own Omega. It plots the same shifted
  // U(beta) as the energy diagram, so its minimum stays at U = 0 for every Omega.
  const potentialPlot = $('potential-plot');
  const potentialSpin = $('potential-spin'), potentialSpinNumber = $('potential-spin-number');
  const POTENTIAL_BETA = Array.from({length:721}, (_, i) => -180 + i / 2);
  const POTENTIAL_FREE = POTENTIAL_BETA.map(b => potential(b * DEG, 0));
  function drawPotential() {
    const omega = Number(potentialSpinNumber.value);
    const U = POTENTIAL_BETA.map(b => potential(b * DEG, omega));
    const eq = stableAngle(omega), split = omega > 1;
    const stable = split ? [-eq, eq] : [0], unstable = split ? [-180, 0, 180] : [-180, 180];
    const point = b => potential(b * DEG, omega);
    // The bottom is always U = 0; the top of the hoop, U(180), is the highest point.
    const top = point(180), pad = 0.06 * top;
    const grid = '#e8eee8';
    const hover = 'β = %{x:.1f}°<br>U = %{y:.3f}<extra></extra>';
    Plotly.react(potentialPlot, [
      {type:'scatter', mode:'lines', x:POTENTIAL_BETA, y:POTENTIAL_FREE, name:'Ω = 0',
        line:{color:'#c3cbc3', width:1.5, dash:'dot'}, hovertemplate:'Ω = 0<br>' + hover},
      {type:'scatter', mode:'lines', x:POTENTIAL_BETA, y:U, name:`Ω = ${omega.toFixed(2)}`,
        line:{color:'#71549e', width:2.6}, hovertemplate:hover},
      {type:'scatter', mode:'markers', x:unstable, y:unstable.map(point), name:'unstable',
        marker:{color:'#fff', size:10, line:{color:'#71549e', width:2}}, hovertemplate:'unstable<br>' + hover},
      {type:'scatter', mode:'markers', x:stable, y:stable.map(point), name:'stable',
        marker:{color:'#71549e', size:11, line:{color:'#fff', width:2}}, hovertemplate:'stable<br>' + hover},
    ], {margin:{l:62, r:15, t:16, b:48}, paper_bgcolor:'#fff', plot_bgcolor:'#fff',
      xaxis:{range:[-180, 180], fixedrange:true, tickmode:'array', tickvals:[-180, -135, -90, -45, 0, 45, 90, 135, 180],
        ticksuffix:'°', gridcolor:grid, zeroline:false, showline:true, linecolor:'#8a948e',
        title:{text:'β from the bottom', standoff:8}},
      yaxis:{range:[-pad, top + pad], fixedrange:true, gridcolor:grid, zeroline:true,
        zerolinecolor:'#cdd6cf', title:{text:'U / mgr'}},
      shapes:split ? stable.map(x => ({type:'line', x0:x, x1:x, yref:'paper', y0:0, y1:1,
        line:{color:'#9e81b3', width:1.2, dash:'dash'}})) : [],
      annotations:split ? stable.map(x => ({x, y:1, yref:'paper', yanchor:'bottom', showarrow:false,
        text:`${x < 0 ? '−' : ''}β<sub>eq</sub>`, font:{color:'#71549e', size:12}})) : [],
      showlegend:false, uirevision:'potential', hovermode:'closest'}, config);
    $('potential-stable').textContent = split ? `±${eq.toFixed(1)}°` : omega === 1 ? '0° (marginal)' : '0°';
    $('potential-bottom').textContent = point(0).toFixed(3);
    $('potential-top').textContent = top.toFixed(3);
  }
  potentialSpin.addEventListener('input', () => {
    potentialSpinNumber.value = Number(potentialSpin.value).toFixed(2); drawPotential();
  });
  potentialSpinNumber.addEventListener('change', () => {
    const value = Number(potentialSpinNumber.value);
    const clamped = potentialSpinNumber.value.trim() && Number.isFinite(value)
      ? Math.max(0, Math.min(3, value)) : Number(potentialSpin.value);
    potentialSpinNumber.value = String(clamped);
    potentialSpin.value = clamped;
    drawPotential();
  });
  $('potential-match').addEventListener('click', () => {
    potentialSpinNumber.value = controls.spinNumber.value;
    potentialSpin.value = controls.spinNumber.value;
    drawPotential();
  });

  function render() {
    if (!data) return;
    const state = sample(tau), beta = state.beta * DEG;
    $('beta-now').textContent = state.beta.toFixed(1) + '°';
    $('height-now').textContent = (-Math.cos(beta)).toFixed(2);
    $('rho-now').textContent = Math.abs(Math.sin(beta)).toFixed(2);
    $('rate-now').textContent = state.rate.toFixed(2) + ' rad/𝜏';
    $('tau-now').textContent = tau.toFixed(2);
    $('turns-now').textContent = (data.omega * tau / (2 * Math.PI)).toFixed(2) + ' turns';
    $('time').value = tau.toFixed(2);
    $('clock').textContent = `𝜏 = ${tau.toFixed(2)} / 20`;
    drawHistoryState(state);
    view.update();
  }
  function tick(stamp) {
    if (!playing) return;
    if (lastStamp !== null) tau = Math.min(TAU_MAX, tau + Math.min(0.1, (stamp - lastStamp) / 1000));
    lastStamp = stamp;
    render();
    if (tau >= TAU_MAX) stop();
    else frame = requestAnimationFrame(tick);
  }
  function showError(error) {
    stop();
    console.error(error);
    setStatus(`Simulation failed: ${error.message || error}. Check the browser console.`, true);
  }
  function restart() {
    stop();
    try {
      const gamma = $('friction-toggle').checked ? Number(controls.frictionNumber.value) : 0;
      data = simulate(Number(controls.spinNumber.value), Number(controls.angleNumber.value), gamma);
      tau = 0;
      const maxForce = Math.max(1, ...data.normal.map(v => Math.hypot(...v)),
        ...data.centrifugal.map(v => Math.hypot(...v)));
      forceScale = Math.min(0.42, 0.8 / maxForce);
      $('equilibrium-value').textContent = data.equilibrium.toFixed(2) + '°';
      $('equilibrium-note').textContent = data.omega > 1
        ? 'The negative-side equilibrium is stable too.'
        : 'The bottom (β₀ = 0°) is the stable equilibrium.';
      drawHistory().then(() => render()).catch(showError);
      $('status').hidden = true;
    } catch (error) { showError(error); }
  }
  function queueRestart() {
    stop();
    clearTimeout(restartTimer);
    restartTimer = setTimeout(restart, 90);
  }
  function setAngle(value) {
    const angle = Math.max(-180, Math.min(180, value));
    controls.angle.value = angle;
    controls.angleNumber.value = String(Number(angle.toFixed(5)));
    queueRestart();
  }
  function commit(number, slider, lo, hi) {
    const value = Number(number.value);
    const clamped = number.value.trim() && Number.isFinite(value)
      ? Math.max(lo, Math.min(hi, value)) : Number(slider.value);
    number.value = String(clamped);
    slider.value = clamped;
    queueRestart();
  }
  controls.spin.addEventListener('input', () => {
    controls.spinNumber.value = Number(controls.spin.value).toFixed(2); queueRestart();
  });
  controls.angle.addEventListener('input', () => {
    controls.angleNumber.value = Number(controls.angle.value).toFixed(1); queueRestart();
  });
  controls.friction.addEventListener('input', () => {
    controls.frictionNumber.value = Number(controls.friction.value).toFixed(2); queueRestart();
  });
  controls.frictionNumber.addEventListener('change', () => commit(controls.frictionNumber, controls.friction, 0, 2));
  $('friction-toggle').addEventListener('change', () => {
    const on = $('friction-toggle').checked;
    controls.friction.disabled = controls.frictionNumber.disabled = !on;
    $('friction-key').hidden = !on;
    queueRestart();
  });
  controls.spinNumber.addEventListener('change', () => commit(controls.spinNumber, controls.spin, 0, 3));
  controls.angleNumber.addEventListener('change', () => commit(controls.angleNumber, controls.angle, -180, 180));
  $('play').addEventListener('click', () => {
    if (playing) { stop(); return; }
    if (tau >= TAU_MAX) tau = 0;
    playing = true;
    lastStamp = null;
    $('play').textContent = 'Pause';
    $('play').setAttribute('aria-label', 'Pause simulation');
    frame = requestAnimationFrame(tick);
  });
  $('reset').addEventListener('click', () => { stop(); tau = 0; render(); });
  $('center-start').addEventListener('click', () => setAngle(90));
  $('set-equilibrium').addEventListener('click', () => {
    if (data) setAngle(data.equilibrium);
  });
  $('set-perturbed').addEventListener('click', () => {
    if (!data) return;
    const value = Number(controls.perturbation.value);
    const perturbation = controls.perturbation.value.trim() && Number.isFinite(value)
      ? Math.max(-30, Math.min(30, value)) : 5;
    controls.perturbation.value = perturbation.toFixed(1);
    setAngle(data.equilibrium + perturbation);
  });
  $('time').addEventListener('input', event => { stop(); tau = Number(event.target.value); render(); });
  $('frame-toggle').addEventListener('click', () => {
    rotating = !rotating;
    $('frame-toggle').textContent = rotating ? 'Use lab frame' : 'Use rotating frame';
    $('frame-toggle').setAttribute('aria-pressed', String(rotating));
    $('force-toggle').disabled = !rotating;
    $('force-legend').hidden = !(rotating && forces);
    $('frame-note').textContent = rotating
      ? 'Rotating frame: the hoop stays fixed. Drag to orbit the 3D view.'
      : 'Lab frame: the hoop rotates about the vertical axis. Drag to orbit the 3D view.';
    view.setFrame(rotating);
    render();
  });
  $('force-toggle').addEventListener('click', () => {
    forces = !forces;
    $('force-toggle').textContent = forces ? 'Hide forces' : 'Show forces';
    $('force-toggle').setAttribute('aria-pressed', String(forces));
    $('force-legend').hidden = !(rotating && forces);
    render();
  });

  if (!window.Plotly) {
    showError(new Error('Plotly did not load'));
  } else {
    enableControls();
    restart();
    drawPotential();
  }
})().catch(error => {
  console.error(error);
  const status = document.getElementById('status');
  status.hidden = false;
  status.classList.add('error');
  status.textContent = `Could not start the simulation: ${error.message || error}. Check your network connection and the browser console.`;
});
