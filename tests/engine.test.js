/*
 * FLOCK 群れエンジンの自動テスト（Node.js だけで動く。描画なし）
 *   実行: node tests/engine.test.js   （または npm test）
 *   乱数シードを固定しているので、同じコードなら毎回同じ結果になる。
 *   しきい値は「明らかな破綻を検出する」ための緩めの値。挙動を調整したら結果を見て見直すこと。
 */
'use strict';
const { FlockEngine } = require('../src/engine.js');

const DT = 1 / 30;
let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'OK  ' : 'NG  '} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed++;
}
function run(e, sec, each) { for (let s = 0; s < Math.round(sec / DT); s++) { e.step(DT); if (each) each(s); } }
function hasNaN(e) { for (let i = 0; i < e.n; i++) if (!isFinite(e.px[i] + e.py[i] + e.pz[i] + e.vx[i] + e.vy[i] + e.vz[i])) return true; return false; }
function heading(e) { let x = 0, z = 0; for (let i = 0; i < e.n; i++) { x += e.vx[i]; z += e.vz[i]; } const l = Math.hypot(x, z) || 1; return [x / l, z / l]; }

// T01 放置：自律群泳が続き、まとまりを保つ
{
  const e = new FlockEngine({ seed: 42, growth: false });
  let maxComp = 0, minP = 1;
  run(e, 120, s => { if (s % 90 === 0) { e.analyze(); maxComp = Math.max(maxComp, e.stats.components); minP = Math.min(minP, e.stats.P); } });
  e.analyze();
  check('T01 放置120秒でNaNなし', !hasNaN(e));
  check('T01 群れが1つにまとまっている（終了時）', e.stats.components === 1, `連結成分=${e.stats.components}`);
  check('T01 向きがそろっている（偏極度>0.7）', e.stats.P > 0.7, `P=${e.stats.P.toFixed(2)}`);
}

// T02 群れの中心をタップ：近い魚ほど先に強く反応し、全体は一斉に逃げない
{
  const e = new FlockEngine({ seed: 7, growth: false });
  run(e, 20);
  const c = e.centroid.slice(), R = 0.8;
  const dist = Array.from({ length: e.n }, (_, i) => Math.hypot(e.px[i] - c[0], e.py[i] - c[1], e.pz[i] - c[2]));
  const rep = { ax: c[0], ay: c[1], az: c[2], bx: c[0], by: c[1], bz: c[2], fx: 0, fy: -0.27, fz: -0.96, R, depth: R * 1.6, s: 0 };
  e.repulsors = [rep];
  let nearAt = -1, farAt = -1;
  for (let k = 0; k < 90; k++) {
    const t = k * DT;
    if (t < 0.15) rep.s += (1 - rep.s) * Math.min(1, DT * 20); else rep.s *= Math.exp(-DT / 0.18);
    e.step(DT);
    let near = 0, nn = 0, far = 0, nf = 0;
    for (let i = 0; i < e.n; i++) { if (dist[i] < 0.6) { near += e.stress[i]; nn++; } else if (dist[i] > 1.2) { far += e.stress[i]; nf++; } }
    if (nearAt < 0 && nn && near / nn > 0.3) nearAt = t;
    if (farAt < 0 && nf && far / nf > 0.15) farAt = t;
  }
  e.repulsors = [];
  check('T02 近くの魚が反応する', nearAt >= 0, `近く: ${nearAt.toFixed(2)}秒`);
  check('T02 遠くの魚は遅れて反応する（伝播）', farAt < 0 || farAt > nearAt, `遠く: ${farAt < 0 ? '反応なし' : farAt.toFixed(2) + '秒'}`);
  run(e, 6); e.analyze();
  check('T05 刺激が消えると群れに戻る', e.stats.components === 1 && e.stats.P > 0.7, `連結成分=${e.stats.components} P=${e.stats.P.toFixed(2)}`);
}

