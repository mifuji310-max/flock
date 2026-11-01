"""FLOCK 画面の動作確認（ヘッドレスChromiumで index.html を開いて操作する）

準備:
  npm install                     # three@0.128.0 を node_modules に入れる（CDNの代わりに使う）
  pip install playwright && python -m playwright install chromium
実行:
  python3 tests/browser/smoke.py  # 結果を表示し、スクリーンショットを tests/browser/out/ に保存
  CHROME_PATH=/path/to/chrome python3 tests/browser/smoke.py   # Chromium を指定する場合

確認すること:
  - 読み込み時・操作時にスクリプトエラーが出ない
  - 一瞬のタップでも魚への刺激が発生する（v0.7 の不具合の再発防止）
  - 2本指の拡大縮小で、触る・餌・障害物が発生しない（v0.12）
  - 1本指のタップで、餌がまける・障害物が置ける
  - 縦画面・横画面のスクリーンショット
"""
import asyncio
import os
import pathlib
import sys

from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'tests' / 'browser' / 'out'
THREE = ROOT / 'node_modules' / 'three' / 'build' / 'three.min.js'

# 指の操作を合成して実行し、結果を返す（pointerType: 'touch'）
GESTURE = r"""async ([kind, delay]) => {
  const cv = document.getElementById('scene'), e = FLOCK.debugEngine, W = innerWidth, H = innerHeight;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ev = (type, id, x, y) => cv.dispatchEvent(new PointerEvent(type, {pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: 'touch', isPrimary: id === 1, button: 0}));
  // 前の操作の刺激が消えるまで待つ（最大2秒）
  for (let k = 0; k < 40 && e.repulsors.length; k++) await sleep(50);
  e.obstacles.length = 0; e.foodN = 0; e.eaten = 0;
  const cx = W / 2, cy = H * 0.45; let touched = false;
  const watch = setInterval(() => { if (e.repulsors.length) touched = true; }, 5);
  if (kind === 'pinch') {
    ev('pointerdown', 1, cx - 20, cy); await sleep(delay); ev('pointerdown', 2, cx + 20, cy);
    for (let k = 1; k <= 10; k++) { ev('pointermove', 1, cx - 20 - k * 8, cy); ev('pointermove', 2, cx + 20 + k * 8, cy); await sleep(30); }
    ev('pointerup', 1, cx - 100, cy); ev('pointerup', 2, cx + 100, cy);
  } else {
    ev('pointerdown', 1, cx, cy); await sleep(delay); ev('pointerup', 1, cx, cy);
  }
  await sleep(500); clearInterval(watch);
  return {touched, obstacles: e.obstacles.length, food: e.foodN + e.eaten, left: e.foodN, eaten: e.eaten};
}"""


# v0.15 ムクドリ：ハヤブサの操作（tap＝急降下、drag＝追いかけ、pinch＝何も起こさない）
GESTURE_STAR = r"""async ([kind]) => {
  const cv = document.getElementById('scene'), S = FLOCK.debugStar, e = FLOCK.debugEngine, W = innerWidth, H = innerHeight;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ev = (type, id, x, y) => cv.dispatchEvent(new PointerEvent(type, {pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: 'touch', isPrimary: id === 1, button: 0}));
  for (let k = 0; k < 120 && S.falcon.active(); k++) await sleep(50);
  const cx = W / 2, cy = H * 0.4; let seen = false, mode = 'none', pred = false;
  const watch = setInterval(() => { if (S.falcon.active()) { seen = true; if (mode === 'none') mode = S.falcon.state(); } if (e.predator) pred = true; }, 5);
  if (kind === 'pinch') {
    ev('pointerdown', 1, cx - 20, cy); await sleep(60); ev('pointerdown', 2, cx + 20, cy);
    for (let k = 1; k <= 10; k++) { ev('pointermove', 1, cx - 20 - k * 8, cy); ev('pointermove', 2, cx + 20 + k * 8, cy); await sleep(30); }
    ev('pointerup', 1, cx - 100, cy); ev('pointerup', 2, cx + 100, cy);
  } else if (kind === 'drag') {
    ev('pointerdown', 1, cx, cy);
    for (let k = 1; k <= 30; k++) { ev('pointermove', 1, cx + k * 4, cy + Math.sin(k / 5) * 40); await sleep(30); }
    ev('pointerup', 1, cx + 120, cy);
  } else {
    ev('pointerdown', 1, cx, cy); await sleep(40); ev('pointerup', 1, cx, cy);
  }
  await sleep(400); clearInterval(watch);
  return {seen, mode, pred};
}"""


