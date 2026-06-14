"""
content_generator.py
Googleドライブからアップロード済みのPDFをダウンロード・テキスト抽出し、
Groq APIで決算速報X投稿文＋ChatGPT画像生成指示書を生成する。
"""

import io
import json
import logging
import re
from dataclasses import dataclass, field

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from groq import Groq
from pypdf import PdfReader

logger = logging.getLogger(__name__)

DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]

AFFILIATE_SUFFIX_TEMPLATE = "\n\n📚決算書の読み方を学ぶ→{affiliate_link}"

# ── 生成プロンプト ────────────────────────────────────────────────────────────
# 以下のフォーマットで出力するよう厳密に指示する
CONTENT_PROMPT_TEMPLATE = """あなたは「プロの財務アナリスト兼SNSマーケター」です。
以下の決算資料のテキストを解析し、コンテンツを作成してください。

【資料テキスト】
{pdf_text}

【出力ルール】
- @kessan_class を必ず含める
- 専門メディアのトーン（個人要素排除）
- 各項目を必ず「```」のコードブロックで囲む

【出力1】X用投稿文（140字以内）を以下の形式でコードブロックに入れる:
```
【決算速報】企業名(証券コード) 期間

売上高　▶XX億円(±XX%)✅または❌
営業利益▶XX億円(±XX%)✅または❌
経常利益▶XX億円(±XX%)✅または❌
純利益　▶XX億円(±XX%)✅または❌

（2〜3行で決算のポイントを簡潔に）

@kessan_class
```

【出力2】ChatGPT用 画像生成指示書（16:9横長・X専用）を以下の形式でコードブロックに入れる:
```
以下の指示に従い、横長画像（アスペクト比16:9）を生成してください。
X（Twitter）タイムライン最適化。1枚で全情報が完結するインフォグラフィック。

■全体デザイン
濃紺（#0D1B2A）×グラファイトグレー（#2E2E2E）基調

■ヘッダー（最上部・全幅帯）
・左：超大フォントで「証券コード　企業名」
・右：「期間 決算」
・サブ：「事業内容（15文字程度）」

■メイン（6つのカード型ボックス・3×2グリッド）
カード①「売上高」 青系
　XX億円（期） ／ 前年同期比±XX% ／ 📊
カード②「営業利益」 緑系（増益）または赤系（減益）
　XX億円 ／ 前年同期比±XX% ／ 📈または📉
カード③「当期純利益」 緑系または赤系
　XX億円 ／ 前年同期比±XX% ／ ✅または❌
カード④「利益変動の背景」 シアン系
　（主要因を2〜3行で） ／ 適切な絵文字
カード⑤「財務健全性」 青系
　自己資本比率XX% ／ 総資産XX億円
　配当XX円 ／ 🛡️
カード⑥「通期予想」 オレンジ系
　売上XX億円（±XX%）
　営業利益XX億円（±XX%）✅ ／ 🔮

■フッター（最下部・全幅帯）
左：✅インサイト
「（3〜4行で投資家視点の注目ポイントを記述）」
右：「@kessan_class」白文字・小さめ
```
"""


@dataclass
class CompanyContent:
    company_identifier: str
    x_post: str = ""
    image_prompt: str = ""


@dataclass
class GenerationResult:
    raw_text: str
    companies: list[CompanyContent] = field(default_factory=list)


def generate_content(
    api_key: str,
    drive_folder_url: str,
    affiliate_link: str,
    dry_run: bool = False,
    service_account_json: str = "",
    folder_id: str = "",
) -> GenerationResult:
    if dry_run:
        logger.info("[DRY RUN] コンテンツ生成をスキップ。")
        sample_post = (
            "【決算速報】ソフトバンクグループ(9984) 2026年3月期\n\n"
            "売上高　▶20.6兆円(＋8.2%)✅\n"
            "営業利益▶2.4兆円(＋15.3%)✅\n\n"
            "@kessan_class"
            + AFFILIATE_SUFFIX_TEMPLATE.format(affiliate_link=affiliate_link)
        )
        return GenerationResult(
            raw_text="[DRY RUN]",
            companies=[CompanyContent(company_identifier="9984 ソフトバンクグループ",
                                      x_post=sample_post, image_prompt="[DRY RUN]")],
        )

    # Driveから PDF テキストを取得
    pdf_texts = _download_pdfs_from_drive(service_account_json, folder_id)

    if not pdf_texts:
        logger.warning("DriveにPDFが見つかりませんでした。ドライブのフォルダを確認してください。")
        return GenerationResult(raw_text="", companies=[])

    logger.info(f"{len(pdf_texts)}件のPDFを処理します。")
    client = Groq(api_key=api_key)
    all_companies = []
    all_raw = []

    for filename, text in pdf_texts.items():
        logger.info(f"コンテンツ生成中: {filename}")
        if len(text) < 100:
            logger.warning(f"{filename}: テキストが短すぎます（{len(text)}文字）。スキップ。")
            continue

        prompt = CONTENT_PROMPT_TEMPLATE.format(pdf_text=text[:8000])

        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.4,
            max_tokens=4000,
        )
        raw_text = response.choices[0].message.content
        all_raw.append(f"=== {filename} ===\n{raw_text}")

        companies = _parse_output(raw_text, affiliate_link)
        all_companies.extend(companies)

    logger.info(f"{len(all_companies)}社分のコンテンツを生成しました。")
    return GenerationResult(raw_text="\n\n".join(all_raw), companies=all_companies)


