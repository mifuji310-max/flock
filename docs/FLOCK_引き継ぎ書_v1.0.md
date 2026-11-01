# FLOCK 引き継ぎ書（Claude Code 向け）

> **版数:** v1.0（2026-11-01）
> **引き継ぎ時点の実装:** FLOCK v0.12
> **仕様の基準:** `docs/FLOCK_設計書_v0.3.md`（以下「設計書」）
> **作業ルール:** リポジトリ直下の `CLAUDE.md`（毎回の作業で必ず守る）

### 改訂履歴

| 版 | 日付 | 内容 |
|---|---|---|
| v1.0 | 2026-11-01 | 初版。claude.ai での試作（v0.1〜v0.12）から Claude Code へ引き継ぐ |

---

## 1. このプロジェクトについて

自律的に泳ぐイワシの群れに、指で触れたり、障害物を置いたり、餌をまいたりして反応を楽しむ、スマホ向けの3D Webアプリ。**1つのHTMLファイルで完結する**（サーバー不要）。

オーナー（ユーザー）がまず設計書 v0.2 を書いた。claude.ai 上で試作を重ね、実機で触って出たフィードバックを v0.12 まで反映した。その内容をまとめたのが設計書 v0.3 である。ここからの改修・公開・保守を Claude Code に引き継ぐ。

## 2. 最初にやること（引き継ぎタスク）

1. このフォルダを Git リポジトリとして GitHub に上げる。
2. GitHub Pages で公開する。
3. 公開した URL で、縦画面・横画面の両方で動くことを確認する。

手順と方針は §7。公開前に、**§7.1 の確認事項をユーザーに聞くこと**。

## 3. 現状（v0.12）

### 3.1 できていること

設計書の §3〜§10 に書かれた機能はすべて実装済み。主なもの：

- 自律群泳。成長モード（12匹から500匹まで）は設定から切り替える。
- 触れる（手／餌）、障害物（浮き玉・岩の柱）、観察（色付け・視点回転）の3モード。
- 目印（海底と1mマス目・岩・群れが泳ぐ範囲・スケールバー）。
- サウンド（環境音・水滴のタッチ音・群れが動く水音・餌の音）。
- 一時停止、キーボード操作、横画面のレイアウト、2本指の誤操作対策。
- 開発者表示（係数スライダーと説明、観察指標、乱数シードの固定）。

### 3.2 テストの状況

| テスト | 実行方法 | 引き継ぎ時の結果 |
|---|---|---|
| エンジン（Node.js） | `npm test` | 22項目すべて成功 |
| 画面の動作確認（ヘッドレスChromium） | `npm install` の後に `python3 tests/browser/smoke.py` | 10項目すべて成功 |

**まだ確認していないこと：**

- スマホ実機での FPS（試作の期間中は、オーナーが実機で操作感だけを確認していた）
- iOS Safari での動作（オーナーの端末は Android と見られる）
- 実機での音の聞こえ方。音量のつり合いは、ブラウザでの計測値で決めた（設計書 §10.2）

### 3.3 既知の課題・気になっている点

| 内容 | 程度 | メモ |
|---|---|---|
| 岩の柱がやや白っぽく見える | 小 | ユーザーに「暗めにできる」と伝えたが、まだ返事がない |
| WebGL を使えない端末では、メッセージを出すだけ | 小 | 試作Bには2Dでの代替表示があった |
| 遅れてきた2本目の指を待つ間（0.12〜0.6秒）に、魚が食べた餌は取り消せない | 極小 | 仕様として受け入れている |
| 開発者表示のパネルが、横画面で左下のパネルと重なることがある | 小 | 開発者向けの表示なので、後回しにしている |
| `FLOCK.debugEngine` などのテスト用の入口が、公開版にも残っている | 小 | テストで使っている。外す場合はテストも直すこと |

## 4. リポジトリの構成