async def main():
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    if not THREE.exists():
        sys.exit('node_modules/three がありません。先に npm install を実行してください。')
    three = THREE.read_text(encoding='utf-8')
    OUT.mkdir(parents=True, exist_ok=True)
    failed = []

    def check(name, ok, detail=''):
        print(('OK   ' if ok else 'NG   ') + name + (f'  — {detail}' if detail else ''))
        if not ok:
            failed.append(name)

    async with async_playwright() as p:
        kw = {'executable_path': os.environ['CHROME_PATH']} if os.environ.get('CHROME_PATH') else {}
        browser = await p.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], **kw)
        for label, (w, h) in [('縦', (390, 844)), ('横', (780, 320))]:
            ctx = await browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2)
            page = await ctx.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            await page.route('https://cdnjs.cloudflare.com/**', lambda r: r.fulfill(status=200, content_type='application/javascript', body=three))
            await page.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='text/css', body=''))
            await page.route('http://flock.test/', lambda r: r.fulfill(status=200, content_type='text/html', body=html))
            await page.add_init_script("try{localStorage.setItem('flock.guideSeen','true');localStorage.setItem('flock.settings',JSON.stringify({sound:false,seabed:true,scalebar:true}))}catch(e){}")
            await page.goto('http://flock.test/')
            await page.wait_for_timeout(2500)
            await page.screenshot(path=str(OUT / f'{label}_触れる.png'))

            if label == '縦':
                r = await page.evaluate(GESTURE, ['tap', 0])
                check('一瞬のタップで刺激が発生する', r['touched'])
                r = await page.evaluate(GESTURE, ['pinch', 60])
                check('2本指（触れる）で刺激が発生しない', not r['touched'])
                await page.click('#touchTool button[data-t=feed]')
                r = await page.evaluate(GESTURE, ['pinch', 250])
                # 取り消しまでの間に魚が食べた粒は戻せないので、残っている粒だけを見る
                check('2本指（餌）で餌が残らない', r['left'] == 0, f"残り={r['left']}（取り消し前に食べられた粒={r['eaten']}）")
                r = await page.evaluate(GESTURE, ['tap', 40])
                check('タップで餌がまける', r['food'] > 0, f"餌={r['food']}")
                await page.keyboard.press('2')
                r = await page.evaluate(GESTURE, ['pinch', 60])
                check('2本指（障害物）で障害物が置かれない', r['obstacles'] == 0)
                r = await page.evaluate(GESTURE, ['tap', 40])
                check('タップで障害物が置ける', r['obstacles'] == 1)
                await page.wait_for_timeout(800)
                await page.screenshot(path=str(OUT / f'{label}_障害物.png'))
            else:
                rects = await page.evaluate("""(()=>{const b=s=>document.querySelector(s).getBoundingClientRect(); return {modes:b('.modes'), tools:b('#touchTools')}})()""")
                check('横画面：モード切替が右側', rects['modes']['left'] > w * 0.6)
                check('横画面：道具が左側', rects['tools']['right'] < w * 0.5)
            check(f'{label}画面：スクリプトエラーなし', not errors, '; '.join(errors[:3]))
            await ctx.close()

        # v0.15 ムクドリモード（設計書 §16.11 S08・S09）
        for label, (w, h) in [('縦', (390, 844)), ('横', (780, 320))]:
            ctx = await browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2)
            page = await ctx.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            await page.route('https://cdnjs.cloudflare.com/**', lambda r: r.fulfill(status=200, content_type='application/javascript', body=three))
            await page.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='text/css', body=''))
            await page.route('http://flock.test/', lambda r: r.fulfill(status=200, content_type='text/html', body=html))
            await page.add_init_script("try{localStorage.setItem('flock.guideSeen','true');localStorage.setItem('flock.settings',JSON.stringify({sound:false,species:'starling',quality:'many',volume:55}))}catch(e){}")
            await page.goto('http://flock.test/')
            await page.wait_for_timeout(3000)
            await page.screenshot(path=str(OUT / f'{label}_ムクドリ.png'))
            st = await page.evaluate("({n: FLOCK.debugEngine.n, sp: FLOCK.debugEngine.species, obsHidden: document.getElementById('modeObstacle').hidden, unit: document.getElementById('countUnit').textContent})")
            check(f'ムクドリ（{label}）：ムクドリで始まり、障害物モードを出さない', st['sp'] == 'starling' and st['obsHidden'] and st['unit'] == '羽', str(st))
            if label == '縦':
                r = await page.evaluate(GESTURE_STAR, ['pinch'])
                check('ムクドリ：2本指でハヤブサが出ない', not r['seen'], str(r))
                r = await page.evaluate(GESTURE_STAR, ['tap'])
                check('ムクドリ：タップでハヤブサが急降下する', r['seen'] and r['mode'] == 'dive', str(r))
                await page.wait_for_timeout(300)
                await page.screenshot(path=str(OUT / f'{label}_ハヤブサ.png'))
                await page.wait_for_timeout(4500)
                r = await page.evaluate(GESTURE_STAR, ['drag'])
                check('ムクドリ：なぞるとハヤブサが追いかける', r['seen'] and r['mode'] == 'chase', str(r))
                # v0.17 止まり木（S13）：電線をタップするとそこへ降りる鳥が出る。空のタップでは降りない
                await page.wait_for_timeout(4000)
                # カメラは群れを追って動くので、電線が画面に入るまで最大20秒待つ
                pt = await page.evaluate("""async () => { for (let w = 0; w < 100; w++) { for (let k=0;k<4;k++) for (const t of [0.2,0.35,0.5,0.65,0.8]) { const q=FLOCK.debugStar.debugWirePoint(k,1,t); const s=FLOCK.debugScreen(q[0],q[1],q[2]); if (s && s[0]>10 && s[0]<innerWidth-10 && s[1]>80 && s[1]<innerHeight-140 && FLOCK.debugPick(s[0],s[1])==='wire') return s; } await new Promise(r=>setTimeout(r,200)); } return null; }""")
                check('止まり木：画面に電線が見えていて、電線と判定される', pt is not None)
                if pt:
                    n1 = await page.evaluate("""async ([x,y]) => { const cv=document.getElementById('scene'), e=FLOCK.debugEngine;
                      const ev=t=>cv.dispatchEvent(new PointerEvent(t,{pointerId:1,clientX:x,clientY:y,bubbles:true,pointerType:'mouse',button:0}));
                      ev('pointerdown'); ev('pointerup'); await new Promise(r=>setTimeout(r,300));
                      return e.site && e.site.active && e.site.kind === 'wire' ? 1 : 0; }""", pt)
                    check('止まり木：電線をタップすると、群れが止まり木へ向かう（上空を回り始める）', n1 > 0)
                    sky = await page.evaluate("FLOCK.debugPick(innerWidth/2, 120)")
                    check('止まり木：空は空と判定される', sky == 'sky', sky)
                # 切り替え：イワシに戻し、設定が保たれることを確かめる
                await page.click('#btnSettings')
                await page.click('#optSpecies button[data-s=sardine]')
                await page.wait_for_timeout(800)
                st = await page.evaluate("({sp: FLOCK.debugEngine.species, q: JSON.parse(localStorage.getItem('flock.settings')).quality, v: JSON.parse(localStorage.getItem('flock.settings')).volume, obsHidden: document.getElementById('modeObstacle').hidden})")
                check('切替：イワシに戻すと画質・音量が保たれ、障害物モードが戻る', st['sp'] == 'sardine' and st['q'] == 'many' and st['v'] == 55 and not st['obsHidden'], str(st))
                await page.wait_for_timeout(1500)
                await page.screenshot(path=str(OUT / f'{label}_イワシに戻す.png'))
            check(f'ムクドリ（{label}）：スクリプトエラーなし', not errors, '; '.join(errors[:3]))
            await ctx.close()
        await browser.close()
    print('\nスクリーンショット:', OUT)
    print(f'{len(failed)} 件失敗' if failed else 'すべて成功')
    sys.exit(1 if failed else 0)


asyncio.run(main())
