# iPhoneからパイプラインを実行する手順

## 仕組み

```
iPhone（ショートカット）
    ↓ GitHub API を叩く
GitHub Actions でパイプライン実行
    ↓ 自動実行（毎日18:30 JST）or 手動起動
結果ファイルをリポジトリにコミット
    ↓
iPhoneのGitHubアプリ or Safariで結果を確認
```

---

## Step 1: GitHub Personal Access Token を作成

1. Safari で https://github.com/settings/tokens を開く
2. 「Generate new token (classic)」をタップ
3. 以下のスコープにチェック：
   - `repo`（リポジトリ読み書き）
   - `workflow`（Actions起動）
4. 「Generate token」→ トークンをメモ帳に保存（`ghp_...`）

---

## Step 2: iOSショートカットを作成

### ショートカットアプリを開く → 「＋」で新規作成

**アクション①「テキスト」を追加**
```
{"ref":"main","inputs":{"skip_tdnet":"false","dry_run":"false"}}
```

**アクション②「URLの内容を取得」を追加**
- URL:
  ```
  https://api.github.com/repos/anyn24-hub/affiriate/actions/workflows/daily_pipeline.yml/dispatches
  ```
- メソッド: `POST`
- ヘッダーを追加:
  | キー | 値 |
  |------|-----|
  | `Accept` | `application/vnd.github+json` |
  | `Authorization` | `Bearer ghp_あなたのトークン` |
  | `X-GitHub-Api-Version` | `2022-11-28` |
  | `Content-Type` | `application/json` |
- リクエストボディ: 「JSON」→ アクション①のテキストを選択

**アクション③「通知を表示」を追加**
```
✅ 決算パイプライン起動！
GitHub Actionsで実行中です（約5〜10分）
```

### ショートカット名: `📊 決算パイプライン実行`

---

## Step 3: ホーム画面に追加

1. ショートカットの「...」→「ホーム画面に追加」
2. 名前: `決算パイプライン`
3. アイコンを好みの画像に変更（任意）

→ ホーム画面から1タップでパイプライン起動できます！

---

## Step 4: 結果を確認する

### 方法A: GitHubアプリで確認
1. `anyn24-hub/affiriate` リポジトリを開く
2. `output/YYYY-MM-DD/` フォルダ内のファイルを確認：
   - `x_posts.txt` → X投稿文（アフィリエイトリンク付き）
   - `image_prompts.txt` → ChatGPT画像生成指示書
   - `stocks.json` → 抽出銘柄リスト

### 方法B: Actions画面で実行ログを確認
- https://github.com/anyn24-hub/affiriate/actions

---

## 自動実行スケジュール

| 時刻 | 内容 |
|------|------|
| 毎日 18:30 JST（平日のみ） | パイプライン自動実行 |

市場が閉じた後（16:00以降）にClaudeが当日データを取得して投稿文を生成します。

---

## GitHub Secrets の設定（管理者が1回だけ実施）

https://github.com/anyn24-hub/affiriate/settings/secrets/actions に以下を登録：

| シークレット名 | 内容 |
|---------------|------|
| `ANTHROPIC_API_KEY` | Claude APIキー |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Google サービスアカウントJSON（1行） |
| `DRIVE_FOLDER_ID` | `18wtkPzESM12OZhe4e2YLQ5mT1HhBVGw0` |
| `DRIVE_FOLDER_URL` | `https://drive.google.com/drive/u/1/folders/18wtkPzESM12OZhe4e2YLQ5mT1HhBVGw0` |
| `AFFILIATE_LINK` | Amazonアソシエイトリンク |
