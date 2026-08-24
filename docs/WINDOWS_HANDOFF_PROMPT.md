# Windows側 Codex 開始プロンプト

以下をWindows側のCodexへ、そのまま貼り付けてください。

---

GitHubで公開しているCloudflare料金試算ツール「Cloud Cost」の開発を、Mac側から引き継いでください。

リポジトリ:
https://github.com/nobphotographr/cloudflare-cost-calculator

本番URL:
https://cloudflare-cost-calculator.nobu-8yashi.workers.dev/

私はディレクションを担当します。実装、テスト、課題管理表の更新、GitへのコミットとGitHubへのpushは、明確な確認が必要な操作を除いて、残課題を順番に自律的に進めてください。小さな工程ごとに止まって確認を求める必要はありません。ただし、権限追加、secret変更、OAuth接続解除・revoke、データ削除、課金につながる操作、本番環境へ影響する大きな変更は、実行直前に確認してください。

最初に次を行ってください。

1. リポジトリをcloneまたはpullする。
2. `README.md`、`docs/ISSUES.md`、`docs/OAUTH_SETUP.md`、`docs/BETA_DEPLOYMENT.md`、`docs/PRODUCT_PLAN.md`をすべて読む。
3. `git status`、現在のブランチ、remote、最新コミットを確認する。
4. `npm install`、`npm test`、`npm run check`を実行し、Windows環境で再現できるか確認する。
5. 問題がなければ`docs/ISSUES.md`の未完了課題を優先度順に進める。

現在までに完了している主な内容:

- R2、Workers、D1の手入力による料金試算
- Cloudflare OAuth Authorization Code Flow + PKCE
- private OAuth clientを使った実アカウント接続
- `account-analytics.read account-settings.read`によるAnalytics取得
- Workersリクエスト数・CPU時間、D1行数・容量の実データ反映
- R2未使用時の0表示
- 月末予測、P50–P99の参考レンジ
- リソース別料金寄与、月額予算、利用履歴、前月比較
- D1での暗号化セッション・履歴保存
- Cloudflare Workersへのβ版デプロイ

重要な実装上の注意:

- Cloudflare Workers組み込みの`fetch`は、参照を変数へ渡して不正な`this`で呼ぶと`Illegal invocation`になる。実運用時はグローバル`fetch()`を直接呼ぶ実装になっている。
- `workersInvocationsAdaptive`のCPU quantileはマイクロ秒なので、料金計算前にミリ秒へ変換している。
- OAuthの製品別Read権限は現状不要。Account Analytics ReadとAccount Settings Readだけを使う。
- Dashboard管理のsecretを保持するため、CLIデプロイ時は原則`npx wrangler deploy --keep-vars`を使う。
- OAuth client secret、session暗号化secret、access token、refresh tokenをコード、Git、ログ、画面キャプチャへ出さない。
- GitHubにはsecretを保存しない。必要な値はCloudflare Dashboard側のWorker secretsに設定済み。
- 本番データやOAuthセッションを削除・revokeする場合は、必ず私へ直前確認する。
- 作業開始時と終了前に`git status`を確認し、既存のユーザー変更を壊さない。

現時点の主な残課題:

- access token期限前のrefreshを実機確認する。
- 接続解除時のrevokeとD1セッション削除を実機確認する。この操作は実行直前に確認する。
- R2利用のあるアカウントで、保存量とClass A/B操作数を実際のDashboard・請求値と照合する。
- Workers・D1の集計値をCloudflare Dashboard表示と最終照合する。
- 外部通知、Handoff管理画面への組み込みなど、`docs/ISSUES.md`に残る課題を進める。

実装したら、関連テストを追加または更新し、最低限以下を通してください。

```powershell
npm test
npm run check
git diff --check
```

本番反映後は公開URLと`/api/health`を確認してください。完了した課題は`docs/ISSUES.md`へ反映し、意味のまとまりごとにコミットして`origin/main`へpushしてください。

まずはリポジトリの状態とドキュメントを確認し、現在の残課題、最初に着手する課題、Windows側で不足している認証やツールがあるかを簡潔に報告した後、確認不要な範囲の作業をそのまま開始してください。

---