// T06/T07 障害物：浮き玉・岩の柱を進路上に置く → 手前から回避し、めり込まない
for (const kind of ['buoy', 'pillar']) {
  const e = new FlockEngine({ seed: 11, growth: false });
  run(e, 20); e.analyze();
  const c = e.centroid, h = heading(e), floor = -e.params.bounds[1];
  const ob = e.addObstacle({ kind, x: c[0] + h[0] * 5, z: c[2] + h[1] * 5, radius: 1.4, height: kind === 'buoy' ? c[1] - floor : c[1] - floor + 3 });
  let minSurf = 1e9;
  run(e, 15, () => {
    for (let i = 0; i < e.n; i++) {
      const cy = kind === 'pillar' ? Math.min(ob.y1, Math.max(ob.y0, e.py[i])) : ob.y;
      minSurf = Math.min(minSurf, Math.hypot(e.px[i] - ob.x, e.py[i] - cy, e.pz[i] - ob.z) - ob.radius);
    }
  });
  check(`T06 ${kind} の表面に近づきすぎない（>0.2）`, minSurf > 0.2, `最小距離=${minSurf.toFixed(2)}`);
  check(`T06 ${kind} にめり込まない`, e.intrusions === 0, `侵入=${e.intrusions}`);
}

// T08 障害物を素早く動かす・高さを変える・5個重ねる：計算が破綻しない
{
  const e = new FlockEngine({ seed: 3, growth: false });
  run(e, 10); const c = e.centroid.slice();
  const ob = e.addObstacle({ kind: 'buoy', x: c[0], z: c[2], radius: 1.5, height: 8 });
  for (let k = 0; k < 120; k++) { ob.tx = c[0] + Math.sin(k * 0.3) * 6; ob.tz = c[2] + Math.cos(k * 0.3) * 6; ob.targetHeight = 3 + (k % 20) * 0.5; e.step(DT); }
  for (let q = 0; q < 4; q++) e.addObstacle({ kind: q % 2 ? 'pillar' : 'buoy', x: c[0] + (q - 1.5), z: c[2], radius: 1.5, height: 9 });
  run(e, 10);
  let vmax = 0; for (let i = 0; i < e.n; i++) vmax = Math.max(vmax, Math.hypot(e.vx[i], e.vy[i], e.vz[i]));
  check('T08 NaNなし', !hasNaN(e));
  check('T08 速度が上限を超えない', vmax <= e.params.panicSpeed + 1e-3, `最大速度=${vmax.toFixed(2)}`);
}

// 岩（固定の目印）：めり込まない
{
  const e = new FlockEngine({ seed: 3, growth: false });
  const B = e.params.bounds;
  e.landmarks = [[-7, -2.5, 1.8], [6.5, 3, 1.4], [1, -8.5, 2.2]].map((r, n) => ({ id: 'r' + n, kind: 'sphere', x: r[0], y: -B[1] - r[2] * 0.25, z: r[1], radius: r[2], enabled: true, vx: 0, vy: 0, vz: 0 }));
  run(e, 120);
  check('岩 120秒でめり込みなし', e.intrusions === 0, `侵入=${e.intrusions}`);
}

// T10 成長：12匹から約500匹まで合流し、カウンタ（合流済み）と整合する
{
  const e = new FlockEngine({ seed: 5, growth: true, maxCount: 500 });
  check('T10 開始時は12匹', e.n === 12, `n=${e.n}`);
  run(e, 320);
  check('T10 5分強で500匹に到達', e.n === 500, `n=${e.n}`);
  check('T10 合流済み数 ≤ 総数', e.joined <= e.n, `joined=${e.joined}`);
  let t0 = Date.now(); run(e, 10); const msPerStep = (Date.now() - t0) / 300;
  check('T14 500匹で1更新 8ms未満（PC基準）', msPerStep < 8, `${msPerStep.toFixed(2)} ms/更新`);
}

// 餌やり：群がって食べ切り、興奮は時間とともに収まる
{
  const e = new FlockEngine({ seed: 5, growth: false });
  run(e, 20); const c = e.centroid.slice();
  e.addFood(c[0] + 5, c[1] + 1, c[2], 28, 0.8);
  let peak = 0;
  run(e, 4, () => { let fe = 0; for (let i = 0; i < e.n; i++) fe += e.feed[i]; peak = Math.max(peak, fe / e.n); });
  check('餌 4秒以内に食べ切る', e.foodN === 0 && e.eaten === 28, `残り=${e.foodN} 食べた=${e.eaten}`);
  check('餌 群れ全体が興奮する（平均>0.5）', peak > 0.5, `最大平均=${peak.toFixed(2)}`);
  run(e, 15); let fe = 0; for (let i = 0; i < e.n; i++) fe += e.feed[i];
  check('餌 15秒後には落ち着く（平均<0.1）', fe / e.n < 0.1, `平均=${(fe / e.n).toFixed(2)}`);
  e.addFood(c[0], c[1], c[2], 1000, 1);
  check('餌 上限を超えてまけない', e.foodN === e.FOOD_CAP, `foodN=${e.foodN}`);
}

