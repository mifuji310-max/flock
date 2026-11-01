/* =====================================================================
 * FLOCK starling view v0.15（設計書 v0.5 §16） — ムクドリモードの描画（Three.js r128）
 *   夕暮れの空・駅前の街のシルエット・羽ばたく鳥・ハヤブサ
 *   座標はエンジンと同じ（1単位 = 1 m）。地面は y = groundY（−50）。観る人は地上1.6 m に立つ
 *   app.js から FLOCK.createStarlingView(opts) で作り、表示の切り替えと毎フレームの更新を呼ぶ
 * ===================================================================== */
(function (root) {
  'use strict';

  function makeRng(seed) { var a = seed >>> 0; return function () { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; }

  // 空と遠くの街にかかる、夕方のかすみ（距離で空の色に溶かす）
  var HAZE_GLSL = 'vec3 haze(vec3 c, float d){ float f = 1.0 - exp(-d * 0.0011); return mix(c, vec3(0.62, 0.44, 0.48), f * 0.75); }';

  FLOCK.createStarlingView = function (opts) {
    var THREE = opts.THREE, cap = opts.cap, engine = opts.engine;
    var P0 = FLOCK.STARLING, GY = P0.groundY;
    var group = new THREE.Group();
    group.visible = false;
    var SUN = new THREE.Vector3(-0.42, -0.06, -1).normalize();   // 沈んだばかりの太陽（観る人の前方やや左）

    /* ---------------- 空 ---------------- */
    var skyU = { uSun: { value: SUN }, uCloud: { value: 1 }, uTime: { value: 0 } };
    var sky = new THREE.Mesh(new THREE.SphereGeometry(2400, 48, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uSun; uniform float uCloud; uniform float uTime; varying vec3 vDir;' +
        'float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }' +
        'float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);' +
        '  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }' +
        'void main(){ vec3 d = normalize(vDir); float h = d.y;' +
        '  vec2 az = normalize(d.xz + 1e-5), sz = normalize(uSun.xz);' +
        '  float sunA = max(dot(az, sz), 0.0), sunS = pow(sunA, 3.0);' +
        '  vec3 zen = vec3(0.10, 0.14, 0.32), upper = vec3(0.33, 0.33, 0.56);' +
        '  vec3 hor = mix(vec3(0.80, 0.52, 0.58), vec3(1.0, 0.60, 0.30), sunS);' +   // 太陽の側は橙、反対側は桃色
        '  float t = pow(clamp(h, 0.0, 1.0), 0.5);' +
        '  vec3 c = mix(hor, upper, smoothstep(0.0, 0.55, t));' +
        '  c = mix(c, zen, smoothstep(0.45, 1.0, t));' +
        '  c += vec3(1.0, 0.55, 0.25) * pow(max(dot(d, uSun), 0.0), 10.0) * 0.45;' +  // 沈んだ太陽の残り火
        '  if (h < 0.0) c = mix(hor, hor * 0.55, smoothstep(0.0, -0.08, h));' +
        // 薄い雲の帯（大群モードでは省く）。夕日の側ほど明るく染まる
        '  if (uCloud > 0.5 && h > 0.015 && h < 0.42) {' +
        '    float a = atan(d.z, d.x);' +
        '    vec2 q = vec2(a * 5.0 + uTime * 0.004, h * 46.0);' +
        '    float n = n2(q) * 0.55 + n2(q * vec2(2.3, 2.1) + 7.0) * 0.3 + n2(q * vec2(5.1, 3.7) + 3.0) * 0.15;' +
        '    float band = smoothstep(0.015, 0.06, h) * (1.0 - smoothstep(0.22, 0.42, h));' +
        '    float k = smoothstep(0.55, 0.78, n) * band * 0.6;' +
        '    vec3 cc = mix(vec3(0.50, 0.38, 0.50), vec3(1.0, 0.68, 0.52), sunS * 0.9 + 0.1);' +
        '    c = mix(c, cc, k); }' +
        '  gl_FragColor = vec4(c, 1.0); }'
    }));
    sky.renderOrder = -1;
    group.add(sky);

    /* ---------------- 地面 ---------------- */
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.ShaderMaterial({
      fog: false,
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: HAZE_GLSL + 'varying vec3 vW; void main(){ float d = distance(vW, cameraPosition); gl_FragColor = vec4(haze(vec3(0.045, 0.04, 0.06), d), 1.0); }'
    }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = GY;
    group.add(ground);

    /* ---------------- 駅前の街（ビル・駅舎） ----------------
     * 側面の窓は、面ごとのメートル単位の座標（aWin）から格子を作り、灯りの割合 uLit で点ける */
    var cityU = { uLit: { value: 0.12 } };
    var city = (function () {
      var pos = [], win = [], seed = [], r = makeRng(31);
      function quad(a, b, c, d, w, h, s) {   // a-b-c-d は反時計回り。w,h は面の幅と高さ（m）
        pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]);
        win.push(0, 0, w, 0, w, h, 0, 0, w, h, 0, h);
        for (var k = 0; k < 6; k++) seed.push(s);
      }
      function box(cx, cz, w, dpt, h, ang, s, noWin) {
        var ca = Math.cos(ang), sa = Math.sin(ang);
        function P(x, y, z) { return [cx + x * ca - z * sa, GY + y, cz + x * sa + z * ca]; }
        var x0 = -w / 2, x1 = w / 2, z0 = -dpt / 2, z1 = dpt / 2;
        quad(P(x0, 0, z1), P(x1, 0, z1), P(x1, h, z1), P(x0, h, z1), noWin ? -1 : w, h, s);
        quad(P(x1, 0, z1), P(x1, 0, z0), P(x1, h, z0), P(x1, h, z1), noWin ? -1 : dpt, h, s);
        quad(P(x1, 0, z0), P(x0, 0, z0), P(x0, h, z0), P(x1, h, z0), noWin ? -1 : w, h, s);
        quad(P(x0, 0, z0), P(x0, 0, z1), P(x0, h, z1), P(x0, h, z0), noWin ? -1 : dpt, h, s);
        quad(P(x0, h, z1), P(x1, h, z1), P(x1, h, z0), P(x0, h, z0), -1, -1, s);
      }
      // 遠くの街並み：観る人の前方 ±100° の扇形に、奥ほど高いビル
      for (var i = 0; i < 150; i++) {
        var ang = (r() - 0.5) * 3.4, dist = 200 + Math.pow(r(), 0.7) * 520;
        var cx = Math.sin(ang) * dist, cz = 125 - Math.cos(ang) * dist;
        var h = 8 + Math.pow(r(), 2.2) * (dist > 380 ? 85 : 45);
        box(cx, cz, 14 + r() * 26, 12 + r() * 20, h, ang + (r() - 0.5) * 0.3, r());
        if (h > 40 && r() < 0.5) box(cx, cz, 5, 5, h + 4 + r() * 6, ang, r(), true);   // 屋上の塔屋
      }
      // 駅舎：前方やや右の低く横長な建物と、張り出した屋根
      box(46, -10, 92, 22, 13, 0.08, 0.5);
      box(46, 3, 98, 8, 0.8, 0.08, 0.5, true);
      box(46, 3, 98, 0.5, 6.5, 0.08, 0.5, true);
      box(18, -14, 9, 9, 24, 0.08, 0.2);   // 駅の時計塔
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('aWin', new THREE.Float32BufferAttribute(win, 2));
      g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
      return new THREE.Mesh(g, new THREE.ShaderMaterial({
        fog: false, uniforms: cityU,
        vertexShader: 'attribute vec2 aWin; attribute float aSeed; varying vec2 vWin; varying float vSeed; varying vec3 vW;' +
          'void main(){ vWin = aWin; vSeed = aSeed; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
        fragmentShader: HAZE_GLSL + 'uniform float uLit; varying vec2 vWin; varying float vSeed; varying vec3 vW;' +
          'float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }' +
          'void main(){ float d = distance(vW, cameraPosition);' +
          '  vec3 c = vec3(0.055, 0.048, 0.07);' +
          '  if (vWin.x >= 0.0) {' +
          '    vec2 cell = floor(vWin / vec2(3.2, 3.6)), f = fract(vWin / vec2(3.2, 3.6));' +
          '    float inWin = step(0.22, f.x) * step(f.x, 0.78) * step(0.3, f.y) * step(f.y, 0.75) * step(1.0, cell.y);' +
          '    float lit = step(h21(cell + vSeed * 97.0), uLit);' +
          '    float warm = h21(cell * 1.7 + vSeed * 13.0);' +
          '    c += inWin * lit * mix(vec3(1.0, 0.72, 0.42), vec3(0.85, 0.9, 1.0), step(0.8, warm)) * 0.9; }' +
          '  gl_FragColor = vec4(haze(c, d), 1.0); }'
      }));
    })();
    group.add(city);

    /* ---------------- 街路樹（ねぐら）・電柱と電線・街灯 ---------------- */
    var TREES = [];
    var trees = (function () {
      var r = makeRng(77), geos = [], ico = new THREE.IcosahedronGeometry(1, 1);
      function addCrown(x, y, z, rx, ry) {
        var g = ico.clone(), p = g.attributes.position;
        var sd = r() * 100;
        for (var i = 0; i < p.count; i++) {   // でこぼこさせて自然な樹冠に（同じ頂点は同じだけ動かし、割れ目を作らない）
          var ux = p.getX(i), uy = p.getY(i), uz = p.getZ(i), hh = Math.sin(ux * 12.9898 + uy * 78.233 + uz * 37.719 + sd) * 43758.5453;
          var k = 1 + ((hh - Math.floor(hh)) - 0.5) * 0.22;
          p.setXYZ(i, x + p.getX(i) * rx * k, y + p.getY(i) * ry * k, z + p.getZ(i) * rx * k);
        }
        geos.push(g);
      }
      function addTrunk(x, z, h) { var g = new THREE.CylinderGeometry(0.18, 0.28, h, 5); g.translate(x, GY + h / 2, z); geos.push(g); }
      // 駅前広場の2列の並木（ケヤキのようにこんもり）
      for (var row = 0; row < 2; row++) for (var k = 0; k < 8; k++) {
        var x = -78 + k * 22 + (r() - 0.5) * 5 + row * 11, z = 18 - row * 20 + (r() - 0.5) * 4;
        var h = 9 + r() * 3.5, cr = 3.6 + r() * 1.4;
        addTrunk(x, z, h * 0.6);
        addCrown(x, GY + h * 0.72, z, cr, cr * 0.75);
        addCrown(x + (r() - 0.5) * cr, GY + h * 0.85, z + (r() - 0.5) * cr, cr * 0.7, cr * 0.55);
        addCrown(x + (r() - 0.5) * cr * 1.2, GY + h * 0.6, z + (r() - 0.5) * cr, cr * 0.75, cr * 0.5);
        TREES.push({ x: x, y: GY + h * 0.75, z: z, r: cr });
      }
      var pos = [];
      geos.forEach(function (g) { var ng = g.index ? g.toNonIndexed() : g, a = ng.attributes.position.array; for (var i = 0; i < a.length; i++) pos.push(a[i]); });
      var mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      return new THREE.Mesh(mg, new THREE.ShaderMaterial({
        fog: false,
        vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
        fragmentShader: HAZE_GLSL + 'varying vec3 vW; void main(){ gl_FragColor = vec4(haze(vec3(0.035, 0.04, 0.045), distance(vW, cameraPosition)), 1.0); }'
      }));
    })();
    group.add(trees);

    var lampU = { uLamp: { value: 0.0 } };
    var wires = (function () {   // 電柱と、たるんだ電線（線で描く）。街灯の柱も
      var r = makeRng(5), pts = [], poles = [[-58, 30], [-22, 33], [14, 31], [50, 34], [86, 30]];
      function line(a, b) { pts.push(a[0], a[1], a[2], b[0], b[1], b[2]); }
      poles.forEach(function (p) {
        line([p[0], GY, p[1]], [p[0], GY + 11.5, p[1]]);
        line([p[0] - 1.2, GY + 10.6, p[1]], [p[0] + 1.2, GY + 10.6, p[1]]);   // 腕木
      });
      for (var k = 0; k < poles.length - 1; k++) for (var w = 0; w < 3; w++) {
        var a = poles[k], b = poles[k + 1], ox = (w - 1) * 1.0, hy = GY + 10.6 + (w === 1 ? 0.6 : 0), N = 16;
        for (var s = 0; s < N; s++) {
          var t0 = s / N, t1 = (s + 1) / N;
          var sag0 = 4 * t0 * (1 - t0) * 1.3, sag1 = 4 * t1 * (1 - t1) * 1.3;
          line([a[0] + ox + (b[0] - a[0]) * t0, hy - sag0, a[1] + (b[1] - a[1]) * t0], [a[0] + ox + (b[0] - a[0]) * t1, hy - sag1, a[1] + (b[1] - a[1]) * t1]);
        }
      }
      var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x0c0a10, fog: false }));
    })();
    group.add(wires);

    var LAMPS = [[-40, 48], [-8, 50], [24, 47], [-30, 72], [10, 74], [44, 70], [70, 52]];
    var lamps = (function () {
      var g = new THREE.Group(), poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 5.5, 5), poleMat = new THREE.MeshBasicMaterial({ color: 0x0a090d, fog: false });
      var glow = (function () {
        var c = document.createElement('canvas'); c.width = c.height = 64;
        var x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
        gr.addColorStop(0, 'rgba(255,236,200,1)'); gr.addColorStop(0.2, 'rgba(255,214,150,0.7)'); gr.addColorStop(1, 'rgba(255,190,120,0)');
        x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
      })();
      var glowMat = new THREE.SpriteMaterial({ map: glow, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, opacity: 0 });
      LAMPS.forEach(function (p) {
        var pole = new THREE.Mesh(poleGeo, poleMat); pole.position.set(p[0], GY + 2.75, p[1]); g.add(pole);
        var s = new THREE.Sprite(glowMat); s.position.set(p[0], GY + 5.6, p[1]); s.scale.set(3.2, 3.2, 1); g.add(s);
      });
      g.userData.mat = glowMat;
      return g;
    })();
    group.add(lamps);

    /* ---------------- ムクドリ（羽ばたく小さなシルエット） ----------------
     * z+ が頭。全長 1（インスタンス側で bodyLen 倍）。翼開長 ≒ 1.7（0.22 m × 1.7 ≒ 38 cm）
     * 翼の先ほど、頂点シェーダーで上下に動かす（aFlap：位相、aAmp：振れ幅。滑空中は小さい） */
    function birdGeometry(span, sweep) {
      var p = [
        0, 0, 0.5, 0.05, 0, 0.1, -0.05, 0, 0.1,          // 頭
        0.05, 0, 0.1, 0, 0, -0.32, -0.05, 0, 0.1,        // 胴
        0, 0, -0.25, 0.13, 0, -0.5, -0.13, 0, -0.5,      // 尾
        0.04, 0, 0.16, span, 0, -sweep, 0.04, 0, -0.12,  // 右の翼
        -0.04, 0, 0.16, -0.04, 0, -0.12, -span, 0, -sweep // 左の翼
      ];
      var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      return g;
    }
    var birdGeo = birdGeometry(0.85, 0.12);
    var flapAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1), ampAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    flapAttr.setUsage(THREE.DynamicDrawUsage); ampAttr.setUsage(THREE.DynamicDrawUsage);
    birdGeo.setAttribute('aFlap', flapAttr); birdGeo.setAttribute('aAmp', ampAttr);
    var FLAP_VS = ['#include <begin_vertex>',
      '#include <begin_vertex>\nfloat wx = abs(position.x);\nif (wx > 0.045) { float ang = sin(aFlap) * aAmp * 1.05 + 0.08;\n' +
      '  transformed.y += wx * sin(ang); transformed.x = sign(position.x) * (0.045 + (wx - 0.045) * cos(ang)); }'];
    var birdMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    birdMat.onBeforeCompile = function (sh) {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aFlap;\nattribute float aAmp;').replace(FLAP_VS[0], FLAP_VS[1]);
    };
    var birds = new THREE.InstancedMesh(birdGeo, birdMat, cap);
    birds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    birds.frustumCulled = false;
    var BASE = new THREE.Color(0x0a080d), baseArr = new Float32Array(cap * 3);
    (function () {
      var c = new THREE.Color();
      for (var i = 0; i < cap; i++) {
        var v = 0.85 + Math.random() * 0.3;
        c.setRGB(BASE.r * v, BASE.g * v, BASE.b * v); birds.setColorAt(i, c);
        baseArr[i * 3] = c.r; baseArr[i * 3 + 1] = c.g; baseArr[i * 3 + 2] = c.b;
      }
      birds.instanceColor.needsUpdate = true;
    })();
    birds.count = 0;
    group.add(birds);

    // 色付け（観察モード）。遠くても見失わないよう、鮮やかな色にする
    function setTag(i, hex) {
      var a = birds.instanceColor.array, o = i * 3;
      if (hex == null) { a[o] = baseArr[o]; a[o + 1] = baseArr[o + 1]; a[o + 2] = baseArr[o + 2]; }
      else { var c = new THREE.Color(hex); a[o] = c.r; a[o + 1] = c.g; a[o + 2] = c.b; }
      birds.instanceColor.needsUpdate = true;
    }
    var tagged = new Uint8Array(cap);

    /* ---------------- ハヤブサ ----------------
     * dive  ：狙った点へ急降下して突き抜ける（35 m/s）。通り過ぎたら leave
     * chase ：指の点を追う（20 m/s）。指を離すと leave
     * leave ：まっすぐ少し上昇しながら飛び去り、数秒で消える
     * 空にいるのは常に1羽。旋回の速さに上限を付ける（ムクドリの方が小回りがきく） */
    var falconGeo = birdGeometry(1.2, 0.35);
    var falconMat = new THREE.MeshBasicMaterial({ color: 0x0d0a0e, side: THREE.DoubleSide, fog: true });
    var falcon = new THREE.Mesh(falconGeo, falconMat);
    falcon.visible = false; falcon.frustumCulled = false;
    group.add(falcon);
    var F = null, FLEN = 0.95;   // ハヤブサの見かけの全長（実物の約2倍。遠くでも見えるように）
    var fPrev = new THREE.Vector3(), fCur = new THREE.Vector3();
    function spawnFalcon(target, camPos) {
      // 観る人の背後の上空（画面の外）から出す
      var dx = target.x - camPos.x, dz = target.z - camPos.z, dy = target.y - camPos.y, hd = Math.hypot(dx, dz) || 1, dist = Math.hypot(hd, dy);
      var elev = Math.min(1.45, Math.atan2(dy, hd) + 0.85), ux = dx / hd, uz = dz / hd, R = dist * 0.85;
      var p = new THREE.Vector3(camPos.x + ux * Math.cos(elev) * R, camPos.y + Math.sin(elev) * R, camPos.z + uz * Math.cos(elev) * R);
      var v = target.clone().sub(p).normalize().multiplyScalar(30);
      F = { p: p, v: v, mode: 'dive', target: target.clone(), passed: false, t: 0, tLeave: 0, flap: 0, fresh: performance.now() };
      fPrev.copy(p); fCur.copy(p);
    }
    function steer(v, desired, speed, turnRate, accel, dt) {
      var sp = v.length() || 1, dl = desired.length() || 1;
      var fx = v.x / sp, fy = v.y / sp, fz = v.z / sp, tx = desired.x / dl, ty = desired.y / dl, tz = desired.z / dl;
      var cs = Math.max(-1, Math.min(1, fx * tx + fy * ty + fz * tz)), ang = Math.acos(cs), mx = turnRate * dt;
      if (ang > mx && ang > 1e-4) {
        var px_ = tx - fx * cs, py_ = ty - fy * cs, pz_ = tz - fz * cs, pl = Math.hypot(px_, py_, pz_) || 1;
        px_ /= pl; py_ /= pl; pz_ /= pl;
        tx = fx * Math.cos(mx) + px_ * Math.sin(mx); ty = fy * Math.cos(mx) + py_ * Math.sin(mx); tz = fz * Math.cos(mx) + pz_ * Math.sin(mx);
      }
      var ns = sp + Math.max(-accel * dt, Math.min(accel * dt, speed - sp));
      v.set(tx * ns, ty * ns, tz * ns);
    }
    var tmp = new THREE.Vector3();
    var falconApi = {
      dive: function (target, camPos) {
        if (!F) { spawnFalcon(target, camPos); return true; }
        F.mode = 'dive'; F.target.copy(target); F.passed = false; F.t = 0; return false;
      },
      chase: function (target, camPos) {
        if (!F) spawnFalcon(target, camPos);
        F.mode = 'chase'; F.target.copy(target); F.passed = false;
      },
      steer: function (target) { if (F && F.mode === 'chase') F.target.copy(target); },
      release: function () { if (F && F.mode === 'chase') { F.mode = 'leave'; F.tLeave = 0; } },
      cancel: function (since) { if (F && performance.now() - F.fresh < since) { F = null; falcon.visible = false; } },
      clear: function () { F = null; falcon.visible = false; },
      active: function () { return !!F; },
      state: function () { return F ? F.mode : 'none'; },
      // 物理の刻みごとに進める。エンジンへ渡す predator（いなければ null）を返す
      step: function (dt, camPos) {
        if (!F) return null;
        fPrev.copy(F.p);
        F.t += dt;
        if (F.mode === 'dive') {
          tmp.copy(F.target).sub(F.p);
          if (!F.passed && (tmp.length() < 3 || tmp.dot(F.v) < 0)) { F.passed = true; F.tPass = 0; }
          if (!F.passed) steer(F.v, tmp, 35, 2.5, 30, dt);
          else { F.tPass += dt; steer(F.v, F.v, 35, 0, 10, dt); if (F.tPass > 1.2) { F.mode = 'leave'; F.tLeave = 0; } }
        } else if (F.mode === 'chase') {
          tmp.copy(F.target).sub(F.p);
          var dl = tmp.length();
          if (dl < 4) tmp.copy(F.v);   // 指の点に着いたら、そのまま通り抜けて回り込む
          steer(F.v, tmp, 20, 3.0, 22, dt);
        } else {
          F.tLeave += dt;
          tmp.copy(F.v); tmp.y += Math.abs(F.v.length()) * 0.35;
          steer(F.v, tmp, 26, 0.5, 8, dt);
        }
        F.p.addScaledVector(F.v, dt);
        fCur.copy(F.p);
        var far = F.p.distanceTo(camPos) > 900 || F.p.y < GY + 3;
        if ((F.mode === 'leave' && F.tLeave > 3.5) || far) { F = null; falcon.visible = false; return null; }
        F.flap += dt * (F.mode === 'chase' ? 15 : 9);
        return { x: F.p.x, y: F.p.y, z: F.p.z, vx: F.v.x, vy: F.v.y, vz: F.v.z };
      }
    };

    /* ---------------- 毎フレームの更新 ---------------- */
    var rh = new Float32Array(cap * 3), roll = new Float32Array(cap), renderedN = 0;
    var glideSeed = new Float32Array(cap);
    for (var gi = 0; gi < cap; gi++) glideSeed[gi] = Math.random() * 100;
    var camP = new THREE.Vector3();
    function update(alpha, dt, camera, viewH, clock, lite) {
      var n = engine.n, m = birds.instanceMatrix.array, P = engine.params;
      var px = engine.px, py = engine.py, pz = engine.pz, ppx = engine.ppx, ppy = engine.ppy, ppz = engine.ppz;
      var vx = engine.vx, vy = engine.vy, vz = engine.vz, fl = flapAttr.array, am = ampAttr.array;
      var kH = 1 - Math.exp(-dt * 10), kR = 1 - Math.exp(-dt * 4), invDt = dt > 1e-4 ? 1 / dt : 0;
      camP.copy(camera.position);
      // 遠くの鳥が点として消えないよう、見かけの翼開長の下限（CSS px）
      var pxPerM = viewH / (2 * Math.tan(camera.fov * Math.PI / 360)), MINPX = 3.0;
      for (var i = 0; i < n; i++) {
        var sp = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i]) || 1;
        var tx = vx[i] / sp, ty = vy[i] / sp, tz = vz[i] / sp, o3 = i * 3;
        if (i >= renderedN) { rh[o3] = tx; rh[o3 + 1] = ty; rh[o3 + 2] = tz; roll[i] = 0; }
        var hx0 = rh[o3], hz0 = rh[o3 + 2];
        var hx = hx0 + (tx - hx0) * kH, hy = rh[o3 + 1] + (ty - rh[o3 + 1]) * kH, hz = hz0 + (tz - hz0) * kH;
        var hl = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1; hx /= hl; hy /= hl; hz /= hl;
        // 傾けて曲がる（最大約60°）。翼の面の向きが変わり、群れに濃淡の波ができる
        var yawRate = (hz0 * hx - hx0 * hz) * invDt;
        var rt = Math.max(-1.05, Math.min(1.05, yawRate * 0.55));
        roll[i] += (rt - roll[i]) * kR;
        rh[o3] = hx; rh[o3 + 1] = hy; rh[o3 + 2] = hz;
        var xx = hz, xz = -hx, xl = Math.sqrt(xx * xx + xz * xz);
        if (xl < 1e-4) { xx = 1; xz = 0; xl = 1; }
        xx /= xl; xz /= xl;
        var yx = hy * xz, yy = hz * xx - hx * xz, yz = -hy * xx;
        var cr = Math.cos(roll[i]), sr = Math.sin(roll[i]);
        var Xx = xx * cr + yx * sr, Xy = yy * sr, Xz = xz * cr + yz * sr;
        var Yx = yx * cr - xx * sr, Yy = yy * cr, Yz = yz * cr - xz * sr;
        var X = ppx[i] + (px[i] - ppx[i]) * alpha, Y = ppy[i] + (py[i] - ppy[i]) * alpha, Z = ppz[i] + (pz[i] - ppz[i]) * alpha;
        var dx = X - camP.x, dy = Y - camP.y, dz = Z - camP.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        var s = P.bodyLen * engine.size[i], spanPx = s * 1.7 * pxPerM / d;
        if (spanPx < MINPX) s *= MINPX / spanPx;
        var o = i * 16;
        m[o] = Xx * s; m[o + 1] = Xy * s; m[o + 2] = Xz * s; m[o + 3] = 0;
        m[o + 4] = Yx * s; m[o + 5] = Yy * s; m[o + 6] = Yz * s; m[o + 7] = 0;
        m[o + 8] = hx * s; m[o + 9] = hy * s; m[o + 10] = hz * s; m[o + 11] = 0;
        m[o + 12] = X; m[o + 13] = Y; m[o + 14] = Z; m[o + 15] = 1;
        // 羽ばたき（約12回/秒）と滑空を、鳥ごとにずらして繰り返す。驚いているときは羽ばたき続ける
        fl[i] = engine.phase[i] * 1.35;
        var g = Math.sin(clock * 1.9 + glideSeed[i]) + 0.6 * Math.sin(clock * 3.1 + glideSeed[i] * 1.7);
        var flapK = g > 0.55 ? 0.12 : 1;
        if (engine.stress[i] > 0.2) flapK = 1;
        am[i] = am[i] + (flapK - am[i]) * Math.min(1, dt * 10);
      }
      renderedN = n;
      birds.count = n;
      birds.instanceMatrix.needsUpdate = true; flapAttr.needsUpdate = true; ampAttr.needsUpdate = true;
      skyU.uTime.value = clock;
      skyU.uCloud.value = lite ? 0 : 1;
      sky.position.copy(camP);
      // ハヤブサ
      if (F) {
        falcon.visible = true;
        tmp.copy(fPrev).lerp(fCur, alpha);
        falcon.position.copy(tmp);
        tmp.copy(falcon.position).add(F.v);
        falcon.lookAt(tmp);   // 物体の lookAt は z+（頭）を進行方向へ向ける
        var fd = falcon.position.distanceTo(camP), fs = FLEN, fpx = fs * 1.4 * pxPerM / fd;
        if (fpx < 4) fs *= 4 / fpx;
        var fold = F.mode === 'dive' && !F.passed ? 0.45 : 1;
        falcon.scale.set(fs * fold, fs, fs);
        falcon.position.y += Math.sin(F.flap) * 0.08 * (F.mode === 'chase' ? 1 : 0);
      }
    }

    return {
      group: group, TREES: TREES,
      setVisible: function (v) { group.visible = v; if (!v) { falconApi.clear(); } },
      update: update, setTag: setTag, falcon: falconApi,
      setLit: function (v) { cityU.uLit.value = v; lamps.userData.mat.opacity = Math.max(0, Math.min(1, (v - 0.1) * 2.5)); },
      reset: function () { renderedN = 0; falconApi.clear(); }
    };
  };
})(typeof window !== 'undefined' ? window : this);
