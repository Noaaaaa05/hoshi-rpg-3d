# iPhoneから使うMeshyモーション自動化（Ver.0.2.3）

## 今回できたことと未実行のこと

初期状態は **dry-run、Meshy APIリクエスト0件、クレジット消費0** です。APIキーは不要です。現在の主人公のIdle / Walk / Run / Attackと全ゲーム機能を維持しています。今回こちらでは生成用キー・API Rigging IDを登録・使用していません。有料実行前に設定が必要です。新しい5動作の生成品質・実機iPhone性能は未検証です。テスト用の既存クリップを生成済みモーションとして公開していません。

| 処理 | 実装 | 初期状態 |
| --- | --- | --- |
| 主人公・骨格・収録クリップの調査 | ローカルGLB検査 | 実行可能 |
| 対象・プロンプト・料金の計画 | オフラインdry-run | 実行可能、課金なし |
| Text to Motion → Animation → GLB | 公式APIスクリプト | 明示的な有料実行のみ |
| 骨格互換・速度・接地検査 | 不一致は反映停止 | 実装済み |
| ゲームへの登録・テスト・GitHub反映 | アニメーション専用GLB → manifest → テスト → ブランチ / PR | 検査合格時のみ |
| GitHub Pages公開 | 従来どおりmainを使用 | PRマージ後、既存設定で公開 |

自然言語の指示を公開ゲームからMeshyへ送る機能は設けていません。iPhoneのGitHub画面からActionsを実行し、プロンプトはGitHubで設定ファイルを編集できます。生成から反映候補の作成までは自動化し、生成品質の最終確認はPRで行います。

## 調査結果

基準main：`bb10f488f98bf70268e5e20d17e1b8f68501a232`。

| ファイル | サイズ / 三角形 | 骨格・動作 |
| --- | --- | --- |
| `assets/models/hero.glb` | 2,157,204 bytes / 119,808三角形 | 骨格・クリップなし |
| `assets/models/hero_animated.glb` | 1,511,344 bytes / 10,112三角形 | 1スキン、66関節、Idle_03 / Walking / Running / Attack |

両方とも画像・マテリアルが未収録です。既存の表示用主人公と元GLBは変更しません。APIから返る別モデルで主人公を置き換えず、互換性を検証した骨の動作だけを現在のモデルへ適用します。

## 最初の無料確認（iPhone Safari）