// 餌と海底（v0.13）：海底より下の点にまいても海底の上に置かれ、魚も海底より下へ潜らない
{
  const e = new FlockEngine({ seed: 7, growth: false }), floor = -e.params.bounds[1];
  run(e, 10); const c = e.centroid.slice();
  e.addFood(c[0], floor - 3, c[2], 28, 0.8);
  let minFood = 99; for (let f = 0; f < e.foodN; f++) minFood = Math.min(minFood, e.foodY[f]);
  check('海底 餌は海底の上にまかれる', minFood > floor + 0.3, `最も低い粒=${(minFood - floor).toFixed(2)}（海底から）`);
  let minFish = 99;
  run(e, 12, () => { for (let i = 0; i < e.n; i++) minFish = Math.min(minFish, e.py[i]); });
  check('海底 魚が海底より下へ潜らない', minFish >= floor, `最も低い魚=${(minFish - floor).toFixed(2)}（海底から）`);
  check('海底 海底近くの餌も食べ切る', e.eaten === 28, `食べた=${e.eaten}`);
}

// 大群（v0.14）：成長は500匹より先も続き、2000匹でも破綻しない
{
  const e = new FlockEngine({ seed: 9, growth: true, capacity: 2000, maxCount: 1000, initial: 500 });
  e.growth.t = 270; e.growth.nextAt = 270;   // 500匹に達した時点から再開
  run(e, 170);
  check('大群 成長が500匹より先へ続き、上限1000で止まる', e.n >= 950 && e.n <= 1000, `n=${e.n}`);
}
{
  const e = new FlockEngine({ seed: 11, growth: false, capacity: 2000, maxCount: 2000, initial: 2000 });
  run(e, 3);
  let t0 = Date.now(); run(e, 10); const msPerStep = (Date.now() - t0) / 300;
  let bad = 0; for (let i = 0; i < e.n; i++) if (!isFinite(e.px[i] + e.py[i] + e.pz[i])) bad++;
  check('大群 2000匹で始められる', e.n === 2000, `n=${e.n}`);
  check('大群 2000匹でNaNなし', bad === 0);
  check('大群 2000匹で1更新 12ms未満（PC基準）', msPerStep < 12, `${msPerStep.toFixed(2)} ms/更新`);
}

/* ---------------- ムクドリ（v0.15 / 設計書 §16.11） ---------------- */
function starling(n, seed) { return new FlockEngine({ species: 'starling', seed, growth: false, capacity: 2000, maxCount: n, initial: n }); }
function minY(e) { let m = 1e9; for (let i = 0; i < e.n; i++) m = Math.min(m, e.py[i]); return m; }

// S01 放置：1つの群れにまとまり、向きをそろえてうねり続ける。S06 最低高度より下へ行かない
{
  const e = starling(300, 5), floorF = e.params.groundY + e.params.minAlt;
  let comp = 0, P = 0, k = 0, low = 1e9;
  run(e, 120, s => { if (s % 30 === 0) low = Math.min(low, minY(e)); if (s > 300 && s % 60 === 0) { e.analyze(); comp += e.stats.components; P += e.stats.P; k++; } });
  e.analyze();
  check('S01 ムクドリ 放置120秒でNaNなし', !hasNaN(e));
  check('S01 ムクドリ ほぼ1つの群れ（連結成分の平均≤2.5）', comp / k <= 2.5, `平均=${(comp / k).toFixed(2)}`);
  check('S01 ムクドリ 向きがそろっている（偏極度の平均>0.6）', P / k > 0.6, `P=${(P / k).toFixed(2)}`);
  check('S01 ムクドリ 最近接距離が約1〜2 m', e.stats.meanNN > 0.8 && e.stats.meanNN < 2.0, `平均=${e.stats.meanNN.toFixed(2)} m`);
  check('S06 ムクドリ 最低高度（地上15 m）より下へ行かない', low >= floorF - 1e-4, `最も低い鳥=地上${(low - e.params.groundY).toFixed(1)} m`);
}

