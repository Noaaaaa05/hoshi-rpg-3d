# 大量素材の制作・確認・3D化

このツールはゲーム本体から独立しています。実画像を非公開領域で処理し、確認済みのモデルだけを既存の `rpg:asset` / `rpg:apply` 経路へ渡します。公開ゲーム・カタログ・Pages設定を、この実装PRから変更しません。**新しい有料APIは実行していません。**

## 動く範囲

| 工程 | 実装 |
| --- | --- |
| ZIP取り込み | JPG / PNG / WebPを検査。パストラバーサル・symlink・重複名・サイズ超過を拒否。文書は実行せず、ライセンスの根拠にも自動採用しない |
| 分割 | 連結成分＋空白行、行のヒント、固定格子、行ごとの格子と余白の調整を組み合わせる |
| 背景 | 白背景は外周につながる白い領域を除去し、白い装備の内部を保持。物体の外接矩形に入った隣の断片はラベルマスクで除外。黒背景の魔法は発光用アルファ。透かし付きは背景も保持 |
| 分類 | シート名と領域ルールによる仮分類。キャラクター・モンスター・武器・防具・魔法・建物・自然・未分類。分類方法・信頼度・未確認状態を記録 |
| 台帳 | PNG、ID、名前、分類、原画像名・SHA-256、切り抜き座標、PNGハッシュ、処理方法、品質・権利・制作段階をJSONへ保存 |
| 確認 | 48件ずつ表示する一覧。分類・元画像・警告で絞り込み、画像と原本・座標オーバーレイを確認。名前・分類・補正座標・権利記録をJSONへ書き出す |
| 3D化 | 初期16件、10〜20件単位やID指定の計画。公式Image to 3Dの実行コードは、権利・画質の承認と対象・回数・クレジット上限の別途承認がないと停止 |
| 登録 | 検証・目視確認済みGLBから既存の依頼JSONを作る。初期値はdry-run。明示的に指定した場合だけモデルを配置し、`rpg:apply` で登録する。マップ上の配置は追加しない |

## 非公開で抽出する

```sh
python3 -m pip install -r tools/asset_pipeline/requirements.txt
npm run assets:extract -- /private/input.zip \
  --output /private/hoshi-batch \
  --profile config/asset-sheets.json
```

`config/asset-sheets.json` は今回の10種類のレイアウトのヒントです。別のシートでは設定を追加するか、`--profile` を省いて空白・連結成分検出を使います。これは機械学習の物体認識ではなく、画像処理と設定による切り出しです。物体の正体・衣装の種類・種族・個数が正しいことを保証しません。名前も暫定名です。

出力：

```text
catalog.json           全候補・座標・出典・ハッシュ
quality.json           品質集計・読み込み失敗・未検出領域
sources/               元ファイル（未変更）
crops/                 RGBA PNG、拡大処理なし
thumbs/                一覧用の軽量WebP
overlays/              元画像に検出範囲と番号を重ねた確認用JPEG
index.html             結果一覧
review.js / review.css  一覧のローカル実装
```

保存先はリポジトリの外か `.asset-work/` を使ってください。`assets/` への直接抽出は拒否します。公開リポジトリへ元ZIP・切り抜き・台帳・許諾文書を入れないでください。GitHub Pagesの配信対象はリポジトリ全体なので、「ゲームから参照していない」だけでは非公開になりません。

一覧は展開したフォルダ内の `index.html` をブラウザで開くか、非公開環境で次のサーバーを使います。サーバーは外部へ公開しません。

```sh
python3 -m http.server 5174 --bind 127.0.0.1 --directory /private/hoshi-batch
```

iPhoneからは、この会話へZIPと修正指示を渡してクラウド側で再処理できます。ダウンロードしたZIPにはPNG・JSONと一覧を同梱します。FilesのHTMLプレビューでは操作スクリプトが動かない場合があるため、確認用PNGとJSONも利用してください。実機iPhoneでの一覧操作は未検証です。