```text
flock/
├── index.html                 公開用の最新版（tools/build.py が生成する。直接は編集しない）
├── VERSION                    現在の版数（例: 0.12）
├── src/
│   ├── shell.html             画面の部品（HTML/CSS）、冒頭に更新履歴、設定画面の版数表示
│   ├── engine.js              群れエンジン（描画なし。Node.js でテストできる）
│   └── app.js                 描画・入力・カメラ・UI・サウンド
├── tools/build.py             src の3つを1つのHTMLにまとめる → index.html と releases/flock_v{版数}.html
├── releases/                  版ごとの完成品（v0.1〜v0.12）。既存のファイルは上書きしない
├── tests/
│   ├── engine.test.js         エンジンの自動テスト
│   └── browser/smoke.py       画面の動作確認（スクリーンショットは tests/browser/out/ に保存。Git には入れない）
├── docs/
│   ├── FLOCK_設計書_v0.2.md    オーナーが書いた原本（変更しない）
│   ├── FLOCK_設計書_v0.3.md    現行の仕様
│   └── FLOCK_引き継ぎ書_v1.0.md  この文書
├── CHANGELOG.md               版ごとの変更点
├── CLAUDE.md                  Claude Code の作業ルール
├── README.md                  公開リポジトリの表紙
├── package.json               テスト用（依存は three@0.128.0 だけ。本番では使わない）
├── .nojekyll                  GitHub Pages で Jekyll の処理をさせないための空ファイル
└── .gitignore
```

## 5. コードの見取り図

### 5.1 engine.js（`FLOCK.FlockEngine`）

| 部分 | 内容 |
|---|---|
| `SARDINE` | 既定のパラメーター。値と意味は設計書 §5・§8、開発者表示の説明文を参照 |
| `SpatialHashGrid` | 近傍探索（空間を格子に分けて、近くの個体を素早く探す） |
| `step(dt)` | 1回の更新。順序は設計書 §11.3 |
| 障害物 | `addObstacle({kind, x, z, radius, height})`、`removeObstacle(id)`、`_shapeObstacle`、`_updateObstacles` |
| 回避の形 | `step` の冒頭で、`obstacles` と `landmarks`（岩）を球と縦のカプセルの一覧 `_prims` に並べ直す |
| 餌 | `addFood(x, y, z, count, spread)`、`_updateFood`、`_removeFood`（配列の末尾と入れ替えて詰める） |
| 個体の状態 | `px/py/pz`、`vx/vy/vz`、`stress`、`feed`、`flock`（0＝本体）など。すべて型付き配列 |
| 観察指標 | `analyze()` → `stats`（P・最近接距離・群れの半径・連結成分の数など） |

### 5.2 app.js

| 部分 | 内容 |
|---|---|
| 魚の描画 | `buildFishGeometry`（細身の紡錘形＋二又の尾びれ）、`InstancedMesh`、`onBeforeCompile` で尾の振り・光り・色付けを加える |
| 障害物の描画 | `makeVis` / `updateVis` / `syncObstacles`、柱の形は `buildPillarGeometry` |
| 岩・海底 | `buildRockGeometry`、海底のシェーダー、光の揺らめき `CAUSTIC_GLSL` |
| 入力 | `beginSingle` / `moveSingle` / `pointerEnd`、2本指を待つ判定 `pending`（`PEND_MS`）、取り消し `undoMade`（`UNDO_MS`）、短いタップの保持 `TAP_MIN` |
| カメラ | `updateCamera`（自動追従と揺れ）、`userYaw` / `userPitch` / `zoom` |
| サウンド | `startAudio`（初めて触れたときに作る）、`blip`（泡・水滴）、`playTouch`、`playRustle`、`playFeed` |
| UI | `setMode`、`updateObsUI`、色付け（`setTag` ほか）、設定、開発者表示 |
| 保存 | `localStorage` の `flock.settings` と `flock.guideSeen`（読み書きは try/catch で囲む） |

### 5.3 shell.html

- 色はすべて `:root` の変数で決めている。ダーク固定のテーマ。
- 横画面のレイアウトは、`@media (orientation: landscape) and (max-height: 600px)` の中にまとめている。
- 冒頭のコメントが更新履歴。設定画面の下にある `.ver` の段落にも、版ごとの要約を書く。

## 6. ユーザー（オーナー）について：作業のときに大事なこと

### 6.1 進め方の好み

- **回答は日本語で。**
- **成果物は、軽い変更でも版数を上げて、更新履歴を残す**（具体的な手順は CLAUDE.md）。
- 実機（Android のスマホ。縦でも横でも使う）で触り、スクリーンショット付きでフィードバックをくれる。
- 「おしゃれ」「自然」を重視する。説明の多いUIや、派手すぎる演出は好まない。
- 提案を求められたときは、選択肢とおすすめを示す。決めるのはユーザー。

### 6.2 却下されたもの（再提案しない）

設計書 §13.2 を必ず確認すること。主なもの：

