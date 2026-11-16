# Claude Codeで3D RPGを開発する

このリポジトリは、ChatGPT WorkとClaude Codeのどちらからでも同じ状態を引き継いで開発できる。共通のルールは [AGENTS.md](../AGENTS.md)、進捗は [AUTOMATION_PROGRESS.md](AUTOMATION_PROGRESS.md)、データの追加と公開の手順は [RPG_AUTOMATION.md](RPG_AUTOMATION.md) にある。このファイルには、Claude Codeだけに当てはまる手順をまとめる。

## iPhoneから指示する

1. Claudeアプリの「Code」タブを開く。Safariなら [claude.ai/code](https://claude.ai/code) を開く。
2. リポジトリに `Noaaaaa05/hoshi-rpg-3d` を選ぶ。
3. ゲームの中でどうなってほしいかを日本語で書いて送る。
4. Claudeが変更を作り、検査を実行して、ブランチをGitHubへpushする。
5. 差分を確認してPRを作る。「PRを作って」と頼んでもよい。
6. PRの `Game checks` が合格したらマージする。`main` に入った変更は、GitHub Pagesが公開URLへ反映する。

作業はクラウド上で進む。アプリを閉じても止まらず、あとで同じ会話から続きを確認できる。GitHubとの連携は2026-11-17に確認した。セッションはリポジトリ所有者の権限で動く。

依頼の例：

> 森の奥に洞窟のダンジョンを追加して。入口は星降りの古木の北。中にコウモリの敵を3体置いて、奥の宝箱から新しい剣が手に入るようにして。テストに合格したらPRを作って。

## 変更の種類とマージ

| 変更の内容 | ブランチ | マージ |
| --- | --- | --- |
| `assets/rpg/catalog.json` への追加だけ | `codex/rpg-content-<作業名>` | `Game checks` の合格後、`RPG content release` が自動でマージしてPagesのビルドを要求する |
| コード、モデル、ワークフロー、ドキュメント | `claude/<作業名>` | `Game checks` の合格を確認し、所有者の了承を得てからマージする |

接頭辞 `codex/rpg-content-` は、リリースゲートが照合する固定の条件である。Claude Codeが作るPRも所有者の名義になるので、同じゲートを通る。ゲートの条件は [RPG_AUTOMATION.md](RPG_AUTOMATION.md) の「PRと公開」にある。

## 検査

| 検査 | Claude Codeのセッション | GitHub Actions |
| --- | --- | --- |
| `npm run check`、`npm run rpg:check`、`npm run meshy:dry-run`、`npm test` | インストールなしで実行できる | `Game checks` が実行する |
| `npm run test:browser`（Chromium、WebKit） | Playwrightのブラウザを入れられる環境だけ | `Game checks` が実行する |
| iPhone実機のSafari | 実行できない | 実行できない |

ブラウザテストをセッションで実行できなかったときは、PRの `Game checks` で確認し、報告にそう書く。実機での操作、発熱、描画速度は自動では確認できないので、確認が必要な点を報告に残す。

## 有料API（Meshy）

- APIキーはGitHub Actions Secretsの `MESHY_API_KEY` だけに置く。Claudeの環境変数、ファイル、チャットには入れない。
- 所有者の指示（2026-11-17）：全体のクレジット上限は設けない。
- 上限がなくても、有料の実行の前には対象、回数、見積もりクレジットを示して、所有者の返事を待つ。ゲーム内容を追加する依頼は、有料実行の承認にはならない（[AGENTS.md](../AGENTS.md)）。
- `Meshy motions` は実行のたびに `confirm_paid`、`max_credits`、固有の `approval_id` を必要とする。1回の実行で指定できる上限は、`config/meshy-motions.json` の `hardCreditLimit`（現在100）まで。
- dry-runと、`Meshy existing task (free)` による既存タスクの照会・取得は無料で実行できる。

詳しい手順と再送防止の仕組みは [MESHY_AUTOMATION.md](MESHY_AUTOMATION.md) にある。

## 見た目の方針

所有者の指示（2026-11-17）：3D RPGとして作る。ドット絵風の見た目や、箱を組み合わせた四角い見た目にはしない。

- 新しいキャラクター・敵・武器・建物・小物は、造形とテクスチャのある3Dモデル（GLB）で追加する。
- カタログの `procedural` プリセットは、GLBを読み込めなかったときの代替表示に限って使う。
- いまの仮の表示と置き換え対象は [AUTOMATION_PROGRESS.md](AUTOMATION_PROGRESS.md) の「見た目の方針と置き換え対象」にある。
