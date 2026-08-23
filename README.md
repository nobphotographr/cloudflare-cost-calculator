# Cloud Cost

Cloudflare R2、Workers、D1の公開価格から、月額利用料をブラウザ上で試算する静的Webアプリです。

## 現在の範囲

- R2 Standard / Infrequent Access
- R2の保存期間、Class A / B操作、取り出し料金、無料枠、課金単位への切り上げ
- Workers Free / Paidのリクエスト、CPU時間、Paid基本料金
- D1 Free / Paidの行読み取り、行書き込み、保存容量
- USDと参考円換算
- 用途別プリセット

試算はブラウザ内だけで行います。Cloudflare OAuthによる実績値の読み取りは次期実装です。

## ローカル確認

```bash
npm test
npm run serve
```

`http://127.0.0.1:4178/` を開きます。

## 料金ソース

- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)

料金設定は `assets/pricing.js` に更新日付きで集約しています。

## 免責・商標

本ツールはCloudflare, Inc.の公式サービスではありません。税、為替手数料、契約固有の割引、掲載対象外のCloudflare製品は含みません。Cloudflare、R2、Workers、D1はCloudflare, Inc.の商標または製品名です。
