/* Bead-on-a-rotating-hoop physics and browser controls.
   Three.js draws the hoop scene; Plotly draws the beta(tau) history. */

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
    angleNumber: $('angle-number'), perturbation: $('perturbation')};
  let data, tau = 0, playing = false, rotating = false, forces = false;
  let frame = null, lastStamp = null, restartTimer = null, forceScale = 0.25;
  const history = $('history');

  // beta is signed from the bottom, tau = t sqrt(g/r), and Omega = 2 pi f sqrt(r/g).
  function stableAngle(omega) {
    return omega <= 1 ? 0 : Math.acos(1 / omega ** 2) / DEG;
  }
  function simulate(omega, beta0) {
    if (!(Number.isFinite(omega) && omega >= 0 && omega <= 3))
      throw new Error('Omega must be between 0 and 3');
    if (!(Number.isFinite(beta0) && beta0 >= -180 && beta0 <= 180))
      throw new Error('Starting angle must be between -180 and 180 degrees');
    const accel = b => Math.sin(b) * (omega ** 2 * Math.cos(b) - 1);
    const h = TAU_MAX / (SAMPLES - 1) / SUBSTEPS;
    const out = {omega, beta0, equilibrium:stableAngle(omega), tau:[], beta:[], rate:[],
      gravity:[], centrifugal:[], normal:[]};
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
      for (let k = 0; k < SUBSTEPS; k++) {  // classic RK4
        const k1b = w, k1w = accel(b);
        const k2b = w + h / 2 * k1w, k2w = accel(b + h / 2 * k1b);
        const k3b = w + h / 2 * k2w, k3w = accel(b + h / 2 * k2b);
        const k4b = w + h * k3w, k4w = accel(b + h * k3b);
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
      gravity:pair('gravity'), centrifugal:pair('centrifugal'), normal:pair('normal')};
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
    const arrows = {gravity:arrow('#2f7d55'), centrifugal:arrow('#b03a30'), normal:arrow('#1f7a80')};

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

  function historyLayout() {
    const eq = data.equilibrium;
    const sameSide = data.beta0 < 0 ? -eq : eq;
    const lo = Math.min(...data.beta, sameSide), hi = Math.max(...data.beta, sameSide);
    const pad = Math.max(5, (hi - lo) * 0.1);
    const values = eq === 0 ? [0] : [-eq, eq];
    return {margin:{l:56, r:15, t:8, b:52}, paper_bgcolor:'#fff', plot_bgcolor:'#fff',
      xaxis:{title:'dimensionless time 𝜏', range:[0, TAU_MAX], fixedrange:true, gridcolor:'#e8eee8'},
      yaxis:{title:'β (degrees)', range:[lo - pad, hi + pad], fixedrange:true, gridcolor:'#e8eee8'},
      shapes:values.map(y => ({type:'line', x0:0, x1:TAU_MAX, y0:y, y1:y,
        line:{color:'#9e81b3', width:1.5, dash:'dash'}})),
      annotations:values.filter(y => y >= lo - pad && y <= hi + pad).map(y => ({
        x:19.8, y, text:`${y < 0 ? '−' : ''}β<sub>eq</sub>`, showarrow:false,
        xanchor:'right', yshift:12, font:{color:'#71549e', size:12}})),
      showlegend:false, uirevision:'history'};
  }
  async function drawHistory() {
    await Plotly.react(history, [
      {type:'scatter', mode:'lines', x:data.tau, y:data.beta,
        line:{color:'#3f6fa8', width:2.5}, hovertemplate:'𝜏 = %{x:.2f}<br>β = %{y:.1f}°<extra></extra>'},
      {type:'scatter', mode:'markers', x:[0], y:[data.beta0],
        marker:{color:'#b26a12', size:11, line:{color:'#fff', width:2}}, hoverinfo:'skip'}
    ], historyLayout(), config);
  }
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
    Plotly.restyle(history, {x:[[tau]], y:[[state.beta]]}, [1]);
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
      data = simulate(Number(controls.spinNumber.value), Number(controls.angleNumber.value));
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
  }
})().catch(error => {
  console.error(error);
  const status = document.getElementById('status');
  status.hidden = false;
  status.classList.add('error');
  status.textContent = `Could not start the simulation: ${error.message || error}. Check your network connection and the browser console.`;
});