// S02 近い順の7羽：群れを2倍に引き伸ばしても、バラバラにならずにまとまり直す
{
  const e = starling(400, 6);
  run(e, 15);
  const c = e.centroid.slice();
  for (let i = 0; i < e.n; i++) { e.px[i] = c[0] + (e.px[i] - c[0]) * 2; e.py[i] = c[1] + (e.py[i] - c[1]) * 2; e.pz[i] = c[2] + (e.pz[i] - c[2]) * 2; }
  run(e, 15); e.analyze();
  check('S02 ムクドリ 引き伸ばしても15秒でまとまり直す（連結成分≤2）', e.stats.components <= 2, `連結成分=${e.stats.components}`);
}

// S03 ハヤブサの急降下：通り道に空洞があき、近い鳥から先に逃げ、どの鳥も減らない。S04 その後まとまりに戻る
{
  const e = starling(800, 8), floorF = e.params.groundY + e.params.minAlt;
  run(e, 20); e.analyze();
  let mvx = 0, mvy = 0, mvz = 0; for (let i = 0; i < e.n; i++) { mvx += e.vx[i]; mvy += e.vy[i]; mvz += e.vz[i]; }
  const T = 1.2, c = [e.centroid[0] + mvx / e.n * T, e.centroid[1] + mvy / e.n * T, e.centroid[2] + mvz / e.n * T];   // 1.2秒後の群れの中心を狙う
  const st = [c[0] - 20, c[1] + 35, c[2] + 10], L = Math.hypot(c[0] - st[0], c[1] - st[1], c[2] - st[2]), sp = L / T;
  const pred = { x: st[0], y: st[1], z: st[2], vx: (c[0] - st[0]) / L * sp, vy: (c[1] - st[1]) / L * sp, vz: (c[2] - st[2]) / L * sp };
  const n0 = e.n, distAim = [], reactT = new Float32Array(e.n).fill(-1);
  for (let i = 0; i < e.n; i++) distAim.push(Math.hypot(e.px[i] + e.vx[i] * T - c[0], e.py[i] + e.vy[i] * T - c[1], e.pz[i] + e.vz[i] * T - c[2]));
  e.predator = pred;
  let hole = 1e9, t = 0, low = 1e9;
  run(e, 3, () => {
    pred.x += pred.vx * DT; pred.y += pred.vy * DT; pred.z += pred.vz * DT; t += DT;
    let md = 1e9;
    for (let i = 0; i < e.n; i++) { md = Math.min(md, Math.hypot(e.px[i] - pred.x, e.py[i] - pred.y, e.pz[i] - pred.z)); if (reactT[i] < 0 && e.stress[i] > 0.3) reactT[i] = t; }
    if (Math.abs(t - T) < 0.2) hole = Math.min(hole, md);
    low = Math.min(low, minY(e));
  });
  e.predator = null;
  let nt = 0, nn = 0, ft = 0, nf = 0;
  for (let i = 0; i < e.n; i++) if (reactT[i] >= 0) { if (distAim[i] < 6) { nt += reactT[i]; nn++; } else if (distAim[i] > 12) { ft += reactT[i]; nf++; } }
  check('S03 ハヤブサ 通り道に空洞があく（群れの中心付近で最も近い鳥 > 2 m）', hole > 2, `最も近い鳥=${hole.toFixed(2)} m`);
  check('S03 ハヤブサ 近い鳥ほど先に逃げる', nn > 0 && (nf === 0 || nt / nn < ft / nf), `近く ${nn}羽 平均${(nt / Math.max(1, nn)).toFixed(2)}秒 / 遠く ${nf}羽 平均${(ft / Math.max(1, nf)).toFixed(2)}秒`);
  check('S03 ハヤブサ 鳥は減らない', e.n === n0, `n=${e.n}`);
  check('S06 ハヤブサから逃げても最低高度より下へ行かない', low >= floorF - 1e-4, `地上${(low - e.params.groundY).toFixed(1)} m`);
  let back = -1;
  for (let k = 1; k <= 10 && back < 0; k++) { run(e, 1); e.analyze(); if (e.stats.components <= 2) back = k; }
  check('S04 ハヤブサが去って10秒以内にまとまりへ戻る（連結成分≤2）', back > 0, back > 0 ? `${back}秒後` : `連結成分=${e.stats.components}`);
}

