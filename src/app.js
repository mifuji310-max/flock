/* =====================================================================
 * FLOCK app v0.19（履歴は shell.html 冒頭） — 描画・入力・カメラ・UI（Three.js r128）
 *   v0.15: ムクドリモード（設計書 v0.5 §16）。描画は starling.js、ここでは切り替え・カメラ・ハヤブサの操作
 * ===================================================================== */
(function () {
  'use strict';

  var STEP = 1 / 30;                 // 物理更新：固定30Hz
  var CAP = 2000;                    // v0.14: 大群モードの上限に合わせる
  var MAX_OBS = 5;
  var FOV = 52;

  /* ---------------- 保存（失敗しても動作は継続） ---------------- */
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem('flock.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('flock.' + k, JSON.stringify(v)); } catch (e) { /* noop */ } }
  };
  var settings = Object.assign({ growth: false, quality: 'auto', sound: true, debug: false,
    seabed: false, rocks: false, range: false, scalebar: false, touchSfx: true, volume: 70,
    startN: 0, devUnlocked: false, species: 'sardine' }, store.get('settings', {}));
  if (settings.species !== 'starling') settings.species = 'sardine';
  if (settings.touchSound === 'none') settings.touchSfx = false;   // v0.6 の保存値からの移行
  delete settings.touchSound;
  if (settings.quality === 'high') settings.quality = 'auto';     // v0.14 で「高」を廃止（自動に統合）
  function saveSettings() { store.set('settings', settings); }

  /* v0.14 画質と最大数
   *  省電力：250匹・解像度1倍
   *  自動　：500匹から始め、余裕があれば1000匹まで段階的に上げる。重ければ解像度→最大数の順に下げる
   *  大群　：細かい演出を減らし、2000匹まで。重ければ最大数をその時点で止める */
  var AUTO_START = 500, AUTO_MAX = 1000;
  function qualityCap() { return settings.quality === 'low' ? 250 : settings.quality === 'many' ? 2000 : AUTO_START; }
  function hardCap() { return settings.quality === 'low' ? 250 : settings.quality === 'many' ? 2000 : AUTO_MAX; }
  function liteFx() { return settings.quality === 'many'; }
  function basePR() { var d = window.devicePixelRatio || 1; return settings.quality === 'auto' ? Math.min(d, 2) : 1; }
  function startCount() { return settings.startN > 0 ? Math.min(settings.startN, hardCap()) : undefined; }   // 裏モードの開始匹数
  function isStar() { return settings.species === 'starling'; }   // v0.15 ムクドリモード
  function unit() { return isStar() ? '羽' : '匹'; }
  // 成長モードがオフのムクドリは、画質の最大数の半分から始める（設計書 §16.3）
  function initialCount() { return startCount() || (isStar() && !settings.growth ? Math.round(qualityCap() / 2) : undefined); }

  /* ---------------- シミュレーション ---------------- */
  var engine = new FLOCK.FlockEngine({ species: settings.species, capacity: CAP, growth: settings.growth, maxCount: Math.max(qualityCap(), startCount() || 0), initial: initialCount() });

  /* ---------------- Three.js ---------------- */
  var canvas = document.getElementById('scene');
  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: settings.quality === 'auto', powerPreference: 'high-performance' });
  } catch (e) {
    document.getElementById('guide').hidden = false;
    document.getElementById('guide').textContent = 'この端末ではWebGLが使えないため表示できません。別のブラウザでお試しください。';
    return;
  }
  var pixelRatio = basePR();
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0x03101b, 1);

  var scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0b3a55, 0.028);
  var camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 220);

  // 背景：上方は明るいターコイズ、下方は深い紺
  var sky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: new THREE.Color(0x3aa5b2) }, uMid: { value: new THREE.Color(0x0b3a55) }, uBot: { value: new THREE.Color(0x020a12) }, uTime: { value: 0 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBot; uniform float uTime; varying vec3 vDir;' +
      'void main(){ vec3 d = normalize(vDir); float h = d.y;' +
      'vec3 c = h > 0.0 ? mix(uMid, uTop, pow(h, 1.1)) : mix(uMid, uBot, pow(-h, 0.55));' +
      // 水面から差し込む光の筋（v0.2 / 試作Bを参考）。ゆっくり揺らぐ
      'float a = atan(d.z, d.x);' +
      'float r1 = pow(0.5 + 0.5 * sin(a * 9.0 + uTime * 0.07 + 1.7 * sin(a * 2.0 - uTime * 0.05)), 5.0);' +
      'float r2 = pow(0.5 + 0.5 * sin(a * 17.0 - uTime * 0.11 + 2.3 * sin(a * 3.0 + uTime * 0.04)), 8.0);' +
      'float beam = (0.65 * r1 + 0.35 * r2) * smoothstep(-0.15, 0.55, h) * (1.0 - smoothstep(0.75, 1.0, h));' +
      'c += vec3(0.42, 0.85, 0.82) * beam * 0.13;' +
      'gl_FragColor = vec4(c, 1.0); }'
  }));
  sky.renderOrder = -1;
  scene.add(sky);

  scene.add(new THREE.HemisphereLight(0xa6e2ff, 0x07202e, 0.8));
  var sun = new THREE.DirectionalLight(0xffffff, 1.05); sun.position.set(0.3, 1, 0.35); scene.add(sun);
  var under = new THREE.DirectionalLight(0x5fc8d8, 0.35); under.position.set(-0.4, -0.3, -1); scene.add(under);

  // マリンスノー（奥行きとカメラ移動の手がかり）。大群モードでは消す
  var snow;
  (function () {
    var N = 700, a = new Float32Array(N * 3), r = Math.random;
    for (var i = 0; i < N; i++) { a[i * 3] = (r() - 0.5) * 70; a[i * 3 + 1] = (r() - 0.5) * 34; a[i * 3 + 2] = (r() - 0.5) * 60; }
    var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(a, 3));
    var c = document.createElement('canvas'); c.width = c.height = 32;
    var x = c.getContext('2d'), gr = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 32, 32);
    var m = new THREE.PointsMaterial({ size: 0.09, map: new THREE.CanvasTexture(c), color: 0xa9dbe2, transparent: true, opacity: 0.45, depthWrite: false });
    snow = new THREE.Points(g, m);
    scene.add(snow);
  })();

  /* ---------------- 魚体（InstancedMesh＋頂点シェーダで尾びれ運動） ---------------- */
  function buildFishGeometry() {
    // z+ が頭。全長 ≒ 1.17（インスタンス側で bodyLen 倍）。左右に薄い紡錘形
    // v0.3: 体高を体長の約19%に抑えた細身の紡錘形。吻をやや尖らせる
    var rings = [[0.58, 0, 0], [0.50, 0.026, 0.038], [0.38, 0.054, 0.086], [0.18, 0.068, 0.11], [-0.05, 0.062, 0.098], [-0.24, 0.042, 0.062], [-0.37, 0.018, 0.028]];
    var seg = 10, pos = [], col = [], idx = [];
    // 背：青緑、体側上部：青紫の光沢帯、体側：銀、腹：白
    var back = new THREE.Color(0x1d4f66), band = new THREE.Color(0x8e9fc6), side = new THREE.Color(0xc0d0d9), belly = new THREE.Color(0xf3f7f8), fin = new THREE.Color(0x8aa3b0), t = new THREE.Color();
    rings.forEach(function (rg) {
      for (var s = 0; s < seg; s++) {
        var a = s / seg * Math.PI * 2, cy = Math.sin(a), cx = Math.cos(a);
        pos.push(cx * rg[1], cy * rg[2], rg[0]);
        if (cy > 0.3) t.copy(band).lerp(back, Math.min(1, (cy - 0.3) / 0.5));
        else if (cy > 0) t.copy(side).lerp(band, cy / 0.3);
        else t.copy(side).lerp(belly, Math.min(1, -cy * 1.6));
        col.push(t.r, t.g, t.b);
      }
    });
    for (var r = 0; r < rings.length - 1; r++) for (var s = 0; s < seg; s++) {
      var a0 = r * seg + s, b0 = r * seg + (s + 1) % seg, c0 = (r + 1) * seg + s, d0 = (r + 1) * seg + (s + 1) % seg;
      idx.push(a0, c0, b0, b0, c0, d0);
    }
    var cap = pos.length / 3, base = (rings.length - 1) * seg;
    pos.push(0, 0, -0.4); col.push(side.r, side.g, side.b);
    for (s = 0; s < seg; s++) idx.push(base + s, cap, base + (s + 1) % seg);
    var f0 = pos.length / 3;   // 二叉の尾びれ（縦）
    // v0.4: 写真に合わせて縮小。開きは体高とほぼ同じ（旧：体高の約1.9倍）、長さは全長の約15%（旧：約22%）
    pos.push(0, 0.022, -0.355, 0, 0.115, -0.55, 0, 0, -0.47, 0, -0.115, -0.55, 0, -0.022, -0.355);
    for (s = 0; s < 5; s++) col.push(fin.r, fin.g, fin.b);
    idx.push(f0, f0 + 1, f0 + 2, f0, f0 + 2, f0 + 4, f0 + 4, f0 + 2, f0 + 3);
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  var fishGeo = buildFishGeometry();
  var phaseAttr = new THREE.InstancedBufferAttribute(new Float32Array(CAP), 1);
  var ampAttr = new THREE.InstancedBufferAttribute(new Float32Array(CAP), 1);
  phaseAttr.setUsage(THREE.DynamicDrawUsage); ampAttr.setUsage(THREE.DynamicDrawUsage);
  fishGeo.setAttribute('aPhase', phaseAttr);
  fishGeo.setAttribute('aAmp', ampAttr);
  var flashAttr = new THREE.InstancedBufferAttribute(new Float32Array(CAP), 1);
  flashAttr.setUsage(THREE.DynamicDrawUsage);
  fishGeo.setAttribute('aFlash', flashAttr);
  var markAttr = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);   // 色付けした個体の発色
  fishGeo.setAttribute('aMark', markAttr);
  var baseCol = new Float32Array(CAP * 3);
  var fishMat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 95, specular: 0xa9c3cf, side: THREE.DoubleSide });
  fishMat.onBeforeCompile = function (sh) {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPhase;\nattribute float aAmp;\nattribute float aFlash;\nvarying float vFlash;\nattribute vec3 aMark;\nvarying vec3 vMark;')
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\n' +
        'vFlash = aFlash;\nvMark = aMark;\n' +
        'float tailW = 1.0 - smoothstep(-0.64, 0.2, position.z);\n' +
        'transformed.x += sin(aPhase - position.z * 6.5) * (0.012 + 0.11 * tailW) * aAmp;');
    // 驚いた個体・急旋回した個体の体側が一瞬明るく光る（v0.2 / 試作Bを参考。控えめ）
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFlash;\nvarying vec3 vMark;')
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.9, 0.98, 1.0), vFlash) + vMark * 0.3;\n#include <fog_fragment>');
  };
  var fish = new THREE.InstancedMesh(fishGeo, fishMat, CAP);
  fish.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  fish.frustumCulled = false;
  (function () {
    var c = new THREE.Color();
    for (var i = 0; i < CAP; i++) {
      var v = 0.86 + Math.random() * 0.2;
      c.setRGB(v * (0.97 + Math.random() * 0.03), v, v * (1.0 + Math.random() * 0.04));
      fish.setColorAt(i, c);
      baseCol[i * 3] = c.r; baseCol[i * 3 + 1] = c.g; baseCol[i * 3 + 2] = c.b;
    }
    fish.instanceColor.needsUpdate = true;
  })();
  fish.count = 0;
  scene.add(fish);

  // 描画用の向き（平滑化）とバンク角
  var rh = new Float32Array(CAP * 3), roll = new Float32Array(CAP), renderedN = 0;

  /* ---------------- 餌粒の描画（v0.10） ---------------- */
  var foodPos = new Float32Array(engine.FOOD_CAP * 3);
  var foodGeo = new THREE.BufferGeometry(); foodGeo.setAttribute('position', new THREE.BufferAttribute(foodPos, 3));
  foodGeo.attributes.position.setUsage(THREE.DynamicDrawUsage);
  var foodPts = new THREE.Points(foodGeo, new THREE.PointsMaterial({ size: 0.14, color: 0xf0bb72, transparent: true, depthWrite: false, map: (function () {
    var c = document.createElement('canvas'); c.width = c.height = 32;
    var x = c.getContext('2d'), g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.55, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c);
  })() }));
  foodPts.frustumCulled = false; scene.add(foodPts);
  function updateFoodPts() {
    var n = engine.foodN;
    for (var f = 0; f < n; f++) { foodPos[f * 3] = engine.foodX[f]; foodPos[f * 3 + 1] = engine.foodY[f]; foodPos[f * 3 + 2] = engine.foodZ[f]; }
    foodGeo.setDrawRange(0, n); foodGeo.attributes.position.needsUpdate = true;
  }

  /* ---------------- 障害物の描画（v0.9）：浮き玉（係留ブイ）と岩の柱 ---------------- */
  var obsVis = new Map(), pillarSeed = 0;
  var glassMat = new THREE.MeshPhongMaterial({ color: 0x3f9488, specular: 0xffffff, shininess: 140, transparent: true, opacity: 0.88, emissive: 0x0a2626 });
  var glassSelMat = glassMat.clone(); glassSelMat.emissive = new THREE.Color(0x2a5e52);
  var ballGeo = new THREE.SphereGeometry(1, 40, 24);
  var netGeo = (function () {   // 浮き玉を包む縄の網（経線8本・緯線3本）。曲面に沿う線で丸さが分かる
    var pts = [], R = 1.02, N = 48;
    function P(th, ph) { return [R * Math.sin(th) * Math.cos(ph), R * Math.cos(th), R * Math.sin(th) * Math.sin(ph)]; }
    function seg(a, b) { pts.push(a[0], a[1], a[2], b[0], b[1], b[2]); }
    for (var k = 0; k < 8; k++) { var ph = k / 8 * Math.PI * 2; for (var i = 0; i < N; i++) seg(P(i / N * Math.PI, ph), P((i + 1) / N * Math.PI, ph)); }
    [0.62, 1.5708, 2.52].forEach(function (th) { for (var i = 0; i < N * 2; i++) seg(P(th, i / (N * 2) * Math.PI * 2), P(th, (i + 1) / (N * 2) * Math.PI * 2)); });
    var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); return g;
  })();
  var netMat = new THREE.LineBasicMaterial({ color: 0x9a8159, transparent: true, opacity: 0.85 });
  var ropeGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 6, 1, true);
  var ropeMat = new THREE.MeshPhongMaterial({ color: 0x8a7454, shininess: 4 });
  var sinkerGeo = new THREE.BoxGeometry(0.6, 0.32, 0.6);
  var sinkerMat = new THREE.MeshPhongMaterial({ color: 0x3b4243, shininess: 6 });
  var wireMat = new THREE.MeshBasicMaterial({ color: 0xf0c97c, wireframe: true, transparent: true, opacity: 0.35, fog: false });
  var wireSphereGeo = new THREE.SphereGeometry(1, 16, 10), wireCylGeo = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true);
  var sandMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, map: (function () {   // 海底を表示していないときの足元の砂地
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0, 'rgba(96,124,120,0.85)'); g.addColorStop(0.6, 'rgba(82,112,111,0.4)'); g.addColorStop(1, 'rgba(82,112,111,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
  })() });

  function buildPillarGeometry(seed, r, h) {   // 海底から立つ岩の柱。ノイズは実寸座標で（高さを変えても模様が伸びない）
    var seg = 28, hsN = Math.max(10, Math.ceil((h + 0.6) / 0.3));
    var g = new THREE.CylinderGeometry(1, 1, 1, seg, hsN, false), p = g.attributes.position, fs = new Float32Array(p.count);
    for (var i = 0; i < p.count; i++) {
      var x = p.getX(i), y = p.getY(i), z = p.getZ(i), rad = Math.sqrt(x * x + z * z);
      var yy = (y + 0.5) * (h + 0.6) - 0.6, ang = Math.atan2(z, x), cx = Math.cos(ang), cz = Math.sin(ang);
      var f = 1 + 0.26 * fbm(cx * r * 0.9, yy * 0.5, cz * r * 0.9, seed) + 0.06 * (1 - Math.abs(vnoise(cx * r * 3, yy * 2.2, cz * r * 3, seed + 5)));
      var flare = 1 + 0.35 * Math.max(0, 1 - (yy + 0.6) / (r * 1.6));            // 根元を太く
      var top = h - yy, taper = top < r ? Math.sqrt(Math.max(0.05, top / r)) * 0.5 + 0.5 : 1;   // 頂部を丸く
      var R = r * f * flare * taper, Y = yy;
      if (y > 0.49 && rad < 0.999) Y += r * 0.3 * (1 - rad * rad);
      p.setXYZ(i, cx * R * rad, Y, cz * R * rad);
      fs[i] = f;
    }
    g.computeVertexNormals();
    var nrm = g.attributes.normal, col = new Float32Array(p.count * 3);
    for (i = 0; i < p.count; i++) {
      x = p.getX(i); y = p.getY(i); z = p.getZ(i);
      var bump = Math.min(1, Math.max(0, (fs[i] - 1) * 2.4 + 0.5)), speck = vnoise(x * 5, y * 5, z * 5, seed + 57) * 0.5 + 0.5;
      C_TMP.copy(C_DARK).lerp(C_LIGHT, Math.min(1, 0.22 + 0.5 * bump + 0.2 * speck));
      var patch = vnoise(x * 1.3, y * 1.3, z * 1.3, seed + 77), algae = Math.min(1, Math.max(0, (nrm.getY(i) - 0.45) / 0.4)) * Math.max(0, patch * 1.6 + 0.2);
      if (algae > 0) C_TMP.lerp(C_ALGAE, Math.min(0.55, algae));
      if (y < 0.4) C_TMP.multiplyScalar(0.7 + 0.3 * Math.max(0, (y + 0.6) / 1.0));
      col[i * 3] = C_TMP.r; col[i * 3 + 1] = C_TMP.g; col[i * 3 + 2] = C_TMP.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }
  function makeVis(o) {
    var g = new THREE.Group(), v = { kind: o.kind, group: g };
    if (o.kind === 'buoy') {
      v.ball = new THREE.Mesh(ballGeo, glassMat); v.ball.renderOrder = 2;
      v.net = new THREE.LineSegments(netGeo, netMat); v.net.renderOrder = 3;
      v.rope = new THREE.Mesh(ropeGeo, ropeMat); v.sinker = new THREE.Mesh(sinkerGeo, sinkerMat);
      g.add(v.ball); g.add(v.net); g.add(v.rope); g.add(v.sinker);
      v.wire = new THREE.Mesh(wireSphereGeo, wireMat);
    } else {
      v.mesh = new THREE.Mesh(new THREE.BufferGeometry(), rockMat); v.builtR = -1; v.builtH = -1; v.seed = 500 + (++pillarSeed);
      g.add(v.mesh);
      v.wire = new THREE.Mesh(wireCylGeo, wireMat);
    }
    v.shadow = new THREE.Mesh(shadowGeo, shadowMat); v.shadow.rotation.x = -Math.PI / 2;
    v.sand = new THREE.Mesh(shadowGeo, sandMat); v.sand.rotation.x = -Math.PI / 2;
    scene.add(g); scene.add(v.wire); scene.add(v.shadow); scene.add(v.sand);
    return v;
  }
  function disposeVis(v) {
    scene.remove(v.group); scene.remove(v.wire); scene.remove(v.shadow); scene.remove(v.sand);
    if (v.mesh) v.mesh.geometry.dispose();
  }
  function updateVis(v, o, sel) {
    var P = engine.params, Re = o.radius + P.obsMargin + P.bodyRadius;
    v.shadow.position.set(o.x, FLOOR_Y + 0.025, o.z); v.sand.position.set(o.x, FLOOR_Y + 0.015, o.z);
    v.sand.visible = !settings.seabed;
    if (o.kind === 'buoy') {
      v.ball.position.set(o.x, o.y, o.z); v.ball.scale.setScalar(o.radius); v.ball.material = sel ? glassSelMat : glassMat;
      v.net.position.copy(v.ball.position); v.net.scale.setScalar(o.radius);
      var len = Math.max(0.01, o.y - o.radius - FLOOR_Y);
      v.rope.position.set(o.x, FLOOR_Y + len / 2, o.z); v.rope.scale.set(1, len, 1);
      v.sinker.position.set(o.x, FLOOR_Y + 0.06, o.z);
      v.shadow.scale.set(o.radius * 2.2, o.radius * 2.2, 1); v.sand.scale.set(o.radius * 3 + 3, o.radius * 3 + 3, 1);
      v.wire.position.copy(v.ball.position); v.wire.scale.setScalar(Re);
    } else {
      if (Math.abs(v.builtR - o.targetRadius) > 1e-3 || Math.abs(v.builtH - o.targetHeight) > 1e-3) {
        v.mesh.geometry.dispose();
        v.mesh.geometry = buildPillarGeometry(v.seed, o.targetRadius, o.targetHeight);
        v.builtR = o.targetRadius; v.builtH = o.targetHeight;
      }
      v.mesh.position.set(o.x, FLOOR_Y, o.z);
      v.mesh.scale.set(o.radius / v.builtR, o.height / v.builtH, o.radius / v.builtR);
      v.shadow.scale.set(o.radius * 3.4, o.radius * 3.4, 1); v.sand.scale.set(o.radius * 4 + 3, o.radius * 4 + 3, 1);
      v.wire.position.set(o.x, (o.y0 + o.y1) / 2, o.z); v.wire.scale.set(Re, Math.max(0.01, o.y1 - o.y0), Re);
    }
    v.wire.visible = showRadius;
  }
  function syncObstacles() {
    var live = new Set(), so = mode === 'obstacle' ? findObstacle(selectedId) : null;
    engine.obstacles.forEach(function (o) {
      live.add(o.id);
      var v = obsVis.get(o.id);
      if (v && v.kind !== o.kind) { disposeVis(v); obsVis.delete(o.id); v = null; }
      if (!v) { v = makeVis(o); obsVis.set(o.id, v); }
      updateVis(v, o, o === so);
    });
    obsVis.forEach(function (v, id) { if (!live.has(id)) { disposeVis(v); obsVis.delete(id); } });
    selRing.visible = !!(so && so.kind === 'buoy');
    if (selRing.visible) {
      selRing.position.set(so.x, so.y, so.z); selRing.quaternion.copy(camera.quaternion);
      selRing.scale.setScalar(so.radius * 1.12 + 0.15);
    }
    floorRing.visible = !!so;
    if (so) { floorRing.position.set(so.x, FLOOR_Y + 0.05, so.z); floorRing.scale.setScalar(so.radius * 1.4 + 0.4); }
  }

  // 刺激半径の可視化（開発者表示時のみ）
  var touchViz = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), new THREE.MeshBasicMaterial({ color: 0x92e2db, wireframe: true, transparent: true, opacity: 0.4, fog: false }));
  touchViz.visible = false; scene.add(touchViz);

  // 選択中の障害物：破線リング＋4点ハンドル（v0.2 / 試作Bを参考）
  /* ---------------- 目印（v0.3）：海底と1mマス目・岩・泳ぐ範囲の枠 ----------------
   * 尺度：イワシの体長 bodyLen 0.32 ≒ 16cm として 1ワールド単位 = 0.5m（2単位 = 1m）。 */
  var BND = FLOCK.SARDINE.bounds, FLOOR_Y = -BND[1];   // イワシの海の大きさ（ムクドリでは使わない）
  var causticTime = { value: 0 };   // 水面からの揺らめく光（海底・岩で共有）
  var causticOn = { value: 1 };     // v0.14: 大群モードでは 0（計算ごと省く）
  var CAUSTIC_GLSL = 'float caus(vec2 p, float t){' +
    'p *= 1.7; float a = sin(p.x * 1.3 + 1.6 * sin(p.y * 0.9 + t * 0.8));' +
    'float b = sin(p.y * 1.1 + 1.6 * sin(p.x * 0.7 - t * 0.7));' +
    'float c = sin((p.x + p.y) * 0.8 + 1.4 * sin((p.x - p.y) * 0.6 + t * 0.5));' +
    'return pow(1.0 - abs(a + b + c) / 3.0, 12.0); }';
  var seabed = new THREE.Mesh(new THREE.PlaneGeometry(140, 140, 1, 1), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, extensions: { derivatives: true },
    uniforms: { uSand: { value: new THREE.Color(0x52706f) }, uLine: { value: new THREE.Color(0xa6dcd4) }, uTime: causticTime, uCaus: causticOn },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: 'uniform vec3 uSand; uniform vec3 uLine; uniform float uTime; uniform float uCaus; varying vec3 vW;' + CAUSTIC_GLSL +
      'float grid(vec2 p, float s){ vec2 q = p / s; vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q); return 1.0 - min(min(g.x, g.y), 1.0); }' +
      'void main(){ float d = distance(vW, cameraPosition); float fade = exp(-pow(d * 0.032, 2.0));' +
      'float rip = 0.5 + 0.5 * sin(vW.x * 1.3 + 2.0 * sin(vW.z * 0.4));' +
      'vec3 c = uSand * (0.82 + 0.18 * rip);' +
      'if (uCaus > 0.5) c += vec3(0.5, 0.82, 0.76) * caus(vW.xz, uTime) * 0.16;' +
      'c = mix(c, uLine, max(grid(vW.xz, 2.0) * 0.32, grid(vW.xz, 10.0) * 0.7));' +   // 細線 1m、太線 5m
      'gl_FragColor = vec4(c, 0.9 * fade); }'
  }));
  seabed.rotation.x = -Math.PI / 2; seabed.position.y = FLOOR_Y; seabed.visible = false; scene.add(seabed);

  /* ---- 岩（v0.8）：多重ノイズの凹凸＋平面で割った面、くぼみの陰り、上面の藻、揺らめく光、砂への接地影 ---- */
  function makeRng(seed) { var a = seed >>> 0; return function () { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; }
  function hash3(x, y, z, s) { var h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + s * 19.31) * 43758.5453; return h - Math.floor(h); }
  function vnoise(x, y, z, s) {   // 3D値ノイズ（-1〜1）
    var xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    function L(a, b, t) { return a + (b - a) * t; }
    var r = L(L(L(hash3(xi, yi, zi, s), hash3(xi + 1, yi, zi, s), u), L(hash3(xi, yi + 1, zi, s), hash3(xi + 1, yi + 1, zi, s), u), v),
              L(L(hash3(xi, yi, zi + 1, s), hash3(xi + 1, yi, zi + 1, s), u), L(hash3(xi, yi + 1, zi + 1, s), hash3(xi + 1, yi + 1, zi + 1, s), u), v), w);
    return r * 2 - 1;
  }
  function fbm(x, y, z, s) { var a = 0.5, f = 1, sum = 0; for (var i = 0; i < 4; i++) { sum += a * vnoise(x * f, y * f, z * f, s + i * 7); a *= 0.5; f *= 2.03; } return sum; }
  var C_DARK = new THREE.Color(0x2c3230), C_LIGHT = new THREE.Color(0x857f72), C_ALGAE = new THREE.Color(0x58703c), C_TMP = new THREE.Color();
  function buildRockGeometry(seed, detail) {
    var src = new THREE.IcosahedronGeometry(1, detail), sp = src.attributes.position, map = new Map(), verts = [], index = [];
    for (var i = 0; i < sp.count; i++) {   // 重複頂点を統合（なめらかな陰影のため）
      var key = Math.round(sp.getX(i) * 1e4) + ',' + Math.round(sp.getY(i) * 1e4) + ',' + Math.round(sp.getZ(i) * 1e4), id = map.get(key);
      if (id === undefined) { id = verts.length / 3; verts.push(sp.getX(i), sp.getY(i), sp.getZ(i)); map.set(key, id); }
      index.push(id);
    }
    src.dispose();
    var rng = makeRng(seed * 7919 + 13), cuts = [], nc = 3 + Math.floor(rng() * 3);
    for (var c = 0; c < nc; c++) {   // 割れた面：ランダムな平面で削る（真下は除く）
      var th = rng() * Math.PI * 2, cy = -0.15 + rng() * 1.05, cr = Math.sqrt(1 - cy * cy);
      cuts.push([Math.cos(th) * cr, cy, Math.sin(th) * cr, 0.68 + rng() * 0.26]);
    }
    var n = verts.length / 3, pos = new Float32Array(n * 3), hs = new Float32Array(n), maxR = 0;
    for (i = 0; i < n; i++) {
      var x = verts[i * 3], y = verts[i * 3 + 1], z = verts[i * 3 + 2];
      var h = 1 + 0.34 * fbm(x * 1.3, y * 1.3, z * 1.3, seed) + 0.07 * (1 - Math.abs(vnoise(x * 5, y * 5, z * 5, seed + 31))) + 0.025 * vnoise(x * 13, y * 13, z * 13, seed + 41);
      x *= h; y *= h; z *= h;
      for (c = 0; c < cuts.length; c++) { var q = cuts[c], dd = x * q[0] + y * q[1] + z * q[2]; if (dd > q[3]) { var k = (dd - q[3]) * 0.75; x -= q[0] * k; y -= q[1] * k; z -= q[2] * k; } }
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z; hs[i] = h;
      var rr = Math.sqrt(x * x + y * y + z * z); if (rr > maxR) maxR = rr;
    }
    for (i = 0; i < n * 3; i++) pos[i] /= maxR;   // 最大半径を1に（＝当たり判定の半径）
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    var nrm = geo.attributes.normal, col = new Float32Array(n * 3);
    for (i = 0; i < n; i++) {
      x = pos[i * 3]; y = pos[i * 3 + 1]; z = pos[i * 3 + 2];
      var bump = Math.min(1, Math.max(0, (hs[i] - 1) * 2.4 + 0.5));            // 出っ張りほど明るく、くぼみほど暗い
      var speck = vnoise(x * 11, y * 11, z * 11, seed + 57) * 0.5 + 0.5;
      C_TMP.copy(C_DARK).lerp(C_LIGHT, Math.min(1, 0.22 + 0.5 * bump + 0.2 * speck));
      var up = nrm.getY(i), patch = vnoise(x * 2.6, y * 2.6, z * 2.6, seed + 77);   // 藻は上面にまだらに
      var algae = Math.min(1, Math.max(0, (up - 0.55) / 0.4)) * Math.max(0, patch * 1.6 + 0.1);
      if (algae > 0) C_TMP.lerp(C_ALGAE, Math.min(0.55, algae));
      if (y < -0.35) C_TMP.multiplyScalar(0.7 + 0.3 * Math.max(0, (y + 0.75) / 0.4));   // 砂に埋まる根元を暗く
      col[i * 3] = C_TMP.r; col[i * 3 + 1] = C_TMP.g; col[i * 3 + 2] = C_TMP.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return geo;
  }
  var rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
  rockMat.onBeforeCompile = function (sh) {   // 上を向いた面に、水面からの揺らめく光（コースティクス）
    sh.uniforms.uTime = causticTime; sh.uniforms.uCaus = causticOn;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying float vUp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvUp = normalize(mat3(modelMatrix) * objectNormal).y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uCaus;\nvarying vec3 vWPos;\nvarying float vUp;\n' + CAUSTIC_GLSL)
      .replace('#include <fog_fragment>', 'if (uCaus > 0.5) gl_FragColor.rgb += vec3(0.5, 0.82, 0.76) * caus(vWPos.xz, uTime) * smoothstep(0.15, 0.85, vUp) * 0.3;\n#include <fog_fragment>');
  };
  var shadowTex = (function () {
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 4, 32, 32, 32);
    g.addColorStop(0, 'rgba(0,0,0,0.75)'); g.addColorStop(0.55, 'rgba(0,0,0,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  var shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.6, color: 0x000000 });
  var shadowGeo = new THREE.PlaneGeometry(1, 1);

  var ROCKS = [[-7, -2.5, 1.8], [6.5, 3, 1.4], [1, -8.5, 2.2], [-3.5, 7.5, 1.2], [11, -5, 1.6], [-12, 5, 1.5]];   // x, z, 半径
  var rockObs = [], rockGroup = new THREE.Group(), rockShadows = new THREE.Group();
  (function () {
    var rng = makeRng(2026);
    function place(x, z, r, seed, detail) {
      var m = new THREE.Mesh(buildRockGeometry(seed, detail), rockMat), cy = FLOOR_Y - r * 0.22;
      m.position.set(x, cy, z); m.scale.set(r, r * 0.78, r * (0.85 + rng() * 0.25)); m.rotation.y = rng() * Math.PI * 2;
      rockGroup.add(m);
      var s = new THREE.Mesh(shadowGeo, shadowMat);
      s.rotation.x = -Math.PI / 2; s.position.set(x, FLOOR_Y + 0.02, z); s.scale.set(r * 2.7, r * 2.7, 1);
      rockShadows.add(s);
      if (r >= 0.45) rockObs.push({ id: 'rock' + seed, kind: 'sphere', x: x, y: cy, z: z, radius: r, enabled: true, vx: 0, vy: 0, vz: 0, fixed: true });
    }
    ROCKS.forEach(function (r, n) {
      place(r[0], r[1], r[2], n + 1, 16);
      var ns = 2 + Math.floor(rng() * 2);   // 周りに小さな石を添える
      for (var k = 0; k < ns; k++) {
        var a = rng() * Math.PI * 2, d = r[2] * (0.95 + rng() * 0.5), sr = r[2] * (0.18 + rng() * 0.27);
        place(r[0] + Math.cos(a) * d, r[1] + Math.sin(a) * d, sr, 100 + n * 10 + k, 5);
      }
    });
  })();
  rockGroup.visible = false; rockShadows.visible = false; scene.add(rockGroup); scene.add(rockShadows);

  function makeRangeFrame(BB, color, opacity) {   // 群れが泳ぐ（飛ぶ）範囲（ソフト境界の楕円体）
    var g = new THREE.Group(), mat = new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: opacity, depthWrite: false, fog: false });
    function ring(fn) { var pts = []; for (var i = 0; i <= 96; i++) pts.push(fn(i / 96 * Math.PI * 2)); g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat)); }
    [-0.6, -0.3, 0, 0.3, 0.6].forEach(function (h) {
      var s = Math.sqrt(1 - h * h);
      ring(function (a) { return new THREE.Vector3(Math.cos(a) * s * BB[0], h * BB[1], Math.sin(a) * s * BB[2]); });
    });
    [0, Math.PI / 4, Math.PI / 2, Math.PI * 3 / 4].forEach(function (ph) {
      ring(function (a) { return new THREE.Vector3(Math.cos(a) * Math.cos(ph) * BB[0], Math.sin(a) * BB[1], Math.cos(a) * Math.sin(ph) * BB[2]); });
    });
    g.visible = false; scene.add(g); return g;
  }
  var rangeSea = makeRangeFrame(BND, 0x92e2db, 0.22), rangeSky = makeRangeFrame(FLOCK.STARLING.bounds, 0xfff1dc, 0.3);
  var rangeFrame = rangeSea;

  /* ---------------- ムクドリモード（v0.15）：空・駅前の街・鳥・ハヤブサ（starling.js） ---------------- */
  var starView = FLOCK.createStarlingView({ THREE: THREE, cap: CAP, engine: engine });
  scene.add(starView.group);
  var seaFog = scene.fog, skyFog = new THREE.FogExp2(0xcc9ea4, 0.0012);

  function applyLandmarks() {
    var st = isStar();   // ムクドリでは海底と岩を使わない
    seabed.visible = !st && !!settings.seabed;
    rockGroup.visible = !st && !!settings.rocks;
    rockShadows.visible = !st && !!(settings.rocks && settings.seabed);
    engine.landmarks = !st && settings.rocks ? rockObs : [];
    rangeSea.visible = rangeSky.visible = false;
    rangeFrame = st ? rangeSky : rangeSea;
    rangeFrame.visible = !!settings.range;
    document.getElementById('scalebar').hidden = !settings.scalebar;
  }

  var selRing = (function () {
    var pts = [], N = 72;
    for (var i = 0; i <= N; i++) { var a = i / N * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0)); }
    var line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineDashedMaterial({ color: 0xb2fdea, dashSize: 0.07, gapSize: 0.07, transparent: true, opacity: 0.85, depthTest: false, fog: false }));
    line.computeLineDistances();
    var handles = new THREE.Points(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0)]),
      new THREE.PointsMaterial({ color: 0xcffff5, size: 6, sizeAttenuation: false, depthTest: false, fog: false }));
    line.renderOrder = 5; handles.renderOrder = 5;
    var g = new THREE.Group(); g.add(line); g.add(handles); g.visible = false; scene.add(g);
    return g;
  })();

  var floorRing = (function () {   // 選択中の障害物の足元（海底）の破線リング
    var pts = [], N = 96;
    for (var i = 0; i <= N; i++) { var a = i / N * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a))); }
    var line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineDashedMaterial({ color: 0xb2fdea, dashSize: 0.06, gapSize: 0.06, transparent: true, opacity: 0.9, fog: false }));
    line.computeLineDistances(); line.visible = true; line.renderOrder = 5;
    var g = new THREE.Group(); g.add(line); g.visible = false; scene.add(g);
    return g;
  })();

  /* ---------------- カメラ ---------------- */
  var camTarget = new THREE.Vector3().fromArray(engine.centroid);
  var camFwd = new THREE.Vector3(0, 0, -1);
  var camDist = 12, spreadSm = engine.spread, zoom = 1, W = 1, H = 1;
  var userYaw = 0, userPitch = 0.24, ORBIT_K = 0.006;   // v0.3 視点回転（観察モードの1本指／全モードの2本指）
  function clampPitch(p) { return isStar() ? Math.min(0.9, Math.max(-0.9, p)) : Math.min(1.3, Math.max(-0.2, p)); }
  function zoomMin() { return isStar() ? 0.5 : 0.45; }
  function zoomMax() { return isStar() ? 2 : 2.4; }
  var tanHalf = Math.tan(FOV * Math.PI / 360);
  function desiredDist() {
    var aspect = W / H;
    var d = (2.8 * Math.max(0.8, spreadSm) / 0.55) / (2 * tanHalf * Math.min(aspect, 1));
    return Math.min(38, Math.max(6, d)) * zoom;
  }
  /* v0.15 ムクドリ：駅前広場に立って見上げる。立つ位置は固定し、群れの方へ首を振る。
   * 画角は群れ全体が入るように変える。2本指（観察モードは1本指）で向きをずらし、3秒たつと自動に戻る */
  var VIEW_POS = new THREE.Vector3(0, FLOCK.STARLING.groundY + 1.6, 85), lookAtV = new THREE.Vector3();   // v0.16: 125 m → 85 m（近くで見上げる）
  var stYaw = 0, stPitch = 0.4, stFov = 50, lastLook = -1e9, stSnap = true;
  var cPrev = new THREE.Vector3(), cVel = new THREE.Vector3();   // v0.16: 群れの進む先を少し先回りして向く
  function clampN(x, a, b) { return x < a ? a : x > b ? b : x; }
  function updateStarCamera(dt) {
    var c = engine.centroid, k = stSnap ? 1 : 1 - Math.exp(-dt * 2.0);
    if (stSnap) { cPrev.fromArray(c); cVel.set(0, 0, 0); }
    else if (dt > 0) { var kv = 1 - Math.exp(-dt * 1.5); cVel.x += ((c[0] - cPrev.x) / dt - cVel.x) * kv; cVel.y += ((c[1] - cPrev.y) / dt - cVel.y) * kv; cVel.z += ((c[2] - cPrev.z) / dt - cVel.z) * kv; cPrev.fromArray(c); }
    var LEAD = 0.7, ax = c[0] + cVel.x * LEAD, ay = c[1] + cVel.y * LEAD, az = c[2] + cVel.z * LEAD, spT = engine.spread;
    // v0.17 止まり木：止まっている（降りている）鳥がいるときは、空の群れとの中間を向き、両方が入るように画角を広げる
    var pn = 0, pcx = 0, pcy = 0, pcz = 0;
    for (var i = 0; i < engine.n; i++) if (engine.pst[i]) { pcx += engine.px[i]; pcy += engine.py[i]; pcz += engine.pz[i]; pn++; }
    if (pn > 0) {
      pcx /= pn; pcy /= pn; pcz /= pn;
      var pext = 0;   // 止まっている鳥の広がり（電線の区間の長さの半分くらい）
      for (i = 0; i < engine.n; i++) if (engine.pst[i]) pext = Math.max(pext, Math.hypot(engine.px[i] - pcx, engine.py[i] - pcy, engine.pz[i] - pcz));
      var half = Math.hypot(ax - pcx, ay - pcy, az - pcz) / 2;
      if (pn >= engine.n - 3) { ax = pcx; ay = pcy; az = pcz; spT = (pext + 4) / 1.8; }   // ほぼ全員が止まったら、止まり木を見る
      else { ax = (ax + pcx) / 2; ay = (ay + pcy) / 2; az = (az + pcz) / 2; spT = Math.max(spT, (half + Math.max(pext, spT)) / 1.8); }
    }
    camTarget.x += (ax - camTarget.x) * k; camTarget.y += (ay - camTarget.y) * k; camTarget.z += (az - camTarget.z) * k;
    spreadSm += (spT - spreadSm) * (stSnap ? 1 : 1 - Math.exp(-dt * 0.8));
    var dx = camTarget.x - VIEW_POS.x, dy = camTarget.y - VIEW_POS.y, dz = camTarget.z - VIEW_POS.z;
    var hd = Math.hypot(dx, dz) || 1, dist = Math.hypot(hd, dy), aspect = W / H;
    var hf = 2 * Math.atan((spreadSm * 1.8 + 6) / dist) / 0.72;   // v0.16: 群れの見かけの直径が、画面の短い辺の約7割
    var vf = aspect < 1 ? 2 * Math.atan(Math.tan(hf / 2) / aspect) : hf;
    var vDeg = clampN(clampN(vf * 180 / Math.PI, aspect < 1 ? 20 : 32, 80) / zoom, 10, 95);   // 横画面は縦が狭いので、画角の下限を広めに
    // 地平線が画面の下から約2割の高さに来る向きを基本にし、群れが高いときだけ見上げる
    var halfV = vDeg * Math.PI / 360, pHor = Math.atan(0.58 * Math.tan(halfV)), elev = Math.atan2(dy, hd);
    var tYaw = Math.atan2(-dx, -dz), tPitch = clampN(Math.max(pHor, elev - 0.3 * halfV), 0.03, 1.35);   // v0.16: 群れは画面の中央やや上に
    if (performance.now() - lastLook > 3000) { var kb = Math.exp(-dt * 1.2); userYaw *= kb; userPitch *= kb; }
    // v0.16: 拡大しているときは、首振りをゆっくりにする（画面の中で景色が速く流れないように）
    var kk = stSnap ? 1 : 1 - Math.exp(-dt * 2.2 / Math.sqrt(Math.max(1, zoom))), dyaw = tYaw - stYaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    stYaw += dyaw * kk; stPitch += (tPitch - stPitch) * kk; stFov += (vDeg - stFov) * kk;
    stSnap = false;
    var yaw = stYaw + userYaw, pitch = clampN(stPitch + userPitch, 0, 1.4);   // 見上げる角度は 0〜80°
    camera.position.copy(VIEW_POS);
    camFwd.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    camera.lookAt(lookAtV.copy(VIEW_POS).add(camFwd));
    if (Math.abs(camera.fov - stFov) > 1e-3) { camera.fov = stFov; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
    tanHalf = Math.tan(stFov * Math.PI / 360);
    camDist = dist;
    engine.viewHalf = dist * tanHalf * aspect;
  }
  function updateCamera(dt, clock) {
    if (isStar()) { updateStarCamera(dt); return; }
    var c = engine.centroid;
    if (!drag) {
      var k = 1 - Math.exp(-dt * 0.9);
      camTarget.x += (c[0] - camTarget.x) * k; camTarget.y += (c[1] - camTarget.y) * k; camTarget.z += (c[2] - camTarget.z) * k;
    }
    spreadSm += (engine.spread - spreadSm) * (1 - Math.exp(-dt * 0.5));
    camDist += (desiredDist() - camDist) * (1 - Math.exp(-dt * 1.2));
    var t = clock, yaw = userYaw + 0.22 * Math.sin(t * 0.043), pitch = userPitch + 0.05 * Math.sin(t * 0.031);
    camera.position.set(
      camTarget.x + Math.sin(yaw) * Math.cos(pitch) * camDist,
      camTarget.y + Math.sin(pitch) * camDist,
      camTarget.z + Math.cos(yaw) * Math.cos(pitch) * camDist);
    if (camera.position.y < FLOOR_Y + 0.6) camera.position.y = FLOOR_Y + 0.6;   // 海底より下に潜らない
    camera.lookAt(camTarget);
    camera.updateMatrixWorld();
    camera.getWorldDirection(camFwd);
    sky.position.copy(camera.position);
    sky.material.uniforms.uTime.value = clock;
    causticTime.value = clock;
    engine.viewHalf = camDist * tanHalf * (W / H);
  }
  function viewSizeAtTarget() { var h = 2 * camDist * tanHalf; return { h: h, w: h * W / H }; }

  /* ---------------- 座標変換（スクリーン → 基準奥行き面） ---------------- */
  var raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(), tmpV = new THREE.Vector3();
  function setRay(sx, sy) {
    var r = canvas.getBoundingClientRect();
    ndc.set((sx - r.left) / r.width * 2 - 1, -((sy - r.top) / r.height * 2 - 1));
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray;
  }
  function screenToPlane(sx, sy, through, out) {
    var ray = setRay(sx, sy);
    plane.setFromNormalAndCoplanarPoint(camFwd, through);
    return ray.intersectPlane(plane, out);
  }

  /* ---------------- 入力：タッチ忌避 ---------------- */
  var mode = 'touch';
  var pointers = new Map();
  var gesture = 'none';            // none | touch | obstacle | look | pinch | wait
  var look = null;                 // 観察モードのドラッグ（視点回転）／タップ（色付け）
  var pinch = null;
  var touchScale = 1;
  var touch = { down: false, sx: 0, sy: 0, s: 0, grow: 0, init: false, cur: new THREE.Vector3(), prev: new THREE.Vector3(), fresh: false, nx: 0, ny: 0, nt: 0, minHold: 0 };
  var TAP_MIN = 0.15;
  var rep = { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, fx: 0, fy: 0, fz: -1, R: 1, depth: 1.6, s: 0 };
  var repList = [rep], emptyList = [];

  function touchRadius() { var v = viewSizeAtTarget(); return 0.15 * Math.min(v.w, v.h) * touchScale; }

  var fal = { sx: 0, sy: 0, x0: 0, y0: 0, chasing: false };   // v0.15 ハヤブサの指
  function updateTouch(dt) {
    if (isStar()) {   // ムクドリ：指はハヤブサを動かす。エンジンには predator として渡す
      engine.repulsors = emptyList; touchViz.visible = false;
      if (fal.chasing && touch.down && screenToPlane(fal.sx, fal.sy, camTarget, tmpV)) starView.falcon.steer(tmpV);
      engine.predator = starView.falcon.step(dt, camera.position);
      return;
    }
    // v0.7: 指を離していても、押してから最低 TAP_MIN 秒は刺激を与える（素早いタップの取りこぼし防止）
    var held = touch.down && gesture === 'touch';
    if (held || touch.minHold > 0) {
      touch.minHold -= dt;
      if (screenToPlane(touch.sx, touch.sy, camTarget, tmpV)) {
        if (!touch.init) { touch.prev.copy(tmpV); touch.init = true; } else touch.prev.copy(touch.cur);
        touch.cur.copy(tmpV);
        if (touch.fresh) { touch.fresh = false; playRustle(countNear(touch.cur, touchRadius() * 1.2), touch.sx); }
      }
      touch.s += (1 - touch.s) * Math.min(1, dt * 20);
      touch.grow = Math.min(1, touch.grow + dt / 0.6);
    } else {
      touch.s *= Math.exp(-dt / 0.17);   // 約0.2〜0.6秒で減衰
      touch.prev.copy(touch.cur);
    }
    if (!touch.init || touch.s < 0.002) { engine.repulsors = emptyList; touchViz.visible = false; return; }
    var g = touch.grow, R = touchRadius() * (0.7 + 0.3 * g * g * (3 - 2 * g));
    rep.ax = touch.prev.x; rep.ay = touch.prev.y; rep.az = touch.prev.z;   // 指の軌跡を線分で補間
    rep.bx = touch.cur.x; rep.by = touch.cur.y; rep.bz = touch.cur.z;
    rep.fx = camFwd.x; rep.fy = camFwd.y; rep.fz = camFwd.z;
    rep.R = R; rep.depth = R * 1.6; rep.s = touch.s;
    engine.repulsors = repList;
    if (showRadius) {
      touchViz.visible = true;
      touchViz.position.copy(touch.cur); touchViz.quaternion.copy(camera.quaternion);
      touchViz.scale.set(R, R, R * 1.6);
      touchViz.material.opacity = 0.45 * touch.s;
    }
  }

  /* ---------------- 入力：障害物（v0.9）：海底に沿って水平に動かし、高さはスライダー ---------------- */
  var selectedId = null, drag = null, nextKind = 'buoy';
  var sphere = new THREE.Sphere(), hitV = new THREE.Vector3(), hplane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function clampXZ(v) {   // 群れが泳ぐ範囲の内側（水平）に留める
    var B = engine.params.bounds, e = Math.sqrt((v.x / B[0]) * (v.x / B[0]) + (v.z / B[2]) * (v.z / B[2]));
    if (e > 0.85) { v.x *= 0.85 / e; v.z *= 0.85 / e; }
    return v;
  }
  function rayToHorizontal(ray, y, out) {   // 視線と水平面 y の交点（遠すぎる交点は不採用）
    hplane.constant = -y;
    var p = ray.intersectPlane(hplane, out);
    return p && p.distanceTo(ray.origin) < 90 ? p : null;
  }
  function findObstacle(id) { for (var i = 0; i < engine.obstacles.length; i++) if (engine.obstacles[i].id === id) return engine.obstacles[i]; return null; }
  function pickObstacle(ray) {
    var best = null, bestD = Infinity;
    engine.obstacles.forEach(function (o) {
      if (o.kind === 'buoy') {
        sphere.center.set(o.x, o.y, o.z); sphere.radius = Math.max(o.radius * 1.15, 0.5);
        if (ray.intersectSphere(sphere, hitV)) { var d = hitV.distanceTo(ray.origin); if (d < bestD) { bestD = d; best = { o: o, y: o.y }; } }
      } else {   // 鉛直の柱：視線と柱の軸の最接近で判定
        var d0 = ray.direction, ox = ray.origin.x - o.x, oz = ray.origin.z - o.z, a = d0.x * d0.x + d0.z * d0.z;
        var t = a > 1e-6 ? Math.max(0, -(ox * d0.x + oz * d0.z) / a) : 0;
        var py = ray.origin.y + d0.y * t, cy = Math.min(o.y1 + o.radius * 0.6, Math.max(o.y0, py));
        var dist = Math.hypot(ray.origin.x + d0.x * t - o.x, py - cy, ray.origin.z + d0.z * t - o.z);
        if (dist < o.radius * 1.25 + 0.3 && t < bestD) { bestD = t; best = { o: o, y: cy }; }
      }
    });
    return best;
  }
  function obstacleDown(sx, sy) {
    var ray = setRay(sx, sy), hit = pickObstacle(ray), ob, grabY, created = null;
    if (hit) { ob = hit.o; grabY = hit.y; }
    else {
      if (engine.obstacles.length >= MAX_OBS) { toast('障害物は5個までです。削除してから追加してください'); return; }
      var r = canvas.getBoundingClientRect(), u = (sx - r.left) / r.width, v = (sy - r.top) / r.height;
      if (u < 0.08 || u > 0.92 || v < 0.1 || v > 0.86) { toast('画面の端には置けません。少し内側をタップしてください'); return; }
      // 群れの高さの水平面に置く（届かなければ画面奥の面で代用）
      var schoolY = Math.min(FLOOR_Y + 13, Math.max(FLOOR_Y + 2, camTarget.y));
      if (!rayToHorizontal(ray, schoolY, tmpV) && !screenToPlane(sx, sy, camTarget, tmpV)) return;
      clampXZ(tmpV);
      var h = nextKind === 'buoy' ? schoolY - FLOOR_Y : Math.min(15, schoolY - FLOOR_Y + 2.5);
      ob = engine.addObstacle({ kind: nextKind, x: tmpV.x, z: tmpV.z, radius: +obsSize.value, height: h });
      grabY = schoolY; created = ob.id;
    }
    selectedId = ob.id;
    var p = rayToHorizontal(ray, grabY, new THREE.Vector3());
    drag = { ob: ob, y: grabY, ox: p ? ob.x - p.x : 0, oz: p ? ob.z - p.z : 0 };
    updateObsUI();
    return created;
  }
  function obstacleMove(sx, sy) {
    if (!drag || !findObstacle(drag.ob.id)) { drag = null; return; }
    if (!rayToHorizontal(setRay(sx, sy), drag.y, tmpV)) return;
    tmpV.x += drag.ox; tmpV.z += drag.oz;
    clampXZ(tmpV);
    drag.ob.tx = tmpV.x; drag.ob.tz = tmpV.z;
  }

  /* ---------------- 入力：餌やり（v0.10） ---------------- */
  var touchTool = 'touch', feedLast = { x: 0, y: 0 };
  function scatterFood(sx, sy, count) {
    if (!screenToPlane(sx, sy, camTarget, tmpV)) return 0;
    // v0.13: 見下ろしたときに海底より下の点にならないよう、指の視線上で海底から50cm上の点に置き直す
    var minY = FLOOR_Y + engine.params.foodMinH;
    if (tmpV.y < minY && !rayToHorizontal(setRay(sx, sy), minY, tmpV)) return 0;
    clampXZ(tmpV);
    var before = engine.foodN;
    engine.addFood(tmpV.x, tmpV.y, tmpV.z, count, count > 10 ? 0.8 : 0.4);
    if (engine.foodN === before) { toast('餌がいっぱいです。食べ終わるまで少し待ってください'); return 0; }
    playFeed(count, sx);
    return engine.foodN - before;
  }

  /* ---------------- Pointer Events ---------------- */
  function pdist() { var a = Array.from(pointers.values()); return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1; }
  function pmid() { var a = Array.from(pointers.values()); return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 }; }
  function endSingle() { touch.down = false; drag = null; look = null; made = null; }
  function releaseAll() { cancelPending(); pointers.clear(); endSingle(); pinch = null; gesture = 'none'; }

  /* v0.12: 拡大縮小のつもりが「触る・餌・障害物」にならないように
   *  ・指1本が触れたら PEND_MS だけ待ち、その間に2本目が来たら拡大縮小として扱う（何も起こさない）
   *  ・待つ間に指が動いた／時間が過ぎた／指を離した（タップ）ときは、通常の操作として実行する
   *  ・操作を始めた直後（UNDO_MS 以内）に2本目が来たら、置いた障害物とまいた餌を取り消す */
  var PEND_MS = 120, UNDO_MS = 600, pending = null, made = null;
  function cancelPending() { if (pending) { clearTimeout(pending.t); pending = null; } }
  function undoMade() {
    if (!made || performance.now() - made.t > UNDO_MS) { made = null; return; }
    if (made.obs) { engine.removeObstacle(made.obs); if (selectedId === made.obs) selectedId = null; drag = null; updateObsUI(); }
    if (made.food) engine.foodN = Math.max(0, engine.foodN - made.food);
    if (made.falcon) starView.falcon.cancel(UNDO_MS);
    made = null;
  }
  function commitPending() {
    if (!pending || gesture !== 'pending') return;
    var p = pending; cancelPending(); gesture = 'none';
    beginSingle(p.x, p.y, 0);
    var cur = pointers.get(p.id);
    if (cur && (cur.x !== p.x || cur.y !== p.y)) moveSingle(cur.x, cur.y);
  }
  function beginSingle(x, y, button) {
    made = { t: performance.now(), obs: null, food: 0 };
    if (button === 2 || mode === 'watch') {   // 右ドラッグ（PC）または観察モードで視点を回す
      gesture = 'look'; look = { sx: x, sy: y, yaw0: userYaw, pitch0: userPitch, moved: button === 2 };
      return;
    }
    if (mode === 'touch' && isStar()) {   // v0.15 ハヤブサ：タップで急降下、なぞると追いかける
      gesture = 'falcon'; touch.down = true;
      fal.sx = fal.x0 = x; fal.sy = fal.y0 = y; fal.chasing = false;
      return;
    }
    if (mode === 'touch' && touchTool === 'feed') {   // 餌やり：タップした場所に餌をまく
      gesture = 'feed'; feedLast.x = x; feedLast.y = y;
      made.food += scatterFood(x, y, 28);
      return;
    }
    if (mode === 'touch') {
      gesture = 'touch'; touch.down = true; touch.sx = x; touch.sy = y; touch.grow = 0;
      touch.fresh = true; touch.nx = x; touch.ny = y; touch.nt = performance.now(); touch.minHold = TAP_MIN;
      playTouch(x, y, false);
      if (touch.s < 0.05) touch.init = false;
    } else if (mode === 'obstacle') {
      gesture = 'obstacle'; made.obs = obstacleDown(x, y) || null;
    }
  }
  function moveSingle(x, y) {
    if (gesture === 'look' && look) {
      var dx = x - look.sx, dy = y - look.sy;
      if (!look.moved && dx * dx + dy * dy > 64) look.moved = true;
      if (look.moved) { userYaw = look.yaw0 + dx * orbitK() * yawSign(); userPitch = clampPitch(look.pitch0 + dy * orbitK()); lastLook = performance.now(); }
    } else if (gesture === 'feed') {   // なぞると帯状にまく
      if (Math.hypot(x - feedLast.x, y - feedLast.y) > 34) { feedLast.x = x; feedLast.y = y; if (made) made.food += scatterFood(x, y, 8); else scatterFood(x, y, 8); }
    } else if (gesture === 'touch') {
      touch.sx = x; touch.sy = y;
      var nowT = performance.now();   // なぞると一定距離ごとに小さく鳴る
      if (Math.hypot(x - touch.nx, y - touch.ny) > 70 && nowT - touch.nt > 150) {
        touch.nx = x; touch.ny = y; touch.nt = nowT; touch.fresh = true;
        playTouch(x, y, true);
      }
    } else if (gesture === 'obstacle') obstacleMove(x, y);
    else if (gesture === 'falcon') {
      fal.sx = x; fal.sy = y;
      if (!fal.chasing && Math.hypot(x - fal.x0, y - fal.y0) > 12 && screenToPlane(x, y, camTarget, tmpV)) {
        fal.chasing = true;
        var fresh = !starView.falcon.active();
        starView.falcon.chase(tmpV.clone(), camera.position);
        engine.scarePerched(tmpV.x, tmpV.y, tmpV.z);   // v0.17 ハヤブサが出たら、止まっている鳥は飛び立つ
        if (made && fresh) made.falcon = true;
      }
    }
  }
  // v0.16 ムクドリ：指を動かした分だけ景色が動く（拡大するほど回転を小さくする）
  function orbitK() { return isStar() ? (camera.fov * Math.PI / 180) / Math.max(1, H) : ORBIT_K; }
  function yawSign() { return isStar() ? 1 : -1; }   // ムクドリは自分が向きを変える（ドラッグした方へ景色が動く）

  canvas.addEventListener('pointerdown', function (e) {
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    dismissGuide();
    fadeHint();
    startAudio();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      cancelPending(); undoMade(); endSingle();
      gesture = 'pinch'; var m0 = pmid(); pinch = { d0: pdist(), z0: zoom, mx: m0.x, my: m0.y, yaw0: userYaw, pitch0: userPitch };
      return;
    }
    if (pointers.size > 2 || gesture === 'pinch' || gesture === 'wait') return;
    if (e.pointerType === 'touch' && mode !== 'watch') {   // 2本目の指が来るか少し待つ
      gesture = 'pending'; pending = { x: e.clientX, y: e.clientY, id: e.pointerId, t: setTimeout(commitPending, PEND_MS) };
      return;
    }
    beginSingle(e.clientX, e.clientY, e.button);
  });
  canvas.addEventListener('pointermove', function (e) {
    var p = pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if (gesture === 'pending') {   // 指がはっきり動いたら、待たずに通常の操作を始める
      if (pending && Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > 12) commitPending();
      return;
    }
    if (gesture === 'pinch' && pointers.size >= 2 && pinch) {
      zoom = isStar() ? Math.min(zoomMax(), Math.max(zoomMin(), pinch.z0 * pdist() / pinch.d0))   // ムクドリは画角を変える（広げると拡大）
        : Math.min(zoomMax(), Math.max(zoomMin(), pinch.z0 * pinch.d0 / pdist()));
      var mm = pmid();   // 2本指をそろえて動かすと視点が回る
      userYaw = pinch.yaw0 + (mm.x - pinch.mx) * orbitK() * yawSign();
      userPitch = clampPitch(pinch.pitch0 + (mm.y - pinch.my) * orbitK());
      lastLook = performance.now();
    } else moveSingle(e.clientX, e.clientY);
  });
  function pointerEnd(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (gesture === 'pending') {   // 待っている間に指を離した＝タップ。その場で実行
      var p = pending; cancelPending(); gesture = 'none';
      if (p && e.type === 'pointerup') beginSingle(p.x, p.y, 0);
    }
    if (gesture === 'pinch') { gesture = pointers.size ? 'wait' : 'none'; pinch = null; return; }
    if (gesture === 'wait') { if (!pointers.size) gesture = 'none'; return; }
    if (gesture === 'look' && look && !look.moved && e.type === 'pointerup' && mode === 'watch') toggleTagAt(look.sx, look.sy);
    if (gesture === 'falcon') {
      if (fal.chasing) starView.falcon.release();
      else if (e.type === 'pointerup') {
        // v0.17 止まり木：電線や木をタップしたら、そこへ降りる。空をタップしたらハヤブサ（止まっている鳥は飛び立つ）
        var hit = starView.pickPerch(fal.x0, fal.y0, camera, canvas.getBoundingClientRect());
        if (hit) engine.perchSite(hit);   // v0.19 群れは上空を回ってから、決断が広がって降りる
        else if (screenToPlane(fal.x0, fal.y0, camTarget, tmpV)) { starView.falcon.dive(tmpV.clone(), camera.position); engine.scarePerched(tmpV.x, tmpV.y, tmpV.z); }
      }
    }
    endSingle();
    if (!pointers.size) gesture = 'none';
  }
  canvas.addEventListener('pointerup', pointerEnd);
  canvas.addEventListener('pointercancel', pointerEnd);
  canvas.addEventListener('lostpointercapture', pointerEnd);
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    zoom = Math.min(zoomMax(), Math.max(zoomMin(), zoom * Math.exp(e.deltaY * (isStar() ? -0.0012 : 0.0012))));
  }, { passive: false });
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', function () {
    releaseAll();
    lastFrame = performance.now(); acc = 0;
    if (audio) { if (document.hidden) audio.ctx.suspend(); else audio.ctx.resume(); }
  });

  function resize() {
    W = Math.max(1, window.innerWidth); H = Math.max(1, window.innerHeight);
    renderer.setSize(W, H, false);
    camera.aspect = W / H; camera.updateProjectionMatrix();
    releaseAll();
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function () { setTimeout(resize, 200); });
  resize();

  /* ---------------- UI ---------------- */
  var $ = function (id) { return document.getElementById(id); };
  var obsPanel = $('obsPanel'), obsSize = $('obsSize'), obsHeight = $('obsHeight'), obsCount = $('obsCount'), tagPanel = $('tagPanel'), touchTools = $('touchTools');
  var kindBtns = Array.from(document.querySelectorAll('#obsKind button'));
  var modeBtns = { touch: $('modeTouch'), obstacle: $('modeObstacle'), watch: $('modeWatch') };
  var showRadius = false;

  function setMode(m) {
    if (m === 'obstacle' && isStar()) m = 'touch';
    mode = m; releaseAll();
    Object.keys(modeBtns).forEach(function (k) { modeBtns[k].setAttribute('aria-pressed', String(k === m)); });
    modeBtns.obstacle.hidden = isStar();
    obsPanel.hidden = m !== 'obstacle';
    touchTools.hidden = m !== 'touch' || isStar();
    tagPanel.hidden = m !== 'watch';
    updateObsUI();
    showHint(m === 'touch' && touchTool === 'feed' ? 'feed' : m);
  }
  Object.keys(modeBtns).forEach(function (k) { modeBtns[k].addEventListener('click', function () { setMode(k); }); });

  function updateObsUI() {
    var n = engine.obstacles.length, sel = findObstacle(selectedId);
    if (!sel) selectedId = null;
    obsCount.textContent = n + '/' + MAX_OBS;
    $('obsSliders').hidden = !sel;
    $('btnObsDelete').disabled = !sel;
    $('btnObsClear').disabled = n === 0;
    obsHeight.disabled = !sel;
    if (sel) { obsSize.value = sel.targetRadius; obsHeight.value = sel.targetHeight; }
    $('obsHeightVal').textContent = sel ? (sel.targetHeight / 2).toFixed(1) + ' m' : '';
    kindBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.k === nextKind)); });
  }
  // 触れるモードの道具：手（触れる）／餌
  var toolBtns = Array.from(document.querySelectorAll('#touchTool button'));
  toolBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      touchTool = b.dataset.t; releaseAll();
      toolBtns.forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      showHint(touchTool === 'feed' ? 'feed' : 'touch');
    });
  });
  // 種類：次に置くものを選ぶだけ（置いてあるものは変えない）
  kindBtns.forEach(function (b) { b.addEventListener('click', function () { nextKind = b.dataset.k; updateObsUI(); }); });
  obsSize.addEventListener('input', function () { var o = findObstacle(selectedId); if (o) o.targetRadius = +obsSize.value; });
  obsHeight.addEventListener('input', function () {
    var o = findObstacle(selectedId);
    if (o) { o.targetHeight = +obsHeight.value; $('obsHeightVal').textContent = (o.targetHeight / 2).toFixed(1) + ' m'; }
  });
  $('btnObsDelete').addEventListener('click', function () { if (selectedId) { engine.removeObstacle(selectedId); selectedId = null; drag = null; updateObsUI(); } });
  $('btnObsClear').addEventListener('click', function () { engine.obstacles.length = 0; selectedId = null; drag = null; updateObsUI(); toast('障害物を消去しました'); });

  var toastEl = $('toast'), toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.hidden = false; toastEl.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.style.opacity = '0'; setTimeout(function () { toastEl.hidden = true; }, 320); }, 2200);
  }

  // 初回ガイド
  var guide = $('guide'), guideOpen = false;
  function showGuide() {
    if (typeof GUIDE_SEA === 'string') guide.innerHTML = isStar() ? GUIDE_SKY : GUIDE_SEA;   // v0.15 生きものに合わせた説明
    guide.hidden = false; guide.classList.remove('fade'); guideOpen = true;
  }
  function dismissGuide() {
    if (!guideOpen) return;
    guideOpen = false; guide.classList.add('fade'); store.set('guideSeen', true);
    setTimeout(function () { if (!guideOpen) guide.hidden = true; }, 520);
  }
  if (!store.get('guideSeen', false)) showGuide();

  // モード別のひとことヒント（v0.2 / 試作Bを参考）。数秒で消え、触れると即座に消える
  var hintEl = $('hint'), hintTimer = 0;
  var HINTS = {
    obstacle: '空いている場所をタップして置く。ドラッグで水平に移動',
    feed: 'タップした場所に餌をまきます。なぞると帯状にまけます',
    touch: '指で触れると、そこから逃げる動きが群れに広がります',
    watch: 'タップで魚に色を付けられます。ドラッグで視点を回せます'
  };
  var HINTS_STAR = {   // v0.15 ムクドリ
    touch: '空をタップするとハヤブサ。電線や木をタップすると、そこに止まります',
    watch: 'タップで鳥に色を付けられます。ドラッグで見る向きを変えられます'
  };
  var GUIDE_SEA = guide.innerHTML;
  var GUIDE_SKY = '夕暮れの空を、ムクドリの群れが飛びます。<br>空をタップするとハヤブサが急降下。<br>電線や木をタップすると、そこに止まります。' +
    '<span class="sub">2本指で見る向き・ズーム ／ 画面に触れると閉じます</span>';
  function showHint(m) {
    clearTimeout(hintTimer);
    var txt = (isStar() ? HINTS_STAR : HINTS)[m];
    if (!txt || guideOpen) { fadeHint(); return; }
    hintEl.textContent = txt; hintEl.hidden = false; hintEl.classList.remove('fade');
    hintTimer = setTimeout(fadeHint, 5000);
  }
  function fadeHint() { hintEl.classList.add('fade'); }
  if (!guideOpen) showHint('touch');

  // 設定シート
  var sheet = $('sheet'), backdrop = $('backdrop');
  function openSheet(o) { sheet.hidden = !o; backdrop.hidden = !o; if (o) releaseAll(); }
  $('btnSettings').addEventListener('click', function () { openSheet(true); });
  $('btnClose').addEventListener('click', function () { openSheet(false); });
  backdrop.addEventListener('click', function () { openSheet(false); });
  // キーボード操作（v0.2 / 試作Bを参考）：Space 一時停止、1/2/3 モード、Esc 閉じる
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { openSheet(false); return; }
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || !sheet.hidden || e.repeat) return;
    if (e.code === 'Space') { e.preventDefault(); togglePause(); }
    else if (e.key === '1') setMode('touch');
    else if (e.key === '2' && !isStar()) setMode('obstacle');
    else if (e.key === '3') setMode('watch');
  });
  document.addEventListener('keyup', function (e) { if (e.code === 'Space' && e.target && e.target.tagName === 'BUTTON') e.preventDefault(); });

  // 一時停止（v0.2 / 試作Bを参考）。停止中も障害物の配置・移動とズームはできる
  var btnPause = $('btnPause'), pausedChip = $('pausedChip');
  var ICON_PAUSE = '<path d="M9 6v12M15 6v12"/>', ICON_PLAY = '<path d="M8 5.5v13l10.5-6.5z"/>';
  function togglePause(force) {
    paused = typeof force === 'boolean' ? force : !paused;
    releaseAll();
    pausedChip.hidden = !paused;
    btnPause.setAttribute('aria-label', paused ? '再開' : '一時停止');
    btnPause.setAttribute('aria-pressed', String(paused));
    $('pauseIcon').innerHTML = paused ? ICON_PLAY : ICON_PAUSE;
  }
  btnPause.addEventListener('click', function () { togglePause(); });

  var optGrowth = $('optGrowth'), optSound = $('optSound'), optDebug = $('optDebug');
  optGrowth.checked = settings.growth; optSound.checked = settings.sound; optDebug.checked = settings.debug;
  optGrowth.addEventListener('change', function () { settings.growth = optGrowth.checked; saveSettings(); updateStartUI(); restart(); toast((settings.growth ? '成長モード：' : '') + (startCount() || defaultStart()) + unit() + 'から始めます'); });
  optSound.addEventListener('change', function () { settings.sound = optSound.checked; saveSettings(); setSound(settings.sound); });
  var optTouchSfx = $('optTouchSfx');
  optTouchSfx.checked = settings.touchSfx;
  optTouchSfx.addEventListener('change', function () { settings.touchSfx = optTouchSfx.checked; saveSettings(); if (settings.touchSfx) previewTouch(); });
  var optVolume = $('optVolume'), volOut = $('volOut');
  optVolume.value = settings.volume; volOut.textContent = settings.volume;
  optVolume.addEventListener('input', function () {
    settings.volume = +optVolume.value; volOut.textContent = settings.volume;
    if (audio) audio.master.gain.setTargetAtTime(volGain(), audio.ctx.currentTime, 0.05);
  });
  optVolume.addEventListener('change', function () { saveSettings(); if (settings.touchSfx) previewTouch(); else startAudio(); });
  optDebug.addEventListener('change', function () { settings.debug = optDebug.checked; saveSettings(); $('debug').hidden = !settings.debug; if (!settings.debug) { showRadius = false; $('chkRadius').checked = false; } });
  $('debug').hidden = !settings.debug;

  var qBtns = Array.from(document.querySelectorAll('#optQuality button'));
  function applyFx() {   // 大群モード：細かい演出を減らす（マリンスノー・海底と岩の光の揺らめき・驚いたときの光り）
    var lite = liteFx();
    snow.visible = !lite && !isStar();
    causticOn.value = lite ? 0 : 1;
  }
  function applyQuality() {
    qBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.q === settings.quality)); });
    pixelRatio = basePR(); renderer.setPixelRatio(pixelRatio); resize();
    engine.maxCount = Math.max(qualityCap(), engine.n);   // いる魚は消さない
    capHeld = false;
    applyFx();
    updateStartUI();
  }
  qBtns.forEach(function (b) { b.addEventListener('click', function () { settings.quality = b.dataset.q; saveSettings(); applyQuality(); }); });
  qBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.q === settings.quality)); });
  applyFx();

  /* ---------------- 裏モード（v0.14）：版数の行を5回タップで表示。開発者表示・開始匹数・更新履歴 ---------------- */
  var devSec = $('devSec'), verTaps = [];
  function showDev(on) { settings.devUnlocked = on; saveSettings(); devSec.hidden = !on; }
  devSec.hidden = !settings.devUnlocked;
  $('ver').addEventListener('click', function () {
    var t = performance.now();
    verTaps = verTaps.filter(function (x) { return t - x < 2500; }); verTaps.push(t);
    if (verTaps.length >= 5 && !settings.devUnlocked) { verTaps = []; showDev(true); toast('裏モードを表示しました'); }
  });
  $('btnDevHide').addEventListener('click', function () {
    showDev(false);
    if (settings.debug) { optDebug.checked = false; optDebug.dispatchEvent(new Event('change')); }
  });
  var optStartN = $('optStartN'), startNOut = $('startNOut');
  function defaultStart() { return settings.growth ? 12 : isStar() ? Math.round(qualityCap() / 2) : 100; }
  function updateStartUI() {
    optStartN.max = hardCap();
    var v = settings.startN > 0 ? Math.min(settings.startN, hardCap()) : defaultStart();
    optStartN.value = v; startNOut.textContent = v;
  }
  optStartN.addEventListener('input', function () { startNOut.textContent = optStartN.value; });
  $('btnStartN').addEventListener('click', function () {
    settings.startN = +optStartN.value; saveSettings(); restart(); openSheet(false);
    toast(settings.startN + unit() + 'で始めます');
  });
  $('btnStartDef').addEventListener('click', function () {
    settings.startN = 0; saveSettings(); updateStartUI(); restart(); openSheet(false);
    toast('開始の数を既定（' + defaultStart() + unit() + '）に戻しました');
  });
  updateStartUI();

  $('btnResetView').addEventListener('click', function () { zoom = 1; userYaw = 0; userPitch = isStar() ? 0 : 0.24; camTarget.fromArray(engine.centroid); stSnap = true; openSheet(false); });
  $('btnGuide').addEventListener('click', function () { openSheet(false); showGuide(); });
  $('btnRestart').addEventListener('click', function () { restart(); openSheet(false); });

  function restart(seed) {
    releaseAll();
    engine.growthEnabled = settings.growth;
    var sN = startCount();
    engine.maxCount = Math.max(qualityCap(), sN || 0);
    capHeld = false;
    var sd = seed != null ? seed : (Math.random() * 0x7fffffff) >>> 0;
    if (engine.species !== settings.species) engine.setSpecies(settings.species, sd, initialCount());
    else engine.reset(sd, initialCount());
    engine.predator = null; starView.reset();
    selectedId = null; renderedN = 0;
    camTarget.fromArray(engine.centroid); spreadSm = engine.spread;
    touch.s = 0; touch.init = false;
    clearTags();
    togglePause(false);
    updateObsUI();
  }

  /* ---------------- 生きものの切り替え（v0.15）：イワシ／ムクドリ ---------------- */
  var spBtns = Array.from(document.querySelectorAll('#optSpecies button'));
  function applySpecies() {
    var st = isStar();
    spBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.s === settings.species)); });
    document.body.classList.toggle('sky', st);   // v0.18 ムクドリでは画面の周辺を暗くしすぎない
    sky.visible = fish.visible = foodPts.visible = !st;
    starView.setVisible(st);
    scene.fog = st ? skyFog : seaFog;
    camera.near = st ? 0.5 : 0.1; camera.far = st ? 5000 : 220;
    if (!st) { camera.fov = FOV; tanHalf = Math.tan(FOV * Math.PI / 360); }
    camera.updateProjectionMatrix();
    userYaw = 0; userPitch = st ? 0 : 0.24; zoom = 1; stSnap = true;
    $('countUnit').textContent = unit();
    $('rowTouchSfx').hidden = $('rowSeabed').hidden = $('rowRocks').hidden = st;
    $('soundDesc').textContent = st ? 'ムクドリモードの音（夕方の風と遠いさえずり）は次の版で付けます。今は鳴りません。' : SOUND_DESC_SEA;
    $('rangeDesc').textContent = st ? '幅120m × 高さ40m × 奥行120mの楕円体（中心は地上50m）。外へ出ると内側へ戻ろうとします。' : RANGE_DESC_SEA;
    if (guideOpen) guide.innerHTML = st ? GUIDE_SKY : GUIDE_SEA;
    setMode(mode);
    applyFx(); applyLandmarks(); updateStartUI(); syncDbgSliders();
    if (audio) setSound(settings.sound);
  }
  var SOUND_DESC_SEA = $('soundDesc').textContent, RANGE_DESC_SEA = $('rangeDesc').textContent;
  spBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.dataset.s === settings.species) return;
      settings.species = b.dataset.s; saveSettings();
      restart(); applySpecies(); openSheet(false);
      toast((isStar() ? 'ムクドリ' : 'イワシ') + '：' + engine.n + unit() + 'で始めます');
    });
  });

  // 開発者表示：係数スライダー
  var DBG = [
    ['wSep', '分離', 0, 6, 0.1, '近すぎる仲間（約30cm以内）から離れる力。上げると間隔が広がり、下げると密集して重なりやすくなる。'],
    ['wAli', '整列', 0, 4, 0.1, '周りの仲間（約70cm以内）と向きをそろえる力。上げると一方向にそろって流れ、下げると向きがばらけて渦や乱れが出る。'],
    ['wCoh', '結合', 0, 3, 0.05, '周りの仲間（約1.4m以内）の中心へ寄る力。上げると丸くまとまり、分かれても戻りやすい。下げると広がって分裂しやすい。'],
    ['noise', 'ノイズ', 0, 0.6, 0.01, '向きに毎回加える小さな揺らぎ。上げるとふらつきが増え、高すぎると群れの秩序が崩れる。0だと機械的にそろう。'],
    ['wTouch', '忌避', 0, 16, 0.5, '指から逃げる力の強さ。上げると大きく素早く逃げ、下げるとわずかに避けるだけになる。'],
    ['alarm', '警戒伝達', 0, 8, 0.1, '驚いた仲間の緊張が隣へうつる速さ。上げると波が速く遠くまで広がり、0だと触れた魚だけが反応する。'],
    ['wObs', '障害物', 0, 20, 0.5, '障害物や岩をよける力。上げると手前から大きく迂回し、下げるとすれすれを通る。'],
    ['_touchScale', '指の半径', 0.5, 2, 0.05, '触れたときに影響する範囲の倍率。1.0で画面の短い辺の約15%。長押しすると少しずつ広がる。'],
    ['cruise', '遊泳速度', 0.8, 3.5, 0.05, 'ふだん泳ぐ速さ。2.0で秒速約1m（体長の約6倍）。驚いたときの最高速度は変わらない。']
  ];
  var sliderBox = $('dbgSliders');
  DBG.forEach(function (d) {
    var row = document.createElement('div'); row.className = 'dbg-slider';
    var cur = d[0] === '_touchScale' ? touchScale : engine.params[d[0]];
    var id = 'dbg_' + d[0].replace('_', '');
    row.innerHTML = '<label for="' + id + '">' + d[1] + '</label><input type="range" id="' + id + '" min="' + d[2] + '" max="' + d[3] + '" step="' + d[4] + '" value="' + cur + '"><span>' + (+cur).toFixed(2) + '</span>';
    var input = row.querySelector('input'), out = row.querySelector('span');
    input.addEventListener('input', function () {
      var v = +input.value; out.textContent = v.toFixed(2);
      if (d[0] === '_touchScale') touchScale = v; else engine.params[d[0]] = v;
    });
    sliderBox.appendChild(row);
    var desc = document.createElement('p'); desc.className = 'dbg-desc'; desc.hidden = true; desc.textContent = d[5];
    sliderBox.appendChild(desc);
  });
  $('chkRadius').addEventListener('change', function (e) { showRadius = e.target.checked; });
  var showDesc = false;
  $('chkDesc').addEventListener('change', function (e) {
    showDesc = e.target.checked;
    Array.prototype.forEach.call(document.querySelectorAll('.dbg-desc'), function (p) { p.hidden = !showDesc; });
  });
  function syncDbgSliders() {   // 生きものを切り替えたとき、スライダーを今のパラメータに合わせる
    DBG.forEach(function (d) {
      if (d[0] === '_touchScale') return;
      var inp = $('dbg_' + d[0].replace('_', '')), v = engine.params[d[0]];
      if (+inp.max < v) inp.max = Math.ceil(v * 2);
      inp.value = v; inp.nextElementSibling.textContent = (+v).toFixed(2);
    });
  }
  $('btnDbgReset').addEventListener('click', function () {
    DBG.forEach(function (d) {
      var v = d[0] === '_touchScale' ? 1 : FLOCK.SPECIES[engine.species][d[0]];
      if (d[0] === '_touchScale') touchScale = v; else engine.params[d[0]] = v;
      var inp = $('dbg_' + d[0].replace('_', '')); inp.value = v; inp.nextElementSibling.textContent = (+v).toFixed(2);
    });
    toast('係数を既定値に戻しました');
  });

  [['optSeabed', 'seabed'], ['optRocks', 'rocks'], ['optRange', 'range'], ['optScale', 'scalebar']].forEach(function (p) {
    var el = $(p[0]); el.checked = !!settings[p[1]];
    el.addEventListener('change', function () { settings[p[1]] = el.checked; saveSettings(); applyLandmarks(); });
  });
  applyLandmarks();

  /* ---------------- 色付け（v0.3）：観察モードでタップした魚に色を付ける ---------------- */
  var TAG_COLORS = ['#ff6b4a', '#ffd23f', '#ff5fae', '#9cff57', '#b48cff'], TAG_NAMES = ['コーラル', 'イエロー', 'ピンク', 'ライム', 'バイオレット'];
  var TAG_MAX = 8, tags = new Map(), tagColorIdx = 0, projV = new THREE.Vector3(), tmpC = new THREE.Color();
  var swatchBox = $('swatches');
  TAG_COLORS.forEach(function (hex, k) {
    var b = document.createElement('button');
    b.className = 'swatch'; b.type = 'button'; b.style.background = hex;
    b.setAttribute('role', 'radio'); b.setAttribute('aria-label', TAG_NAMES[k]);
    b.addEventListener('click', function () { tagColorIdx = k; updateTagUI(); });
    swatchBox.appendChild(b);
  });
  function setTag(i, ci) {
    var ic = fish.instanceColor.array, ma = markAttr.array, o = i * 3;
    if (ci < 0) {
      tags.delete(i);
      ic[o] = baseCol[o]; ic[o + 1] = baseCol[o + 1]; ic[o + 2] = baseCol[o + 2];
      ma[o] = ma[o + 1] = ma[o + 2] = 0;
    } else {
      tags.set(i, ci); tmpC.set(TAG_COLORS[ci]);
      ic[o] = tmpC.r; ic[o + 1] = tmpC.g; ic[o + 2] = tmpC.b;
      ma[o] = tmpC.r; ma[o + 1] = tmpC.g; ma[o + 2] = tmpC.b;
    }
    fish.instanceColor.needsUpdate = true; markAttr.needsUpdate = true;
    starView.setTag(i, ci < 0 ? null : TAG_COLORS[ci]);
  }
  function pickFish(sx, sy) {   // 画面上で指に最も近い魚（34px以内）
    var r = canvas.getBoundingClientRect(), best = -1, bestD = 34 * 34;
    for (var i = 0; i < engine.n; i++) {
      projV.set(engine.px[i], engine.py[i], engine.pz[i]).project(camera);
      if (projV.z > 1) continue;
      var x = (projV.x * 0.5 + 0.5) * r.width + r.left - sx, y = (-projV.y * 0.5 + 0.5) * r.height + r.top - sy;
      if (x * x + y * y < bestD) { bestD = x * x + y * y; best = i; }
    }
    return best;
  }
  function addTag(i) { setTag(i, tagColorIdx); tagColorIdx = (tagColorIdx + 1) % TAG_COLORS.length; }
  function toggleTagAt(sx, sy) {
    var i = pickFish(sx, sy);
    if (i < 0) return;
    if (tags.has(i)) setTag(i, -1);
    else if (tags.size >= TAG_MAX) toast('色を付けられるのは8' + unit() + 'までです。付いている' + (isStar() ? '鳥' : '魚') + 'をタップすると外せます');
    else addTag(i);
    updateTagUI();
  }
  function clearTags() { Array.from(tags.keys()).forEach(function (i) { setTag(i, -1); }); updateTagUI(); }
  function updateTagUI() {
    $('tagCount').textContent = tags.size + '/' + TAG_MAX;
    $('btnTagClear').disabled = tags.size === 0;
    $('btnTagRandom').disabled = tags.size >= TAG_MAX;
    Array.prototype.forEach.call(swatchBox.children, function (b, k) { b.setAttribute('aria-checked', String(k === tagColorIdx)); });
  }
  $('btnTagRandom').addEventListener('click', function () {
    var pool = [];
    for (var i = 0; i < engine.n; i++) if (engine.flock[i] === 0 && !tags.has(i)) pool.push(i);
    for (var k = 0; k < 3 && pool.length && tags.size < TAG_MAX; k++) addTag(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    updateTagUI();
  });
  $('btnTagClear').addEventListener('click', clearTags);
  updateTagUI();
  $('btnSeed').addEventListener('click', function () {
    var v = parseInt($('seedInput').value, 10);
    if (!isFinite(v)) v = engine.seed;
    restart(v >>> 0);
    toast('シード ' + (v >>> 0) + ' で再開しました');
  });

  /* ---------------- サウンド（v0.6）：すべて Web Audio で合成（音声ファイルなし） ----------------
   * 環境音：低いうねり ＋ 寄せては返す水の揺らぎ ＋ ときどき立ちのぼる泡
   * タッチ音：水滴（v0.7 で水琴窟を廃止。音程はランダム）。オン／オフのみ
   *           群れの近くに触れたときだけ、逃げる魚の「ザッ」という水音を重ねる */
  var audio = null;
  var lastRustle = 0;
  function volGain() { var v = settings.volume / 100; return v * v; }
  function makeNoise(ctx, sec, brown) {
    var len = Math.floor(ctx.sampleRate * sec), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0), last = 0;
    for (var i = 0; i < len; i++) {
      var w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; } else d[i] = w;
    }
    return buf;
  }
  function makeImpulse(ctx, sec, decay) {   // 水中らしい、こもった長めの残響
    var len = Math.floor(ctx.sampleRate * sec), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (var c = 0; c < 2; c++) {
      var d = buf.getChannelData(c), lp = 0;
      for (var i = 0; i < len; i++) { lp += ((Math.random() * 2 - 1) - lp) * 0.35; d[i] = lp * Math.pow(1 - i / len, decay); }
    }
    return buf;
  }
  function loopSrc(ctx, buf) { var s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * buf.duration); return s; }
  function lfo(ctx, freq, depth, target) { var o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = freq; g.gain.value = depth; o.connect(g); g.connect(target); o.start(); }
  function panner(ctx, pan) { if (!ctx.createStereoPanner) return ctx.createGain(); var p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); return p; }

  function startAudio() {
    if (audio) { if (audio.ctx.state === 'suspended') audio.ctx.resume(); return; }
    if (!settings.sound && !settings.touchSfx) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      var master = ctx.createGain(); master.gain.value = volGain(); master.connect(ctx.destination);
      var comp = ctx.createDynamicsCompressor(); comp.threshold.value = -10; comp.ratio.value = 3; comp.connect(master);
      var verb = ctx.createConvolver(); verb.buffer = makeImpulse(ctx, 2.2, 2.4);
      var wet = ctx.createGain(); wet.gain.value = 0.6; verb.connect(wet); wet.connect(comp);
      var dry = ctx.createGain(); dry.connect(comp);
      var amb = ctx.createGain(); amb.gain.value = 0; amb.connect(dry);
      var ambSend = ctx.createGain(); ambSend.gain.value = 0.25; amb.connect(ambSend); ambSend.connect(verb);
      // 1) 低いうねり（イヤホンで感じる深さ）
      var rl = ctx.createBiquadFilter(); rl.type = 'lowpass'; rl.frequency.value = 300;
      var rg = ctx.createGain(); rg.gain.value = 0.2;
      loopSrc(ctx, makeNoise(ctx, 5, true)).connect(rl); rl.connect(rg); rg.connect(amb);
      lfo(ctx, 0.06, 110, rl.frequency);
      // 2) 寄せては返す水の揺らぎ（スマホのスピーカーでも聞こえる帯域）
      var white = makeNoise(ctx, 4, false);
      var wb = ctx.createBiquadFilter(); wb.type = 'bandpass'; wb.frequency.value = 650; wb.Q.value = 0.7;
      var wl = ctx.createBiquadFilter(); wl.type = 'lowpass'; wl.frequency.value = 2200;
      var wg = ctx.createGain(); wg.gain.value = 0.12;
      loopSrc(ctx, white).connect(wb); wb.connect(wl); wl.connect(wg); wg.connect(amb);
      lfo(ctx, 0.071, 0.065, wg.gain); lfo(ctx, 0.113, 0.04, wg.gain);   // 周期の違う2つで不規則なうねり
      lfo(ctx, 0.053, 260, wb.frequency);
      audio = { ctx: ctx, master: master, dry: dry, verb: verb, amb: amb, white: white };
      if (settings.sound && !isStar()) amb.gain.setTargetAtTime(1, ctx.currentTime, 1.5);
      setTimeout(bubbleLoop, 1500);
    } catch (e) { audio = null; }
  }

  // 短い正弦波を指数的に上昇させる＝泡がはじける音（ミナールト共鳴の簡易モデル）
  function blip(t, f0, rise, dur, amp, pan, out, send) {
    var ctx = audio.ctx, o = ctx.createOscillator(), g = ctx.createGain(), p = panner(ctx, pan);
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * rise, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(amp, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(p); p.connect(out);
    if (send) { var s = ctx.createGain(); s.gain.value = send; p.connect(s); s.connect(audio.verb); }
    o.start(t); o.stop(t + dur + 0.05);
  }
  function bubbleLoop() {
    if (!audio) return;
    if (settings.sound && !isStar() && !document.hidden && audio.ctx.state === 'running') {
      var t = audio.ctx.currentTime + 0.05, n = 1 + Math.floor(Math.random() * 4), pan = Math.random() * 1.6 - 0.8;
      for (var k = 0; k < n; k++) {
        t += 0.04 + Math.random() * 0.14;
        blip(t, 380 + Math.random() * 700, 2.0 + Math.random() * 0.8, 0.05 + Math.random() * 0.07, 0.035 + Math.random() * 0.04, pan + (Math.random() - 0.5) * 0.3, audio.amb, 0);
      }
    }
    setTimeout(bubbleLoop, 1800 + Math.random() * 4500);
  }
  function playTouch(sx, sy, soft) {
    if (!audio || !settings.touchSfx || paused || isStar()) return;
    var ctx = audio.ctx, t = ctx.currentTime + 0.01, r = canvas.getBoundingClientRect();
    var pan = ((sx - r.left) / r.width - 0.5) * 1.2, k = soft ? 0.55 : 1;
    // 水滴：音程は毎回ランダム（約450〜1100Hzから上昇）。v0.6より約5dB小さく
    blip(t, 450 + Math.random() * 650, 2.4 + Math.random() * 0.4, 0.08 + Math.random() * 0.03, 0.4 * k, pan, audio.dry, 0.5);
  }
  function playRustle(count, sx) {   // v0.10: 群れが向きを変えたときの、水が動くやわらかい音（低めの「ふわっ」＋小さな泡）
    if (!audio || !settings.touchSfx || count < 3) return;
    var now = performance.now();
    if (now - lastRustle < 450) return;
    lastRustle = now;
    var ctx = audio.ctx, t = ctx.currentTime + 0.03, a = Math.min(1, count / 40) * 0.32;
    var r = canvas.getBoundingClientRect(), pan = ((sx - r.left) / r.width - 0.5) * 1.2, p = panner(ctx, pan);
    var src = ctx.createBufferSource(); src.buffer = audio.white;
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.2;
    lp.frequency.setValueAtTime(220, t); lp.frequency.linearRampToValueAtTime(820, t + 0.2); lp.frequency.exponentialRampToValueAtTime(260, t + 1.0);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(a, t + 0.18); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.05);
    var s = ctx.createGain(); s.gain.value = 0.35;
    src.connect(lp); lp.connect(g); g.connect(p); p.connect(audio.dry); p.connect(s); s.connect(audio.verb);
    src.start(t, Math.random() * 3); src.stop(t + 1.1);
    var nb = 1 + Math.floor(Math.random() * 3);
    for (var k = 0; k < nb; k++) blip(t + 0.08 + Math.random() * 0.4, 500 + Math.random() * 700, 2.0 + Math.random() * 0.6, 0.05 + Math.random() * 0.05, 0.035, pan + (Math.random() - 0.5) * 0.4, audio.dry, 0.3);
  }
  function playFeed(count, sx) {   // 餌粒が水に落ちる小さな「ぽつぽつ」
    if (!audio || !settings.touchSfx || paused) return;
    var ctx = audio.ctx, t = ctx.currentTime + 0.01, r = canvas.getBoundingClientRect(), pan = ((sx - r.left) / r.width - 0.5) * 1.2;
    var n = Math.min(7, 2 + Math.round(count / 5));
    for (var k = 0; k < n; k++) blip(t + k * 0.035 + Math.random() * 0.05, 1300 + Math.random() * 1300, 1.8, 0.025 + Math.random() * 0.02, 0.05, pan + (Math.random() - 0.5) * 0.5, audio.dry, 0.35);
  }
  function countNear(c, R) {
    var n = 0, R2 = R * R;
    for (var i = 0; i < engine.n; i++) {
      var dx = engine.px[i] - c.x, dy = engine.py[i] - c.y, dz = engine.pz[i] - c.z;
      if (dx * dx + dy * dy + dz * dz < R2) n++;
    }
    return n;
  }
  function setSound(on) {
    if (on) { startAudio(); if (audio) audio.amb.gain.setTargetAtTime(isStar() ? 0 : 1, audio.ctx.currentTime, 0.6); }
    else if (audio) audio.amb.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.2);
  }
  function previewTouch() {   // 設定で選んだ音を試聴（画面中央付近で鳴らす）
    startAudio();
    if (!audio) return;
    var r = canvas.getBoundingClientRect();
    setTimeout(function () { playTouch(r.left + r.width / 2, r.top + r.height * (0.3 + Math.random() * 0.4), false); }, 60);
  }

  /* ---------------- 魚のインスタンス更新 ---------------- */
  function updateFish(alpha, dt) {
    var n = engine.n, m = fish.instanceMatrix.array, P = engine.params;
    var px = engine.px, py = engine.py, pz = engine.pz, ppx = engine.ppx, ppy = engine.ppy, ppz = engine.ppz;
    var vx = engine.vx, vy = engine.vy, vz = engine.vz, ph = phaseAttr.array, am = ampAttr.array, fl = flashAttr.array, lite = liteFx();   // 大群：驚いたときの光りを省く
    var kH = 1 - Math.exp(-dt * 12), kR = 1 - Math.exp(-dt * 5), invDt = dt > 1e-4 ? 1 / dt : 0;
    for (var i = 0; i < n; i++) {
      var sp = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i]) || 1;
      var tx = vx[i] / sp, ty = vy[i] / sp, tz = vz[i] / sp, o3 = i * 3;
      if (i >= renderedN) { rh[o3] = tx; rh[o3 + 1] = ty; rh[o3 + 2] = tz; roll[i] = 0; }
      var hx0 = rh[o3], hz0 = rh[o3 + 2];
      var hx = hx0 + (tx - hx0) * kH, hy = rh[o3 + 1] + (ty - rh[o3 + 1]) * kH, hz = hz0 + (tz - hz0) * kH;
      var hl = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1; hx /= hl; hy /= hl; hz /= hl;
      // 旋回方向へバンク（群れの回転で反射が揃って変化する）
      var yawRate = (hz0 * hx - hx0 * hz) * invDt;
      var rt = Math.max(-0.75, Math.min(0.75, yawRate * 0.28));
      roll[i] += (rt - roll[i]) * kR;
      rh[o3] = hx; rh[o3 + 1] = hy; rh[o3 + 2] = hz;
      // 基底：z = 進行方向
      var xx = hz, xy = 0, xz = -hx, xl = Math.sqrt(xx * xx + xz * xz);
      if (xl < 1e-4) { xx = 1; xz = 0; xl = 1; }
      xx /= xl; xz /= xl;
      var yx = hy * xz - hz * xy, yy = hz * xx - hx * xz, yz = hx * xy - hy * xx;
      var cr = Math.cos(roll[i]), sr = Math.sin(roll[i]);
      var Xx = xx * cr + yx * sr, Xy = xy * cr + yy * sr, Xz = xz * cr + yz * sr;
      var Yx = yx * cr - xx * sr, Yy = yy * cr - xy * sr, Yz = yz * cr - xz * sr;
      var s = P.bodyLen * engine.size[i], o = i * 16;
      m[o] = Xx * s; m[o + 1] = Xy * s; m[o + 2] = Xz * s; m[o + 3] = 0;
      m[o + 4] = Yx * s; m[o + 5] = Yy * s; m[o + 6] = Yz * s; m[o + 7] = 0;
      m[o + 8] = hx * s; m[o + 9] = hy * s; m[o + 10] = hz * s; m[o + 11] = 0;
      m[o + 12] = ppx[i] + (px[i] - ppx[i]) * alpha;
      m[o + 13] = ppy[i] + (py[i] - ppy[i]) * alpha;
      m[o + 14] = ppz[i] + (pz[i] - ppz[i]) * alpha;
      m[o + 15] = 1;
      ph[i] = engine.phase[i];
      am[i] = 0.75 + Math.min(0.9, engine.stress[i] * 0.9 + (sp - P.cruise) * 0.08);
      fl[i] = lite ? 0 : Math.min(0.3,Math.max(0, engine.stress[i] - 0.15) * 0.45 + Math.abs(roll[i]) * 0.12 + engine.feed[i] * 0.08);
    }
    renderedN = n;
    fish.count = n;
    fish.instanceMatrix.needsUpdate = true;
    phaseAttr.needsUpdate = true; ampAttr.needsUpdate = true; flashAttr.needsUpdate = true;
  }

  /* ---------------- 指標表示・自動画質 ---------------- */
  var countEl = $('count'), arrivingEl = $('arriving');
  var fpsFrames = 0, fpsT = 0, fps = 60, simMs = 0, metricT = 0, qualityT = 0, shownCount = -1, capHeld = false;
  var sbW = -1, sbBar = $('scalebarBar'), sbLabel = $('scalebarLabel'), SB_STEPS = [0.5, 1, 2, 5, 10, 20], SB_STEPS_SKY = [1, 2, 5, 10, 20, 50, 100];
  function updateHud(dt) {
    if (engine.joined !== shownCount) { shownCount = engine.joined; countEl.textContent = shownCount; }
    var arriving = engine.n - engine.joined;
    if (settings.scalebar) {   // 群れの中心の奥行きでの長さ（1ワールド単位 = 0.5m）
      var pxM = H / (2 * camDist * tanHalf) * (isStar() ? 1 : 2), steps = isStar() ? SB_STEPS_SKY : SB_STEPS, m = steps[steps.length - 1];   // ムクドリは 1単位 = 1m
      for (var q = 0; q < steps.length; q++) if (pxM * steps[q] >= 44) { m = steps[q]; break; }
      var w = Math.round(pxM * m);
      if (w !== sbW) { sbW = w; sbBar.style.width = w + 'px'; sbLabel.textContent = m < 1 ? (m * 100) + ' cm' : m + ' m'; }
    }
    arrivingEl.hidden = arriving <= 0;
    if (arriving > 0) arrivingEl.textContent = '+' + arriving + ' 接近中';
    fpsFrames++; fpsT += dt;
    if (fpsT >= 0.5) { fps = fpsFrames / fpsT; fpsFrames = 0; fpsT = 0; }
    metricT += dt; qualityT += dt;
    if (settings.debug && metricT >= 0.5) {
      metricT = 0;
      var st = engine.analyze();
      $('dN').textContent = engine.joined + ' / ' + engine.n;
      $('dPerch').textContent = isStar() ? engine.perchedN + ' 羽' : '-';   // v0.17 止まっている羽数
      $('dFps').textContent = fps.toFixed(0);
      $('dSim').textContent = simMs.toFixed(2);
      $('dP').textContent = st.P.toFixed(3);
      $('dNN').textContent = st.meanNN.toFixed(2) + ' / ' + st.minNN.toFixed(2);
      $('dR').textContent = st.radius.toFixed(2);
      $('dComp').textContent = st.components;
      $('dSpd').textContent = st.meanSpeed.toFixed(2);
      $('dStress').textContent = st.maxStress.toFixed(2);
      $('dIntr').textContent = engine.intrusions;
      $('dPR').textContent = pixelRatio.toFixed(2);
      $('dSeed').textContent = engine.seed;
    }
    // 自動・大群：重いときは先に解像度、次に最大個体数をその時点で止める（既存個体は消さない）
    // 自動のみ：余裕があり上限に届いたら、最大数を250匹ずつ1000匹まで上げる（一度止めたら上げない）
    if (settings.quality !== 'low' && qualityT >= 3 && !paused) {
      qualityT = 0;
      if (fps < 42 && pixelRatio > 1) { pixelRatio = Math.max(1, pixelRatio - 0.5); renderer.setPixelRatio(pixelRatio); renderer.setSize(W, H, false); }
      else if ((fps < 30 || simMs > 12) && engine.maxCount > engine.n) { engine.maxCount = Math.max(150, engine.n); capHeld = true; }
      else if (settings.quality === 'auto' && !capHeld && fps >= 50 && simMs < 5 && engine.n >= engine.maxCount - 5 && engine.maxCount < AUTO_MAX) {
        engine.maxCount = Math.min(AUTO_MAX, engine.maxCount + 250);
      }
    }
  }

  /* ---------------- メインループ（固定刻み＋描画補間） ---------------- */
  var lastFrame = performance.now(), acc = 0, paused = false, simClock = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    var dt = (now - lastFrame) / 1000; lastFrame = now;
    if (!(dt > 0)) dt = 0; if (dt > 0.1) dt = 0.1;
    if (!paused) {
      acc += dt; simClock += dt;
      var steps = 0;
      while (acc >= STEP && steps < 4) {
        updateTouch(STEP);
        var t0 = performance.now();
        engine.step(STEP);
        simMs += (performance.now() - t0 - simMs) * 0.1;
        acc -= STEP; steps++;
      }
      if (steps === 4 && acc > STEP) acc = 0;
    } else {
      acc = 0;
      engine._updateObstacles(Math.max(dt, 1 / 120));
    }
    updateCamera(dt, simClock);
    if (isStar()) starView.update(paused ? 1 : acc / STEP, paused ? 0 : dt, camera, H, simClock, liteFx());
    else updateFish(paused ? 1 : acc / STEP, paused ? 0 : dt);
    syncObstacles();
    updateFoodPts();
    if (mode === 'obstacle' && (frame._n = (frame._n || 0) + 1) % 15 === 0) updateObsUI();
    updateHud(dt);
    renderer.render(scene, camera);
  }
  applySpecies();
  updateCamera(0, 0);
  FLOCK.debugAudio = function () { return audio; };
  FLOCK.debugStar = starView;   // 検証用（ムクドリの描画・ハヤブサ）
  FLOCK.debugPick = function (sx, sy) { var h = starView.pickPerch(sx, sy, camera, canvas.getBoundingClientRect()); return h ? h.kind : 'sky'; };   // 検証用
  FLOCK.debugScreen = function (x, y, z) {   // 検証用：ワールド座標 → 画面の位置（CSS px）
    var v = new THREE.Vector3(x, y, z).project(camera), r = canvas.getBoundingClientRect();
    return v.z > 1 ? null : [(v.x * 0.5 + 0.5) * r.width + r.left, (-v.y * 0.5 + 0.5) * r.height + r.top];
  };
  FLOCK.debugEngine = engine;   // 検証用
  FLOCK.debugView = function (yaw, pitch, z) { userYaw = yaw; userPitch = pitch; zoom = z; };
  camDist = desiredDist();
  updateObsUI();
  requestAnimationFrame(frame);
})();
