// Railroad Union v2: the engine in the hero.
// A 4-4-0 built in Blender (models/build_loco.py) running through the night:
// drivers, side rods and main rods turn, ties and telegraph poles stream past,
// steam rolls off the stack, the headlamp throws a beam. Scroll opens the
// throttle; a click blows her off. Falls back to a still render without
// WebGL, and holds a single frame for prefers-reduced-motion.

import * as THREE from './vendor/three/three.module.js';
import { GLTFLoader } from './vendor/three/GLTFLoader.js';
import { RoomEnvironment } from './vendor/three/RoomEnvironment.js';
import { MeshoptDecoder } from './vendor/three/meshopt_decoder.module.js';

const hero = document.querySelector('.hero');
if (hero) start(hero);

function start(hero) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const saveData = !!(navigator.connection && navigator.connection.saveData);
  // Reduced motion or data saver: the rendered still, no WebGL, no 4 MB download.
  if (reduce || saveData) return;
  // Phones, tablets and narrow windows get the light tier: pixel ratio 1,
  // no shadow map, fewer particles and stars. RedM is using the same GPU.
  const small = matchMedia('(max-width: 900px), (pointer: coarse)').matches;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !small, powerPreference: 'high-performance' });
  } catch (e) {
    hero.classList.add('still');
    return;
  }
  hero.prepend(canvas);
  renderer.setPixelRatio(small ? 1 : Math.min(devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = !small;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const NIGHT = new THREE.Color(0x0b0f19);
  const scene = new THREE.Scene();
  scene.background = NIGHT;
  scene.fog = new THREE.FogExp2(0x0d1220, 0.028);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 400);

  // ── light: moon rim, warm lantern key, low blue fill ──
  scene.add(new THREE.HemisphereLight(0x5b6d99, 0x1a120c, 0.55));
  const moon = new THREE.DirectionalLight(0x9db4ff, 1.6);
  moon.position.set(-14, 18, -10);
  scene.add(moon);
  const key = new THREE.DirectionalLight(0xffc98a, 3.6);
  key.position.set(10, 9, 12);
  key.castShadow = !small;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -12, right: 12, top: 8, bottom: -4, near: 1, far: 50 });
  key.shadow.bias = -0.0004;
  scene.add(key);
  const cabGlow = new THREE.PointLight(0xff8a3a, 6, 6, 1.6);   // firebox glow spilling out of the cab
  cabGlow.position.set(-2.1, 2.2, 0);
  scene.add(cabGlow);

  // ── ground, ballast, rails, ties ──
  const groundTex = noiseTexture(256, [18, 14, 12], [44, 40, 38]);
  groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
  groundTex.repeat.set(60, 60);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1, color: 0x6a6258 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.18;
  ground.receiveShadow = true;
  scene.add(ground);

  const ballastTex = noiseTexture(256, [60, 56, 52], [120, 112, 104]);
  ballastTex.wrapS = ballastTex.wrapT = THREE.RepeatWrapping;
  ballastTex.repeat.set(80, 1.5);
  const ballast = new THREE.Mesh(new THREE.BoxGeometry(240, 0.2, 3.6),
    new THREE.MeshStandardMaterial({ map: ballastTex, roughness: 1, color: 0x8a8278 }));
  ballast.position.y = -0.2;
  ballast.receiveShadow = true;
  scene.add(ballast);

  const railMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 1, roughness: 0.32 });
  for (const z of [-0.72, 0.72]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(240, 0.14, 0.09), railMat);
    rail.position.set(0, -0.02, z);
    rail.receiveShadow = true;
    scene.add(rail);
  }
  const TIE_GAP = 0.62, TIES = 220;
  const ties = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.14, 2.5),
    new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 0.95 }), TIES);
  ties.receiveShadow = true;
  {   // laid once; the whole set slides by one tie gap and wraps
    const m = new THREE.Matrix4();
    for (let i = 0; i < TIES; i++) { m.makeTranslation(i * TIE_GAP - 70, -0.08, 0); ties.setMatrixAt(i, m); }
    ties.instanceMatrix.needsUpdate = true;
  }
  scene.add(ties);

  // telegraph poles along the far side: the clearest sense of speed there is
  const POLE_GAP = 16, POLES = 12;
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.13, 7.5, 8);
  poleGeo.translate(0, 3.75, 0);
  const arm = new THREE.BoxGeometry(0.12, 0.12, 1.8);
  arm.translate(0, 6.8, 0);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2b211a, roughness: 1 });
  const poles = [];
  for (let i = 0; i < POLES; i++) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(poleGeo, poleMat), new THREE.Mesh(arm, poleMat));
    g.children.forEach(m => { m.castShadow = !small; });
    g.position.set(i * POLE_GAP - 60, -0.1, -5.2);
    scene.add(g);
    poles.push(g);
  }
  // the wire sags between poles; drawn as one line that moves with them
  const wireMat = new THREE.LineBasicMaterial({ color: 0x1a1c24, transparent: true, opacity: 0.8 });
  const wirePts = [];
  for (let i = 0; i <= POLES * 10; i++) {
    const x = i * POLE_GAP / 10 - 60;
    const t = (i % 10) / 10;
    wirePts.push(new THREE.Vector3(x, 6.65 - Math.sin(t * Math.PI) * 0.45, -5.2));
  }
  const wire = new THREE.Line(new THREE.BufferGeometry().setFromPoints(wirePts), wireMat);
  scene.add(wire);

  // far ridge line in silhouette, and stars
  const ridge = ridgeMesh();
  scene.add(ridge);
  const stars = starField(small ? 500 : 1100);
  scene.add(stars);

  // ── steam ──
  const steamTex = puffTexture();
  const PUFFS = small ? 48 : 90;
  const puffs = [];
  const steamGroup = new THREE.Group();
  scene.add(steamGroup);
  for (let i = 0; i < PUFFS; i++) {
    const m = new THREE.SpriteMaterial({ map: steamTex, color: 0xc9d1e2, transparent: true, depthWrite: false, opacity: 0, fog: true });
    const s = new THREE.Sprite(m);
    s.visible = false;
    steamGroup.add(s);
    puffs.push({ s, life: 0, max: 1, v: new THREE.Vector3() });
  }
  let puffIndex = 0;
  function emit(origin, burst) {
    const p = puffs[puffIndex++ % PUFFS];
    p.life = 0;
    p.max = (burst ? 2.6 : 3.4) + Math.random() * 1.4;
    p.s.position.copy(origin);
    p.v.set(-0.4 - Math.random() * 0.6, (burst ? 3.4 : 2.1) + Math.random() * 1.2, (Math.random() - 0.5) * 0.6);
    p.s.material.rotation = Math.random() * Math.PI * 2;
    p.size0 = burst ? 1.2 : 0.75;
    p.s.visible = true;
  }

  // ── headlamp beam: a soft additive cone, a glow, and a real spot ──
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(0xffd28a) }, uPower: { value: 0.55 } },
    vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){ vY = position.y; vec4 mv = modelViewMatrix * vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uPower; varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){ float along = clamp(1. - (vY + 9.) / 18., 0., 1.); float rim = pow(abs(dot(vN, vV)), 1.6);
        float a = uPower * pow(1. - along, 2.2) * rim; gl_FragColor = vec4(uColor * a, a); }`,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 3.6, 18, 40, 1, true), beamMat);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffd9a0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.scale.set(2.6, 2.6, 1);
  const spot = new THREE.SpotLight(0xffd28a, 120, 40, 0.42, 0.6, 1.4);
  spot.castShadow = false;
  scene.add(beam, glow, spot, spot.target);

  // ── the engine ──
  const parts = { drivers: [], lead: [], tender: [], side: [], main: [] };
  let loco = null;
  const smokeAt = new THREE.Vector3(), lampAt = new THREE.Vector3();
  const DR = 0.84, LR = 0.42, TR = 0.42, RC = DR * 0.45;
  const base = new Map();

  new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(hero.dataset.model || 'assets/3d/loco.glb', gltf => {
    loco = gltf.scene;
    loco.traverse(o => {
      if (o.isMesh) { o.castShadow = !small; o.receiveShadow = true; }
      const n = o.name || '';
      if (/^Driver_/.test(n)) parts.drivers.push(o);
      else if (/^Lead_/.test(n)) parts.lead.push(o);
      else if (/^TenderWheel_/.test(n)) parts.tender.push(o);
      else if (/^SideRod_/.test(n)) parts.side.push(o);
      else if (/^MainRod_/.test(n)) parts.main.push(o);
      if (/^(SideRod|MainRod)_/.test(n)) base.set(o, o.position.clone());
      if (n === 'LampLens' && o.material) {
        o.material = o.material.clone();
        o.material.emissive = new THREE.Color(0xffd08a);
        o.material.emissiveIntensity = 6;
      }
    });
    scene.add(loco);
    const sm = loco.getObjectByName('Smoke');
    const hl = loco.getObjectByName('Headlamp');
    loco.updateMatrixWorld(true);
    if (sm) sm.getWorldPosition(smokeAt); else smokeAt.set(4.15, 4.74, 0);   // stack mouth (build_loco.py)
    if (hl) hl.getWorldPosition(lampAt); else lampAt.set(4.85, 3.19, 0);    // headlamp lens

    beam.position.copy(lampAt).add(new THREE.Vector3(9, -0.6, 0));
    beam.rotation.z = Math.PI / 2 + 0.07;
    glow.position.copy(lampAt).add(new THREE.Vector3(0.1, 0, 0));
    spot.position.copy(lampAt);
    spot.target.position.copy(lampAt).add(new THREE.Vector3(10, -2.6, 0));

    for (let i = 0; i < 26; i++) { emit(smokeAt, false); puffs[(puffIndex - 1) % PUFFS].life = Math.random() * 3; }
    frame(performance.now());
    hero.classList.add('live');
    if (!reduce) loop();
  }, undefined, () => hero.classList.add('still'));

  // ── framing ──
  const look = new THREE.Vector3();
  const CAMS = {
    roster:   { cam: [12.2, 2.7, 12.4],  look: [-4.2, 2.2, 0] },            // three-quarter, from the front
    login:    { cam: [9.5, 1.6, 10.5],   look: [-3.6, 2.6, 0], fov: 30 },  // low and heroic, cowcatcher first
    trains:   { cam: [1.5, 2.4, 15.5],   look: [-5.5, 2.0, 0], fov: 26 },  // broadside, the whole engine and tender
    railyard: { cam: [10, 9.5, 14],      look: [-4, 1.2, 0],   fov: 28 },  // from the signal tower, looking down
    report:   { cam: [-12, 2.6, 11],     look: [-1.5, 2.0, 0], fov: 28 },  // from behind the tender, the cab lit
    yard:     { cam: [14, 4.2, 6],       look: [-2.5, 2.0, 0], fov: 26 },  // head-on, lamp in your eyes
  };
  function resize() {
    const w = hero.clientWidth, h = hero.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Wide screens: the engine stands right of centre and the title has the
    // left. Narrow screens: pull back and centre her under the copy.
    const narrow = w / h < 1.05;
    camera.fov = narrow ? 40 : 28;
    camera.updateProjectionMatrix();
    // Each page frames her differently (data-cam on .hero). Phones look well
    // above her so she rides the foot of the frame, clear of the copy.
    const P = CAMS[hero.dataset.cam] || CAMS.roster;
    if (narrow) { look.set(-1.2, 5.6, 0); baseCam.set(15.5, 5.2, 19); }
    else { look.set(...P.look); baseCam.set(...P.cam); camera.fov = P.fov || 28; camera.updateProjectionMatrix(); }
    // Framed for a 2.2:1 strip; a taller hero (the login page, a laptop)
    // backs the camera off along the same line so she never crops.
    const k = narrow ? 1 : Math.min(1.45, Math.max(1, 2.2 / camera.aspect));
    baseCam.sub(look).multiplyScalar(k).add(look);
    // a resize clears the drawing buffer; paint at once rather than wait for
    // the next tick (there is none under reduced motion)
    if (loco) frame(performance.now());
  }
  const baseCam = new THREE.Vector3();
  new ResizeObserver(resize).observe(hero);
  resize();

  // ── input: pointer sways the camera, scroll opens the throttle, click blows her off ──
  let px = 0, py = 0, tx = 0, ty = 0;
  hero.addEventListener('pointermove', e => {
    const r = hero.getBoundingClientRect();
    tx = (e.clientX - r.left) / r.width - 0.5;
    ty = (e.clientY - r.top) / r.height - 0.5;
  });
  hero.addEventListener('pointerleave', () => { tx = 0; ty = 0; });
  let lastY = scrollY, scrollV = 0, burst = 0;
  addEventListener('scroll', () => {
    scrollV += Math.abs(scrollY - lastY) * 0.02;
    lastY = scrollY;
    const p = Math.min(1, scrollY / hero.clientHeight);
    hero.style.setProperty('--scroll', p.toFixed(3));
  }, { passive: true });
  hero.addEventListener('click', e => {
    if (e.target.closest('a,button,input,select')) return;
    burst = 1;
    for (let i = 0; i < 14; i++) emit(smokeAt, true);
  });

  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); hero.classList.remove('live'); running = false; visible = false; });
  // Free the GPU on the way out; the back/forward cache would otherwise hold
  // every page's context.
  addEventListener('pagehide', () => { running = false; visible = false; renderer.dispose(); renderer.forceContextLoss(); });

  let visible = true;
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible && !reduce) loop(); }).observe(hero);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !reduce) loop(); });

  // ── animation ──
  let dist = 0, last = performance.now(), running = false, speed = 4.2, emitAcc = 0;
  const v3 = new THREE.Vector3();

  function loop() {
    if (running) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(tick);
  }
  function tick(now) {
    if (!visible || document.hidden) { running = false; return; }
    frame(now);
    requestAnimationFrame(tick);
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    scrollV *= 0.92;
    burst *= 0.96;
    const target = 4.2 + Math.min(18, scrollV * 6) + burst * 6;
    speed += (target - speed) * Math.min(1, dt * 1.6);
    dist += speed * dt;

    // ground and ballast slide under her
    groundTex.offset.x = (dist / 400) * 60;
    ballastTex.offset.x = (dist / 240) * 80;
    ties.position.x = -(dist % TIE_GAP);
    const poff = dist % POLE_GAP;
    poles.forEach((g, i) => { g.position.x = i * POLE_GAP - 60 - poff; });
    wire.position.x = -poff;

    if (loco) {
      const th = dist / DR;
      parts.drivers.forEach(w => { w.rotation.z = -th; });
      parts.lead.forEach(w => { w.rotation.z = -dist / LR; });
      parts.tender.forEach(w => { w.rotation.z = -dist / TR; });
      const cx = RC * Math.cos(th), cy = -RC * Math.sin(th);
      parts.side.forEach(r => { const b = base.get(r); r.position.set(b.x + cx, b.y + cy, b.z); });
      parts.main.forEach(r => {
        // from the front driver's crank pin to the crosshead on the cylinder line
        const b = base.get(r);
        const pinX = 0.65 + cx, pinY = DR + cy;
        const L = 2.0, dy = b.y - pinY, dx = Math.sqrt(Math.max(0.01, L * L - dy * dy));
        r.position.set(pinX + dx / 2, pinY + dy / 2, b.z);
        r.rotation.z = Math.atan2(dy, dx);
      });
      // she rocks a little on her springs
      loco.position.y = Math.sin(dist * 1.7) * 0.012 + Math.sin(dist * 0.53) * 0.008;
      loco.rotation.x = Math.sin(dist * 0.9) * 0.0035;

      emitAcc += dt * (5 + speed * 1.1);
      while (emitAcc > 1) { emitAcc -= 1; v3.copy(smokeAt); v3.y += loco.position.y; emit(v3, false); }
    }

    // steam: rises, drifts back with the train's wind, swells and thins
    for (const p of puffs) {
      if (!p.s.visible) continue;
      p.life += dt;
      const k = p.life / p.max;
      if (k >= 1) { p.s.visible = false; continue; }
      p.v.x -= speed * 0.35 * dt;
      p.v.y *= 1 - 0.55 * dt;
      p.s.position.addScaledVector(p.v, dt);
      const size = p.size0 + k * 5.2;
      p.s.scale.set(size, size, 1);
      p.s.material.opacity = Math.sin(Math.min(1, k * 4) * Math.PI / 2) * (1 - k) * 0.55;
      p.s.material.rotation += dt * 0.25;
    }

    const flick = 0.92 + Math.sin(now * 0.013) * 0.04 + Math.sin(now * 0.031) * 0.03;
    beamMat.uniforms.uPower.value = 0.5 * flick + burst * 0.25;
    glow.material.opacity = 0.85 * flick;
    cabGlow.intensity = 5 + Math.sin(now * 0.02) * 1.2 + Math.random() * 0.8;
    stars.material.uniforms.uTime.value = now * 0.001;

    px += (tx - px) * 0.05;
    py += (ty - py) * 0.05;
    const sc = parseFloat(hero.style.getPropertyValue('--scroll')) || 0;
    camera.position.set(baseCam.x + px * 2.4, baseCam.y - py * 1.2 + sc * 1.5, baseCam.z - sc * 2.5);
    camera.lookAt(look.x, look.y + sc * 0.6, look.z);
    hero.style.setProperty('--hx', px.toFixed(3));

    renderer.render(scene, camera);
  }

  // ── procedural textures and props ──
  function noiseTexture(size, lo, hi) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const img = g.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      const t = Math.random() ** 1.6;
      img.data[i * 4] = lo[0] + (hi[0] - lo[0]) * t;
      img.data[i * 4 + 1] = lo[1] + (hi[1] - lo[1]) * t;
      img.data[i * 4 + 2] = lo[2] + (hi[2] - lo[2]) * t;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  function puffTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    for (let i = 0; i < 7; i++) {
      const x = 40 + Math.random() * 48, y = 40 + Math.random() * 48, r = 26 + Math.random() * 22;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,.55)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 128, 128);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function glowTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,240,210,1)');
    gr.addColorStop(0.18, 'rgba(255,210,140,.55)');
    gr.addColorStop(1, 'rgba(255,190,110,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }
  function ridgeMesh() {
    const shape = new THREE.Shape();
    shape.moveTo(-200, -2);
    for (let x = -200; x <= 200; x += 4) {
      const y = 5 + Math.sin(x * 0.045) * 3 + Math.sin(x * 0.13 + 1.3) * 1.4 + Math.sin(x * 0.31) * 0.5;
      shape.lineTo(x, y);
    }
    shape.lineTo(200, -2);
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: 0x0a0e18, fog: false }));
    mesh.position.set(0, 0, -70);
    return mesh;
  }
  function starField(n) {
    const pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI - Math.PI, e = 0.06 + Math.random() * 0.9;
      pos.set([Math.cos(a) * 120 * Math.cos(e), 120 * Math.sin(e), Math.sin(a) * 120 * Math.cos(e) - 20], i * 3);
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `attribute float seed; varying float vA; uniform float uTime;
        void main(){ vA = 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * (0.6 + seed * 2.4) + seed * 40.)); vA *= seed * 0.9 + 0.1;
          vec4 mv = modelViewMatrix * vec4(position,1.); gl_PointSize = 1.2 + seed * 1.8; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - .5); if (d > .5) discard; gl_FragColor = vec4(vec3(.85,.9,1.), vA * (1. - d * 2.)); }`,
    });
    return new THREE.Points(g, mat);
  }
}
