# Cloudflare OAuth 接続手順

最終更新: 2026-08-24

## 1. Cloudflare側

1. Cloudflare DashboardでOAuth clientを作成する。
2. Grant typeへ`Authorization Code`と`Refresh Token`を設定する。Cloudflareは`Refresh Token`追加時に`offline_access`をclient scopeへ自動追加する。
3. 開発中はprivate clientのままにする。
4. Redirect URIへ `https://<公開URL>/api/connect/callback` を登録する。ローカル実機検証ではCloudflareに登録可能なlocalhost URIを使用する。
5. `Account Analytics Read`を選択する（scope ID: `account-analytics.read`）。
6. `Account Settings Read`を選択する（scope ID: `account-settings.read`）。アカウント一覧の取得に使用する。
7. Workerの認可要求では`offline_access`を含める。期限切れaccess tokenをブラウザ操作なしで更新するためのrefresh token取得に使用する。

R2、Workers、D1それぞれの製品別Read scopeは、GraphQL Analyticsの集計取得には不要だった。Cloudflare API権限は必要最小限の上記2権限だけを指定する。

public clientへの変更にはドメイン確認が必要で、公開後はprivateへ戻せないため、実装とscopeの検証が終わるまで公開しない。

## 2. D1とWorker

```bash
npx wrangler d1 create cloud-cost-sessions
```

返された`database_id`を`wrangler.jsonc`の`SESSIONS`へ設定し、次を実行する。

```bash
npx wrangler d1 migrations apply SESSIONS --remote
npx wrangler secret put OAUTH_CLIENT_ID
npx wrangler secret put OAUTH_CLIENT_SECRET
npx wrangler secret put SESSION_ENCRYPTION_SECRET
```

`OAUTH_SCOPES`と`OAUTH_REDIRECT_URI`は公開値なので通常のWorker変数へ設定する。現在のscopeはCloudflare APIの2権限とtoken更新用の`offline_access`。

```text
account-analytics.read account-settings.read offline_access
```

Dashboardでsecretを管理したままCLIから更新するときは、既存secretを消さないよう`npx wrangler deploy --keep-vars`を使う。

`SESSION_ENCRYPTION_SECRET`には十分に長いランダム値を使う。access tokenとrefresh tokenはこの値を鍵にAES-GCMで暗号化してD1へ保存する。

## 3. 実機確認

1. Cloudflareへ接続できる。
2. 複数アカウントの場合に対象を選択できる。
3. R2、Workers、D1のうち未使用製品があっても、他の取得結果を表示できる。
4. 画面に表示されたUTC月初・終了時刻と同じ期間をDashboardへ指定し、R2日次ピーク、Class A/B、Workers requests、CPU P50/P99、D1 rows・容量を照合する。
5. token期限前のrefreshと、接続解除時のrevokeを確認する。接続解除後はCloudflare Dashboardの **My Profile → Access Management → Connected Applications** から対象アプリが消えていることも照合する。
6. 接続解除後にD1のセッションが削除されることを確認する。

GraphQL Analyticsは集計遅延、保持期間、adaptive samplingの影響を受ける。画面上の金額は公式請求額ではなく、UTC月初から現在までの集計値を公開料金へ当てはめ、同じ利用ペースが続く前提で月末へ補正した推定として扱う。

## 4. 2026-08-24 実機確認結果

- private OAuth clientからAuthorization Code Flow + PKCEで接続できた。
- `account-settings.read`追加後にアカウント一覧を取得できた。
- `account-analytics.read`でR2、Workers、D1の3クエリが成功した。
- WorkersのCPU quantileはGraphQLのマイクロ秒から料金計算用のミリ秒へ変換する。
- R2未使用アカウントは警告ではなく0として表示できた。
- 期限情報がないaccess tokenでも、GraphQLがHTTP 401を返した場合はrefresh tokenで1回だけ更新して全datasetを再取得する。refresh tokenを確実に要求するため`offline_access`も指定する。HTTP 429はrefreshせず、時間を置いた再取得を案内する。
- token更新または更新後のAnalytics認証が拒否された場合は、機密値をログへ出さず理由codeだけを記録し、画面で再接続を案内する。
- OAuth clientのGrant typeへ`Refresh Token`を追加後、再認可callbackで`account-analytics.read account-settings.read offline_access`を受け取り、refresh tokenとaccess token期限の両方が発行された。接続直後と手動再取得でR2 0、Workers 785→793 requests、D1 3,018 readsを取得した。