def _download_pdfs_from_drive(service_account_json: str, folder_id: str) -> dict[str, str]:
    """DriveフォルダからPDFをダウンロードしてテキストを抽出する。"""
    if not service_account_json or service_account_json == "{}":
        logger.warning("GOOGLE_SERVICE_ACCOUNT_JSON が未設定。Drive PDFの取得をスキップ。")
        return {}

    try:
        info = json.loads(service_account_json)
        credentials = service_account.Credentials.from_service_account_info(
            info, scopes=DRIVE_SCOPES
        )
        service = build("drive", "v3", credentials=credentials)
    except Exception as e:
        logger.error(f"Google Drive認証エラー: {e}")
        return {}

    # フォルダ内のPDFを一覧
    try:
        results = service.files().list(
            q=f"'{folder_id}' in parents and mimeType='application/pdf' and trashed=false",
            fields="files(id, name, createdTime)",
            orderBy="createdTime desc",
            pageSize=20,
        ).execute()
        files = results.get("files", [])
    except Exception as e:
        logger.error(f"Drive ファイル一覧取得エラー: {e}")
        return {}

    if not files:
        logger.warning("DriveフォルダにPDFが見つかりません。")
        return {}

    pdf_texts = {}
    for f in files:
        file_id = f["id"]
        name = f["name"]
        try:
            request = service.files().get_media(fileId=file_id)
            buf = io.BytesIO()
            downloader = MediaIoBaseDownload(buf, request)
            done = False
            while not done:
                _, done = downloader.next_chunk()
            buf.seek(0)
            text = _extract_text_from_pdf(buf)
            pdf_texts[name] = text
            logger.info(f"PDF取得・テキスト抽出完了: {name} ({len(text)}文字)")
        except Exception as e:
            logger.warning(f"PDF取得エラー ({name}): {e}")

    return pdf_texts


def _extract_text_from_pdf(buf: io.BytesIO) -> str:
    """PDFバイナリからテキストを抽出する。"""
    try:
        reader = PdfReader(buf)
        pages = []
        for page in reader.pages:
            pages.append(page.extract_text() or "")
        return "\n".join(pages)
    except Exception as e:
        logger.warning(f"PDFテキスト抽出エラー: {e}")
        return ""


def _parse_output(text: str, affiliate_link: str) -> list[CompanyContent]:
    """コードブロックからX投稿文と画像プロンプトを抽出する。"""
    code_blocks = re.findall(r"```[^\n]*\n(.*?)```", text, re.DOTALL)

    if not code_blocks:
        post_text = text.strip()
        if affiliate_link and affiliate_link not in post_text:
            post_text += AFFILIATE_SUFFIX_TEMPLATE.format(affiliate_link=affiliate_link)
        return [CompanyContent(company_identifier="unknown", x_post=post_text)]

    x_posts, image_prompts = [], []
    for block in code_blocks:
        stripped = block.strip()
        if "アスペクト比" in stripped or "16:9" in stripped or "ヘッダー" in stripped:
            image_prompts.append(stripped)
        else:
            x_posts.append(stripped)

    companies = []
    count = max(len(x_posts), len(image_prompts))
    for i in range(count):
        x_post = x_posts[i] if i < len(x_posts) else ""
        image_prompt = image_prompts[i] if i < len(image_prompts) else ""
        company_id = _extract_company_id(x_post) or f"company_{i+1}"
        if affiliate_link and affiliate_link not in x_post:
            x_post += AFFILIATE_SUFFIX_TEMPLATE.format(affiliate_link=affiliate_link)
        companies.append(CompanyContent(
            company_identifier=company_id,
            x_post=x_post,
            image_prompt=image_prompt,
        ))
    return companies


def _extract_company_id(text: str) -> str:
    match = re.search(r"[【\[]?(\d{4,5}[A-Z]?)[】\]]?\s*([^\n#@（(]{2,15})", text)
    if match:
        return f"{match.group(1)} {match.group(2).strip()}"
    return ""
