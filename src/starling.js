/* =====================================================================
 * FLOCK starling view v0.24（設計書 v0.9 §16）
 *   v0.22: 駅舎を低くし、遠くの低いビルを間引いた（並木が空を背に見える）
 *   v0.21: 電線をなめらかな帯で描く（カクカクしない）。タップできる電線・木を押している間だけ光らせる。最初に一度きらめく
 *   v0.20: 時間の流れ（空が暮れて夜になる・星・かすみと街の暗さ）。ねぐらの木に入った鳥は描かない
 *   v0.19: 止まり木は席を作らず、電線の形と木の中の空き場所をエンジンへ渡す
 *   v0.18: 夕方の空・雲・かすみ・地面を明るく
 *   v0.17: 止まり木（電線と木の席・タップの判定・止まった鳥は翼をたたむ）
 *   v0.16: 観る人を近づけたので街灯を奥へ — ムクドリモードの描画（Three.js r128）
 *   夕暮れの空・駅前の街のシルエット・羽ばたく鳥・ハヤブサ
 *   座標はエンジンと同じ（1単位 = 1 m）。地面は y = groundY（−50）。観る人は地上1.6 m に立つ
 *   app.js から FLOCK.createStarlingView(opts) で作り、表示の切り替えと毎フレームの更新を呼ぶ
 * ===================================================================== */