1. [GitHub ActionsのMeshy motions](https://github.com/Noaaaaa05/hoshi-rpg-3d/actions/workflows/meshy-motions.yml) を開きます。表示されない場合はSafariの「デスクトップ用Webサイトを表示」を使います。
2. **Run workflow** → `mode: dry-run`、`max_credits: 0`、`confirm_paid: false` のまま実行します。キーの登録は不要です。
3. 終了後のSummaryと `meshy-report` Artifactを確認します。`plan.json` に5対象、予定リクエスト、料金、モデル調査結果が出ます。main・モデル・manifestは変更しません。

ローカルでも `npm run meshy:dry-run` で同じ確認ができます。対象指定例：

```sh
npm run meshy:dry-run -- --targets roll,land --motion-mode swift --max-credits 12
```

## 有料実行前に必要な設定

### APIキー

Meshy Developer PlatformでAPIキーを作り、**キー側にも月間クレジット上限**を設定してください。GitHubの Settings → Secrets and variables → Actions → Secrets に **`MESHY_API_KEY`** として保存します。チャット、公開コード、manifest、ゲーム画面へキーを貼り付けないでください。ワークフローは有料生成ステップだけにSecretを渡します。

### API側のRiggingタスクID

Animation APIの `rig_task_id` は、**同じAPIアカウントで成功したRiggingタスク**のIDです。Web版モデルのURL、GLBのファイル名、Web版でのアセットIDを代用できるとは限りません。利用可能なAPI Rigging IDがあれば、GitHub ActionsのVariablesに **`MESHY_RIG_TASK_ID`** を登録するか、実行フォームに入力してください。スクリプトはGETで成功状態とGLBの骨格を確認してから、有料POSTへ進みます。

既存モデルをAPI側で利用できない場合：

1. Meshy Web版から、UVとベースカラーテクスチャが埋め込まれた、+Y上・+Z正面の人型GLBを取得します。A/Tポーズで四肢が明確なモデルを使います。
2. **現在の2つのGLBはテクスチャがないため、そのまま自動再リギングしません。** まずテクスチャ付きの原本が必要です。Rigging APIはテクスチャなしモデルを不向きな対象としています。
3. 別途費用を確認したうえで、公式 `POST /openapi/v1/rigging` に `model_url`、適切な `height_meters`、`skeleton_template: "mixamo"`、必要に応じ `include_fingers: true` を送ります。URLはMeshyが取得できるHTTPS GLBにします。自動化スクリプトはこのPOSTを実行しません。
4. 成功したAPI Rigging IDを登録します。**Mixamoという名称や同じ骨数だけで互換と判断しません。** 骨名・階層・レスト姿勢・単位・逆バインド行列が現在の主人公と一致しなければ、生成開始前に停止します。
5. 再リギング結果が異なる場合は、Blender等で現在の66関節へのリターゲットを行い、同じレスト姿勢で書き出すか、既存4動作を含む主人公一式の移行を別作業で行います。自動的な骨名置換や無理な変形はしません。

### 料金と範囲

公式料金の確認日：2026-11-16。

| モード | 1動作（生成＋適用） | 5動作 | 再Rigging |
| --- | --- | --- | --- |
| swift | 3＋3＝6クレジット | 30 | 別途5 |
| prime | 10＋3＝13クレジット | 65 | 別途5 |

`config/meshy-motions.json` でプロンプト、生成時間、クリップ名・区間、料金見積もり、ハード上限を設定します。Text to Motionは **2〜10秒、0.5秒刻み、プロンプト最大400文字** です。

既存の回避は0.36秒、着地表示は0.2秒です。生成された2秒全体を高速化すると不自然になるため、再生倍率が2.5倍を超える場合は反映を止めます。`range: [開始秒, 終了秒]` を、実際の前転・ステップ・着地を含む区間に調整してください。必要な動作がその区間に収まらなければ採用しません。適切な区間を未確認のまま、自動切り抜きで動作を完成したことにはしません。

`max_credits` は**その実行の予定予約額の上限**です。POST前に予約し、完了後の `consumed_credits` と照合します。公式料金が変わった場合、最後のリクエストですでに費用が発生し得るため、絶対的な請求上限を保証しません。Meshy側のキー上限を併用してください。他の実行・Web版・別キーの支出はこのスクリプトでは管理しません。リトライで予約額を減らしたり、推測した返金を充当したりしません。

## 有料実行と結果の反映

1. 先にdry-runの対象・概算を確認します。最初は `targets: roll` のように1動作を推奨します。
2. `mode: generate`、対象、`swift` / `prime`、正の上限、Rigging IDを設定し、`confirm_paid` を明示的にオンにして実行します。初期値のままでは生成しません。
3. 公式の `/text-to-motion` で作成・ポーリングし、そのタスクIDを `/animations` の `motion_task_id` に渡します。GLB結果を取得し、元データを `meshy-report` に保存します。生成GLBは25MiBまで、採用するアニメーション専用GLBは2MiBまでです。
4. 骨格、有限のキーフレーム、ボーントラック、再生倍率、31姿勢での全身の地面貫通を検査します。不合格ならゲームのファイルを変更せず、ソースGLBとタスクIDをArtifactへ残します。
5. 全対象が合格した場合だけ、メッシュ・画像を除いた `assets/models/motions/<動作>-<内容ハッシュ>.glb` とmanifestを準備し、単体・ブラウザテストを実行します。
6. テスト成功後、`meshy/motions-<run ID>-<attempt>` ブランチへコミットしPRを作ります。GitHubでActionsからのPR作成が許可されていなければ、ブランチのみ保存されます。Settings → Actions → General → Workflow permissionsで「Allow GitHub Actions to create and approve pull requests」を有効にするか、iPhoneからそのブランチのPRを開いてください。自動承認・自動マージは行いません。
7. Artifactのブラウザ画像・GLBを確認し、PRをmainへマージします。公開は既存GitHub Pages設定に任せます。APIキーや作業レポートをコミットしません。

## 失敗・再開・二重課金対策

- 状態はArtifactの `state.json` に、タスクID・予約額・確認済み消費額だけを保存します。キー、Authorization、署名付きダウンロードURL、APIの生エラー本文は保存しません。
- POSTは自動再試行しません。送信直前に予約を保存し、通信切断などでIDが不明なら `uncertain: true` のまま停止します。Meshy側の履歴で照合するまで新規生成を繰り返さないでください。
- IDが保存できている場合は、同じ対象・モード・Rigging ID・生成プロンプト・予算で、前回の `resume_run_id` を指定します。保存済みタスクを再利用し、必要な未作成タスクだけを作ります。**クリップ選択とrangeは、再開前に変更できます。** 不確定なPOSTが残る場合は再開も停止します。
- 新しいrunで `resume_run_id` を空にすると新規生成です。以前の支出は別途かかるため注意してください。
- Text to Motionの結果は3日保持のため、期限内にAnimationへ渡す必要があります。期限切れ・削除済みタスクを勝手に再生成しません。中断してもサーバー上の処理や課金を取り消すことはできません。
- GitHubのArtifact保持は14日です。Artifactが失われた場合や上限に達した場合は、Meshy側の記録を確認してから次の計画を作ります。

## ゲーム内の操作と品質対策

- 前方入力または入力なし＋回避：前転。横／後方入力＋回避：主人公がボタン入力時に向いていた方向を基準に左右／後方ステップ。ステップ中は向きを保持します。スティックと右側カメラ、攻撃、ジャンプ、ダッシュ、同時タッチは従来のままです。
- 距離3.6m・時間0.36秒、ST22、無敵0.34秒、再使用待ち0.8秒、木・岩の衝突は維持します。着地は物理処理の空中→地上遷移で検出します。
- AnimationMixerで動作の重みを補間し、終了時はその時点の歩行／走行／待機へ移ります。移動中に待機を強制しません。着地動作も停止時だけ再生し、移動・攻撃・回避が優先します。
- 水平ルート移動を除去し、当たり判定の移動と二重に動くことを防ぎます。回避・着地の時間をゲームのフェーズに合わせます。通常時は足裏の少数頂点、前転中は各骨に属する表面の代表点を支持点として高さを補正します。
- 前転を足裏だけで接地させると逆さの姿勢で頭が地面へ入るため、前転時は全身の支持点を使います。採用前は全頂点の31姿勢検査で3.5cmを超えるめり込みを拒否します。キーフレーム間の全時刻の無貫通や、足滑りの完全除去を保証するIKではありません。生成結果の接地・足運び・開始終了姿勢は目視確認が必要です。
- 読み込み失敗、チェックサム・骨格不一致は該当モーションだけをスキップし、現在の主人公と操作を維持します。未生成の状態では追加GLBをダウンロードせず、従来の4動作を使います。

## テスト

`npm run check`、`npm test`、`npm run test:browser` を使用します。料金を使うAPI呼び出しはテストしません。単体テストでは明示的な模擬APIと既存Idleクリップを配線検証用データとして使います。ブラウザもテスト内だけでモーションファイルを差し込みます。

対象：dry-runのネットワーク0件、予算・同意ゲート、キー非露出、異常POSTの再送防止、再開、骨格不一致、5ファイルの保存とmanifest登録、過度な高速化の拒否、回避方向・着地・滑らかな切り替え、ポーズ停止、読み込み失敗時の継続、既存の探索・戦闘・育成・保存・複数指操作。

## 公式仕様

- [Text to Motion API](https://docs.meshy.ai/en/api/text-to-motion)
- [Animation API](https://docs.meshy.ai/en/api/animation)
- [Rigging API](https://docs.meshy.ai/en/api/rigging)
- [料金表](https://docs.meshy.ai/en/api/pricing)
- [APIキー・キー単位の月間上限](https://docs.meshy.ai/en/api/authentication)

料金・パラメーターは変更される可能性があります。有料実行前に公式仕様と `credits` の設定を再確認してください。
