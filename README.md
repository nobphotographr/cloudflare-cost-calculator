# Cloud Cost

Cloudflare R2、Workers、D1の公開価格から月額利用料を試算し、OAuth接続後は直近30日のAnalytics実績を自動反映するWebアプリです。

## 現在の範囲

- R2 Standard / Infrequent Access
- R2の保存期間、Class A / B操作、取り出し料金、無料枠、課金単位への切り上げ
- Workers Free / Paidのリクエスト、CPU時間、Paid基本料金
- D1 Free / Paidの行読み取り、行書き込み、保存容量
- USDと参考円換算
- 用途別プリセット
- Cloudflare OAuth Authorization Code Flow + PKCE
- R2、Workers、D1のアカウント実績とリソース別内訳
- 今月実績からの月末予測とWorkers CPU P50–P99レンジ
- リソース別の料金寄与ランキングと月額予算アラート
- 400日間の日次利用スナップショット（アカウント合計のみ）
- refresh token、接続解除、期限切れセッションの自動削除

手入力の試算はブラウザ内だけで行います。接続機能は集計済みAnalyticsのみを取得し、R2のファイル本体・オブジェクト名・D1の行データは取得しません。

## ローカル確認

```bash
npm install
npm run db:migrate:local
npm test
npm run check
npm run dev
```

`http://127.0.0.1:8787/` を開きます。OAuth未設定でも「デモデータで確認」から接続後の画面を検証できます。静的画面だけの確認は `npm run serve` と `http://127.0.0.1:4178/` を使います。

## OAuth接続

CloudflareのOAuth client、D1、Worker secretsが必要です。設定値と実機検証の手順は [docs/OAUTH_SETUP.md](docs/OAUTH_SETUP.md) にまとめています。

現在のβ版は `https://cloudflare-cost-calculator.nobu-8yashi.workers.dev/` へデプロイ済みです。OAuth client設定が完了するまでは手入力とデモ接続を利用できます。

## 料金ソース

- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)

料金設定は `public/assets/pricing.js` に更新日付きで集約しています。

## 免責・商標

本ツールはCloudflare, Inc.の公式サービスではありません。税、為替手数料、契約固有の割引、掲載対象外のCloudflare製品は含みません。Cloudflare、R2、Workers、D1はCloudflare, Inc.の商標または製品名です。
