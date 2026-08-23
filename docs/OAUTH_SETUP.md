# Cloudflare OAuth 接続手順

最終更新: 2026-08-24

## 1. Cloudflare側

1. Cloudflare DashboardでOAuth clientを作成する。
2. 開発中はprivate clientのままにする。
3. Redirect URIへ `https://<公開URL>/api/connect/callback` を登録する。ローカル実機検証ではCloudflareに登録可能なlocalhost URIを使用する。
4. Account Analyticsの読み取り権限を選択する。
5. アカウント一覧取得にAccount Settings Read等が必要か、private clientで確認する。

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
npx wrangler secret put OAUTH_REDIRECT_URI
npx wrangler secret put SESSION_ENCRYPTION_SECRET
```

`OAUTH_SCOPES`にはCloudflare Dashboardで発行されたscope IDを空白区切りで設定する。表示名を推測して設定せず、client作成画面の値を使う。

`SESSION_ENCRYPTION_SECRET`には十分に長いランダム値を使う。access tokenとrefresh tokenはこの値を鍵にAES-GCMで暗号化してD1へ保存する。

## 3. 実機確認

1. Cloudflareへ接続できる。
2. 複数アカウントの場合に対象を選択できる。
3. R2、Workers、D1のうち未使用製品があっても、他の取得結果を表示できる。
4. R2日次ピーク、Class A/B、Workers requests、CPU P50/P99、D1 rows・容量をDashboardと照合する。
5. token期限前のrefreshと、接続解除時のrevokeを確認する。
6. 接続解除後にD1のセッションが削除されることを確認する。

GraphQL Analyticsは保持期間とサンプリングの影響を受ける。画面上の金額は公式請求額ではなく、直近30日の集計値を公開料金へ当てはめた推定として扱う。
