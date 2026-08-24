# Cloud Cost 課題管理表

最終更新: 2026-08-24

| 順 | ID | 課題 | 優先度 | 状態 | 完了条件 |
| ---: | --- | --- | :---: | :---: | --- |
| 1 | CC-001 | 料金設定と計算エンジン | P0 | 完了 | R2、Workers、D1の公開料金、無料枠、R2の課金単位をテスト可能な関数として分離する。 |
| 2 | CC-002 | 接続不要の試算画面 | P0 | 完了 | 用途別入力、内訳、円換算、注意事項をPC・スマートフォンで操作できる。 |
| 3 | CC-003 | 計算精度のケース検証 | P0 | 完了 | Cloudflare公式例と100GB短期保存などの代表ケースがテストに一致する。 |
| 4 | CC-004 | アクセシビリティ・ブラウザ確認 | P1 | 完了 | キーボード操作、狭い画面、主要ブラウザで入力と結果更新に問題がない。 |
| 5 | CC-005 | 料金更新運用 | P1 | 完了 | 料金ソース、確認日、差分確認手順を定義し、古い料金であることを検知できる。 |
| 6 | CC-006 | Cloudflare OAuth client | P0 | 一部完了 | Authorization Code Flow + PKCE、2権限での実アカウント接続、Analytics取得を確認済み。refresh/access tokenの独立revokeと失敗時案内を本番反映し、切断後に再consentが必要になることからtoken失効とローカルセッション削除を実機確認した。Connected Applicationsの一覧行はtoken revoke後も残り、Dashboardのgrant削除とは別動作。token期限前refreshの実機確認を残す。 |
| 7 | CC-007 | Analytics読取scopeの実機検証 | P0 | 完了 | `account-analytics.read`でR2・Workers・D1を取得し、`account-settings.read`でアカウント一覧を取得できる。製品別scopeは不要。 |
| 8 | CC-008 | R2実績連携 | P0 | 一部完了 | 空bucketの保存量0 BはDashboardと一致。月初集計のClass A 20回・Class B 10回に対し、Dashboard請求期間はClass A 14回・Class B 21回だった。期間境界とcontrol-plane操作を含む指標差を切り分ける。 |
| 9 | CC-009 | Workers・D1実績連携 | P1 | 一部完了 | D1の3 database ID対応を確認。Cloud Cost DBはアプリ182 reads対Dashboard 179 readsでほぼ一致したが、Handoff DBは215対198、Installer DBは338対222。Workersの月初・30日Dashboard表示は取得エラーのため、集計遅延を待って再照合する。 |
| 10 | CC-010 | 集計値の保存方針 | P0 | 完了 | token暗号化、30日セッション、400日の日次合計、明示的な接続解除時の履歴削除を実装する。リソース名は長期保存しない。 |
| 11 | CC-011 | 月末予測 | P1 | 完了 | 今月の経過日数で操作量を補正し、Workers CPUはP50–P99の月末レンジを表示する。 |
| 12 | CC-012 | 予算通知 | P2 | 一部完了 | 月額予算と50%、80%、100%の画面内アラートを実装済み。メール等の外部通知を別課題とする。 |
| 13 | CC-013 | Handoffへの組み込み | P1 | 完了 | Handoff管理画面の新規納品で、選択ファイル容量と保存期間からR2 Standardの追加費用目安と月末保存費用を表示する。 |
| 14 | CC-014 | 公開・商標表記 | P0 | 完了 | 非公式ツールであること、免責、Cloudflare商標・製品名を公開画面とREADMEへ記載する。 |
| 15 | CC-015 | 接続後ダッシュボード | P0 | 完了 | アカウント選択、再取得、デモ、接続解除、バケット・Worker・DB別利用量をPC・スマートフォンで確認できる。 |
| 16 | CC-016 | リソース別コスト順位 | P1 | 完了 | 無料枠適用前の料金寄与額をバケット・Worker・DB単位で計算し、高い順に表示する。 |
| 17 | CC-017 | 外部予算通知 | P2 | 完了 | Webhook通知の非公開・予約IPとredirect拒否、10秒timeout、同一月・同一閾値のatomic leaseと冪等性key、失敗時6時間待機、通知履歴APIと接続画面UIを実装した。`0003_budget_notifications.sql`とVersion `8316842a-38ae-4141-a309-8361167f1dd0`を本番反映済み。 |
| 18 | CC-018 | 前月比較 | P1 | 完了 | 400日履歴APIから前月の最終スナップショットを選び、推定額の差額・増減率とデータ不足状態を表示する。 |
| 19 | CC-019 | β版デプロイ | P0 | 完了 | 専用D1、マイグレーション、暗号化secret、Workers.devへの公開とhealth checkを完了する。 |