// S07 負荷：2000羽で1回の更新が12 ms未満（PC）、NaNなし
{
  const e = starling(2000, 11);
  run(e, 3);
  let t0 = Date.now(); run(e, 10); const ms = (Date.now() - t0) / 300;
  check('S07 ムクドリ 2000羽でNaNなし', !hasNaN(e));
  check('S07 ムクドリ 2000羽で1更新 12ms未満（PC基準）', ms < 12, `${ms.toFixed(2)} ms/更新`);
}

// S10〜S12 止まり木（v0.19 / 設計書 v0.7 §16.14）：上空を回る → 降りる決断が広がる → 着いた所の空きに止まる
function wireSite(e) {   // 地上約10 m、長さ40 m、たるんだ3本の電線（描画側の電線と同じ形）
  const G = e.params.groundY, wires = [];
  for (let w = 0; w < 3; w++) { const pts = []; for (let k = 0; k <= 32; k++) { const t = k / 32; pts.push([-20 + 40 * t, G + 10.6 + (w === 1 ? 0.6 : 0) - 4 * t * (1 - t) * 1.3, 30 + (w - 1)]); } wires.push(pts); }
  return { kind: 'wire', wires };
}
{
  const e = starling(600, 21), G = e.params.groundY;
  run(e, 10);
  const site = wireSite(e);
  e.perchSite(site);
  const landT = new Float32Array(e.n).fill(-1); let t = 0, low = 1e9, early = 0;
  run(e, 40, () => {
    t += DT;
    for (let i = 0; i < e.n; i++) { if (landT[i] < 0 && e.pst[i] === 2) landT[i] = t; if (!e.pst[i]) low = Math.min(low, e.py[i]); }
    if (Math.abs(t - 1) < DT / 2) for (let i = 0; i < e.n; i++) if (e.pst[i]) early++;
  });
  const lt = [...landT].filter(v => v >= 0).sort((a, b) => a - b);
  check('S10 止まり木 タップしてすぐには降りない（まず上空を回る）', early === 0, `1秒後に降り始めた鳥=${early}`);
  check('S10 止まり木 電線に多くの鳥が止まる（150羽以上）', lt.length >= 150, `止まった=${lt.length}羽（電線の長さから見た目安 ${site.cap}羽）`);
  let off = 0; const nq = {};
  for (let i = 0; i < e.n; i++) if (e.pst[i] === 2) { e._wireNearest(site, e.px[i], e.py[i] - 0.09, e.pz[i], nq); if (Math.hypot(nq.x - e.px[i], nq.y - (e.py[i] - 0.09), nq.z - e.pz[i]) > 0.15) off++; }
  check('S10 止まり木 止まった鳥は電線の上（0.15 m 以内）', off === 0, `電線から離れている=${off}`);
  const byW = {}; for (const s of e.perches) if (s.bird >= 0 && s.w != null) (byW[s.w] = byW[s.w] || []).push(s.s);
  const gaps = []; for (const w in byW) { const a = byW[w].sort((x, y) => x - y); for (let k = 1; k < a.length; k++) gaps.push(a[k] - a[k - 1]); }
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length, cv = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length) / mean;
  check('S10 止まり木 隣との間隔は 0.24 m 以上で、ばらつきがある（変動係数 0.1 以上）', Math.min(...gaps) >= 0.24 - 1e-4 && cv >= 0.1, `最小=${Math.min(...gaps).toFixed(2)} m 平均=${mean.toFixed(2)} m 変動係数=${cv.toFixed(2)}`);
  const spread = lt[Math.floor(lt.length * 0.9)] - lt[0];
  check('S10 止まり木 全員が同時には降りない（最初の着地から9割が着地するまで2秒以上）', spread >= 2, `${spread.toFixed(1)}秒`);
  check('S10 止まり木 止まれなかった鳥は空を飛び続ける（地面より上）', e.n - e.perchedN > 0 && low > G, `空=${e.n - e.perchedN}羽 最も低い=地上${(low - G).toFixed(1)} m`);
  // S12 ハヤブサが近くに来ると一斉に飛び立ち、空の群れに混ざる
  e.predator = { x: 0, y: G + 25, z: 30, vx: 0, vy: -10, vz: 0 };
  run(e, 1.5);
  e.predator = null;
  let still = 0; const chosen = []; for (let i = 0; i < e.n; i++) { if (e.pst[i]) still++; if (landT[i] >= 0) chosen.push(i); }
  check('S12 止まり木 ハヤブサが来ると全員が飛び立つ', still === 0, `止まったまま=${still}`);
  const took = new Set(chosen);
  function mixed() { let m = 0; for (const b of chosen) { let md = 1e9; for (let j = 0; j < e.n; j++) if (!took.has(j)) md = Math.min(md, Math.hypot(e.px[j] - e.px[b], e.py[j] - e.py[b], e.pz[j] - e.pz[b])); if (md < 3) m++; } return m / chosen.length; }
  let back = -1, mx = 0;
  for (let k = 1; k <= 10 && back < 0; k++) { run(e, 1); mx = mixed(); if (mx >= 0.8) back = k; }
  check('S12 止まり木 飛び立って10秒以内に8割以上が空の群れに混ざる', back > 0, back > 0 ? `${back}秒後` : `混ざった割合=${(mx * 100).toFixed(0)}%`);
  let low2 = 1e9; for (let i = 0; i < e.n; i++) low2 = Math.min(low2, e.py[i]);
  check('S12 止まり木 飛び立った鳥が地面より下へ行かない', low2 > G, `最も低い=地上${(low2 - G).toFixed(1)} m`);
}
{   // S11 木：樹冠の中の空いている場所に降りる
  const e = starling(400, 22), G = e.params.groundY, T = { x: 10, y: G + 9, z: 30, r: 4 };
  run(e, 8);
  const seats = [];
  for (let k = 0; k < 120; k++) {   // 樹冠（横 r・縦 0.75r の楕円体）の中、半径の 40〜95% の位置
    const a = k * 2.4, el = (((k * 37) % 100) / 100 - 0.5) * 2.4, rr = 0.4 + ((k * 53) % 56) / 100;
    seats.push({ x: T.x + Math.cos(a) * Math.cos(el) * T.r * rr, y: T.y + Math.sin(el) * T.r * 0.75 * rr, z: T.z + Math.sin(a) * Math.cos(el) * T.r * rr, fx: Math.cos(a), fz: Math.sin(a), bird: -1 });
  }
  e.perchSite({ kind: 'tree', x: T.x, y: T.y, z: T.z, r: T.r, seats });
  run(e, 40);
  let on = 0, out = 0, low = 1e9;
  for (let b = 0; b < e.n; b++) if (e.pst[b] === 2) { on++; if (Math.hypot((e.px[b] - T.x) / T.r, (e.py[b] - T.y) / (T.r * 0.75), (e.pz[b] - T.z) / T.r) > 1.05) out++; low = Math.min(low, e.py[b]); }
  check('S11 止まり木 木の樹冠の中に止まる（120羽まで）', on >= 60 && on <= 120 && out === 0 && low > G, `止まった=${on} 樹冠の外=${out}`);
}

// 種類の切り替え：ムクドリ → イワシに戻すと、イワシのパラメータで最初からやり直す
{
  const e = starling(300, 2);
  run(e, 2);
  e.setSpecies('sardine', 42);
  check('切替 イワシに戻すとパラメータもイワシ', e.species === 'sardine' && e.params.cruise === 2.0 && !e.params.topoK && e.n === 100, `species=${e.species} n=${e.n}`);
}

// T13 乱数シード固定で再現できる
{
  const a = new FlockEngine({ seed: 1234, growth: false }), b = new FlockEngine({ seed: 1234, growth: false });
  run(a, 5); run(b, 5);
  let same = true; for (let i = 0; i < a.n; i++) if (a.px[i] !== b.px[i] || a.vz[i] !== b.vz[i]) { same = false; break; }
  check('T13 同じシードなら同じ結果', same);
}

console.log(failed ? `\n${failed} 件失敗` : '\nすべて成功');
process.exit(failed ? 1 : 0);
