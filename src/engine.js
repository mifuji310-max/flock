/* =====================================================================
 * FLOCK simulation engine  v0.11
 *   v0.11 2026-11-02 ねぐら入り：街路樹の上空を回り、降りる決断が広がって、渦を巻きながら木の中へ入る（見えなくなる）
 *   v0.10 2026-11-01 止まり木の降り方を改訂：上空を回る → 降りる決断が仲間へ広がる → 着いた所の空きに止まる（席を先に決めない）
 *   v0.9 2026-11-01 止まり木（ムクドリ）：席を割り当てて降りる・止まる・ハヤブサで一斉に飛び立つ
 *   v0.8 2026-11-01 ムクドリ（species: 'starling'）：近い順の7羽で整列・結合、ハヤブサから逃げる、平たい群れ、最低高度
 *   v0.7 2026-11-01 成長の計画を2000匹まで延長（上限は maxCount で決まる）
 *   v0.6 2026-11-01 海底より下に餌をまかない・魚が海底より下へ潜らない
 *   v0.5 2026-10-31 餌やり：沈む餌粒、餌への誘引・興奮（feed）の近傍伝播・捕食
 *   v0.4 2026-10-31 障害物の種類：浮き玉（球＋係留ロープ）と岩の柱（鉛直カプセル）。海底基準で配置
 *   v0.3 2026-10-31 固定の目印（岩）を回避対象 landmarks として追加
 *   v0.2 2026-10-31 合流群の出現位置・匹数を公開（到着トースト用）
 *   v0.1 2026-10-30 初版
 *   描画非依存。Node でも単体実行できる（検証用）。
 *   - SpatialHashGrid   : 近傍探索
 *   - NeighborRules     : 分離 / Vicsek型整列 / 結合（Couzin型の距離別優先）
 *   - WanderField       : 低振幅3Dフローフィールド＋ソフト境界
 *   - TouchRepulsion    : 指の忌避（カプセル＋奥行き厚み）＋ stress 伝播
 *   - ObstacleAvoid     : 予測回避（相対速度・拡張半径）＋めり込み補正
 *   - GrowthManager     : 画面外からの小集団合流
 *   - GroupAnalyzer     : 偏極度・最近接距離・連結成分など
 * ===================================================================== */
