# 料金表の更新手順

最終更新: 2026-08-24

## 確認対象

1. [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
2. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
3. [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)

## 更新方法

1. 3つの公式ページで単価、無料枠、課金単位、最低保存期間を確認する。
2. `public/assets/pricing.js` の `PRICING` と `version` を更新する。
3. 公式ページの計算例と既存テストの期待値を比較する。
4. `npm test` を実行する。
5. 代表ケースを画面で確認する。
   - R2 Standard: 100GBを3日保存
   - R2 Infrequent Access: 100GBを3日保存、2回取得
   - Workers Paid: 1,500万request、平均CPU 7ms
   - Workers FreeとD1 Freeの上限超過警告
6. READMEと公開画面の確認日を合わせる。

`PRICING.version`から90日を超えると、公開画面の料金表表示へ「要確認」が追加される。
