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

// T13 乱数シード固定で再現できる
{
  const a = new FlockEngine({ seed: 1234, growth: false }), b = new FlockEngine({ seed: 1234, growth: false });
  run(a, 5); run(b, 5);
  let same = true; for (let i = 0; i < a.n; i++) if (a.px[i] !== b.px[i] || a.vz[i] !== b.vz[i]) { same = false; break; }
  check('T13 同じシードなら同じ結果', same);
}

console.log(failed ? `\n${failed} 件失敗` : '\nすべて成功');
process.exit(failed ? 1 : 0);