(function (root) {
  'use strict';

  function makeRng(seed) { var a = seed >>> 0; return function () { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; }

  // 空と遠くの街にかかる、夕方のかすみ（距離で空の色に溶かす）
  // v0.18: 明るい夕方に合わせた。v0.20: 色（uHaze）と暗さ（uDark：0 夕方〜1 夜）は時間の流れで変わる
  var HAZE_GLSL = 'uniform vec3 uHaze; uniform float uDark; vec3 haze(vec3 c, float d){ float f = 1.0 - exp(-d * 0.0011); return mix(c * (1.0 - 0.55 * uDark), uHaze, f * 0.75); }';
  var HAZE_DUSK = [0.80, 0.62, 0.64], HAZE_NIGHT = [0.075, 0.075, 0.12];

  FLOCK.createStarlingView = function (opts) {
    var THREE = opts.THREE, cap = opts.cap, engine = opts.engine;
    var P0 = FLOCK.STARLING, GY = P0.groundY;
    var group = new THREE.Group();
    group.visible = false;
    var SUN = new THREE.Vector3(-0.42, -0.06, -1).normalize();   // 沈んだばかりの太陽（観る人の前方やや左）
    var hazeC = { value: new THREE.Vector3().fromArray(HAZE_DUSK) }, darkU = { value: 0 };   // v0.20 街・木・地面で共有する

    /* ---------------- 空 ---------------- */
    var skyU = { uSun: { value: SUN }, uCloud: { value: 1 }, uTime: { value: 0 }, uDark: darkU };
    var sky = new THREE.Mesh(new THREE.SphereGeometry(2400, 48, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uSun; uniform float uCloud; uniform float uTime; uniform float uDark; varying vec3 vDir;' +
        'float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }' +
        'float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);' +
        '  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }' +
        'void main(){ vec3 d = normalize(vDir); float h = d.y;' +
        '  vec2 az = normalize(d.xz + 1e-5), sz = normalize(uSun.xz);' +
        '  float sunA = max(dot(az, sz), 0.0), sunS = pow(sunA, 3.0);' +
        // v0.18: 日没直後の明るい空に（v0.15〜0.17 は暗すぎた）
        '  vec3 zen = vec3(0.22, 0.33, 0.60), upper = vec3(0.53, 0.55, 0.80);' +
        '  vec3 hor = mix(vec3(0.98, 0.73, 0.70), vec3(1.0, 0.75, 0.46), sunS);' +   // 太陽の側は橙、反対側は桃色
        '  float t = pow(clamp(h, 0.0, 1.0), 0.5);' +
        '  vec3 c = mix(hor, upper, smoothstep(0.0, 0.55, t));' +
        '  c = mix(c, zen, smoothstep(0.45, 1.0, t));' +
        '  c += vec3(1.0, 0.55, 0.25) * pow(max(dot(d, uSun), 0.0), 10.0) * 0.45;' +  // 沈んだ太陽の残り火
        // v0.20 夜へ：天頂から先に暗くなり、西の地平線の明るさは最後まで少し残る
        '  vec3 nh = mix(vec3(0.16, 0.12, 0.19), vec3(0.30, 0.17, 0.14), sunS);' +
        '  vec3 nc = mix(nh, vec3(0.05, 0.06, 0.14), smoothstep(0.0, 0.5, t));' +
        '  nc = mix(nc, vec3(0.018, 0.024, 0.07), smoothstep(0.4, 1.0, t));' +
        '  float dk = clamp(uDark * (1.0 + 0.3 * t) - 0.1 * sunS * (1.0 - t), 0.0, 1.0);' +
        '  c = mix(c, nc, dk);' +
        '  if (h < 0.0) { vec3 hh = mix(hor, nh, dk); c = mix(hh, hh * 0.55, smoothstep(0.0, -0.08, h)); }' +
        // 薄い雲の帯（大群モードでは省く）。夕日の側ほど明るく染まる
        '  if (uCloud > 0.5 && h > 0.015 && h < 0.42) {' +
        '    float a = atan(d.z, d.x);' +
        '    vec2 q = vec2(a * 5.0 + uTime * 0.004, h * 46.0);' +
        '    float n = n2(q) * 0.55 + n2(q * vec2(2.3, 2.1) + 7.0) * 0.3 + n2(q * vec2(5.1, 3.7) + 3.0) * 0.15;' +
        '    float band = smoothstep(0.015, 0.06, h) * (1.0 - smoothstep(0.22, 0.42, h));' +
        '    float k = smoothstep(0.55, 0.78, n) * band * 0.6;' +
        '    vec3 cc = mix(vec3(0.74, 0.60, 0.70), vec3(1.0, 0.80, 0.64), sunS * 0.9 + 0.1);' +
        '    cc = mix(cc, vec3(0.07, 0.07, 0.12), smoothstep(0.1, 0.9, uDark));' +   // 夜の雲は空より少し暗い影
        '    c = mix(c, cc, k * (1.0 - 0.4 * uDark)); }' +
        // v0.20 夜になると星がいくつか出る（大群モードでは省く）
        '  if (uCloud > 0.5 && uDark > 0.45 && h > 0.12) {' +
        '    vec2 g = vec2(atan(d.z, d.x) * 70.0, asin(h) * 140.0), cl = floor(g), fr = fract(g) - 0.5;' +
        '    float st = step(0.9965, h21(cl)) * (1.0 - smoothstep(0.08, 0.3, length(fr)));' +
        '    c += vec3(0.85, 0.88, 1.0) * st * smoothstep(0.45, 0.95, uDark) * (0.55 + 0.45 * h21(cl + 3.1)); }' +
        '  gl_FragColor = vec4(c, 1.0); }'
    }));
    sky.renderOrder = -1;
    group.add(sky);

    /* ---------------- 地面 ---------------- */
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.ShaderMaterial({
      fog: false, uniforms: { uHaze: hazeC, uDark: darkU },
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: HAZE_GLSL + 'varying vec3 vW; void main(){ float d = distance(vW, cameraPosition); gl_FragColor = vec4(haze(vec3(0.11, 0.10, 0.13), d), 1.0); }'
    }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = GY;
    group.add(ground);

    /* ---------------- 駅前の街（ビル・駅舎） ----------------
     * 側面の窓は、面ごとのメートル単位の座標（aWin）から格子を作り、灯りの割合 uLit で点ける */
    var cityU = { uLit: { value: 0.12 }, uHaze: hazeC, uDark: darkU };
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
        var bw = 14 + r() * 26, bd = 12 + r() * 20, ba = ang + (r() - 0.5) * 0.3, bs = r();
        if (h < 24 && (i * 7) % 10 < 5) continue;   // v0.22 低い建物を半分ほど間引き、木の奥に夕焼けの空がのぞくようにする
        box(cx, cz, bw, bd, h, ba, bs);
        if (h > 40 && r() < 0.5) box(cx, cz, 5, 5, h + 4 + r() * 6, ang, r(), true);   // 屋上の塔屋
      }
      // 駅舎：前方やや右の低く横長な建物と、張り出した屋根
      box(46, -10, 92, 22, 7.5, 0.08, 0.5);   // v0.22 13 → 7.5 m（並木の上半分が空にかかり、木が見えやすい）
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
          '  vec3 c = vec3(0.055, 0.048, 0.07), glow = vec3(0.0);' +
          '  if (vWin.x >= 0.0) {' +
          '    vec2 cell = floor(vWin / vec2(3.2, 3.6)), f = fract(vWin / vec2(3.2, 3.6));' +
          '    float inWin = step(0.22, f.x) * step(f.x, 0.78) * step(0.3, f.y) * step(f.y, 0.75) * step(1.0, cell.y);' +
          '    float lit = step(h21(cell + vSeed * 97.0), uLit);' +
          '    float warm = h21(cell * 1.7 + vSeed * 13.0);' +
          '    glow = inWin * lit * mix(vec3(1.0, 0.72, 0.42), vec3(0.85, 0.9, 1.0), step(0.8, warm)) * 0.9; }' +
          '  float f = 1.0 - exp(-d * 0.0011);' +
          '  gl_FragColor = vec4(haze(c, d) + glow * (1.0 - f * 0.75), 1.0); }'
      }));
    })();
    group.add(city);

    /* ---------------- 街路樹（ねぐら）・電柱と電線・街灯 ---------------- */
    // v0.21 タップできる場所の光：押している電線の区間（wire）・木（tree）と、その明るさ。最初のきらめき（shP：左→右の位置、shA：強さ）
    var hiU = { wire: { value: -9 }, wireA: { value: 0 }, tree: { value: -9 }, treeA: { value: 0 }, shP: { value: -1 }, shA: { value: 0 } };
    var TREES = [];
    var trees = (function () {
      var r = makeRng(77), geos = [], ico = new THREE.IcosahedronGeometry(1, 1), treeNo = 0;
      function tag(g, nrm) {   // v0.21 木の番号と、ふちを光らせるための外向き（幹は 0）
        var c = g.attributes.position.count, id = new Float32Array(c).fill(treeNo);
        g.setAttribute('aTree', new THREE.BufferAttribute(id, 1));
        g.setAttribute('aN', new THREE.BufferAttribute(nrm || new Float32Array(c * 3), 3));
      }
      function addCrown(x, y, z, rx, ry) {
        var g = ico.clone(), p = g.attributes.position, nrm = new Float32Array(p.count * 3);
        var sd = r() * 100;
        for (var i = 0; i < p.count; i++) {   // でこぼこさせて自然な樹冠に（同じ頂点は同じだけ動かし、割れ目を作らない）
          var ux = p.getX(i), uy = p.getY(i), uz = p.getZ(i), hh = Math.sin(ux * 12.9898 + uy * 78.233 + uz * 37.719 + sd) * 43758.5453;
          var k = 1 + ((hh - Math.floor(hh)) - 0.5) * 0.22;
          var nx = ux / rx, ny = uy / ry, nz = uz / rx, nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
          nrm[i * 3] = nx / nl; nrm[i * 3 + 1] = ny / nl; nrm[i * 3 + 2] = nz / nl;
          p.setXYZ(i, x + p.getX(i) * rx * k, y + p.getY(i) * ry * k, z + p.getZ(i) * rx * k);
        }
        tag(g, nrm); geos.push(g);
      }
      function addTrunk(x, z, h) { var g = new THREE.CylinderGeometry(0.18, 0.28, h, 5); g.translate(x, GY + h / 2, z); tag(g, null); geos.push(g); }
      // 駅前広場の2列の並木（ケヤキのようにこんもり）
      for (var row = 0; row < 2; row++) for (var k = 0; k < 8; k++) {
        var x = -78 + k * 22 + (r() - 0.5) * 5 + row * 11, z = 18 - row * 20 + (r() - 0.5) * 4;
        var h = 9 + r() * 3.5, cr = 3.6 + r() * 1.4;
        addTrunk(x, z, h * 0.6);
        addCrown(x, GY + h * 0.72, z, cr, cr * 0.75);
        addCrown(x + (r() - 0.5) * cr, GY + h * 0.85, z + (r() - 0.5) * cr, cr * 0.7, cr * 0.55);
        addCrown(x + (r() - 0.5) * cr * 1.2, GY + h * 0.6, z + (r() - 0.5) * cr, cr * 0.75, cr * 0.5);
        TREES.push({ x: x, y: GY + h * 0.75, z: z, r: cr });
        treeNo++;
      }
      var pos = [], an = [], at = [];
      geos.forEach(function (g) {
        var ng = g.index ? g.toNonIndexed() : g, a = ng.attributes.position.array, b = ng.attributes.aN.array, c = ng.attributes.aTree.array, i;
        for (i = 0; i < a.length; i++) { pos.push(a[i]); an.push(b[i]); }
        for (i = 0; i < c.length; i++) at.push(c[i]);
      });
      var mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      mg.setAttribute('aN', new THREE.Float32BufferAttribute(an, 3)); mg.setAttribute('aTree', new THREE.Float32BufferAttribute(at, 1));
      return new THREE.Mesh(mg, new THREE.ShaderMaterial({
        fog: false, uniforms: { uHaze: hazeC, uDark: darkU, uHiT: hiU.tree, uHiA: hiU.treeA, uShP: hiU.shP, uShA: hiU.shA },
        vertexShader: 'attribute vec3 aN; attribute float aTree; varying vec3 vW; varying vec3 vN; varying float vT;' +
          'void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = aN; vT = aTree; gl_Position = projectionMatrix * viewMatrix * w; }',
        // v0.21 押している木（と最初のきらめき）は、樹冠のふちがうっすら光る
        fragmentShader: HAZE_GLSL + 'uniform float uHiT; uniform float uHiA; uniform float uShP; uniform float uShA; varying vec3 vW; varying vec3 vN; varying float vT;' +
          'void main(){ vec3 c = haze(vec3(0.035, 0.04, 0.045), distance(vW, cameraPosition));' +
          '  float nl = length(vN);' +
          '  if (nl > 0.1) {' +
          '    float rim = pow(1.0 - abs(dot(vN / nl, normalize(cameraPosition - vW))), 4.0);' +
          '    float hi = (abs(vT - uHiT) < 0.5 ? uHiA : 0.0) + uShA * exp(-(((vW.x + 90.0) / 190.0 - uShP) * 5.0) * (((vW.x + 90.0) / 190.0 - uShP) * 5.0));' +
          '    c += vec3(1.0, 0.84, 0.6) * rim * hi * 0.55; }' +
          '  gl_FragColor = vec4(c, 1.0); }'
      }));
    })();
    group.add(trees);

    var lampU = { uLamp: { value: 0.0 } };
    // 電柱と、たるんだ電線。電線の形（wirePt）は、止まり木の席でも使う
    var POLES = [[-58, 30], [-22, 33], [14, 31], [50, 34], [86, 30]];
    function wirePt(k, w, t) {   // 区間 k（電柱 k → k+1）の w 本目（0〜2）の、割合 t の位置
      var a = POLES[k], b = POLES[k + 1], ox = (w - 1) * 1.0, hy = GY + 10.6 + (w === 1 ? 0.6 : 0);
      return [a[0] + ox + (b[0] - a[0]) * t, hy - 4 * t * (1 - t) * 1.3, a[1] + (b[1] - a[1]) * t];
    }
    /* v0.21 電線は1ピクセルの線ではなく、縁をぼかした細い帯で描く（斜めでも階段状にならない）。
     *   太さは実際の太さ（電線 3.5 cm・電柱 26 cm）を画面に写した幅。細すぎるときは最低の幅で、少し薄く描く */
    var wireU = { uRes: { value: new THREE.Vector2(1, 1) }, uPR: { value: 1 }, uHiK: hiU.wire, uHiA: hiU.wireA, uShP: hiU.shP, uShA: hiU.shA };
    var wires = (function () {
      var pos = [], dir = [], side = [], ww = [], span = [], idx = [];
      function strip(pts, w, k) {
        var base = pos.length / 3;
        for (var i = 0; i < pts.length; i++) {
          var a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
          var dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
          for (var sd = -1; sd <= 1; sd += 2) { pos.push(pts[i][0], pts[i][1], pts[i][2]); dir.push(dx / l, dy / l, dz / l); side.push(sd); ww.push(w); span.push(k); }
          if (i > 0) { var o = base + (i - 1) * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
        }
      }
      POLES.forEach(function (p) {
        strip([[p[0], GY, p[1]], [p[0], GY + 11.5, p[1]]], 0.26, -1);
        strip([[p[0] - 1.2, GY + 10.6, p[1]], [p[0] + 1.2, GY + 10.6, p[1]]], 0.12, -1);   // 腕木
      });
      for (var k = 0; k < POLES.length - 1; k++) for (var w = 0; w < 3; w++) {
        var pts = [], N = 64;
        for (var q = 0; q <= N; q++) pts.push(wirePt(k, w, q / N));
        strip(pts, 0.035, k);
      }
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('aDir', new THREE.Float32BufferAttribute(dir, 3));
      g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
      g.setAttribute('aW', new THREE.Float32BufferAttribute(ww, 1));
      g.setAttribute('aSpan', new THREE.Float32BufferAttribute(span, 1));
      g.setIndex(idx);
      var mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
        fog: false, transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: wireU,   // 帯の向きで裏表が変わるので両面
        vertexShader:
          'attribute vec3 aDir; attribute float aSide; attribute float aW; attribute float aSpan;' +
          'uniform vec2 uRes; uniform float uPR; uniform float uHiK; uniform float uHiA; uniform float uShP; uniform float uShA;' +
          'varying float vS; varying float vHw; varying float vA; varying float vHi;' +
          'void main(){' +
          '  vec4 w = modelMatrix * vec4(position, 1.0);' +
          '  vec4 c0 = projectionMatrix * viewMatrix * w, c1 = projectionMatrix * viewMatrix * vec4(w.xyz + aDir * 0.5, 1.0);' +
          '  vec2 dd = (c1.xy / c1.w - c0.xy / c0.w) * uRes; float dl = length(dd);' +
          '  vec2 nrm = dl > 1e-5 ? vec2(-dd.y, dd.x) / dl : vec2(0.0, 1.0);' +
          '  float px = aW * projectionMatrix[1][1] * uRes.y * 0.5 / max(c0.w, 1e-3);' +   // 実際の太さを画面に写した幅（CSS px）
          '  float hi = 0.0;' +
          '  if (aSpan > -0.5) hi = max(abs(aSpan - uHiK) < 0.5 ? uHiA : 0.0, uShA * exp(-(((w.x + 90.0) / 190.0 - uShP) * 5.0) * (((w.x + 90.0) / 190.0 - uShP) * 5.0)));' +
          '  float wd = max(px, 0.8);' +
          '  vA = clamp(px / 0.8, 0.55, 1.0); vHw = wd * 0.5; vHi = hi;' +
          '  float hw = vHw + 1.5 / uPR + hi * 3.0;' +
          '  vS = aSide * hw;' +
          '  c0.xy += nrm * aSide * hw / (uRes * 0.5) * c0.w;' +
          '  gl_Position = c0; }',
        fragmentShader:
          'uniform float uPR; varying float vS; varying float vHw; varying float vA; varying float vHi;' +
          'void main(){' +
          '  float e = abs(vS);' +
          '  float core = clamp((vHw - e) * uPR + 0.5, 0.0, 1.0) * vA;' +
          '  float halo = vHi * (1.0 - smoothstep(vHw, vHw + 3.0, e)) * 0.45;' +
          '  vec3 glow = vec3(1.0, 0.84, 0.6), base = mix(vec3(0.047, 0.039, 0.063), glow, vHi * 0.8);' +
          '  float a = core + halo * (1.0 - core);' +
          '  if (a < 0.003) discard;' +
          '  gl_FragColor = vec4((base * core + glow * halo * (1.0 - core)) / a, a); }'
      }));
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      return mesh;
    })();
    group.add(wires);

    var LAMPS = [[-40, 40], [-8, 44], [24, 41], [-30, 58], [10, 60], [44, 56], [70, 44]];   // v0.16: 観る人（z = 85）に近づけたので奥へ
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
    var foldAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);   // v0.17: 1 = 止まって翼をたたんだ形
    flapAttr.setUsage(THREE.DynamicDrawUsage); ampAttr.setUsage(THREE.DynamicDrawUsage); foldAttr.setUsage(THREE.DynamicDrawUsage);
    birdGeo.setAttribute('aFlap', flapAttr); birdGeo.setAttribute('aAmp', ampAttr); birdGeo.setAttribute('aFold', foldAttr);
    var FLAP_VS = ['#include <begin_vertex>',
      '#include <begin_vertex>\nfloat wx = abs(position.x);\nif (wx > 0.045) { float ang = sin(aFlap) * aAmp * 1.05 + 0.08;\n' +
      '  float wl = (wx - 0.045) * (1.0 - 0.86 * aFold);\n' +   // たたむと翼が胴に沿って短くなる
      '  transformed.y += wl * sin(ang) * (1.0 - aFold) - 0.02 * aFold; transformed.x = sign(position.x) * (0.045 + wl * cos(ang));\n' +
      '  transformed.z -= 0.18 * aFold * (wx - 0.045); }\n' +
      // 止まった鳥は横から見られるので、平たい形に高さを付けて、ずんぐりした姿にする（肩が高く、頭と尾は低い）
      'transformed.y += aFold * clamp(0.42 - abs(position.z - 0.05) * 0.8, 0.0, 0.42) * (0.55 + 0.45 * min(wx / 0.05, 1.0));'];
    var birdMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    birdMat.onBeforeCompile = function (sh) {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aFlap;\nattribute float aAmp;\nattribute float aFold;').replace(FLAP_VS[0], FLAP_VS[1]);
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
    // v0.21 光の状態：押している所（hover）、止まり木に決まった所（flash：1秒ほど光ってから消える）、最初のきらめき
    var hi = { kind: null, k: -1, a: 0, hold: 0, sh: -1, last: 0 };
    function updateHi(camera, viewH) {
      var now = performance.now(), dt = hi.last ? Math.min(0.1, (now - hi.last) / 1000) : 0; hi.last = now;
      var want = hi.kind ? 1 : 0;
      if (hi.hold > 0) { hi.hold -= dt; want = 1; if (hi.hold <= 0) { hi.kind = hi.kind === 'flash' ? null : hi.kind; } }
      hi.a += (want * 0.85 - hi.a) * Math.min(1, dt * (want ? 14 : 4));
      hiU.wireA.value = hi.cur && hi.cur.kind === 'wire' ? hi.a : 0; hiU.wire.value = hi.cur && hi.cur.kind === 'wire' ? hi.cur.k : -9;
      hiU.treeA.value = hi.cur && hi.cur.kind === 'tree' ? hi.a : 0; hiU.tree.value = hi.cur && hi.cur.kind === 'tree' ? hi.cur.k : -9;
      if (hi.a < 0.005 && !want) hi.cur = null;
      if (hi.sh >= 0) {   // 左から右へ、2.4 秒かけて光がなでる
        hi.sh += dt;
        var u = hi.sh / 2.4;
        hiU.shP.value = -0.25 + 1.5 * u; hiU.shA.value = 0.75 * Math.sin(Math.PI * Math.min(1, u));
        if (u >= 1) { hi.sh = -1; hiU.shA.value = 0; }
      }
      wireU.uRes.value.set(Math.max(1, viewH * camera.aspect), Math.max(1, viewH));
    }
    function setHover(t) {   // t = { kind: 'wire' | 'tree', k } または null
      if (hi.hold > 0) return;
      if (t) { if (!hi.cur || hi.cur.kind !== t.kind || hi.cur.k !== t.k) { hi.cur = { kind: t.kind, k: t.k }; if (hi.a > 0.3) hi.a = 0.3; } hi.kind = 'hover'; }
      else hi.kind = null;
    }
    function flashSite(t) { if (!t) return; hi.cur = { kind: t.kind, k: t.k }; hi.kind = 'flash'; hi.hold = 1.0; }

    function update(alpha, dt, camera, viewH, clock, lite) {
      updateHi(camera, viewH);
      var n = engine.n, m = birds.instanceMatrix.array, P = engine.params;
      var px = engine.px, py = engine.py, pz = engine.pz, ppx = engine.ppx, ppy = engine.ppy, ppz = engine.ppz;
      var vx = engine.vx, vy = engine.vy, vz = engine.vz, fl = flapAttr.array, am = ampAttr.array, fo = foldAttr.array, pst = engine.pst;
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
        if (pst && pst[i] >= 2) { var bodyPx = s * pxPerM / d; if (bodyPx < 7) s *= 7 / bodyPx; }
        if (pst && pst[i] === 4) s = 0;   // v0.20 ねぐらの木の中に入った鳥は見えない   // v0.17 止まった鳥は翼をたたんで小さくなるので、見かけの体長の下限を付ける
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
        var foldT = 0;
        if (pst && pst[i]) {   // v0.17 止まり木：降りる途中は羽ばたき、席の近くで翼を広げて減速、止まったら翼をたたむ
          if (pst[i] === 1) { flapK = sp < 3 ? 0.25 : 1; }
          else { flapK = 0; foldT = 1; }
        }
        if (i >= renderedN) fo[i] = foldT;
        fo[i] += (foldT - fo[i]) * Math.min(1, dt * 6);
        am[i] = am[i] + (flapK - am[i]) * Math.min(1, dt * 10);
      }
      renderedN = n;
      birds.count = n;
      birds.instanceMatrix.needsUpdate = true; flapAttr.needsUpdate = true; ampAttr.needsUpdate = true; foldAttr.needsUpdate = true;
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

    /* ---------------- 止まり木（v0.17 / 設計書 §16.14） ----------------
     * 電線：タップした区間（電柱から電柱まで）の3本の形をエンジンへ渡す。止まる場所は、着いた鳥がその場で空きを探して決める（v0.19）
     * 木　：タップした1本の樹冠の中と枝先の、約120か所の空き場所 */
    var treeSeatCache = {};   // 木の中の空き場所は木ごとに1つ（止まっている鳥の情報を保つ）
    function treeSeats(k) {
      var T = TREES[k], out = [], r = makeRng(700 + k);
      for (var q = 0; q < 120; q++) {
        var a = r() * Math.PI * 2, el, rr;
        if (q < 40) { el = 0.45 + r() * 0.9; rr = 1.0 + r() * 0.07; }   // 3分の1は樹冠の上の枝先（空を背にして見える）
        else { el = (r() - 0.45) * 2.4; rr = 0.35 + r() * 0.5; }         // 残りは葉の中（隠れる）
        out.push({ x: T.x + Math.cos(a) * Math.cos(el) * T.r * rr, y: T.y + Math.sin(el) * T.r * 0.75 * rr, z: T.z + Math.sin(a) * Math.cos(el) * T.r * rr, fx: Math.cos(a + 1.6), fz: Math.sin(a + 1.6), bird: -1 });
      }
      return out;
    }
    var prj = new THREE.Vector3();
    function toScreen(x, y, z, camera, rect) {
      prj.set(x, y, z).project(camera);
      if (prj.z > 1 || prj.z < -1) return null;
      return [(prj.x * 0.5 + 0.5) * rect.width + rect.left, (-prj.y * 0.5 + 0.5) * rect.height + rect.top];
    }
    function segDist(px_, py_, a, b) {
      var dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, t = l2 > 0 ? ((px_ - a[0]) * dx + (py_ - a[1]) * dy) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(px_ - a[0] - dx * t, py_ - a[1] - dy * t);
    }
    // 画面の点 (sx, sy) が電線（24 px 以内）か木（樹冠の中か 12 px 以内）に当たれば、その席の一覧を返す。当たらなければ null（＝空）
    function pickTarget(sx, sy, camera, rect) {   // v0.21 当たった電線の区間・木の番号だけを返す（押している間の光に使う）
      var best = null, bd = 1e9;
      for (var k = 0; k < POLES.length - 1; k++) for (var w = 0; w < 3; w++) {
        var prev = null;
        for (var s = 0; s <= 16; s++) {
          var q = wirePt(k, w, s / 16), sp = toScreen(q[0], q[1], q[2], camera, rect);
          if (sp && prev) { var d = segDist(sx, sy, prev, sp); if (d < 24 && d < bd) { bd = d; best = { kind: 'wire', k: k }; } }
          prev = sp;
        }
      }
      var pxPerM = rect.height / (2 * Math.tan(camera.fov * Math.PI / 360));
      for (var t = 0; t < TREES.length; t++) {
        var T = TREES[t], c = toScreen(T.x, T.y, T.z, camera, rect);
        if (!c) continue;
        var dist = camera.position.distanceTo(prj.set(T.x, T.y, T.z)), rpx = T.r * pxPerM / dist;
        var dd = Math.max(0, Math.hypot(sx - c[0], sy - c[1]) - rpx);
        if (dd < 12 && dd < bd) { bd = dd; best = { kind: 'tree', k: t }; }
      }
      return best;
    }
    function pickPerch(sx, sy, camera, rect) { return perchFor(pickTarget(sx, sy, camera, rect)); }
    function perchFor(best) {   // v0.21 当たった電線の区間・木から、エンジンへ渡す止まり木を作る
      if (!best) return null;
      // v0.19 エンジンへ渡す止まり木（席は先に決めない。電線は形だけ、木は中の空き場所の一覧）
      if (best.kind === 'wire') {
        var ws = [];
        for (var w2 = 0; w2 < 3; w2++) { var pts = []; for (var s2 = 0; s2 <= 32; s2++) pts.push(wirePt(best.k, w2, s2 / 32)); ws.push(pts); }
        return { kind: 'wire', key: 'w' + best.k, k: best.k, wires: ws };
      }
      var T2 = TREES[best.k];
      return { kind: 'tree', key: 't' + best.k, k: best.k, x: T2.x, y: T2.y, z: T2.z, r: T2.r, seats: treeSeatCache[best.k] || (treeSeatCache[best.k] = treeSeats(best.k)) };
    }

    return {
      group: group, TREES: TREES, pickPerch: pickPerch, pickTarget: pickTarget, perchFor: perchFor,
      setHover: setHover, flashSite: flashSite,
      shimmer: function () { hi.sh = 0; },                      // v0.21 最初のきらめき
      setPR: function (v) { wireU.uPR.value = v; },            // 画面の細かさ（電線の縁のぼかし幅）
      debugHi: function () { return { wire: hiU.wire.value, wireA: hiU.wireA.value, tree: hiU.tree.value, treeA: hiU.treeA.value, sh: hiU.shA.value }; },
      debugWirePoint: function (k, w, t) { return wirePt(k, w, t); },
      setVisible: function (v) { group.visible = v; if (!v) { falconApi.clear(); } },
      update: update, setTag: setTag, falcon: falconApi,
      setLit: function (v) { cityU.uLit.value = v; lamps.userData.mat.opacity = Math.max(0, Math.min(1, (v - 0.1) * 2.5)); },
      // v0.20 空の暗さ（0 = 日没直後の夕焼け、1 = 夜）
      setDark: function (v) {
        darkU.value = v;
        hazeC.value.set(HAZE_DUSK[0] + (HAZE_NIGHT[0] - HAZE_DUSK[0]) * v, HAZE_DUSK[1] + (HAZE_NIGHT[1] - HAZE_DUSK[1]) * v, HAZE_DUSK[2] + (HAZE_NIGHT[2] - HAZE_DUSK[2]) * v);
      },
      reset: function () { renderedN = 0; falconApi.clear(); treeSeatCache = {}; hi.kind = null; hi.hold = 0; }
    };
  };
})(typeof window !== 'undefined' ? window : this);
