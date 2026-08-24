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
- `account-analytics.read account-settings.read offline_access`によるR2・Workers・D1 Analytics取得とrefresh token発行
- Workers、D1の実績値反映とR2未使用時の0表示
- Windows引き継ぎ後のOAuth fetch修正を `npx wrangler deploy --keep-vars` で反映済み（Version ID: `733ac9fc-d825-44c0-ae6a-998b2bd41cd7`）
- 外部予算Webhook通知の実装、atomic lease・送信先防御、OAuth切断強化を本番反映済み（Version ID: `8316842a-38ae-4141-a309-8361167f1dd0`）。`0003_budget_notifications.sql`も適用済みで、未適用migrationはない。
- OAuth clientへ`Refresh Token` grantを追加し、更新失敗時の再接続案内と`offline_access`を本番反映済み（Version ID: `59958d74-3d4f-46b9-8c78-98f25c128c84`）。

## Windows側デプロイメモ

Documents配下の `.wrangler/tmp` ではビルド出力が `Access is denied` になる場合がある。その場合は、許可済みの別ディレクトリを `--outdir` に指定してから `--keep-vars` 付きでデプロイする。

## 現在の本番状態と反映待ち

- Cloud Cost: `0003_budget_notifications.sql`適用済み、未適用migrationなし。現在の本番Versionは`ad4763f3-9f94-494b-8a66-c4fc197b0bc7`で、`/api/health`、Webhook設定UI、履歴API、OAuth実績取得が正常。
- migration適用前のCloud Cost D1 Time Travel bookmark: `00000010-00000000-000050d1-d81a1102cb4807000e23b09c6c2a579c`
- Handoff: 2026-08-24にD1 migration `0003`から`0018`を適用し、管理画面のアップロード前R2追加費用目安を本番反映した。Version Metadata復旧後のVersionは`a1b42cc7-8cd8-44d7-9cb8-ca16e4472791`。
- 2026-08-24に承認を得てCloud Costの接続解除・手動revoke・再接続を実施した。アプリ側のセッション・設定削除は成功し、Connected Applicationsの認可は残った。token revocation endpointの成功・失敗を画面へ返さない従来実装だったため、token自体の失効成否はこの試行からは判別できない。Dashboardから手動解除した後、`account-analytics.read account-settings.read`の2権限で再認可し、Workers 595 requests、D1 676 readsを含むAnalytics再取得まで成功した。
- 上記を受けて、refresh/access tokenを独立に失効し、どちらかの要求が失敗した場合はConnected Applicationsでの手動確認を案内する修正を追加した。本番反映後の再切断では両revoke要求が成功し、ローカル接続状態が削除された。Connected Applicationsの一覧行は残るが、再接続時に2権限のconsentが再表示されたためtoken失効を確認できた。再認可後はWorkers 621 requests、D1 712 reads、R2 0を取得した。
- その後の既存接続でWorkers・D1がHTTP 401、R2が429を返す状態を実機観測した。token応答に期限がない場合は自動refreshを行わず、401も製品別の0件表示に変換していたことが原因。401を認証失敗として上位へ返し、refresh tokenで1回だけ更新して全datasetを再取得する修正を追加した。429は権限エラーと分け、時間を置いた再取得を案内する。
- Version `a43d0258-6797-4056-9c8f-6bacb0ac05c9`へ上記修正を反映した後、既存接続でR2・Workers・D1すべてのHTTP 401を再現し、自動復帰しないことを確認した。Cloudflareの公開OIDC設定は`refresh_token` grantと`offline_access` scopeを案内しているため、OAuth要求へ`offline_access`を追加した。token値を出さずrefresh token・期限の有無だけを記録し、更新拒否時は理由codeと再接続案内を返す。
- Version `59958d74-3d4f-46b9-8c78-98f25c128c84`へ反映後、OAuth clientのGrant typeへ`Refresh Token`を追加した。当初はclient側が未対応だったため`invalid_scope`を返したが、設定後の再認可ではcallback scopeに`offline_access`が含まれ、非機密metadataログでrefresh tokenと期限の両方を確認した。接続直後と手動再取得はいずれも成功し、R2 0、Workers 785→793 requests、D1 3,018 readsを取得した。
- 2026-08-24 07:12 UTCまでをR2 bucket MetricsのCustom期間・UTCで照合し、保存量0 B、Class A 20、Class B 10がアプリと一致した。R2請求概要は請求期間と課金用データ源が異なるため、Analytics比較には使用しない。
- 07:23 UTCの再取得ではWorkers requestsが`cloudflare-cost-calculator` 376、`cloudflare-handoff` 263、`handoff-installer` 178となりDashboardと一致した。Workers Metricsは7日超のCustom期間でNo dataだったため、月初以降の全リクエストを含むLast 7 daysで照合した。
- 同じ再取得でD1 readsがdatabase別に2502・261・348、writes合計459、storage合計364.544 kBとなり、DashboardのCustom期間表示（reads 2.5k・261・348、writes 266・123・70、storage 213 kB・77.82 kB・73.73 kB）と表示丸め内で一致した。
- Workers CPUはGraphQLを`scriptName + datetime`で分割していたため、時間bucket別P50/P99の加重平均がDashboardの期間全体quantileと一致しなかった。`scriptName`だけで期間集計し、サービス別P50/P99を内訳へ表示する修正をVersion `ad4763f3-9f94-494b-8a66-c4fc197b0bc7`へ反映した。
- 反映後の再取得ではrequestsがCloud Cost 404、Handoff 268、Installer 178でDashboardと一致した。CPU P50/P99（ms）はCloud Costがアプリ0.798/8.523、Dashboard 0.81/8.84で表示丸め内。Handoffは0.959/4.365対1.03/2.72、Installerは0.656/19.434対1.93/6.85だった。Dashboardが月初からのCustom期間をNo dataとするためLast 7 daysとの比較であり、adaptive datasetの期間・sampling差をCPU推定の既知制約として扱う。
- D1 restoreは未実行。Handoffの本番データ削除・OAuth revokeも未実行。

## OAuth実機確認の残課題

1. refresh token発行までは確認済み。access token期限切れ後、再認可なしでAnalytics取得へ復帰することを確認する。
2. Workers CPUはサービス別P50/P99を表示済み。Dashboardが7日超のCustom期間を返せるようになった時点で、アプリと完全に同じUTC期間を再照合する。

client secretや暗号化secretの値はリポジトリ、課題表、ログへ保存しない。
