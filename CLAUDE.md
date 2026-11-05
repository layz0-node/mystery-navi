# シーシャ屋ミステリーナビ

東京23区のシーシャ専門店を1軒だけ選び、方向と距離だけで案内するスマホ向けWebアプリ。店名は100m以内に近づくまでわからない。前に評価した店は矢印の色でわかり、たどり着いた回数でトロフィーが上がる。ホーム画面に追加して使う（PWA）。

**このリポジトリは公開（GitHub Pages）。** 店リストの作業用データは、同じ親フォルダにある非公開リポジトリ `../mystery-navi-data` にある。

- 仕様：`docs/requirements.md`（作業する範囲の章を必ず読む）
- 進め方：`docs/plan.md`（今どのフェーズかを確認してから作業する）

## 技術の前提

- 素のHTML・CSS・JavaScript（ESモジュール）。フレームワーク、ビルド工程、実行時の npm 依存は入れない
- 開発用の依存は Playwright だけ（画面を開いてスクリーンショットを撮るため。`devDependencies` に入れ、アプリ本体からは使わない）
- `package.json` は `"type": "module"`
- 静的ファイルだけで動く。サーバー処理はない（サービスワーカーは使う）
- GitHub Pages のサブパスで公開するので、パスはすべて相対にする
- アプリ動作中に外部APIを呼ばない（Googleフォントと、Googleマップへのリンクだけ例外。リンクは開くだけで、データは取得しない）
- テストは Node 標準の `node --test`
- 時刻の判定（営業時間・朝5時の切り替え・「今日」）は日本時間で行う。端末のタイムゾーンに頼らない

```
index.html
style.css
manifest.webmanifest  ホーム画面対応
sw.js             サービスワーカー（変更したらバージョンを上げる）
icons/            ホーム画面用アイコン（コンパスのモチーフ）
package.json      "type": "module"。devDependencies は Playwright だけ
src/config.js     定数（requirements.md 9章）
src/logic.js      距離・方位・営業時間・点数・選出・案内先の再開判定・トロフィーの集計（DOMに触らない純粋な関数だけ）
src/storage.js    localStorage の読み書き・取り消し・お知らせの判定・バックアップの書き出しと読み込み
src/sensors.js    位置情報・方位センサー・デバッグ上書き
src/app.js        画面の切り替えと描画
src/debug.js      デバッグパネル（?debug=1 のときだけ app.js から読み込む）
shops.json        公開用の店データ（アプリが読むのはこれだけ。Phase 8 以降は mystery-navi-data で作る）
scripts/validate-shops.mjs  店データの検査（パスを引数で渡せる。mystery-navi-data からも使う）
scripts/screenshot.mjs      Playwright でローカルの画面を開いてスクリーンショットを撮る（開発用）
scripts/screenshot-steps/   スクリーンショットの手順ファイル（入力・クリック・選択・待つ・撮影・localStorage に値を置く、だけ）
tests/            node --test のテスト
tests/fixtures/   テスト用のダミー店。テストは shops.json を読まない
screenshots/      Playwright で撮った画像（.gitignore 済み。コミットしない）
```

## 必ず守ること

