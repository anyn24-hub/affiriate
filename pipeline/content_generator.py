"""
content_generator.py
Takes a Google Drive folder URL and calls Claude API to generate
X post text and ChatGPT image generation prompts per company.
"""

import logging
import re
from dataclasses import dataclass, field

import anthropic

logger = logging.getLogger(__name__)

CONTENT_GENERATION_PROMPT_TEMPLATE = """あなたは「プロの財務アナリスト兼SNSマーケター」として、指定されたURL内の**全決算資料(複数ある場合はすべて個別に)**を解析し、以下のコンテンツを作成してください。 【重要】スマホ操作優先のため、各項目を個別の「コードブロック」に分けて出力してください。 【1. SNS投稿共通ルール】 全投稿文および画像指示書に @kessan_class を含める。 専門メディアのトーン(個人要素排除)、適切な改行を使用。 【2. 作成内容(資料ごとに以下を出力)】 1 X用投稿文(140字以内) 2 ChatGPT用 画像生成指示書【詳細図解(X専用・1枚完結)】 サイズ指定:アスペクト比 16:9(横長) ※Xのタイムラインに最適化。 デザイン構成(濃紺・グラファイトグレー基調): ヘッダー: 最上部に「証券コード+企業名」を非常に大きく、視認性高く配置。 サブヘッダー: その下に「事業内容(15文字程度)」を記載。 メイン: 6つのカード型ボックスに売上・利益(青/赤)、実績数値、フラットアイコンを配置。 フッター: ✅インサイト(注目ポイント)と右下に @kessan_class の署名。 解析対象URL: {drive_url}"""

AFFILIATE_SUFFIX_TEMPLATE = "\n\n📚決算書の読み方はこちら→{affiliate_link}"


@dataclass
class CompanyContent:
    """X post and image prompt for a single company."""
    company_identifier: str  # e.g. "9984 ソフトバンクグループ"
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
) -> GenerationResult:
    """
    Call Claude API with the content generation prompt.
    Returns structured GenerationResult with X posts and image prompts.
    """
    if dry_run:
        logger.info("[DRY RUN] Would call Claude API for content generation.")
        sample_post = (
            "【決算速報】9984 ソフトバンクグループ\n"
            "売上高: X兆円 / 純利益: Y億円\n"
            "#決算 @kessan_class"
            + AFFILIATE_SUFFIX_TEMPLATE.format(affiliate_link=affiliate_link)
        )
        sample_image = (
            "[DRY RUN] ChatGPT画像生成指示書サンプル - "
            "9984 ソフトバンクグループ 16:9横長 @kessan_class"
        )
        return GenerationResult(
            raw_text="[DRY RUN] No API call made.",
            companies=[
                CompanyContent(
                    company_identifier="9984 ソフトバンクグループ",
                    x_post=sample_post,
                    image_prompt=sample_image,
                )
            ],
        )

    prompt = CONTENT_GENERATION_PROMPT_TEMPLATE.format(drive_url=drive_folder_url)

    logger.info(f"Calling Claude API for content generation. Drive URL: {drive_folder_url}")
    client = anthropic.Anthropic(api_key=api_key)

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=8000,
        messages=[{"role": "user", "content": prompt}],
    )

    raw_text = _extract_text(response)
    logger.debug(f"Content generation response length: {len(raw_text)} chars")

    companies = _parse_content_output(raw_text, affiliate_link)
    logger.info(f"Generated content for {len(companies)} companies.")
    return GenerationResult(raw_text=raw_text, companies=companies)


def _extract_text(response) -> str:
    parts = []
    for block in response.content:
        if hasattr(block, "text"):
            parts.append(block.text)
    return "\n".join(parts)


def _parse_content_output(text: str, affiliate_link: str) -> list[CompanyContent]:
    """
    Parse Claude output into CompanyContent objects.

    Claude is instructed to output each item in code blocks.
    We look for patterns like:
      ```
      X用投稿文 ...
      ```
      ```
      ChatGPT用 画像生成指示書 ...
      ```
    grouped per company.
    """
    companies = []

    # Extract all code blocks
    code_blocks = re.findall(r"```[^\n]*\n(.*?)```", text, re.DOTALL)

    if not code_blocks:
        # Fallback: treat entire output as one company's content
        logger.warning("No code blocks found in Claude output. Treating as single block.")
        post_text = text.strip()
        if affiliate_link and affiliate_link not in post_text:
            post_text += AFFILIATE_SUFFIX_TEMPLATE.format(affiliate_link=affiliate_link)
        companies.append(CompanyContent(
            company_identifier="unknown",
            x_post=post_text,
            image_prompt="",
        ))
        return companies

    # Pair up blocks: odd index = X post, even index = image prompt
    # But we need to detect company boundaries first.
    # Strategy: look for pairs of (X post block, image prompt block) and group them.
    x_posts = []
    image_prompts = []

    for block in code_blocks:
        stripped = block.strip()
        # Heuristic: image prompt blocks contain keywords like "アスペクト比" or "ChatGPT"
        if "アスペクト比" in stripped or "ChatGPT" in stripped or "16:9" in stripped:
            image_prompts.append(stripped)
        else:
            x_posts.append(stripped)

    # Match x_posts and image_prompts by index
    max_count = max(len(x_posts), len(image_prompts))
    for i in range(max_count):
        x_post = x_posts[i] if i < len(x_posts) else ""
        image_prompt = image_prompts[i] if i < len(image_prompts) else ""

        # Extract company identifier from X post
        company_id = _extract_company_id(x_post) or f"company_{i+1}"

        # Append affiliate link if not already present
        if affiliate_link and affiliate_link not in x_post:
            x_post += AFFILIATE_SUFFIX_TEMPLATE.format(affiliate_link=affiliate_link)

        companies.append(CompanyContent(
            company_identifier=company_id,
            x_post=x_post,
            image_prompt=image_prompt,
        ))

    return companies


def _extract_company_id(text: str) -> str:
    """Try to extract a stock code + company name from text."""
    # Look for patterns like 【9984】 or [9984] or just 9984 followed by company name
    match = re.search(r"[【\[]?(\d{4,5})[】\]]?\s*([^\n#@]{2,20})", text)
    if match:
        return f"{match.group(1)} {match.group(2).strip()}"
    return ""
