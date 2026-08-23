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

## OAuth実機確認に残る設定

1. private OAuth clientを作成する。
2. 発行されたclient IDとclient secretをWorker secretsへ登録する。
3. Account Analytics Readのscope IDを`OAUTH_SCOPES`へ設定する。
4. 実アカウントで接続し、`/accounts`がAnalytics scopeだけで使えるか検証する。
5. 不足する場合だけAccount Settings Readを追加する。

client secretや暗号化secretの値はリポジトリ、課題表、ログへ保存しない。