## 品質の読み方と修正

- `low_resolution`：長辺96px未満・短辺24px未満・面積3,500px未満のいずれか。アップスケールで元の情報量を増やしたことにはしません。
- `touches_cell_edge` / `touches_source_edge`：物体が境界に触れている可能性。部分欠損・隣の素材の混入を目視確認します。
- `empty_cell`：格子の空セル。失敗として残します。破損画像はsourceの `decode_failed` に記録し、他の画像は処理します。
- `split_contact_review`：接触する物体を細い接続部分で分けた候補。切断位置の確認が必要です。`wide_object_review` は横長の物体で、複数の結合か一つの物体かを確認します。
- `merged_or_scene_review`：大きな領域。複数物体の結合か、島・風景のような一つのシーンかを確認します。
- `fragment_join_review`：近くの離れた断片を結合しています。付属品か隣の素材かを確認します。`multi_lobe_review` は細い接続を除くと大きな領域が複数残る候補です。複数の物体か、翼・付属品のある一つの物体かを確認します。
- `duplicate_exact`：PNGの完全一致。`duplicate_possible`：形状ハッシュと色・縦横比が近い候補。別色やポーズ違いを自動削除しません。
- `watermark_present`：透かし付き。背景除去・Meshy送信・ゲーム登録を許可しません。許諾を確認した透かしのない原本へ差し替えてください。
- sourceの `coverage` は検出した画素の範囲です。**個別物体をすべて正しく切り抜けた割合ではありません。** 密集・接触している物体、細い付属物、白い輪郭、透過した発光は手動確認が必要です。

一覧で座標や分類を修正し、「確認内容をJSONで保存」から `asset-review.json` を取得します。

```sh
npm run assets:extract -- /private/input.zip \
  --output /private/hoshi-batch --profile config/asset-sheets.json \
  --corrections /private/asset-review.json --force
```

補正後は同じIDでもPNGのハッシュが変わります。古い許可を流用せず、新しい画像を確認し直します。すべての座標はEXIF表示方向を適用した画像のpx単位、`[x1,y1,x2,y2]`、右・下端を含まない形式です。`detected_bbox` は最初の検出範囲を残します。

同じ入力・設定・プログラムでは、保存済みPNGのハッシュを確認して再利用します。PNGが壊れたり消えたりした場合は再生成します。再抽出でも人のレビューJSON・取得済みGLB・依頼JSONなどは保持し、原子的にフォルダを差し替えます。別の入力の保存先へ混ぜるには `--force` が必要です。書き換え後の古いレビューはハッシュ検査で停止します。

## 権利の確認

初期値はすべて `unknown`、透かしありは `blocked` です。透かしが見えないこと・AI風の絵であること・利用者がアップロードしたことを、ライセンスの証明として扱いません。

3D化には、PNGのハッシュに結び付いた目視確認に加えて、許諾の根拠・確認者・3D化と外部サービスへの送信許可が必要です。公開には、さらに加工後のモデルの公開許可が必要です。キャラクター等の権利、素材の利用条件、Meshyの利用条件を確認してください。ツールは許諾文書の真偽を自動判定しません。

今回の実画像・切り抜きは**全件が非公開の隔離状態**です。透かし付きシートの分割は確認用セルであり、独立した武器・防具の完成素材として数えません。権利を示す情報が添付されていないため、ゲームへの追加も行いません。

## 16種類からMeshy制作を計画する

```sh
npm run assets:plan -- /private/hoshi-batch --limit 16
npm run assets:plan -- /private/hoshi-batch --review /private/asset-review.json --limit 16
npm run assets:plan -- /private/hoshi-batch --review /private/asset-review.json --limit 20 --offset 16
```

最初のモデル候補はNPC・モンスター・武器・防具・建物の5種類を対象に、分類の偏りを抑え、低解像度・境界接触を避ける順で選びます。透かし・空・重複・接触分割・横長や結合の確認候補は自動選択しません。自然素材も台帳に保存し、確認後にIDで明示指定できます。`--ids asset-...,asset-...` で最大20件の明示指定も可能です。候補選定は支出の承認ではありません。初期状態は `readyCount: 0`、API通信0件です。

