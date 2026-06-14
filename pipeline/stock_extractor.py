"""
stock_extractor.py
Calls Gemini API to extract stock tickers that had earnings reports on the latest trading day.
"""

import logging
import re
from dataclasses import dataclass, field

import google.generativeai as genai

logger = logging.getLogger(__name__)

STOCK_EXTRACTION_PROMPT = """あなたは「日本市場リサーチ専門のエージェント」として、以下の手順を厳守し、「未来の予定」を一切含まず、直近で「完了した」最新取引日の情報のみを整理してください。 STEP 0: 対象取引日の動的特定（遡りロジック） 実行時の日時から、**「データが確定し、市場が閉まっている最新の平日（祝日を除く）」**を特定してください。

1. 「今」が平日の16:00以降： 今日を対象とする。
2. それ以外（午前中・夜間・土日祝日）： 「今日より前」の最も近い営業日（平日かつ非祝日）まで遡って特定する。 ※GW等の連休中は、連休が始まる前の「最終取引日」まで自動で遡ること。 ※冒頭に「▼ 対象取引日: YYYY年MM月DD日（曜日）」を明記。 STEP 1: 決算データ取得（実績確定分のみ）

* URL: `https://irbank.net/market/kessan?y=[Target Date]`
* 【厳守】 上記URLのリストから、「（予定）」と記載されている未来の情報は全て除外し、実際に決算発表が**「完了した」**時価総額上位10社を抽出してください。 STEP 2: ストップ高・急騰銘柄の厳選
* 条件： 本日のランキング上位から、**「過去1ヶ月以内に決算発表を行った企業」**のみを最大5社ずつ抽出。
* 決算と無関係な急騰や、発表から1ヶ月以上経過した銘柄は除外。 出力形式（テキストのみ・シンプル構成） ━━【A】本日決算の大手企業（10社）━━ ■ [証券コード] 企業名 ・カテゴリー：本決算 or 第X四半期 ・事業内容：（15文字程度で直感的に） ━━【B】ストップ高（直近決算発表銘柄 / 5社）━━ ■ [証券コード] 企業名 ・事業内容：（15文字程度） ・注目材料：[発表日] 決算内容等の急騰理由を簡潔に ━━【C】値上がり率上位（直近決算発表銘柄 / 5社）━━ ■ [証券コード] 企業名 ・事業内容：（15文字程度） ・注目材料：[発表日] 決算内容等の急騰理由を簡潔に @kessan_class #決算 自己検証（末尾に記載） 【検証ログ】
* 対象取引日の特定根拠（何日前まで遡ったか）
* 未来の「予定」銘柄を含んでいないかの再確認結果
* 「決算から1ヶ月以内」の条件合致確認結果"""


@dataclass
class Stock:
    code: str
    name: str
    category: str = ""
    content: str = ""
    notes: str = ""
    section: str = ""  # A, B, or C


@dataclass
class ExtractionResult:
    raw_text: str
    trading_date: str
    stocks_a: list[Stock] = field(default_factory=list)
    stocks_b: list[Stock] = field(default_factory=list)
    stocks_c: list[Stock] = field(default_factory=list)

    def all_stocks(self) -> list[Stock]:
        return self.stocks_a + self.stocks_b + self.stocks_c


def extract_stocks(api_key: str, dry_run: bool = False) -> ExtractionResult:
    if dry_run:
        logger.info("[DRY RUN] Would call Gemini API for stock extraction.")
        return ExtractionResult(
            raw_text="[DRY RUN] No API call made.",
            trading_date="2025-01-01",
            stocks_a=[
                Stock(code="9984", name="ソフトバンクグループ", category="本決算",
                      content="通信・投資持株会社", section="A"),
            ],
        )

    logger.info("Calling Gemini API for stock extraction...")
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(
        model_name="gemini-2.0-flash",
        tools="google_search",
    )

    response = model.generate_content(STOCK_EXTRACTION_PROMPT)
    raw_text = response.text
    logger.debug(f"Raw Gemini response length: {len(raw_text)} chars")

    result = _parse_extraction_output(raw_text)
    logger.info(
        f"Parsed {len(result.stocks_a)} stocks in A, "
        f"{len(result.stocks_b)} in B, "
        f"{len(result.stocks_c)} in C. "
        f"Trading date: {result.trading_date}"
    )
    return result


def _parse_extraction_output(text: str) -> ExtractionResult:
    trading_date = _extract_trading_date(text)
    stocks_a = _parse_section(text, "A")
    stocks_b = _parse_section(text, "B")
    stocks_c = _parse_section(text, "C")
    return ExtractionResult(
        raw_text=text,
        trading_date=trading_date,
        stocks_a=stocks_a,
        stocks_b=stocks_b,
        stocks_c=stocks_c,
    )


def _extract_trading_date(text: str) -> str:
    match = re.search(r"▼\s*対象取引日[：:]\s*(\d{4}年\d{1,2}月\d{1,2}日)", text)
    if match:
        return match.group(1)
    match = re.search(r"(\d{4}-\d{2}-\d{2})", text)
    if match:
        return match.group(1)
    return "unknown"


def _parse_section(text: str, section_letter: str) -> list[Stock]:
    stocks = []
    section_pattern = rf"━━【{section_letter}】[^━]*━━(.*?)(?=━━【[A-Z]】|$)"
    match = re.search(section_pattern, text, re.DOTALL)
    if not match:
        return stocks

    section_text = match.group(1)
    entry_pattern = r"■\s*\[?(\d{4,5})\]?\s+(.+?)(?=■|\Z)"
    for entry_match in re.finditer(entry_pattern, section_text, re.DOTALL):
        code = entry_match.group(1).strip()
        rest = entry_match.group(2).strip()
        lines = [l.strip() for l in rest.splitlines() if l.strip()]
        name = lines[0] if lines else ""
        category = content = notes = ""
        for line in lines[1:]:
            if "カテゴリー" in line or "カテゴリ" in line:
                category = re.sub(r"^[・\-\s]*カテゴリー?[：:]\s*", "", line).strip()
            elif "事業内容" in line:
                content = re.sub(r"^[・\-\s]*事業内容[：:]\s*", "", line).strip()
            elif "注目材料" in line:
                notes = re.sub(r"^[・\-\s]*注目材料[：:]\s*", "", line).strip()
        if code and name:
            stocks.append(Stock(code=code, name=name, category=category,
                                content=content, notes=notes, section=section_letter))
    return stocks
