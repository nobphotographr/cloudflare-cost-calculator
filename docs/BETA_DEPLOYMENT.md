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

## Windows側デプロイメモ

Documents配下の `.wrangler/tmp` ではビルド出力が `Access is denied` になる場合がある。その場合は、許可済みの別ディレクトリを `--outdir` に指定してから `--keep-vars` 付きでデプロイする。

## OAuth実機確認の残課題

1. access token期限前のrefreshを実機で確認する。
2. 接続解除時のrevokeとD1セッション削除を実機で確認する。
3. R2利用のあるアカウントで保存量・Class A/Bを請求値と照合する。
4. Workers・D1の集計値をDashboard表示と最終照合する。

client secretや暗号化secretの値はリポジトリ、課題表、ログへ保存しない。