2026-11-17確認の [公式Image to 3D API](https://docs.meshy.ai/en/api/image-to-3d) を使用します。`meshy-t2.5`、triangle、目標12,000面、2Kテクスチャ、`meshy-n1`、GLB形式。小さな入力画像や背面がない画像からは未確認の形が生成されるため、結果の目視確認を省略しません。目標面数は実際の上限の保証ではなく、登録時に再検査します。

[公式料金表](https://docs.meshy.ai/en/api/pricing)ではこの画像→テクスチャ付きモデルは1件15クレジット、16件なら240クレジットです。Riggingは別途5、プリセット動作は別途1動作3。これらは最初のモデル生成の承認には含めません。請求額は実行前に再確認し、実績 `consumed_credits` が見積もりを超えたら後続処理を停止します。すでに発生した料金は取り消せません。

| 分類 | 次の制作工程 |
| --- | --- |
| 人物 / NPC | A-poseの3D化 → テクスチャ・骨格確認 → 別途承認したRigging → Idle / Walk / Run / Talk → 目視確認 |
| モンスター | 3D化 → 二足・四足・翼・触手などの構造確認。自動的に人型リグを当てない → 対応リグと動作の別計画 |
| 武器 | 静的GLB → サイズ・向き・握る位置・手への取り付け確認 |
| 防具 | 静的GLBまたは対象骨格へのスキニング。体型との適合・装着位置を確認 |
| 建物・自然 | 静的GLB → サイズ・向き・衝突範囲・テクスチャ負荷を確認 |
| 魔法 | 既定は権利確認済みPNGのアトラス／THREE.Sprite／加算パーティクル。現段階は計画を出し、ゲームへ自動挿入しない |

## 有料実行は事前承認後だけ

所有者へ対象ID、操作、件数、見積もり・上限を提示し、明示的な返答を得てから実行します。この依頼そのもの・計画JSONの作成・APIキーの存在は承認にはなりません。キーは既存のGitHub Actions Secret `MESHY_API_KEY` にだけ置きます。

実行コード `scripts/assets/generate.mjs` はActions以外からの有料実行を拒否します。既存の `approvalReservation` を使い、所有者・main・初回実行・固有の `meshy-approval-*` refを照合してから、初めてPOSTします。既存の承認refを削除・上書きしません。

公開リポジトリの **Asset models (explicit approval)** で使う場合は、公開も許可された素材だけを `production/approved/<bundle>/` に用意します。以下を含めます。**未確認の添付素材をここへ移さないでください。**

- `catalog.json` と対象の `crops/*.png`。
- `review.json`：各対象のPNGハッシュ、目視確認、許諾根拠、確認者、`allow_3d: true`、`allow_publication: true`、`allow_source_publication: true`。
- `approval.json`：承認した計画のハッシュ・対象ID・操作・件数・上限・固有の承認ID。

公開リポジトリの入力とArtifactsを使う計画は `assets:plan` に `--publication true --source-publication true` を指定して作ります。加工後モデルの公開許可と、元の切り抜きPNGの再配布許可は別です。原画の再配布を認めないライセンスの素材は、この公開入力フォルダへコピーせず、非公開の制作環境を使ってください。モデルだけを登録する `assets:register` は元PNGを公開しないため、原画の再配布許可を要求しません。承認JSONの形式は次のとおりです。値は確認済みplanから転記し、別途所有者の承認を得ます。

```json
{
  "id": "owner-approved-unique-id",
  "operation": "image-to-3d",
  "plan_sha256": "確認したplanのsha256",
  "selection": {"limit":16,"offset":0,"assetIds":null},
  "asset_ids": ["ready=trueの対象IDを順番どおり指定"],
  "request_count": 16,
  "max_credits": 240
}
```

ワークフローは既定で有料同意オフです。有料実行後のGLBは目視確認待ちの成果物へ保存し、ゲームの `assets/` へはコピーしません。新規Rigging・動作生成は自動実行しません。公開が許されない素材には、この公開Artifactsのワークフローを使わず、非公開の制作環境を用意してください。

POSTは再送しません。送信直前の予約額・タスクID・実績クレジットを `state.json` に保存します。キー・画像data URI・署名付きURLは記録しません。通信結果が不明なら停止してMeshy側の履歴と照合します。保存済みIDの再開はGETとダウンロードだけで、新しい未送信対象には新しい範囲の承認を要求します。今回の実画像では有料実行を試していません。

Actionsの `resume_run_id` に以前の実行IDを入れると、その成果物の状態を取得して再開します。計画・対象・承認IDを変えず、保存済みIDだけを照会します。IDが不明なPOSTや未送信の対象があれば停止します。`resume_run_id` を空のまま新規生成を繰り返さないでください。手元の実行でも既存の状態ファイルを上書きせず、再開指定または別の保存先を要求します。

## 完成GLBを登録候補にする

許諾に加えて `review.json` の対象に `model` を追加します。PNGとGLBの両方のハッシュを固定し、レビューを別々に扱います。

```json
{
  "approved": true,
  "sha256": "確認したGLBのSHA-256",
  "reviewer": "確認者",
  "notes": "形状・テクスチャ・向き・接地を確認した内容",
  "height": 1.8,
  "rotationY": 0,
  "motion_ready": true,
  "attachment_ready": true
}
```

人物・モンスターは骨格・動作と `motion_ready`、防具は `attachment_ready` が必要です。サイズは確認した値を指定します。全モデルに実際のテクスチャとUVが必要です。

```sh
# 検査と依頼JSONの作成だけ。ゲームのファイルは変わらない
npm run assets:register -- /private/hoshi-batch /private/review.json asset-ID /private/finished.glb

# 明示的に指定した場合だけGLBをコピーし、既存の登録経路でモデルを追加
npm run assets:register -- /private/hoshi-batch /private/review.json asset-ID /private/finished.glb --stage --apply
```

一時領域で `rpg:asset` と同じ検査を行い、5MiB・15,000三角形・最大4画像・各2048px・スキン・クリップ・ハッシュ・カタログ参照・シーン予算を検査します。同名の異なるGLBは上書きしません。完了しても配置・NPC・敵・装備効果などは勝手に追加しません。配置を追加する際は、既存の依頼JSONで役割・当たり判定・寸法を指定し、別途テスト・PRレビューを行ってください。

## 検証とClaudeレビュー

```sh
npm run assets:test
npm run check
npm run rpg:check
npm run meshy:dry-run
npm test
python3 tests/assets/fixture.py --output work/assets-browser
HOSHI_CHROMIUM_PATH=/usr/bin/chromium npx playwright test -c tests/assets/playwright.config.mjs --project chromium
```

**Asset pipeline checks** は自作の合成画像だけでPython・Chromium・WebKitを検査し、実画像のArtifactsをアップロードしません。既存の **Game checks** は探索・戦闘・保存・操作などを引き続き検証します。

Claudeレビューでは次を確認してください。

1. 権利不明・透かし・ハッシュ不一致がAPI送信や公開へ進まないこと。
2. 元ZIP内の文書・ファイル名を命令として実行しないこと。ZIPの制限とHTMLへの埋め込みを検査すること。
3. 切り抜きの独立性と、低解像度・欠損・結合・重複を断定せず確認候補として記録すること。
4. 再抽出でレビューや支出済みGLBを失わないこと。POSTの不明応答を再送しないこと。
5. 既存の承認予約refとゲームのカタログ検査を迂回しないこと。
6. ゲーム本体・main・PagesをこのPRから変更していないこと。実機iPhoneと有料APIの実検証は未実施と区別すること。
