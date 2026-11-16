# ChatGPT Workで3D RPGを開発する

Claude Codeから進める場合も、このファイルの手順とゲートをそのまま使う。本文の「Work」は、ChatGPT WorkまたはClaude Codeのセッションと読み替える。Claude Codeだけに当てはまる注意は [CLAUDE_CODE.md](CLAUDE_CODE.md) にある。

リポジトリを指定して、ゲーム内でどうなってほしいかを書く。Workが最新の `main` を取得し、既存データを確認して、追加データまたはコード変更を作る。ローカルとGitHubで検査し、マージ・Pages配信の順に確認する。作品の内容と画面上の動作を同じPRから追跡できる。

> 星灯りの森 3Dに、見張り番ミナと北東の見張り台を追加して。見回りを済ませて報告すると短剣と三連撃が使えて、ミナを仲間にできるようにして。既存素材と無料の制作手段を使い、テスト合格後、公開URLで確認して。

## データを追加する

`assets/rpg/catalog.json` が追加コンテンツの一覧。`docs/requests/watchpost.json` は上の依頼を実装した例。依頼JSONは `version`、`summary`、`changes` を持つ。各変更は `op`（`add`、`replace`、`remove`）、`type`、`id`、追加・差し替えの場合は `value` を指定する。すべての変更をまとめて検査するため、同じ依頼で作るモデルや会話を参照できる。

```sh
npm run rpg:apply -- docs/requests/watchpost.json
npm run rpg:apply -- docs/requests/watchpost.json --write
npm run check
npm run rpg:check
npm test
npm run test:browser
```

最初のコマンドで変更後のファイルを検査し、`--write` で成功した内容をカタログに保存する。適用済みの例をもう一度追加するとIDの重複で止まる。削除は登録を外す操作。参照が残る場合は変更全体が止まる。Gitで一緒に変更するなら、まず最新の `main` を基点とする作業ブランチを用意する。

| データ | ゲームでの使い方 |
| --- | --- |
| `models` | 既存GLBを再利用するか、見張り番・灯り・小屋などの低ポリゴン形状を指定する。GLBはモデルの寸法、骨数、ハッシュ、内蔵テクスチャ、容量と三角形を検査する。 |
| `motions` | 骨格付きGLB内のクリップ、または同じバインド姿勢のアニメーション専用GLBを登録する。クリップ名、区間、速度、ループ、ブレンドを指定する。 |
| `actors` と `placements` | NPC・敵・仲間にモデル、状態別モーション、会話または戦闘能力を割り当て、既存フィールドへ置く。敵は既存の追跡・攻撃・帰還処理を使う。 |
| `zones` | 既存地形上の名前付きエリア、オブジェクトの当たり判定、移動先を登録する。移動はエリア中心付近でボタンを押す方式。 |
| `dialogues` と `quests` | 会話の選択肢から受注・報告し、訪問や敵の討伐を進行条件にする。条件を満たすとアイテムを受け取れる。 |
| `items` と `skills` | 持ち物に記念品・回復品・装備を表示する。装備の攻撃力と、技ごとのスタミナ・威力・命中タイミングを設定する。 |

会話は近くの「話す」ボタンまたはPCの **F**。技は持ち物に表示されるボタンまたはPCの **L**（使用可能な先頭の技）。進行、獲得アイテム、装備、仲間は既存の端末内セーブに追加される。見回りの例では、開始地点の右側にいるミナに話し、北東の小屋と灯りを訪ねて戻る。

## PRと公開

1. コードやワークフロー、モデルファイルの差し替えを含むPRは、差分をレビューし、`Game checks` の結果を待ってWorkでマージする。
2. 既存エントリを保った追加データだけなら、同じリポジトリの `codex/rpg-content-<作業名>` ブランチから `main` へPRを作る。PRのファイルは `assets/rpg/catalog.json` の1件。
3. `RPG content release` は既定ブランチのコードを実行し、作成者・PRとブランチ・最新 `main` との親子関係・同じSHAの構文チェック、カタログ、単体、ブラウザテストを照合する。チェック失敗、追加以外の差分、別リポジトリ、古いSHAは停止する。
4. ActionsにマージとPages buildの権限があれば、確認済みのSHAを指定してマージし、Pagesのビルドを要求する。既存のPages公開元は `main /(root)`。
5. Actions側で権限やイベントの問題がある場合、`npm run rpg:release -- <PR番号> <確認したhead SHA>` で同じゲートを検査し、WorkのGitHub接続でマージする。すでにマージ済みならデプロイ結果を調べる。再度マージしない。

マージ後はPagesジョブ、公開URL、変更したカタログやGLBの配信を確認する。配信物か公開URLを起動して操作テストし、iPhone実機とブラウザのモバイル設定を区別して報告する。

参照 [GitHubの自動マージ](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/automatically-merging-a-pull-request) · [Pagesのビルドを要求するAPI](https://docs.github.com/en/rest/pages/pages#request-a-github-pages-build)

## Meshy

**Meshy existing task (free)** は、タスク種別と既存UUIDでGETを行う。`motion`、`animation`、`rigging`、`text-to-3d`、`image-to-3d` を選べる。必要なら完了済みのデータをActions成果物に取得する。取得先はMeshyのアセットホスト。キーはGitHub Secretsの `MESHY_API_KEY` を参照し、保存するメタデータは状態、形式、ハッシュなどに限る。SwiftはBVH、PrimeはFBX、対応するモデル・リグ・アニメーションはGLBを取得する。

66ボーンの前転BVHは既存の `scripts/meshy/retarget-forward-roll.mjs` で再現できる。別骨格のBVHやFBXはBlenderなどでレスト姿勢、軸、ボーン割り当てを確認してからGLBへ書き出す。新しい動作名の登録はカタログでできる。プレイヤー側の固有アクションに新しいクリップを結び付けるときは、入力と状態遷移も追加してテストする。

有料生成は、現行の料金で対象・回数・上限を提示し、ユーザーの明示承認を取得してから行う。既存の `Meshy motions` は生成時に `confirm_paid`、`max_credits` と固有の `approval_id` を使う。最初の有料リクエストの直前にGit refで一度だけ承認を予約する。通信結果が不明ならタスクを照会し、同じ承認で再送しない。すべての対象のタスクIDが保存済みなら、以前の状態を指定してGETによる取得を進められる。今回使った前転の旧ONE SHOTワークフローは、既存タスクとして扱う。

参照 [Text to Motion](https://docs.meshy.ai/en/api/text-to-motion) · [Animation API](https://docs.meshy.ai/en/api/animation) · [料金](https://docs.meshy.ai/en/api/pricing)
