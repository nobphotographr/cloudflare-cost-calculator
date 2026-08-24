# β版デプロイ状況

最終更新: 2026-08-24

## 公開先

- Worker: `cloudflare-cost-calculator`
- URL: `https://cloudflare-cost-calculator.nobu-8yashi.workers.dev/`
- D1: `cloud-cost-sessions`（APAC）
- Cron: 毎日 `03:17 UTC`

## 完了済み

- OAuthセッション、利用履歴、予算設定のD1 migration
- `SESSION_ENCRYPTION_SECRET`
- `OAUTH_REDIRECT_URI`
- CSP、同一オリジンPOST検証、HTTPSでのSecure Cookie
- 公開ページと `/api/health` の応答確認
- private OAuth clientでの実アカウント接続
- `account-analytics.read account-settings.read`によるR2・Workers・D1 Analytics取得
- Workers、D1の実績値反映とR2未使用時の0表示
- Windows引き継ぎ後のOAuth fetch修正を `npx wrangler deploy --keep-vars` で反映済み（Version ID: `733ac9fc-d825-44c0-ae6a-998b2bd41cd7`）
- 外部予算Webhook通知の実装、atomic lease・送信先防御、OAuth切断強化を本番反映済み（Version ID: `8316842a-38ae-4141-a309-8361167f1dd0`）。`0003_budget_notifications.sql`も適用済みで、未適用migrationはない。

## Windows側デプロイメモ

Documents配下の `.wrangler/tmp` ではビルド出力が `Access is denied` になる場合がある。その場合は、許可済みの別ディレクトリを `--outdir` に指定してから `--keep-vars` 付きでデプロイする。

## 現在の本番状態と反映待ち

- Cloud Cost: 2026-08-24に`0003_budget_notifications.sql`を本番D1へ適用し、`npx wrangler deploy --keep-vars`でVersion `8316842a-38ae-4141-a309-8361167f1dd0`を公開した。`/api/health`はHTTP 200、Webhook設定UIと履歴APIの初期表示も正常。
- migration適用前のCloud Cost D1 Time Travel bookmark: `00000010-00000000-000050d1-d81a1102cb4807000e23b09c6c2a579c`
- Handoff: 2026-08-24にD1 migration `0003`から`0018`を適用し、管理画面のアップロード前R2追加費用目安を本番反映した。Version Metadata復旧後のVersionは`a1b42cc7-8cd8-44d7-9cb8-ca16e4472791`。
- 2026-08-24に承認を得てCloud Costの接続解除・手動revoke・再接続を実施した。アプリ側のセッション・設定削除は成功し、Connected Applicationsの認可は残った。token revocation endpointの成功・失敗を画面へ返さない従来実装だったため、token自体の失効成否はこの試行からは判別できない。Dashboardから手動解除した後、`account-analytics.read account-settings.read`の2権限で再認可し、Workers 595 requests、D1 676 readsを含むAnalytics再取得まで成功した。
- 上記を受けて、refresh/access tokenを独立に失効し、どちらかの要求が失敗した場合はConnected Applicationsでの手動確認を案内する修正を追加した。本番反映後の再切断では両revoke要求が成功し、ローカル接続状態が削除された。Connected Applicationsの一覧行は残るが、再接続時に2権限のconsentが再表示されたためtoken失効を確認できた。再認可後はWorkers 621 requests、D1 712 reads、R2 0を取得した。
- その後の既存接続でWorkers・D1がHTTP 401、R2が429を返す状態を実機観測した。token応答に期限がない場合は自動refreshを行わず、401も製品別の0件表示に変換していたことが原因。401を認証失敗として上位へ返し、refresh tokenで1回だけ更新して全datasetを再取得する修正を追加した。429は権限エラーと分け、時間を置いた再取得を案内する。
- D1 restoreは未実行。Handoffの本番データ削除・OAuth revokeも未実行。

## OAuth実機確認の残課題

1. 401時のrefresh修正を本番へ反映し、既存接続が再認可なしでAnalytics取得へ復帰することを確認する。
2. R2は空bucketの保存量0 Bが一致した。旧比較はアプリのUTC月初集計に対してDashboardの請求期間表示を使っており、画面側も誤って「直近30日」と案内していた。同じUTC開始・終了時刻を表示する修正後にClass A/Bを再照合する。
3. D1は3 database IDの対応を確認した。旧比較はアプリのUTC月初集計とDashboardの30日表示で期間が一致していなかったため参考値とし、同一UTC期間で再照合する。WorkersのDashboard表示はCloudflare側の取得エラーが解消した後に同じ期間で確認する。

client secretや暗号化secretの値はリポジトリ、課題表、ログへ保存しない。