- 背びれ・胸びれ
- 大きな尾びれ
- 「新しい仲間が近づいています」のトースト
- 水琴窟の音
- タッチ音の種類を選ぶ機能
- 「ザッ」という水音
- 大きな障害物パネル
- 半透明の球の障害物
- 画面左右の大きな見出し

## 7. GitHub への公開：方針と手順

### 7.1 公開前にユーザーへ確認すること

| 項目 | 推奨 | 理由 |
|---|---|---|
| リポジトリ名 | `shimeji-lab/flock` | オーナーの他のアプリ（lens-lab、wave-lab など）と同じアカウント |
| 公開範囲 | Public | 無料プランで GitHub Pages を使うには Public が必要。他のアプリもすべて Public |
| ライセンス | 確認する（例：MIT、または付けない） | 付けない場合、閲覧はできるが再利用は許可されない |
| まなびラボ（ポータル）への掲載 | 確認する | `shimeji-lab/manabi-lab` に学習ツールの一覧がある。FLOCK を載せるかどうか |

### 7.2 手順

前提：`gh` コマンドに、オーナーのアカウントでログイン済みであること（`gh auth status` で確認）。

```bash
# 1) 公開前の確認
npm install                      # three@0.128.0（テスト専用）
npm test                         # エンジンの自動テスト
python3 tests/browser/smoke.py   # 画面の動作確認（Playwright が必要）
python3 tools/build.py           # index.html を最新にする（releases の既存ファイルは上書きされない）

# 2) Git の初期化と最初のコミット
git init -b main
git add .
git commit -m "FLOCK v0.12: 初回公開（claude.ai の試作から引き継ぎ）"

# 3) GitHub にリポジトリを作って push する（7.1 で確認した名前と公開範囲で）
gh repo create shimeji-lab/flock --public --source . --push \
  --description "FLOCK – 自律的に泳ぐイワシの群れに触れて観察する3D群れシミュレータ"

# 4) GitHub Pages を有効にする（main ブランチの直下を公開）
gh api -X POST repos/shimeji-lab/flock/pages -f "source[branch]=main" -f "source[path]=/"
#    すでに有効になっている場合は PUT で更新する
gh api repos/shimeji-lab/flock/pages --jq '.html_url,.status'

# 5) 公開を確かめる（反映まで1〜数分かかる）
curl -sI https://shimeji-lab.github.io/flock/ | head -1         # 200 になること
curl -s  https://shimeji-lab.github.io/flock/ | grep -o 'FLOCK v0.12'

# 6) 版のタグとリリース（任意。おすすめ）
git tag v0.12 && git push origin v0.12
gh release create v0.12 releases/flock_v0.12.html --title "FLOCK v0.12" --notes-file CHANGELOG.md
```

### 7.3 公開後に確認すること

- **公開URL：** `https://shimeji-lab.github.io/flock/`
- **スマホで開く：** 縦・横それぞれで次を確かめる。
  - 初回ガイドが出る
  - 触ると魚が逃げ、音が鳴る（マナーモードを解除して）
  - 餌に群がる
  - 浮き玉・柱を置ける
  - 2本指で拡大縮小しても、誤って操作にならない
- **外部から読み込んでいるもの：**
  - Three.js（cdnjs、r128 に固定）
  - Google Fonts
  - どちらも GitHub Pages からそのまま読み込める。

**読み込みに失敗した場合**
- Three.js：画面に「WebGLが使えない」と表示される。
- フォント：代わりのフォントで表示されるだけで、動作に問題はない。

### 7.4 公開後の更新の流れ

1. `src/` を変更する。
2. 版数を上げて、更新履歴を書く（CLAUDE.md の手順）。
3. `npm test` と `python3 tests/browser/smoke.py` を実行する。
4. `python3 tools/build.py <新しい版数>` を実行する。
5. コミットして push する。GitHub Pages は自動で更新される。

## 8. 次の候補（ユーザーに確認してから着手する）

設計書 §14 を参照。優先度が高いのは次の2つ。

1. スマホ実機での性能測定と、画質の自動調整の見直し
2. 障害物の配置・色付け・カメラ位置の保存

## 9. 参照

- 設計書（原本）：`docs/FLOCK_設計書_v0.2.md`
- 設計書（現行）：`docs/FLOCK_設計書_v0.3.md`
- 変更履歴：`CHANGELOG.md`
- 試作の経緯：claude.ai の会話の Artifact「FLOCK」（オーナーだけが閲覧できる。公開後は GitHub Pages の URL が正式な公開先になる）
