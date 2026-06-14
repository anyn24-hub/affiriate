# @kessan_class 自動投稿パイプライン

決算情報をX（Twitter）に自動投稿するためのパイプラインです。

## 機能

| ステップ | 内容 | 自動化 |
|---------|------|--------|
| 1. 銘柄抽出 | Claude APIが最新取引日の決算銘柄を抽出（A:大手10社 / B:ストップ高5社 / C:値上がり5社） | ✅ 自動 |
| 2. TDnet → Drive | 各銘柄の決算PDFをTDnetからダウンロードしてGoogle Driveに格納 | ✅ 自動 |
| 3. 投稿文生成 | Claude APIがDrive内の決算資料を解析し、X投稿文＋ChatGPT画像指示書を生成 | ✅ 自動 |
| 4. X予約投稿 | 生成された投稿文を確認・予約投稿 | 手動（最終確認） |

## セットアップ

### 1. 環境変数の設定

```bash
cp .env.example .env
# .env を編集して各値を入力
```

必要な環境変数:

| 変数名 | 説明 |
|--------|------|
| `ANTHROPIC_API_KEY` | [Anthropic Console](https://console.anthropic.com/) で取得 |
| `DRIVE_FOLDER_ID` | Google DriveフォルダのID |
| `DRIVE_FOLDER_URL` | Google DriveフォルダのURL |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Google Cloud サービスアカウントのJSON（1行化） |
| `AFFILIATE_LINK` | AmazonアソシエイトのアフィリエイトURL |

### 2. Google Drive API の設定（TDnet自動ダウンロードを使う場合）

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
2. Google Drive API を有効化
3. サービスアカウントを作成 → JSONキーをダウンロード
4. そのサービスアカウントのメールアドレスを、対象のDriveフォルダに「編集者」として共有
5. `jq -c . service_account.json` で1行化して `.env` の `GOOGLE_SERVICE_ACCOUNT_JSON` に貼り付け

### 3. 依存パッケージのインストール

```bash
pip install -r requirements.txt
```

## 使い方

### 通常実行（フル自動）

```bash
python pipeline/main.py
```

### TDnetダウンロードをスキップ（手動でDriveに入れた場合）

```bash
python pipeline/main.py --skip-tdnet
```

### テスト実行（APIを呼ばない）

```bash
python pipeline/main.py --dry-run
```

## 出力ファイル

実行後、`output/YYYY-MM-DD/` に以下が生成されます:

| ファイル | 内容 |
|---------|------|
| `stocks.json` | 抽出された銘柄リスト（JSON） |
| `raw_stock_extraction.txt` | Claudeの銘柄抽出の生出力 |
| `x_posts.txt` | X投稿文（アフィリエイトリンク付き） |
| `image_prompts.txt` | ChatGPT向け画像生成指示書 |
| `tdnet_uploads.json` | TDnetアップロード結果 |
| `pipeline.log` | 実行ログ |

## アフィリエイト収益化

`.env` の `AFFILIATE_LINK` に Amazon アソシエイトリンクを設定すると、
全てのX投稿文の末尾に以下が自動追記されます:

```
📚決算書の読み方はこちら→https://amzn.to/xxxxxxxxx
```

おすすめ書籍カテゴリ（アソシエイトリンクの候補）:
- 決算書の読み方
- 財務分析
- 株式投資・ファンダメンタル分析

## 銘柄抽出精度の改善について

現状の課題と改善策:
- **IRBANKが404の場合**: Claudeのweb_searchツールが複数ソース（Yahoo!ファイナンス、株探など）を参照して補完
- **証券コードの裏取り**: 抽出後、`stocks.json` を目視確認して修正可能
- **精度向上のヒント**: `pipeline/stock_extractor.py` の `STOCK_EXTRACTION_PROMPT` を直接編集して調整できます

## 定期実行（cron）

```bash
# 毎日16:30に実行（市場終了後）
30 16 * * 1-5 cd /path/to/affiriate && python pipeline/main.py >> /var/log/kessan.log 2>&1
```