1. **店リストの作業用データ（下書き・出典・メモ・確認リスト）をこのリポジトリに置かない。** 公開されてしまう
2. **Phase 8 以降、`shops.json` を手で編集しない。** `mystery-navi-data` のビルドで作る。実機テスト用の目的地は、デバッグの「仮の目的地」を使う
3. **テストは `shops.json` を読まない。** `tests/fixtures/` のダミー店を使う（店リストを本物に替えてもテストが壊れないように）
4. **Googleマップ／Google Places のデータを保存・転記しない。** 店名・営業時間・座標・口コミをGoogleから取ってファイルに書くことは規約違反になる
5. **どこにも自動で投稿しない。** Googleマップのレビュー、SNSなどへの投稿機能は作らない
6. **位置情報を端末の外に送らない。** 解析ツール、トラッカー、ログ送信も入れない
7. **たまおの自宅などの位置を、コード・テスト・画像に残さない。** デバッグの初期位置やテストの座標は、駅などの公共の場所にする
8. **店名やヒントなどのデータを画面に出すときは `textContent` を使い、`innerHTML` に入れない。** 表示崩れと不正なコードの実行を防ぐ
9. **評価の記録（visits）を消したり書き換えたりする処理を足さない。** トロフィーは何か月もかけて貯めるもので、壊すと取り返しがつかない。例外は requirements.md 6章に書いたものだけ
10. **保存データの形（schemaVersion 1）を勝手に変えない。** 変える必要があれば、古い形から移す処理とテストを先に提案する
11. **仕様を勝手に変えない。** 仕様の不備や、もっと良い案に気づいたら、実装せずに提案する
12. **ロジックは `src/logic.js` に純粋な関数として置き、テストを書く。** 乱数と現在時刻は引数で渡し、テストで固定できるようにする
13. UIの文言は日本語のみ（方位の N・E・S・W だけ例外）
14. 1回の作業は `docs/plan.md` の1フェーズまで。終わったら止まって報告する
15. **`scripts/screenshot.mjs` と `package.json` の `scripts` は、サンドボックスの外で動く。変えるときは、実装の前に計画で伝える**（スクリーンショットは必ず `npm run screenshot` から撮る。`node scripts/screenshot.mjs` を直接実行しない）
    - `npm run screenshot` は確認なしで実行できる。その代わり、`scripts/screenshot.mjs`・`package.json`・`node_modules` は書き込み禁止にしてある（`.claude/settings.local.json`）
    - これらを変える必要が出たとき（`npm install` を含む）は、計画で理由を伝え、たまおに一時的な解除を頼む。自分で設定を変えたり、別の方法で書き込んだりしない

## 作業が終わったと言う前に

- `node --test` がすべて通っている
- 店データを触ったら `node scripts/validate-shops.mjs` が通っている
- 画面を触ったら、Playwright でローカルの画面（`?debug=1`）を開いてスクリーンショットを撮り、確認した内容と画像のパスを報告する。**撮っていない画面を「確認した」と書かない**
- 実機でしか確認できないこと（方位センサー、GPS、ホーム画面からの起動、画面のスリープ防止）は「未確認」と正直に書く
- 画面やロジックを変えたら `sw.js` のキャッシュのバージョンを上げたか確認する
- 報告には「やったこと／確認したこと／たまおが実機で確認すべきこと」を分けて書く

## よく使うコマンド

```bash
python3 -m http.server 8000     # ローカルで開く → http://localhost:8000/?debug=1
node --test                     # テスト
node scripts/validate-shops.mjs # 店データの検査（パスを渡すと別のファイルも検査できる）
npm run screenshot              # WebKit・iPhone相当の画面で ?debug=1 を撮る → screenshots/page-webkit.png
```

スクリーンショットのオプション（`npm run screenshot -- ` の後に付ける）
- `--name=s1`：保存名（`screenshots/s1-webkit.png`）
- `--url="?debug=1&..."`：開くURL（ルートからの相対）
- `--browser=chromium`：Chromium で撮る。**基本は WebKit。Chromium は必要なときだけ**
- `--full`：ページ全体
- `--reduced-motion`：動きを減らす設定で撮る
- `--steps=scripts/screenshot-steps/phase3.json`：手順ファイルの操作を順に実行し、手順の中の `shot` ごとに撮る

スクリプトが自分でローカルのサーバーを立てるので、`python3 -m http.server` を別に動かしておく必要はない。初回は `npx playwright install webkit chromium` でブラウザを入れる。

※ localhost では位置情報が使えるが、スマホ実機で試すにはHTTPSの公開URLが必要。

## コミット

- フェーズごと、意味のある単位でコミットし、push する（GitHub Pages は push しないと更新されない）
- `git push --force`、履歴の書き換え、ファイルの一括削除はしない
- APIキーやパスワードのような秘密情報をリポジトリに入れない（このアプリには本来不要）