(function (root) {
  'use strict';

  var ENGINE_VERSION = '0.11';

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // smoothstep(e0, e1, x)。e0 > e1 も可（例: smoothstep(R, rInner, d)）
  function smoothstep(e0, e1, x) {
    var t = (x - e0) / (e1 - e0);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return t * t * (3 - 2 * t);
  }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

  /* ------------------------------------------------------------------ */
  /* イワシ（先行モード）の既定パラメータ。単位はワールド単位・秒。      */
  /* 魚体長 ≒ 0.32                                                        */
  /* ------------------------------------------------------------------ */
  var SARDINE = {
    bodyLen: 0.32,
    bodyRadius: 0.10,
    cruise: 2.0, minSpeed: 1.1, panicSpeed: 6.2,
    maxAccel: 4.0, panicAccel: 22,
    maxTurn: 2.6, panicTurn: 8.0,        // rad/s
    maxPitch: 0.62,                      // 進行方向の上下成分の上限（|dir.y|）
    rSep: 0.60, rAli: 1.40, rCoh: 2.80,  // 分離 < 整列 < 結合
    blindCos: -0.55,                     // 真後ろの死角（整列・結合のみ）
    maxNeighbors: 28,
    wInertia: 1.0,
    wSep: 2.6, wAli: 1.6, wCoh: 0.6,
    wTouch: 7.0, wObs: 9.0, wEnv: 0.30, wBound: 1.6, wGather: 1.0,
    noise: 0.16,                         // Vicsek 型ノイズ
    alarm: 3.0,                          // 近傍警戒伝達の速さ (1/s)
    alarmGain: 0.80,                     // 1ホップあたりの伝達率
    stressDecay: 0.85,                   // 1/s
    speedMatch: 0.30,                    // 近傍速度への同調
    obsMargin: 0.38, lookAhead: 1.15,    // 拡張半径の余裕 / 予測時間 (s)
    wFood: 3.2, foodRange: 9, eatDist: 0.2, biteProb: 0.25, sinkSpeed: 0.2, feedDecay: 0.32,   // 餌やり（biteProb：届いても毎回は食べられない）
    foodMinH: 1.0, floorGuard: 0.8,   // v0.6: 餌をまく最低の高さ（海底から）、魚が海底を避け始める高さ
    obsMaxSpeed: 8.0, obsRadiusRate: 2.5,
    bounds: [16, 8, 14]                  // ソフト境界（楕円体の半径）
  };

  /* ------------------------------------------------------------------ */
  /* ムクドリ（v0.8〜）の既定パラメータ。1ワールド単位 = 1 m。           */
  /* 全長 ≒ 0.22 m。範囲の中心は地上 50 m（地面は y = −50）              */
  /*   ・整列と結合は「近い順に topoK 羽」（Ballerini 2008）             */
  /*   ・ハヤブサ（predator）から逃げ、驚きは近い順の仲間へ速く伝わる     */
  /* ------------------------------------------------------------------ */
  var STARLING = Object.assign({}, SARDINE, {
    species: 'starling',
    bodyLen: 0.22, bodyRadius: 0.08,
    cruise: 10, minSpeed: 7, panicSpeed: 18,
    maxAccel: 5, panicAccel: 30,
    maxTurn: 1.6, panicTurn: 5.0,
    maxPitch: 0.45, panicPitch: 0.7,
    rSep: 1.6, rAli: 3, rCoh: 3,         // rCoh は近傍を探す範囲（空間ハッシュの格子の大きさ）。最近接は約1.3 m になる
    topoK: 7,
    blindCos: -0.6,
    wSep: 2.4, wAli: 1.8, wCoh: 0.9,
    wTouch: 9.0, wEnv: 0.5, wBound: 1.4, wGather: 1.0, wCenter: 0.6,   // wCenter：群れの中心から離れた個体を弱く戻す
    noise: 0.12,
    alarm: 14, alarmGain: 0.9, stressDecay: 0.9,
    speedMatch: 0.4,
    flatten: 0.9,                        // 上下の動きを抑えて平たい群れにする
    envScale: 0.25,                      // 環境の流れの空間スケール（広い空に合わせる）
    spawnScale: 1.9,                     // 生まれたときの群れの広がり
    predR: 14, predLead: 0.3,            // ハヤブサを怖がる距離（m）、ハヤブサの何秒先の位置を見て逃げるか
    groundY: -50, minAlt: 15, floorGuard: 6,   // 地面、平常時の最低高度、高度を保ち始める余裕
    perchScareR: 30,                     // v0.9 止まり木：ハヤブサがこの距離に来たら飛び立つ（m）
    // v0.10 降り方（設計書 v0.7 §16.14）
    siteUp: 14, siteR: 15,               // 上空を回る高さ（止まり木から）と半径（m）
    landDelay: 4, landBase: 0.004, landNear: 0.05, landQuorum: 0.5,  // 決め始めるまでの秒、ふだんの決めやすさ（1/秒）、真上にいるとき、仲間の影響
    claimR: 2.5, gapMin: 0.24, gapMax: 0.50, slotSearch: 5,            // 空きを探し始める距離、好む間隔の範囲、左右に探す幅（m）
    siteLife: 45, siteFails: 300,
    // v0.11 ねぐら入り（設計書 §16.7）：街路樹の上空を回り、降りる決断が広がって、渦を巻きながら木の中へ入る
    roostR: 28, roostDelay: 6, roostBase: 0.004, roostRamp: 0.0005, roostQuorum: 0.8, roostEnd: 68, roostIn: 1.2, swirl: 0.9,
    growMax: 80,
    bounds: [60, 20, 60]
  });
  var SPECIES = { sardine: SARDINE, starling: STARLING };

  /* ------------------------------------------------------------------ */
  function SpatialHashGrid(cap, cell) {
    this.size = 4096; this.mask = 4095;
    this.head = new Int32Array(this.size);
    this.next = new Int32Array(cap);
    this.setCell(cell);
  }
  SpatialHashGrid.prototype.setCell = function (cell) { this.cell = cell; this.inv = 1 / cell; };
  SpatialHashGrid.prototype.key = function (ix, iy, iz) {
    return ((ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)) & this.mask;
  };
  SpatialHashGrid.prototype.build = function (px, py, pz, n) {
    this.head.fill(-1);
    var inv = this.inv;
    for (var i = 0; i < n; i++) {
      var k = this.key(Math.floor(px[i] * inv), Math.floor(py[i] * inv), Math.floor(pz[i] * inv));
      this.next[i] = this.head[k];
      this.head[k] = i;
    }
  };
  // 27セルのキー（ハッシュ衝突による重複を除去）を keys に書き込み、個数を返す
  SpatialHashGrid.prototype.cellKeys = function (x, y, z, keys) {
    var inv = this.inv, ix = Math.floor(x * inv), iy = Math.floor(y * inv), iz = Math.floor(z * inv), m = 0;
    for (var a = -1; a <= 1; a++) for (var b = -1; b <= 1; b++) for (var c = -1; c <= 1; c++) {
      var k = this.key(ix + a, iy + b, iz + c), dup = false;
      for (var q = 0; q < m; q++) if (keys[q] === k) { dup = true; break; }
      if (!dup) keys[m++] = k;
    }
    return m;
  };

  /* ------------------------------------------------------------------ */
  function FlockEngine(opts) {
    opts = opts || {};
    this.cap = opts.capacity || 640;
    this.species = SPECIES[opts.species] ? opts.species : 'sardine';
    this.params = Object.assign({}, SPECIES[this.species], opts.params || {});
    var C = this.cap;
    this.px = new Float32Array(C); this.py = new Float32Array(C); this.pz = new Float32Array(C);
    this.vx = new Float32Array(C); this.vy = new Float32Array(C); this.vz = new Float32Array(C);
    this.nvx = new Float32Array(C); this.nvy = new Float32Array(C); this.nvz = new Float32Array(C);
    this.ppx = new Float32Array(C); this.ppy = new Float32Array(C); this.ppz = new Float32Array(C); // 前ステップ位置（描画補間）
    this.stress = new Float32Array(C); this.nstress = new Float32Array(C);
    this.feed = new Float32Array(C); this.nfeed = new Float32Array(C);   // 餌への興奮（0〜1）
    var FC = this.FOOD_CAP = 260;
    this.foodX = new Float32Array(FC); this.foodY = new Float32Array(FC); this.foodZ = new Float32Array(FC);
    this.foodVX = new Float32Array(FC); this.foodVY = new Float32Array(FC); this.foodVZ = new Float32Array(FC);
    this.foodAge = new Float32Array(FC); this.foodPh = new Float32Array(FC); this.foodEaten = new Uint8Array(FC);
    this.foodN = 0; this.eaten = 0;
    this.resp = new Float32Array(C);     // responseBias
    this.speedBias = new Float32Array(C);
    this.size = new Float32Array(C);
    this.phase = new Float32Array(C);
    this.flock = new Int16Array(C);      // 0 = 本体に合流済み, >0 = 接近中の小集団ID
    this.joinT = new Float32Array(C);
    this.iso = new Float32Array(C);
    this.sx = new Float32Array(C); this.sy = new Float32Array(C); this.sz = new Float32Array(C); // 回避の好み側
    this.nn = new Float32Array(C);
    this.inside = new Uint8Array(C);
    this.grid = new SpatialHashGrid(C, this.params.rCoh);
    this._keys = new Int32Array(27);
    this._knD = new Float32Array(16); this._knJ = new Int32Array(16);   // 近い順の近傍（ムクドリ）
    this.predator = null;                // ハヤブサ { x, y, z, vx, vy, vz, R }（入力層が設定。いないときは null）
    // v0.9 止まり木：鳥ごとの状態 0=飛ぶ 1=席へ降りる 2=止まっている 3=飛び立ち待ち 4=ねぐらの木の中（見えない。v0.11）。席は perches の番号
    this.pst = new Uint8Array(C); this.pseat = new Int32Array(C); this.ptk = new Float32Array(C);
    this.rj = new Float32Array(C);       // 飛び立ってから群れへ戻るまでの残り時間（この間は目印の鳥を追う）
    this.anchor = new Int32Array(C).fill(-1);
    // v0.10 降り方：降りると決めた鳥の目標（電線の番号と位置、木の中の点）、好む間隔、決め直しまでの待ち時間
    this.dw = new Int16Array(C); this.ds = new Float32Array(C);
    this.dtx = new Float32Array(C); this.dty = new Float32Array(C); this.dtz = new Float32Array(C);
    this.gap = new Float32Array(C); this.cool = new Float32Array(C);
    this.site = null; this._siteSeq = 0;
    this.perches = []; this.perchedN = 0; this.roostedN = 0;
    this.obstacles = [];
    this.landmarks = [];               // 固定の目印（岩など）。ユーザーは編集できない
    this.repulsors = [];                 // 入力層が毎ステップ設定
    this.viewHalf = 8;                   // 入力層が設定（合流群の出現位置に使用）
    this.maxCount = opts.maxCount || 500;
    this.growthEnabled = !!opts.growth;
    this.reset(opts.seed != null ? opts.seed : (Date.now() & 0x7fffffff), opts.initial);
  }

  FlockEngine.prototype.reset = function (seed, initial) {
    this.seed = seed >>> 0;
    this.rng = mulberry32(this.seed);
    this.n = 0; this.joined = 0; this.time = 0; this.steps = 0;
    this.intrusions = 0;
    this.growth = { t: 0, nextAt: 8, seq: 1, groups: 0, lastSize: 0, lastPos: null };
    this.centroid = [0, 0, 0]; this.spread = 2; this.mainN = 0;
    this.stats = { P: 0, meanNN: 0, minNN: 0, radius: 0, components: 1, maxStress: 0, meanSpeed: 0 };
    var count = initial != null ? initial : (this.growthEnabled ? 12 : 100);
    var r = this.rng, P = this.params;
    var R0 = (0.55 * Math.cbrt(count) + 0.4) * (P.spawnScale || 1);
    var hx = r() * 2 - 1, hz = r() * 2 - 1, hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
    for (var i = 0; i < count; i++) {
      var p = this._randInBall(R0);
      this.addFish(p[0], p[1] * 0.6, p[2],
        (hx + (r() - 0.5) * 0.4) * P.cruise, (r() - 0.5) * 0.3, (hz + (r() - 0.5) * 0.4) * P.cruise, 0);
    }
    this.joined = this.n;
    this.obstacles.length = 0;
    this.foodN = 0; this.eaten = 0; this.feed.fill(0);
    this.pst.fill(0); this.rj.fill(0); this.cool.fill(0); this.perches = []; this.perchedN = 0; this.roostedN = 0; this.site = null;
    this.analyze();
  };

  /* ---------------- 止まり木（v0.9、v0.10 で降り方を改訂） ----------------
   * site（描画側が作る。THREE には依存しない）
   *   電線：{ kind: 'wire', wires: [[[x, y, z], ...], ...] }   電線ごとの折れ線（たるみを含む）
   *   木　：{ kind: 'tree', x, y, z, r, seats: [{ x, y, z, fx, fz }] }
   * 群れはまず上空を回り、降りる決断が仲間へ広がって降り、着いた所の空きに止まる（席は先に決めない） */
  FlockEngine.prototype.perchSite = function (site) {
    // 空いた席を片づける（席の番号が変わるので、鳥の pseat も付け直す）
    var keep = [], map = {};
    for (var q = 0; q < this.perches.length; q++) if (this.perches[q].bird >= 0) { map[q] = keep.length; keep.push(this.perches[q]); }
    for (var i = 0; i < this.n; i++) if (this.pst[i] && this.pseat[i] >= 0) this.pseat[i] = map[this.pseat[i]];
    this.perches = keep;
    // 降りる途中で席のない鳥は、空へ戻す（呼びかけを新しい止まり木へ切り替える）
    for (i = 0; i < this.n; i++) if (this.pst[i] === 1 && this.pseat[i] < 0) { this.pst[i] = 0; this.rj[i] = 4; this.anchor[i] = -1; }
    var cx = 0, cy = 0, cz = 0, m = 0;
    if (site.kind === 'wire') {
      site.cum = site.wires.map(function (pts) {
        var c = [0];
        for (var k = 1; k < pts.length; k++) c.push(c[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1], pts[k][2] - pts[k - 1][2]));
        pts.forEach(function (p) { cx += p[0]; cy += p[1]; cz += p[2]; m++; });
        return c;
      });
      cx /= m; cy /= m; cz /= m;
      var len = 0; site.cum.forEach(function (c) { len += c[c.length - 1]; });
      site.cap = Math.floor(len / ((this.params.gapMin + this.params.gapMax) / 2));   // 止まれるおおよその数
    } else { cx = site.x; cy = site.y; cz = site.z; site.cap = site.seats.length; }
    site.cx = cx; site.cy = cy; site.cz = cz;
    site.ox = cx; site.oy = cy + this.params.siteUp; site.oz = cz;
    site.t = 0; site.fails = 0; site.active = true; site.id = site.key != null ? site.key : 's' + (++this._siteSeq);   // 同じ電線の区間・同じ木は同じ id（前に止まった鳥と重ならない）
    site.dir = this.rng() < 0.5 ? 1 : -1;   // 回る向き
    this.site = site;
    for (i = 0; i < this.n; i++) this.cool[i] = 0;
  };
  /* ---------------- ねぐら入り（v0.11 / 設計書 §16.7） ----------------
   * trees: [{ x, y, z, r }]（描画側の街路樹）。止まり木と同じく「上空を回る → 決断が広がる → 降りる」。
   * 席は作らない。渦を巻くように降りて樹冠の中まで来た鳥は、見えなくなる（pst = 4）。 */
  FlockEngine.prototype.roostSite = function (trees) {
    var P = this.params, cx = 0, cy = 0, cz = 0;
    trees.forEach(function (t) { cx += t.x; cy += t.y; cz += t.z; });
    cx /= trees.length; cy /= trees.length; cz /= trees.length;
    var site = { kind: 'roost', trees: trees, cx: cx, cy: cy, cz: cz, ox: cx, oy: cy + P.siteUp, oz: cz, t: 0, fails: 0, active: true, free: 1, cap: 1e9, id: 'roost', dir: this.rng() < 0.5 ? 1 : -1 };
    // 降りる途中の鳥は空へ戻し、電線や木に止まっている鳥は少しずつ飛び立たせる（そのあと、ねぐらへ向かう）
    for (var i = 0; i < this.n; i++) {
      if (this.pst[i] === 1) { if (this.pseat[i] >= 0) this.perches[this.pseat[i]].bird = -1; this.pseat[i] = -1; this.pst[i] = 0; this.rj[i] = 4; this.anchor[i] = -1; }
      else if (this.pst[i] === 2) { this.pst[i] = 3; this.ptk[i] = 0.5 + this.rng() * 4; }
      this.cool[i] = 0;
    }
    this.site = site;
    return site;
  };
  FlockEngine.prototype.roosting = function () { return !!(this.site && this.site.kind === 'roost'); };
  // 電線 w の上で点 (x, y, z) に一番近い点の、電線に沿った距離 s と、その点
  FlockEngine.prototype._wireNearest = function (site, x, y, z, out) {
    var best = 1e18;
    for (var w = 0; w < site.wires.length; w++) {
      var pts = site.wires[w], cum = site.cum[w];
      for (var k = 0; k < pts.length - 1; k++) {
        var a = pts[k], b = pts[k + 1], abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2], l2 = abx * abx + aby * aby + abz * abz;
        var t = l2 > 0 ? ((x - a[0]) * abx + (y - a[1]) * aby + (z - a[2]) * abz) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        var qx = a[0] + abx * t, qy = a[1] + aby * t, qz = a[2] + abz * t, d2 = (x - qx) * (x - qx) + (y - qy) * (y - qy) + (z - qz) * (z - qz);
        if (d2 < best) { best = d2; out.w = w; out.s = cum[k] + Math.sqrt(l2) * t; out.x = qx; out.y = qy; out.z = qz; }
      }
    }
    return out;
  };
  // 電線 w の、端からの距離 s の点と、その場所の電線の向き
  FlockEngine.prototype._wireAt = function (site, w, s, out) {
    var pts = site.wires[w], cum = site.cum[w], k = 0;
    while (k < pts.length - 2 && cum[k + 1] < s) k++;
    var a = pts[k], b = pts[k + 1], L = cum[k + 1] - cum[k] || 1, t = (s - cum[k]) / L;
    out.x = a[0] + (b[0] - a[0]) * t; out.y = a[1] + (b[1] - a[1]) * t; out.z = a[2] + (b[2] - a[2]) * t;
    out.dx = (b[0] - a[0]) / L; out.dz = (b[2] - a[2]) / L;
    return out;
  };
  // 空を飛んでいた鳥 i が「降りる」と決める
  FlockEngine.prototype._startDescent = function (i) {
    var site = this.site, r = this.rng;
    this.pst[i] = 1; this.pseat[i] = -1; this.stress[i] = 0;
    this.gap[i] = this.params.gapMin + r() * (this.params.gapMax - this.params.gapMin);
    if (site.kind === 'wire') {
      // 電線の空いていそうな所を目指す：候補を5つ見て、近くて、止まっている鳥や向かっている鳥が少ない所を選ぶ
      var bestW = 0, bestS = 0, bestC = 1e18;
      for (var c = 0; c < 5; c++) {
        var w = Math.floor(r() * site.wires.length), L = site.cum[w][site.cum[w].length - 1], sc = 0.6 + r() * (L - 1.2);
        var pt = this._wireAt(site, w, sc, {}), crowd = 0;
        for (var j = 0; j < this.n; j++) {
          if (this.pst[j] === 1 && j !== i && this.dw[j] === w && Math.abs(this.ds[j] - sc) < 1.5) crowd++;
          else if (this.pst[j] === 2) { var o = this.perches[this.pseat[j]]; if (o.site === site.id && o.w === w && Math.abs(o.s - sc) < 1.5) crowd++; }
        }
        var cost = Math.hypot(pt.x - this.px[i], pt.z - this.pz[i]) + crowd * 6;
        if (cost < bestC) { bestC = cost; bestW = w; bestS = sc; }
      }
      this.dw[i] = bestW; this.ds[i] = bestS;
    }
    if (site.kind === 'roost') {   // v0.11 近くの木（4本から一番近いもの）の樹冠の中を目指す
      var bt = site.trees[0], bd = 1e18;
      for (var c2 = 0; c2 < 4; c2++) {
        var T = site.trees[Math.floor(r() * site.trees.length)], ex = T.x - this.px[i], ez = T.z - this.pz[i], e2 = ex * ex + ez * ez;
        if (e2 < bd) { bd = e2; bt = T; }
      }
      var a2 = r() * Math.PI * 2, rr2 = bt.r * (0.15 + r() * 0.4);
      this.dtx[i] = bt.x + Math.cos(a2) * rr2; this.dty[i] = bt.y + (r() - 0.5) * bt.r * 0.5; this.dtz[i] = bt.z + Math.sin(a2) * rr2;
    }
    if (site.kind === 'tree') {   // 樹冠の中のどこかを目指す
      var a = r() * Math.PI * 2, el = (r() - 0.3) * 1.6, rr = site.r * (0.3 + r() * 0.6);
      this.dtx[i] = site.x + Math.cos(a) * Math.cos(el) * rr; this.dty[i] = site.y + Math.sin(el) * rr * 0.75; this.dtz[i] = site.z + Math.sin(a) * Math.cos(el) * rr;
    }
  };
  // 着いた所で空きを探す。見つかれば席を作って true
  FlockEngine.prototype._claim = function (i) {
    var site = this.site, P = this.params, r = this.rng, seat = null;
    if (site.kind === 'wire') {
      var w = this.dw[i], s0 = this.ds[i], L = site.cum[w][site.cum[w].length - 1], gi = this.gap[i];
      var occ = [];
      for (var q = 0; q < this.perches.length; q++) { var o = this.perches[q]; if (o.bird >= 0 && o.site === site.id && o.w === w) occ.push(o); }
      for (var k = 0; k <= P.slotSearch / 0.06 && !seat; k++) {
        var s = s0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.06;
        if (s < 0.6 || s > L - 0.6) continue;
        var ok = true;
        for (q = 0; q < occ.length; q++) if (Math.abs(occ[q].s - s) < Math.max(gi, occ[q].g)) { ok = false; break; }
        if (ok) {
          var pt = this._wireAt(site, w, s, {}), sg = r() < 0.7 ? 1 : -1;
          seat = { x: pt.x, y: pt.y + 0.09, z: pt.z, fx: -pt.dz * sg, fz: pt.dx * sg, w: w, s: s, g: gi, site: site.id };
        }
      }
    } else {
      var best = -1, bd = 1e18;
      for (q = 0; q < site.seats.length; q++) {
        var st = site.seats[q];
        if (st.bird >= 0) continue;
        var d2 = (st.x - this.px[i]) * (st.x - this.px[i]) + (st.y - this.py[i]) * (st.y - this.py[i]) + (st.z - this.pz[i]) * (st.z - this.pz[i]);
        if (d2 < bd) { bd = d2; best = q; }
      }
      if (best >= 0) seat = site.seats[best];
    }
    if (!seat) return false;
    seat.bird = i;
    this.pseat[i] = this.perches.length; this.perches.push(seat);
    return true;
  };
  // 空きがなかった鳥：舞い上がって空の群れへ戻る（しばらくは降りると決めない）
  FlockEngine.prototype._abortDescent = function (i) {
    this.pst[i] = 0; this.pseat[i] = -1; this.rj[i] = 6; this.anchor[i] = -1; this.cool[i] = 10;
    this.vy[i] = Math.max(this.vy[i], 4);
    if (this.site) this.site.fails++;
  };
  // 止まっている鳥（と降りている途中の鳥）を飛び立たせる。点 (x, y, z) に近い鳥から 0〜0.5 秒の遅れで、波のように
  FlockEngine.prototype.scarePerched = function (x, y, z) {
    var roost = this.roosting();   // v0.11 ねぐら入りの間は呼びかけを続ける。驚いた鳥は舞い上がり、しばらくしてまた降りる
    if (!roost) this.site = null;   // v0.10 降りる呼びかけも終わり
    for (var i = 0; i < this.n; i++) {
      if (this.pst[i] === 1) {
        if (roost && Math.hypot(this.px[i] - x, this.py[i] - y, this.pz[i] - z) > 40) continue;
        if (this.pseat[i] >= 0) this.perches[this.pseat[i]].bird = -1; this.pseat[i] = -1; this.pst[i] = 0; this.stress[i] = 0.6; this.rj[i] = 15; this.anchor[i] = -1;
        if (roost) { this.cool[i] = 4 + this.rng() * 4; this.vy[i] = Math.max(this.vy[i], 5); }
      }
      else if (this.pst[i] === 2) { this.pst[i] = 3; this.ptk[i] = Math.min(0.5, Math.hypot(this.px[i] - x, this.py[i] - y, this.pz[i] - z) / 120); }
    }
  };

  // v0.8: 生きものの種類を切り替える（パラメータを入れ替えて最初からやり直す）
  FlockEngine.prototype.setSpecies = function (species, seed, initial) {
    this.species = SPECIES[species] ? species : 'sardine';
    this.params = Object.assign({}, SPECIES[this.species]);
    this.predator = null; this.repulsors = []; this.landmarks = [];
    this.reset(seed != null ? seed : (Date.now() & 0x7fffffff), initial);
  };

  FlockEngine.prototype._randInBall = function (R) {
    var r = this.rng, x, y, z;
    do { x = r() * 2 - 1; y = r() * 2 - 1; z = r() * 2 - 1; } while (x * x + y * y + z * z > 1);
    return [x * R, y * R, z * R];
  };

  FlockEngine.prototype.addFish = function (x, y, z, vx, vy, vz, flockId) {
    if (this.n >= this.cap) return -1;
    var i = this.n++, r = this.rng;
    this.px[i] = this.ppx[i] = x; this.py[i] = this.ppy[i] = y; this.pz[i] = this.ppz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.stress[i] = 0; this.feed[i] = 0;
    this.resp[i] = 0.75 + r() * 0.5;
    this.speedBias[i] = 0.9 + r() * 0.2;
    this.size[i] = 0.88 + r() * 0.24;
    this.phase[i] = r() * Math.PI * 2;
    this.flock[i] = flockId | 0;
    this.joinT[i] = 0; this.iso[i] = 0; this.inside[i] = 0;
    var s = this._randInBall(1), sl = Math.hypot(s[0], s[1], s[2]) || 1;
    this.sx[i] = s[0] / sl; this.sy[i] = s[1] / sl; this.sz[i] = s[2] / sl;
    return i;
  };

  /* ---------------- 障害物 ---------------- */
  // opts: { kind: 'buoy' | 'pillar', x, z, radius, height }  height は海底からの高さ
  //   buoy   : 浮き玉の中心が海底から height の位置。海底の重りまで細いロープ
  //   pillar : 海底から高さ height まで立つ岩の柱（鉛直カプセルとして回避）
  FlockEngine.prototype.addObstacle = function (opts) {
    var ob = { id: 'ob' + (this._obSeq = (this._obSeq || 0) + 1), kind: opts.kind || 'buoy',
      x: opts.x, y: 0, z: opts.z, tx: opts.x, ty: 0, tz: opts.z, y0: 0, y1: 0,
      radius: opts.radius, targetRadius: opts.radius, height: opts.height, targetHeight: opts.height,
      vx: 0, vy: 0, vz: 0, enabled: true };
    this._shapeObstacle(ob);
    this.obstacles.push(ob);
    return ob;
  };
  FlockEngine.prototype._shapeObstacle = function (o) {
    var floor = -this.params.bounds[1];
    if (o.kind === 'pillar') { o.y0 = floor; o.y1 = floor + Math.max(o.radius * 0.5, o.height - o.radius * 0.3); o.y = (o.y0 + o.y1) / 2; }
    else { o.y0 = floor; o.y = floor + o.height; o.y1 = o.y; }
  };
  /* ---------------- 餌（v0.5） ---------------- */
  FlockEngine.prototype.addFood = function (x, y, z, count, spread) {
    var r = this.rng, minY = -this.params.bounds[1] + this.params.foodMinH;
    if (y < minY) y = minY;   // v0.6: 海底より下にはまかない（粒の広がりを含めて海底の上に収める）
    for (var k = 0; k < count && this.foodN < this.FOOD_CAP; k++) {
      var p = this._randInBall(spread), f = this.foodN++;
      this.foodX[f] = x + p[0]; this.foodY[f] = y + p[1] * 0.6; this.foodZ[f] = z + p[2];
      this.foodVX[f] = p[0] * 1.2; this.foodVY[f] = 0.15 + r() * 0.2; this.foodVZ[f] = p[2] * 1.2;   // ぱっと広がってから沈む
      this.foodAge[f] = 0; this.foodPh[f] = r() * 6.283; this.foodEaten[f] = 0;
    }
  };
  FlockEngine.prototype._updateFood = function (dt) {
    var P = this.params, floor = -P.bounds[1] + 0.04, damp = Math.exp(-dt * 2.2), t = this.time;
    for (var f = 0; f < this.foodN; f++) {
      if (this.foodEaten[f] || this.foodAge[f] > 6) { this._removeFood(f); f--; continue; }
      if (this.foodY[f] <= floor) { this.foodAge[f] += dt; continue; }   // 海底に落ちた粒はしばらくして消える
      this.foodVX[f] *= damp; this.foodVZ[f] *= damp;
      this.foodVY[f] += (-P.sinkSpeed - this.foodVY[f]) * Math.min(1, dt * 1.5);
      var w = this.foodPh[f];
      this.foodX[f] += (this.foodVX[f] + Math.sin(t * 1.3 + w) * 0.06) * dt;
      this.foodY[f] += this.foodVY[f] * dt;
      this.foodZ[f] += (this.foodVZ[f] + Math.cos(t * 1.1 + w * 1.7) * 0.06) * dt;
      if (this.foodY[f] < floor) this.foodY[f] = floor;
    }
  };
  FlockEngine.prototype._removeFood = function (f) {
    var l = --this.foodN;
    this.foodX[f] = this.foodX[l]; this.foodY[f] = this.foodY[l]; this.foodZ[f] = this.foodZ[l];
    this.foodVX[f] = this.foodVX[l]; this.foodVY[f] = this.foodVY[l]; this.foodVZ[f] = this.foodVZ[l];
    this.foodAge[f] = this.foodAge[l]; this.foodPh[f] = this.foodPh[l]; this.foodEaten[f] = this.foodEaten[l];
  };
  FlockEngine.prototype.removeObstacle = function (id) {
    this.obstacles = this.obstacles.filter(function (o) { return o.id !== id; });
  };
  FlockEngine.prototype._updateObstacles = function (dt) {
    var P = this.params;
    for (var k = 0; k < this.obstacles.length; k++) {
      var o = this.obstacles[k];
      var dx = o.tx - o.x, dz = o.tz - o.z, d = Math.hypot(dx, dz);   // 水平移動のみ
      var maxMove = P.obsMaxSpeed * dt, ox = o.x, oy = o.y, oz = o.z;
      if (d > maxMove) { var f = maxMove / d; dx *= f; dz *= f; }
      o.x += dx; o.z += dz;
      var dh = o.targetHeight - o.height, mh = P.obsRadiusRate * 2 * dt;
      o.height += clamp(dh, -mh, mh);
      this._shapeObstacle(o);
      var a = Math.min(1, dt * 10);
      o.vx += ((o.x - ox) / dt - o.vx) * a;
      o.vy += ((o.y - oy) / dt - o.vy) * a;
      o.vz += ((o.z - oz) / dt - o.vz) * a;
      var dr = o.targetRadius - o.radius, mr = P.obsRadiusRate * dt;
      o.radius += clamp(dr, -mr, mr);
    }
  };

  /* ---------------- 成長（小集団の合流） ---------------- */
  // v0.7: 500匹より先も合流を続ける（実際の上限は maxCount＝画質の設定で決まる）
  var GROWTH_PLAN = [[0, 12], [30, 30], [90, 90], [180, 220], [270, 500], [420, 1000], [600, 2000]];
  // v0.8: ムクドリは日没までに合流し終えるよう、早めの計画（設計書 §16.7）
  var STARLING_PLAN = [[0, 12], [20, 40], [60, 120], [120, 300], [200, 600], [280, 1000], [360, 2000]];
  function growthTarget(t, plan) {
    plan = plan || GROWTH_PLAN;
    for (var i = 1; i < plan.length; i++) {
      var a = plan[i - 1], b = plan[i];
      if (t <= b[0]) return a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]);
    }
    return plan[plan.length - 1][1];
  }
  FlockEngine.prototype._updateGrowth = function (dt) {
    var g = this.growth, r = this.rng, P = this.params;
    if (this.roosting()) return;   // v0.11 ねぐら入りの間は合流しない
    g.t += dt;
    if (g.t < g.nextAt) return;
    var limit = Math.min(this.maxCount, this.cap);
    var target = Math.min(limit, growthTarget(g.t + 12, this.species === 'starling' ? STARLING_PLAN : GROWTH_PLAN));
    var want = Math.round(target - this.n);
    if (want < 3) { g.nextAt = g.t + 2; return; }
    var size = clamp(want, 4, P.growMax || 46);
    // 出現位置：画面外。左右（60%）または奥のフォグの中（40%）
    var c = this.centroid, cx, cy, cz;
    var side = r() < 0.6;
    var sc = P.spawnScale || 1;
    var dist = this.viewHalf * 1.25 + (3 + r() * 3) * sc;
    if (side) { var s = r() < 0.5 ? -1 : 1; cx = c[0] + s * dist; cz = c[2] + (r() - 0.5) * 6 * sc; }
    else { cx = c[0] + (r() - 0.5) * 8 * sc; cz = c[2] - dist * 1.4; }
    cy = c[1] + (r() - 0.5) * 4 * sc;
    // 境界の外側すぎる位置は内側へ寄せる
    var B = P.bounds, e = Math.hypot(cx / B[0], cy / B[1], cz / B[2]);
    if (e > 1.15) { var f = 1.15 / e; cx *= f; cy *= f; cz *= f; }
    var dx = c[0] - cx, dy = (c[1] - cy) * 0.3, dz = c[2] - cz, dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;
    var R0 = (0.45 * Math.cbrt(size) + 0.3) * sc, id = g.seq++;
    for (var i = 0; i < size; i++) {
      var p = this._randInBall(R0);
      this.addFish(cx + p[0], cy + p[1] * 0.6, cz + p[2],
        (dx + (r() - 0.5) * 0.3) * P.cruise, (dy + (r() - 0.5) * 0.2) * P.cruise, (dz + (r() - 0.5) * 0.3) * P.cruise, id);
    }
    g.groups++; g.lastSize = size; g.lastPos = [cx, cy, cz];
    g.nextAt = g.t + 5 + r() * 5;
  };

  /* ---------------- メイン更新 ---------------- */
  FlockEngine.prototype.step = function (dt) {
    var P = this.params, n = this.n, rng = this.rng;
    var px = this.px, py = this.py, pz = this.pz, vx = this.vx, vy = this.vy, vz = this.vz;
    var nvx = this.nvx, nvy = this.nvy, nvz = this.nvz, stress = this.stress, nstress = this.nstress;
    var flock = this.flock, grid = this.grid, keys = this._keys, head = grid.head, next = grid.next;
    this.time += dt; this.steps++;

    // 1. 入力・障害物
    this._updateObstacles(dt);
    // 2. 環境・成長
    if (this.growthEnabled) this._updateGrowth(dt);
    n = this.n;
    this._updateFood(dt);
    var feed = this.feed, nfeed = this.nfeed, foodN = this.foodN, foodX = this.foodX, foodY = this.foodY, foodZ = this.foodZ, foodEaten = this.foodEaten;
    var fcx = 0, fcy = 0, fcz = 0;
    for (var f0 = 0; f0 < foodN; f0++) { fcx += foodX[f0]; fcy += foodY[f0]; fcz += foodZ[f0]; }
    if (foodN) { fcx /= foodN; fcy /= foodN; fcz /= foodN; }
    this.ppx.set(px.subarray(0, n)); this.ppy.set(py.subarray(0, n)); this.ppz.set(pz.subarray(0, n));
    // 3. 空間ハッシュ
    if (grid.cell !== P.rCoh) grid.setCell(P.rCoh);
    grid.build(px, py, pz, n);

    var c = this.centroid, cxm = c[0], cym = c[1], czm = c[2], mainN = this.mainN;
    var rAli2 = P.rAli * P.rAli, rCoh2 = P.rCoh * P.rCoh;
    var t = this.time, B = P.bounds, reps = this.repulsors;
    // 回避用の形状を展開：t=0 球、t=1 鉛直カプセル（柱・ロープ）。m は形状ごとの余裕
    var prims = this._prims || (this._prims = []), srcs = [this.obstacles, this.landmarks], floorY = -B[1];
    prims.length = 0;
    for (var s0 = 0; s0 < 2; s0++) for (var k0 = 0; k0 < srcs[s0].length; k0++) {
      var q = srcs[s0][k0];
      if (!q.enabled) continue;
      if (q.kind === 'pillar') prims.push({ t: 1, x: q.x, y: q.y, z: q.z, y0: q.y0, y1: q.y1, r: q.radius, m: P.obsMargin, vx: q.vx, vy: 0, vz: q.vz });
      else {
        prims.push({ t: 0, x: q.x, y: q.y, z: q.z, y0: 0, y1: 0, r: q.radius, m: P.obsMargin, vx: q.vx, vy: q.vy, vz: q.vz });
        if (q.kind === 'buoy') prims.push({ t: 1, x: q.x, y: 0, z: q.z, y0: floorY, y1: q.y - q.radius, r: 0.03, m: 0.1, vx: q.vx, vy: 0, vz: q.vz });
      }
    }
    var obs = prims;
    var cosPitch = P.maxPitch, panicPitch = P.panicPitch || P.maxPitch;
    var mainR = this.spread * 1.35 + 1.0;
    // v0.8 ムクドリ：近い順の近傍・ハヤブサ・地面・平たさ
    var topoK = P.topoK | 0, knD = this._knD, knJ = this._knJ;
    var pred = this.predator, predR = P.predR || 0;
    if (pred) {
      var pvl = Math.sqrt(pred.vx * pred.vx + pred.vy * pred.vy + pred.vz * pred.vz);
      var pdx = pvl > 1e-3 ? pred.vx / pvl : 0, pdy = pvl > 1e-3 ? pred.vy / pvl : 0, pdz = pvl > 1e-3 ? pred.vz / pvl : 0;
      if (pred.R) predR = pred.R;
    }
    var floorF = P.groundY != null ? P.groundY + P.minAlt : -B[1];   // 平常時に保つ一番低い高さ
    // v0.10 止まり木の呼びかけ中：群れは止まり木の上空を回るので、最低高度と境界をゆるめる
    var site = this.site, siteOn = !!(site && site.active), bMul = 1;
    if (site && site.active) {
      site.t += dt;
      // 止まり木の空き具合（止まっている鳥と降りている途中の鳥を引く）。空きが少ないほど降りると決めにくい
      var taken = 0;
      if (site.kind !== 'roost') for (var q1 = 0; q1 < n; q1++) if (this.pst[q1] === 1 || (this.pst[q1] === 2 && this.perches[this.pseat[q1]].site === site.id) || (this.pst[q1] === 2 && site.kind === 'tree' && site.seats.indexOf(this.perches[this.pseat[q1]]) >= 0)) taken++;
      site.free = site.kind === 'roost' ? 1 : clamp((site.cap - taken) / site.cap, 0, 1);
      if (site.kind !== 'roost' && (site.t > P.siteLife || site.fails > P.siteFails)) { site.active = false; siteOn = false; }
      else { floorF = Math.min(floorF, site.oy - 8); bMul = 0.15; }
    }
    var envK = P.envScale || 1, flatten = P.flatten || 0;

    var pst = this.pst, rj = this.rj, perchedN = 0, roostedN = 0, scareP = false;
    var siteRR = siteOn && site.kind === 'roost' ? P.roostR : P.siteR;   // 回る半径（ねぐらは並木全体を回るので大きい）
    for (var i = 0; i < n; i++) {
      if (pst[i]) { if (this._perchStep(i, dt, pred)) scareP = true; if (pst[i] === 2) perchedN++; else if (pst[i] === 4) roostedN++; continue; }
      var x = px[i], y = py[i], z = pz[i];
      var ux = vx[i], uy = vy[i], uz = vz[i];
      var sp = Math.sqrt(ux * ux + uy * uy + uz * uz);
      if (!(sp > 1e-5)) { ux = this.sx[i]; uy = 0; uz = this.sz[i]; sp = Math.hypot(ux, uz) || 1; ux /= sp; uz /= sp; sp = P.minSpeed; ux *= sp; uz *= sp; }
      var fx = ux / sp, fy = uy / sp, fz = uz / sp;
      var si = stress[i];
      var rSepI = P.rSep * (1 + 0.35 * si), rSep2 = rSepI * rSepI;

      // 4-5. 近傍・分離/整列/結合
      var sX = 0, sY = 0, sZ = 0;
      var aX = fx, aY = fy, aZ = fz, aN = 1;
      var cX = 0, cY = 0, cZ = 0, cN = 0;
      var spdSum = 0, spdN = 0, nbStress = 0, nbFeed = 0, minD2 = 1e9, cnt = 0, mainNb = false;
      var m = grid.cellKeys(x, y, z, keys);
      if (topoK > 0) {
        // v0.8 ムクドリ：分離は距離で、整列と結合は「近い順に topoK 羽」で決める
        var kn = 0, nbDesc = 0;
        for (var q = 0; q < m; q++) {
          for (var j = head[keys[q]]; j !== -1; j = next[j]) {
            if (j === i) continue;
            var ddx = px[j] - x, ddy = py[j] - y, ddz = pz[j] - z;
            var d2 = ddx * ddx + ddy * ddy + ddz * ddz;
            if (d2 > rCoh2) continue;
            if (d2 < 1e-8) { sX += this.sx[i]; sY += this.sy[i]; sZ += this.sz[i]; continue; }
            if (d2 < minD2) minD2 = d2;
            if (d2 < rSep2) {
              var d = Math.sqrt(d2), w = 1 - d / rSepI;
              sX -= ddx / d * w; sY -= ddy / d * w; sZ -= ddz / d * w;
            }
            if (pst[j]) { if (pst[j] === 1) nbDesc++; continue; }   // v0.9 降りている・止まっている鳥は、空の群れの仲間にしない（v0.10 降り始めた鳥の数だけ数える）
            if (flock[j] === 0) mainNb = true;
            if (kn === topoK && d2 >= knD[kn - 1]) continue;
            if ((ddx * fx + ddy * fy + ddz * fz) < P.blindCos * Math.sqrt(d2)) continue;   // 真後ろの死角
            var pos = kn < topoK ? kn++ : topoK - 1;
            while (pos > 0 && knD[pos - 1] > d2) { knD[pos] = knD[pos - 1]; knJ[pos] = knJ[pos - 1]; pos--; }
            knD[pos] = d2; knJ[pos] = j;
          }
        }
        for (var kq = 0; kq < kn; kq++) {
          var jj = knJ[kq];
          var vjx = vx[jj], vjy = vy[jj], vjz = vz[jj], vjs = Math.sqrt(vjx * vjx + vjy * vjy + vjz * vjz);
          if (vjs > 1e-5) { aX += vjx / vjs; aY += vjy / vjs; aZ += vjz / vjs; aN++; spdSum += vjs; spdN++; }
          if (stress[jj] > nbStress) nbStress = stress[jj];
          cX += px[jj] - x; cY += py[jj] - y; cZ += pz[jj] - z; cN++;
        }
      } else
      outer:
      for (var q = 0; q < m; q++) {
        for (var j = head[keys[q]]; j !== -1; j = next[j]) {
          if (j === i) continue;
          var ddx = px[j] - x, ddy = py[j] - y, ddz = pz[j] - z;
          var d2 = ddx * ddx + ddy * ddy + ddz * ddz;
          if (d2 > rCoh2) continue;
          if (d2 < 1e-8) { sX += this.sx[i]; sY += this.sy[i]; sZ += this.sz[i]; continue; }
          if (d2 < minD2) minD2 = d2;
          var d = Math.sqrt(d2);
          if (d2 < rSep2) {
            var w = 1 - d / rSepI;
            sX -= ddx / d * w; sY -= ddy / d * w; sZ -= ddz / d * w;
          }
          if (flock[j] === 0) mainNb = true;
          var cosA = (ddx * fx + ddy * fy + ddz * fz) / d;
          if (cosA < P.blindCos) continue;
          if (d2 < rAli2) {
            var vjx = vx[j], vjy = vy[j], vjz = vz[j], vjs = Math.sqrt(vjx * vjx + vjy * vjy + vjz * vjz);
            if (vjs > 1e-5) { aX += vjx / vjs; aY += vjy / vjs; aZ += vjz / vjs; aN++; spdSum += vjs; spdN++; }
            if (stress[j] > nbStress) nbStress = stress[j];
            if (feed[j] > nbFeed) nbFeed = feed[j];
          }
          cX += ddx; cY += ddy; cZ += ddz; cN++;
          if (++cnt >= P.maxNeighbors) break outer;
        }
      }
      this.nn[i] = minD2 < 1e9 ? Math.sqrt(minD2) : -1;

      var sepMag = Math.sqrt(sX * sX + sY * sY + sZ * sZ);
      var kSep = sepMag > 1 ? 1 : sepMag;

      // Vicsek型整列：局所平均方向＋ノイズ。平均ベクトルが短い（向きが割れている）ときは採用しない
      var Ax = fx, Ay = fy, Az = fz;
      var order = Math.sqrt(aX * aX + aY * aY + aZ * aZ) / aN;
      if (aN === 1 || order > 0.12) {
        var nz = P.noise * 2;
        var mx = aX / aN + (rng() - 0.5) * nz, my = aY / aN + (rng() - 0.5) * nz * 0.5, mz = aZ / aN + (rng() - 0.5) * nz;
        var ml = Math.sqrt(mx * mx + my * my + mz * mz);
        if (ml > 1e-4) { Ax = mx / ml; Ay = my / ml; Az = mz / ml; }
      }

      // 結合
      var Cx = 0, Cy = 0, Cz = 0;
      if (cN > 0) {
        var gx = cX / cN, gy = cY / cN, gz = cZ / cN, gl = Math.sqrt(gx * gx + gy * gy + gz * gz);
        if (gl > 1e-5) { var ramp = gl / (topoK ? P.rSep * 1.5 : P.rCoh * 0.5); if (ramp > 1) ramp = 1; Cx = gx / gl * ramp; Cy = gy / gl * ramp; Cz = gz / gl * ramp; }
        this.iso[i] = 0;
      } else this.iso[i] += dt;

      // 接近中の小集団・孤立個体の弱い再合流補助
      var Gx = 0, Gy = 0, Gz = 0;
      // v0.8 ムクドリ：群れの中心から離れた個体ほど、弱く中心へ寄る（分かれた群れが再び1つに戻る）
      if (P.wCenter && mainN > 0 && flock[i] === 0) {
        var kx = cxm - x, ky = (cym - y) * 0.3, kz = czm - z, kl = Math.sqrt(kx * kx + ky * ky + kz * kz) || 1;
        var kOut = kl / (this.spread * 1.2 + 4) - 1;
        if (this.rj[i] > 0) {   // v0.9 飛び立った直後：空に残っていた鳥を1羽目印にして追いかけ、群れに混ざるまで（最長15秒）
          var an = this.anchor[i];
          if (an < 0 || an >= n || this.pst[an] || this.rj[an] > 0) an = this.anchor[i] = this._pickAnchor();
          if (an >= 0) {
            var rx_ = px[an] + vx[an] * 0.5 - x, ry_ = py[an] + vy[an] * 0.5 - y, rz_ = pz[an] + vz[an] * 0.5 - z, rl_ = Math.sqrt(rx_ * rx_ + ry_ * ry_ + rz_ * rz_) || 1;
            if (rl_ < 3) this.rj[i] = 0;
            Gx += rx_ / rl_ * 2.0; Gy += ry_ / rl_ * 2.0; Gz += rz_ / rl_ * 2.0;
          }
          this.rj[i] -= dt;
        }
        else if (kOut > 0) { var kw = (kOut > 1 ? 1 : kOut) * P.wCenter; Gx += kx / kl * kw; Gy += ky / kl * kw; Gz += kz / kl * kw; }
      }
      // v0.10 止まり木の呼びかけ中：上空を回り、降りると決める（降り始めた仲間が近くに多いほど決めやすい）
      if (siteOn && flock[i] === 0 && !(this.rj[i] > 0)) {
        var ox_ = site.ox - x, oz_ = site.oz - z, oh = Math.sqrt(ox_ * ox_ + oz_ * oz_) || 1, rad = clamp((oh - siteRR) / siteRR, -1, 1);
        Gx += ox_ / oh * rad * 1.2 - oz_ / oh * 0.9 * site.dir; Gz += oz_ / oh * rad * 1.2 + ox_ / oh * 0.9 * site.dir;
        Gy += clamp((site.oy - y) / 8, -1, 1) * 1.0;
        if (this.cool[i] > 0) this.cool[i] -= dt;
        else if (site.t > (site.kind === 'roost' ? P.roostDelay : P.landDelay)) {
          var above = oh < siteRR * 1.4 && Math.abs(y - site.oy) < 10, nearSite = oh < siteRR * 2.5;
          var rate = site.kind === 'roost'
            // v0.11 ねぐら：時間とともに決めやすくなり、近くに降り始めた仲間がいると続く（細い流れになる）。最後は全員が降りる
            ? (nearSite ? (P.roostBase + P.roostRamp * site.t + (site.t > P.roostEnd ? 0.5 : 0)) * (1 + P.roostQuorum * Math.min(4, nbDesc)) : (site.t > P.roostEnd ? 0.2 : 0))
            : nearSite ? (P.landBase + (above ? P.landNear : 0) + P.landQuorum * Math.min(1, nbDesc * nbDesc / 4)) * (site.free > 0.04 ? Math.min(1, site.free * 1.5) : 0) : 0;   // 止まり木の近くに来てから決める。空きが少ないと決めにくい
          if (rng() < rate * dt) { this._startDescent(i); continue; }
        }
      }
      if (mainN > 0 && (flock[i] !== 0 || this.iso[i] > 1.5)) {
        var hx = cxm - x, hy = (cym - y) * 0.5, hz = czm - z, hl = Math.sqrt(hx * hx + hy * hy + hz * hz);
        if (hl > 1e-3) {
          var gw = flock[i] !== 0 ? 0.9 : 0.45 * Math.min(1, this.iso[i] - 1.5);
          Gx = hx / hl * gw; Gy = hy / hl * gw; Gz = hz / hl * gw;
        }
        if (flock[i] !== 0) {
          var inMain = mainNb || hl < mainR * 0.6;
          this.joinT[i] = inMain ? this.joinT[i] + dt : Math.max(0, this.joinT[i] - dt * 0.5);
        }
      }

      // 6a. 指への忌避（カプセル状、奥行き方向は別の厚み）
      var Tx = 0, Ty = 0, Tz = 0, tU = 0;
      for (var r = 0; r < reps.length; r++) {
        var rp = reps[r];
        if (rp.s < 0.002) continue;
        var abx = rp.bx - rp.ax, aby = rp.by - rp.ay, abz = rp.bz - rp.az;
        var ab2 = abx * abx + aby * aby + abz * abz, tt = 0;
        if (ab2 > 1e-8) { tt = ((x - rp.ax) * abx + (y - rp.ay) * aby + (z - rp.az) * abz) / ab2; tt = tt < 0 ? 0 : tt > 1 ? 1 : tt; }
        var dqx = x - (rp.ax + abx * tt), dqy = y - (rp.ay + aby * tt), dqz = z - (rp.az + abz * tt);
        var dzz = dqx * rp.fx + dqy * rp.fy + dqz * rp.fz;
        var lx = dqx - dzz * rp.fx, ly = dqy - dzz * rp.fy, lz = dqz - dzz * rp.fz;
        var dEff2 = lx * lx + ly * ly + lz * lz + (dzz * rp.R / rp.depth) * (dzz * rp.R / rp.depth);
        if (dEff2 >= rp.R * rp.R) continue;
        var str = smoothstep(rp.R, rp.R * 0.35, Math.sqrt(dEff2)) * rp.s;
        var ex = lx + dzz * rp.fx * 0.5, ey = ly + dzz * rp.fy * 0.5, ez = lz + dzz * rp.fz * 0.5;
        var el = Math.sqrt(ex * ex + ey * ey + ez * ez);
        if (el < 1e-4) {      // 中心で距離ゼロ → 進行方向と視線の外積で横へ
          ex = fy * rp.fz - fz * rp.fy; ey = fz * rp.fx - fx * rp.fz; ez = fx * rp.fy - fy * rp.fx;
          el = Math.sqrt(ex * ex + ey * ey + ez * ez);
          if (el < 1e-4) { ex = this.sx[i]; ey = this.sy[i]; ez = this.sz[i]; el = 1; }
        }
        Tx += ex / el * str; Ty += ey / el * str; Tz += ez / el * str;
        if (str > tU) tU = str;
      }

      // 6a'. ハヤブサ（v0.8）：通り道から横へ、ハヤブサから遠ざかる向きへ逃げる
      if (pred) {
        // 少し先（predLead 秒後）のハヤブサの位置を見て逃げる（速いハヤブサに間に合うように）
        var rx = x - pred.x - pred.vx * P.predLead, ry = y - pred.y - pred.vy * P.predLead, rz = z - pred.z - pred.vz * P.predLead, rd2 = rx * rx + ry * ry + rz * rz;
        if (rd2 < predR * predR) {
          var rd = Math.sqrt(rd2) || 1e-4, along = rx * pdx + ry * pdy + rz * pdz;
          var lx2 = rx - along * pdx, ly2 = ry - along * pdy, lz2 = rz - along * pdz;
          var ex2 = lx2 + rx / rd * 0.6 * rd, ey2 = ly2 + ry / rd * 0.6 * rd, ez2 = lz2 + rz / rd * 0.6 * rd;
          var el2 = Math.sqrt(ex2 * ex2 + ey2 * ey2 + ez2 * ez2);
          if (el2 < 1e-4) { ex2 = this.sx[i]; ey2 = this.sy[i]; ez2 = this.sz[i]; el2 = 1; }
          var pstr = smoothstep(predR, predR * 0.25, rd);
          Tx += ex2 / el2 * pstr; Ty += ey2 / el2 * pstr; Tz += ez2 / el2 * pstr;
          if (pstr > tU) tU = pstr;
        }
      }

      // 6b. 障害物の予測回避
      var Ox = 0, Oy = 0, Oz = 0, oU = 0;
      for (var k = 0; k < obs.length; k++) {
        var o = obs[k];
        var cy0 = o.t === 1 ? (y < o.y0 ? o.y0 : y > o.y1 ? o.y1 : y) : o.y;   // 柱・ロープは軸上の最も近い点
        var Re = o.r + o.m + P.bodyRadius;
        var ocx = o.x - x, ocy = cy0 - y, ocz = o.z - z;
        var od = Math.sqrt(ocx * ocx + ocy * ocy + ocz * ocz);
        var reach = Re + sp * P.lookAhead + 1.0;
        if (od > reach) continue;
        // 近接：最短方向へ外向き
        var near = Re + 0.45;
        if (od < near) {
          var u = (near - od) / (near - o.r);
          if (u > 1) u = 1;
          if (od > 1e-5) { Ox -= ocx / od * u * 1.4; Oy -= ocy / od * u * 1.4; Oz -= ocz / od * u * 1.4; }
          else { Ox += this.sx[i]; Oy += this.sy[i]; Oz += this.sz[i]; }
          if (u > oU) oU = u;
        }
        // 予測：相対速度での進路と球の距離
        var rvx = ux - o.vx, rvy = uy - o.vy, rvz = uz - o.vz, rs = Math.sqrt(rvx * rvx + rvy * rvy + rvz * rvz);
        if (rs < 1e-4) continue;
        rvx /= rs; rvy /= rs; rvz /= rs;
        var tp = ocx * rvx + ocy * rvy + ocz * rvz;
        var L = rs * P.lookAhead + Re;
        if (tp <= 0 || tp > L + Re) continue;
        var latx = rvx * tp - ocx, laty = rvy * tp - ocy, latz = rvz * tp - ocz;
        var ld = Math.sqrt(latx * latx + laty * laty + latz * latz);
        if (ld >= Re) continue;
        if (ld < 1e-3) { // 真正面：個体ごとの好み側（進行方向に垂直化）
          var dp = this.sx[i] * rvx + this.sy[i] * rvy + this.sz[i] * rvz;
          latx = this.sx[i] - rvx * dp; laty = this.sy[i] - rvy * dp; latz = this.sz[i] - rvz * dp;
          ld = Math.sqrt(latx * latx + laty * laty + latz * latz) || 1;
        }
        var urg = (1 - ld / Re) * 0.5 + (1 - clamp((tp - Re) / L, 0, 1)) * 0.5;
        // 横へ（側方の余地が少なければ上下成分も含めて）外周を回る
        Ox += latx / ld * urg; Oy += laty / ld * urg; Oz += latz / ld * urg;
        if (urg > oU) oU = urg;
      }

      // 6c. 環境流（低振幅・時間変化する3Dフローフィールド）
      var ex_ = x * envK, ey_ = y * envK, ez_ = z * envK;
      var Ex = 0.5 * (Math.sin(0.21 * ey_ + 0.13 * t + 1.3) + Math.sin(0.17 * ez_ - 0.071 * t));
      var Ey = 0.2 * (Math.sin(0.19 * ex_ + 0.11 * t + 2.1) + Math.sin(0.23 * ez_ + 0.053 * t));
      var Ez = 0.5 * (Math.sin(0.18 * ex_ - 0.093 * t + 0.4) + Math.sin(0.15 * ey_ + 0.12 * t + 0.7));

      // 6d. ソフト境界（楕円体。近づくほど内向き）
      var Bx = 0, By = 0, Bz = 0;
      var qx = x / B[0], qy = y / B[1], qz = z / B[2], e = Math.sqrt(qx * qx + qy * qy + qz * qz);
      if (e > 0.7) {
        var bx = -x / (B[0] * B[0]), by = -y / (B[1] * B[1]), bz = -z / (B[2] * B[2]), bl = Math.sqrt(bx * bx + by * by + bz * bz) || 1;
        var bs = smoothstep(0.7, 1.25, e);
        Bx = bx / bl * bs; By = by / bl * bs; Bz = bz / bl * bs;
      }
      // 6d'. 海底（v0.6）：海底に近づくと上向きに舵を切る（海底より下へ潜らない）
      var hFl = y - floorF;
      if (hFl < P.floorGuard) By += 1.5 * (1 - (hFl > 0 ? hFl : 0) / P.floorGuard);
      // 平たい群れ（v0.8 ムクドリ）：上下の動きを弱める
      if (flatten) By -= fy * flatten;

      // 6e. 餌：近くの餌粒へ向かう。興奮（feed）は近傍へ伝わり、遠くの仲間も餌の方へ集まる
      var Fx = 0, Fy = 0, Fz = 0, fe = feed[i], feT = nbFeed * 0.8;
      if (foodN > 0) {
        var bestF = P.foodRange * P.foodRange, bj = -1;
        for (var f = 0; f < foodN; f++) {
          if (foodEaten[f]) continue;
          var qx = foodX[f] - x, qy = foodY[f] - y, qz = foodZ[f] - z, q2 = qx * qx + qy * qy + qz * qz;
          if (q2 < bestF) { bestF = q2; bj = f; }
        }
        if (bj >= 0) {
          var fd = Math.sqrt(bestF) || 1e-4;
          Fx = (foodX[bj] - x) / fd; Fy = (foodY[bj] - y) / fd; Fz = (foodZ[bj] - z) / fd;
          var feNear = 0.65 + 0.35 * (1 - fd / P.foodRange);
          if (feNear > feT) feT = feNear;
          if (fd < P.eatDist && rng() < P.biteProb) { foodEaten[bj] = 1; this.eaten++; fe = 1; }
        } else if (fe > 0.15) {
          var gx = fcx - x, gy = fcy - y, gz = fcz - z, gl = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
          Fx = gx / gl * 0.6; Fy = gy / gl * 0.6; Fz = gz / gl * 0.6;
        }
      }
      if (feT > fe) fe += (feT - fe) * Math.min(1, dt * 3); else fe -= fe * P.feedDecay * dt;
      nfeed[i] = fe < 0 ? 0 : fe > 1 ? 1 : fe;

      // 合成（Couzin型：分離・回避が強いときは整列/結合を弱める）
      var urgAll = tU > oU ? tU : oU;
      var calm = 1 - 0.75 * urgAll;
      var wA = P.wAli * (1 - 0.6 * kSep) * calm * (1 + 0.6 * si) * (1 - 0.65 * fe);   // 餌に興奮すると隊列が崩れる
      var wC = P.wCoh * (1 - 0.85 * kSep) * calm * (1 - 0.5 * si) * (1 - 0.6 * fe);
      var wE = P.wEnv * (1 - urgAll);
      var wB = P.wBound * bMul;
      var Dx = P.wInertia * fx + P.wSep * (1 + si) * sX + wA * Ax + wC * Cx + P.wTouch * Tx + P.wObs * Ox + wE * Ex + wB * Bx + P.wGather * Gx;
      var Dy = P.wInertia * fy + P.wSep * (1 + si) * sY + wA * Ay + wC * Cy + P.wTouch * Ty + P.wObs * Oy + wE * Ey + wB * By + P.wGather * Gy;
      var Dz = P.wInertia * fz + P.wSep * (1 + si) * sZ + wA * Az + wC * Cz + P.wTouch * Tz + P.wObs * Oz + wE * Ez + wB * Bz + P.wGather * Gz;
      if (fe > 0.01 || Fx || Fy || Fz) {   // 餌へ向かう力＋興奮による小刻みな方向転換
        var wF = P.wFood * (0.35 + 0.65 * fe) * calm, jit = fe * 0.7;
        Dx += wF * Fx + jit * (rng() - 0.5) * 2; Dy += wF * Fy + jit * (rng() - 0.5); Dz += wF * Fz + jit * (rng() - 0.5) * 2;
      }

      // 7. 旋回角速度の制限
      var Dl = Math.sqrt(Dx * Dx + Dy * Dy + Dz * Dz), tx, ty, tz;
      if (Dl < 1e-6) { tx = fx; ty = fy; tz = fz; } else { tx = Dx / Dl; ty = Dy / Dl; tz = Dz / Dl; }
      var panic = si > tU ? si : tU;
      var turnMax = (P.maxTurn + (P.panicTurn - P.maxTurn) * Math.max(panic, oU, fe * 0.6)) * dt;
      var cs = fx * tx + fy * ty + fz * tz, nx, ny, nzz;
      if (cs >= Math.cos(turnMax)) { nx = tx; ny = ty; nzz = tz; }
      else {
        var ppx_ = tx - fx * cs, ppy_ = ty - fy * cs, ppz_ = tz - fz * cs, pl = Math.sqrt(ppx_ * ppx_ + ppy_ * ppy_ + ppz_ * ppz_);
        if (pl < 1e-5) { // ほぼ真後ろ：瞬間反転は禁止。好み側へ旋回
          var dps = this.sx[i] * fx + this.sy[i] * fy + this.sz[i] * fz;
          ppx_ = this.sx[i] - fx * dps; ppy_ = (this.sy[i] - fy * dps) * 0.3; ppz_ = this.sz[i] - fz * dps;
          pl = Math.sqrt(ppx_ * ppx_ + ppy_ * ppy_ + ppz_ * ppz_);
          if (pl < 1e-5) { ppx_ = -fz; ppy_ = 0; ppz_ = fx; pl = Math.sqrt(ppx_ * ppx_ + ppz_ * ppz_) || 1; }
        }
        ppx_ /= pl; ppy_ /= pl; ppz_ /= pl;
        var ca = Math.cos(turnMax), sa = Math.sin(turnMax);
        nx = fx * ca + ppx_ * sa; ny = fy * ca + ppy_ * sa; nzz = fz * ca + ppz_ * sa;
      }
      // 魚は真上・真下へは泳がない（ムクドリは驚いたときだけ上下に大きく向ける）
      var pitchI = cosPitch + (panicPitch - cosPitch) * panic;
      if (ny > pitchI || ny < -pitchI) {
        ny = ny > 0 ? pitchI : -pitchI;
        var hz2 = Math.sqrt(nx * nx + nzz * nzz);
        var hs = Math.sqrt(1 - ny * ny) / (hz2 > 1e-6 ? hz2 : 1);
        if (hz2 < 1e-6) { nx = fx; nzz = fz; hz2 = Math.sqrt(nx * nx + nzz * nzz) || 1; hs = Math.sqrt(1 - ny * ny) / hz2; }
        nx *= hs; nzz *= hs;
      }

      // 速度
      var target = P.cruise * this.speedBias[i];
      if (spdN > 0) target += (spdSum / spdN - target) * P.speedMatch;
      target += (P.panicSpeed - P.cruise) * (panic + 0.35 * fe) + 0.8 * oU;
      if (rj[i] > 0) target += P.cruise * 0.45;   // v0.9 飛び立った鳥は、群れに追いつくまで速めに飛ぶ
      target = clamp(target, P.minSpeed, P.panicSpeed);
      var acc = (P.maxAccel + (P.panicAccel - P.maxAccel) * Math.max(panic, fe * 0.5)) * dt;
      var ns = sp + clamp(target - sp, -acc, acc);
      ns = clamp(ns, P.minSpeed, P.panicSpeed);
      nvx[i] = nx * ns; nvy[i] = ny * ns; nvz[i] = nzz * ns;

      // 8. 反応状態（stress）：直接刺激＋近傍からの警戒伝達＋減衰
      var st = si, direct = tU * this.resp[i];
      if (direct > st) st += (direct - st) * Math.min(1, dt * 14);
      var alarmT = nbStress * P.alarmGain;
      if (alarmT > st) st += (alarmT - st) * Math.min(1, dt * P.alarm);
      st -= st * P.stressDecay * dt;
      nstress[i] = st < 0 ? 0 : st > 1 ? 1 : st;
    }

    // 積分・後処理
    var joinedNow = 0, maxS = 0;
    for (i = 0; i < n; i++) {
      if (pst[i]) { if (flock[i] === 0 && pst[i] !== 4) joinedNow++; continue; }
      var X = px[i] + nvx[i] * dt, Y = py[i] + nvy[i] * dt, Z = pz[i] + nvz[i] * dt;
      var VX = nvx[i], VY = nvy[i], VZ = nvz[i];
      // めり込み防止（最後の保険）：最短方向へ段階的に押し出す
      var ins = 0;
      for (k = 0; k < obs.length; k++) {
        o = obs[k];
        var rr = o.r + P.bodyRadius, cyP = o.t === 1 ? (Y < o.y0 ? o.y0 : Y > o.y1 ? o.y1 : Y) : o.y;
        var ox = X - o.x, oy = Y - cyP, oz = Z - o.z, dd = Math.sqrt(ox * ox + oy * oy + oz * oz);
        if (dd >= rr) continue;
        ins = 1;
        if (dd < 1e-5) { ox = this.sx[i]; oy = this.sy[i]; oz = this.sz[i]; dd = 1e-5; }
        var nxo = ox / dd, nyo = oy / dd, nzo = oz / dd, pen = rr - dd;
        var push = Math.max(Math.min(pen, 0.06), pen * 0.5);
        X += nxo * push; Y += nyo * push; Z += nzo * push;
        var vin = VX * nxo + VY * nyo + VZ * nzo;
        if (vin < 0) { VX -= vin * nxo; VY -= vin * nyo; VZ -= vin * nzo; }
      }
      if (ins && !this.inside[i]) this.intrusions++;
      this.inside[i] = ins;
      // 海底より下へは出さない（最後の保険。v0.6）
      var flMin = P.groundY != null ? floorF : P.bodyRadius - P.bounds[1];   // v0.10 呼びかけ中は floorF が下がっている
      if (py[i] < flMin) { if (Y < py[i]) { Y = py[i]; if (VY < 0) VY = 0; } }   // v0.9 止まり木から飛び立った鳥：下がらずに上昇させる
      else if (Y < flMin) { Y = flMin; if (VY < 0) VY = 0; }
      // NaN・無限大のガード
      if (!(isFinite(X) && isFinite(Y) && isFinite(Z) && isFinite(VX) && isFinite(VY) && isFinite(VZ))) {
        X = cxm + (this.rng() - 0.5); Y = cym + (this.rng() - 0.5); Z = czm + (this.rng() - 0.5);
        VX = this.sx[i] * P.cruise; VY = 0; VZ = this.sz[i] * P.cruise;
      }
      px[i] = X; py[i] = Y; pz[i] = Z; vx[i] = VX; vy[i] = VY; vz[i] = VZ;
      stress[i] = nstress[i]; feed[i] = nfeed[i];
      if (nstress[i] > maxS) maxS = nstress[i];
      var spd = Math.sqrt(VX * VX + VY * VY + VZ * VZ);
      this.phase[i] += dt * (9 + spd * 4.5);
      if (this.phase[i] > 6283.18) this.phase[i] -= 6283.18;
      if (flock[i] !== 0 && this.joinT[i] > 1.0) flock[i] = 0;
      if (flock[i] === 0) joinedNow++;
    }
    this.joined = joinedNow;
    this.stats.maxStress = maxS;
    this.perchedN = perchedN; this.roostedN = roostedN;
    if (scareP && pred) this.scarePerched(pred.x, pred.y, pred.z);
    this._updateCentroid();
  };

  // v0.9 飛び立った鳥の目印：空に残っていた鳥から1羽を選ぶ
  FlockEngine.prototype._pickAnchor = function () {
    for (var k = 0; k < 30; k++) { var j = Math.floor(this.rng() * this.n); if (!this.pst[j] && !(this.rj[j] > 0) && this.flock[j] === 0) return j; }
    return -1;
  };

  // v0.9 止まり木の鳥を1歩進める。ハヤブサが近づいたら true を返す（全員を飛び立たせる合図）
  FlockEngine.prototype._perchStep = function (i, dt, pred) {
    var P = this.params, st = this.pst[i], seat = this.pseat[i] >= 0 ? this.perches[this.pseat[i]] : null;
    var x = this.px[i], y = this.py[i], z = this.pz[i];
    this.ppx[i] = x; this.ppy[i] = y; this.ppz[i] = z;
    this.nstress[i] = this.stress[i] = 0; this.nfeed[i] = 0;
    if (st === 4) return false;   // v0.11 ねぐらの木の中（見えない・動かない）
    var scared = !!(pred && st !== 3 && Math.hypot(pred.x - x, pred.y - y, pred.z - z) < P.perchScareR);
    if (st === 1 && !seat) {   // v0.10 降りる途中（席はまだない）：止まり木へ向かい、近くまで来たら空きを探す
      var site = this.site;
      if (!site) { this._abortDescent(i); return scared; }
      var tx, ty, tz;
      if (site.kind === 'wire') { var wq = this._wireAt(site, this.dw[i], this.ds[i], this._nq || (this._nq = {})); tx = wq.x; ty = wq.y + 0.09; tz = wq.z; }   // 決めたときに選んだ、空いていそうな所へ
      else { tx = this.dtx[i]; ty = this.dty[i]; tz = this.dtz[i]; }
      var ddx = tx - x, ddy = ty - y, ddz = tz - z, dd = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
      var isRoost = site.kind === 'roost';
      if (isRoost && dd < P.roostIn) { this.pst[i] = 4; this.vx[i] = this.vy[i] = this.vz[i] = 0; return false; }   // v0.11 木の中に入った
      if (!isRoost && dd < P.claimR) { if (!this._claim(i)) { this._abortDescent(i); return scared; } return scared; }
      var lift0 = dd > 8 ? Math.min(dd * (isRoost ? 0.08 : 0.2) * this.resp[i], 7) : 0, ty0 = ddy + lift0, tl0 = Math.sqrt(ddx * ddx + ty0 * ty0 + ddz * ddz) || 1;
      var vmax = P.cruise * (0.55 + 0.45 * (this.resp[i] - 0.75) * 2);   // 降りる速さは鳥ごとに違う（巡航の55〜100%）。着く時刻がばらける
      var sp0 = clamp(dd * 0.9, 3, vmax), k0 = Math.min(1, dt * 2.5);   // 近づくと減速
      var ux0 = ddx / tl0, uy0 = ty0 / tl0, uz0 = ddz / tl0;
      if (isRoost) {   // v0.11 木の真上を回りながら降りる（渦）。近づくほど回る成分を弱めて、まっすぐ入る
        var hd0 = Math.sqrt(ddx * ddx + ddz * ddz) || 1, sw = P.swirl * clamp((hd0 - 2) / 12, 0, 1) * site.dir;
        ux0 -= ddz / hd0 * sw; uz0 += ddx / hd0 * sw;
        var ul0 = Math.sqrt(ux0 * ux0 + uy0 * uy0 + uz0 * uz0) || 1; ux0 /= ul0; uy0 /= ul0; uz0 /= ul0;
      }
      this.vx[i] += (ux0 * sp0 - this.vx[i]) * k0; this.vy[i] += (uy0 * sp0 - this.vy[i]) * k0; this.vz[i] += (uz0 * sp0 - this.vz[i]) * k0;
      var ny0 = y + this.vy[i] * dt;
      if (ny0 < P.groundY + P.bodyRadius) ny0 = P.groundY + P.bodyRadius;
      this.px[i] = x + this.vx[i] * dt; this.py[i] = ny0; this.pz[i] = z + this.vz[i] * dt;
      return scared;
    }
    if (st === 1) {   // 席へ向かう：遠いうちは席の少し上を狙い、ゆるい弧を描いて降りる
      var dx = seat.x - x, dy = seat.y - y, dz = seat.z - z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 0.3) { this.pst[i] = 2; this.px[i] = seat.x; this.py[i] = seat.y; this.pz[i] = seat.z; this.vx[i] = seat.fx * 0.01; this.vy[i] = 0; this.vz[i] = seat.fz * 0.01; return scared; }
      var lift = d > 6 ? Math.min(d * 0.25, 10) : 0, ty = dy + lift, tl = Math.sqrt(dx * dx + ty * ty + dz * dz) || 1;
      var sp = clamp(d * 0.9, 1.2, P.cruise), k = Math.min(1, dt * 4);
      this.vx[i] += (dx / tl * sp - this.vx[i]) * k; this.vy[i] += (ty / tl * sp - this.vy[i]) * k; this.vz[i] += (dz / tl * sp - this.vz[i]) * k;
      var nx = x + this.vx[i] * dt, ny = y + this.vy[i] * dt, nz = z + this.vz[i] * dt;
      if (ny < P.groundY + P.bodyRadius) ny = P.groundY + P.bodyRadius;   // 地面より下へは行かない
      this.px[i] = nx; this.py[i] = ny; this.pz[i] = nz;
    } else if (st === 2) {   // 止まっている：席に留まり、ときどき向きを少し変える
      this.px[i] = seat.x; this.py[i] = seat.y; this.pz[i] = seat.z;
      if (this.rng() < dt * 0.15) { var a = (this.rng() - 0.5) * 0.6, ca = Math.cos(a), sa = Math.sin(a), fx = seat.fx; seat.fx = fx * ca - seat.fz * sa; seat.fz = fx * sa + seat.fz * ca; }
      this.vx[i] = seat.fx * 0.01; this.vy[i] = 0; this.vz[i] = seat.fz * 0.01;
    } else {   // 飛び立ち待ち：遅れの時間がたったら、前へ・上へ飛び立つ
      this.ptk[i] -= dt;
      if (this.ptk[i] <= 0) {
        seat.bird = -1; this.pst[i] = 0; this.stress[i] = 0.7; this.rj[i] = 15; this.anchor[i] = -1;
        this.vx[i] = seat.fx * 5 + (this.rng() - 0.5) * 2; this.vy[i] = 6 + this.rng() * 2; this.vz[i] = seat.fz * 5 + (this.rng() - 0.5) * 2;
      }
    }
    return scared;
  };

  FlockEngine.prototype._updateCentroid = function () {
    var n = this.n, sx = 0, sy = 0, sz = 0, m = 0;
    var pst = this.pst;
    for (var i = 0; i < n; i++) if (this.flock[i] === 0 && !pst[i]) { sx += this.px[i]; sy += this.py[i]; sz += this.pz[i]; m++; }
    if (m === 0) { this.mainN = 0; return; }   // v0.11 全員が木の中：中心は最後の位置のまま
    sx /= m; sy /= m; sz /= m;
    var s2 = 0;
    for (i = 0; i < n; i++) if (this.flock[i] === 0 && !pst[i]) {
      var dx = this.px[i] - sx, dy = this.py[i] - sy, dz = this.pz[i] - sz;
      s2 += dx * dx + dy * dy + dz * dz;
    }
    this.centroid[0] = sx; this.centroid[1] = sy; this.centroid[2] = sz;
    this.spread = Math.sqrt(s2 / m);
    this.mainN = m;
  };

  /* ---------------- 観察指標（開発者表示） ---------------- */
  FlockEngine.prototype.analyze = function () {
    var n = this.n, P = this.params;
    this._updateCentroid();
    var hx = 0, hy = 0, hz = 0, m = 0, nnSum = 0, nnN = 0, nnMin = 1e9, spSum = 0;
    for (var i = 0; i < n; i++) {
      var s = Math.hypot(this.vx[i], this.vy[i], this.vz[i]);
      spSum += s;
      if (this.flock[i] === 0 && s > 1e-6 && !this.pst[i]) { hx += this.vx[i] / s; hy += this.vy[i] / s; hz += this.vz[i] / s; m++; }
      if (this.nn[i] > 0) { nnSum += this.nn[i]; nnN++; if (this.nn[i] < nnMin) nnMin = this.nn[i]; }
    }
    // 連結成分（近傍グラフ: 距離 < rAli）
    var parent = new Int32Array(n);
    for (i = 0; i < n; i++) parent[i] = i;
    function find(a) { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; }
    var grid = this.grid, keys = this._keys, r2 = P.rAli * P.rAli;
    grid.build(this.px, this.py, this.pz, n);
    for (i = 0; i < n; i++) {
      var k = grid.cellKeys(this.px[i], this.py[i], this.pz[i], keys);
      for (var q = 0; q < k; q++) for (var j = grid.head[keys[q]]; j !== -1; j = grid.next[j]) {
        if (j <= i || this.pst[i] || this.pst[j]) continue;
        var dx = this.px[j] - this.px[i], dy = this.py[j] - this.py[i], dz = this.pz[j] - this.pz[i];
        if (dx * dx + dy * dy + dz * dz < r2) { var a = find(i), b = find(j); if (a !== b) parent[a] = b; }
      }
    }
    // 小さな断片（3匹未満）は数えない
    var sizes = new Map();
    for (i = 0; i < n; i++) { if (this.pst[i]) continue; var rt = find(i); sizes.set(rt, (sizes.get(rt) || 0) + 1); }
    var comps = 0; sizes.forEach(function (v) { if (v >= 3) comps++; });
    var st = this.stats;
    st.P = m ? Math.hypot(hx, hy, hz) / m : 0;
    st.meanNN = nnN ? nnSum / nnN : 0;
    st.minNN = nnN ? nnMin : 0;
    st.radius = this.spread;
    st.components = comps;
    st.meanSpeed = n ? spSum / n : 0;
    return st;
  };

  var api = { FlockEngine: FlockEngine, SARDINE: SARDINE, STARLING: STARLING, SPECIES: SPECIES, smoothstep: smoothstep, growthTarget: growthTarget, VERSION: ENGINE_VERSION };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FLOCK = api;
})(typeof window !== 'undefined' ? window : this);
