"""
stock_extractor.py
irbank.net をスクレイピングして決算銘柄を取得し、
Groq API（無料）で整形・分析する。
"""

import logging
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

import requests
from bs4 import BeautifulSoup
from groq import Groq

logger = logging.getLogger(__name__)

# 日本の祝日（固定分・主要なもの）
_JP_HOLIDAYS = {
    (1, 1), (2, 11), (2, 23), (3, 20), (4, 29),
    (5, 3), (5, 4), (5, 5), (7, 15), (8, 11),
    (9, 15), (9, 23), (10, 13), (11, 3), (11, 23), (12, 23),
}

FORMAT_PROMPT_TEMPLATE = """あなたは「日本市場リサーチ専門のエージェント」です。
以下の3種類のデータをもとに、指定フォーマットで出力してください。

対象取引日: {trading_date}

【決算データ（irbank.net）】
{earnings_data}

【ストップ高銘柄（株探）】
{stop_high_data}

【値上がり率上位（株探）】
{top_gainers_data}

出力ルール:
- 【A】は決算データから時価総額上位を最大10社
- 【B】はストップ高のうち「直近1ヶ月以内に決算発表した銘柄」を最大5社
- 【C】は値上がり率上位のうち「直近1ヶ月以内に決算発表した銘柄」を最大5社
- データがない場合は「（該当なし）」と記載

出力形式:
▼ 対象取引日: {trading_date}

━━【A】本日決算の大手企業（時価総額上位・最大10社）━━
■ [証券コード] 企業名
・カテゴリー：本決算 or 第X四半期
・事業内容：（15文字程度で直感的に）

━━【B】ストップ高（直近決算発表銘柄 / 最大5社）━━
■ [証券コード] 企業名
・事業内容：（15文字程度）
・注目材料：[発表日] 決算内容等の急騰理由を簡潔に

━━【C】値上がり率上位（直近決算発表銘柄 / 最大5社）━━
■ [証券コード] 企業名
・事業内容：（15文字程度）
・注目材料：[発表日] 決算内容等の急騰理由を簡潔に

@kessan_class #決算

【検証ログ】
・対象取引日の特定根拠
・未来の「予定」銘柄を含んでいないかの確認
・「決算から1ヶ月以内」の条件合致確認
"""


@dataclass
class Stock:
    code: str
    name: str
    category: str = ""
    content: str = ""
    notes: str = ""
    section: str = ""


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
        logger.info("[DRY RUN] Would call Groq API for stock extraction.")
        return ExtractionResult(
            raw_text="[DRY RUN] No API call made.",
            trading_date="2025-01-01",
            stocks_a=[
                Stock(code="9984", name="ソフトバンクグループ", category="本決算",
                      content="通信・投資持株会社", section="A"),
            ],
        )

    # Step 1: 対象取引日を特定
    trading_date = _get_latest_trading_date()
    logger.info(f"対象取引日: {trading_date}")

    # Step 2: 各種データをスクレイピング
    earnings_data = _scrape_irbank(trading_date)
    stop_high_data = _scrape_stop_high()
    top_gainers_data = _scrape_top_gainers()
    logger.info(f"irbank: {len(earnings_data.splitlines())}行 / ストップ高: {len(stop_high_data.splitlines())}行 / 値上がり: {len(top_gainers_data.splitlines())}行")

    # Step 3: Groq APIで整形
    logger.info("Groq APIで整形中...")
    client = Groq(api_key=api_key)
    prompt = FORMAT_PROMPT_TEMPLATE.format(
        trading_date=trading_date,
        earnings_data=earnings_data if earnings_data else "（本日の決算データなし）",
        stop_high_data=stop_high_data if stop_high_data else "（データなし）",
        top_gainers_data=top_gainers_data if top_gainers_data else "（データなし）",
    )

    response = client.chat.completions.create(
        model="llama3-8b-8192",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_tokens=2000,
    )
    raw_text = response.choices[0].message.content
    logger.debug(f"Groq response length: {len(raw_text)} chars")

    result = _parse_extraction_output(raw_text, trading_date)
    logger.info(
        f"Parsed {len(result.stocks_a)} in A, "
        f"{len(result.stocks_b)} in B, "
        f"{len(result.stocks_c)} in C."
    )
    return result


def _get_latest_trading_date() -> str:
    """市場が閉まっている最新の取引日を返す（YYYY-MM-DD形式）。"""
    now = datetime.now()
    # 今日が平日16:00以降なら今日、それ以外は直前の営業日
    candidate = now.date()
    if now.weekday() >= 5 or now.hour < 16:
        candidate -= timedelta(days=1)
    # 土日・祝日を遡る
    for _ in range(14):
        if candidate.weekday() < 5 and (candidate.month, candidate.day) not in _JP_HOLIDAYS:
            break
        candidate -= timedelta(days=1)
    return candidate.strftime("%Y-%m-%d")


_SCRAPE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
}


def _scrape_irbank(trading_date: str) -> str:
    """irbank.netから決算データをスクレイピングしてテキスト形式で返す。"""
    url = f"https://irbank.net/market/kessan?y={trading_date}"
    try:
        resp = requests.get(url, timeout=15, headers=_SCRAPE_HEADERS)
        resp.raise_for_status()
    except Exception as e:
        logger.warning(f"irbank.net取得失敗: {e}")
        return ""

    soup = BeautifulSoup(resp.text, "lxml")
    lines = []

    # テーブル行を抽出（予定を除外）
    for row in soup.select("table tr"):
        cells = [td.get_text(strip=True) for td in row.select("td, th")]
        if not cells:
            continue
        row_text = " | ".join(cells)
        if "予定" in row_text:
            continue
        lines.append(row_text)

    return "\n".join(lines[:60])  # 上位60行に絞る


def _scrape_stop_high() -> str:
    """株探からストップ高銘柄をスクレイピングしてテキスト形式で返す。"""
    url = "https://kabutan.jp/warning/?val=stock_h&market=0"
    try:
        resp = requests.get(url, timeout=15, headers=_SCRAPE_HEADERS)
        resp.raise_for_status()
    except Exception as e:
        logger.warning(f"株探ストップ高取得失敗: {e}")
        return ""

    soup = BeautifulSoup(resp.text, "lxml")
    lines = []
    for row in soup.select("table tr"):
        cells = [td.get_text(strip=True) for td in row.select("td, th")]
        if len(cells) >= 2:
            lines.append(" | ".join(cells))
    return "\n".join(lines[:40])


def _scrape_top_gainers() -> str:
    """株探から値上がり率上位銘柄をスクレイピングしてテキスト形式で返す。"""
    url = "https://kabutan.jp/stock/ranking/?val=t&market=0"
    try:
        resp = requests.get(url, timeout=15, headers=_SCRAPE_HEADERS)
        resp.raise_for_status()
    except Exception as e:
        logger.warning(f"株探値上がり率取得失敗: {e}")
        return ""

    soup = BeautifulSoup(resp.text, "lxml")
    lines = []
    for row in soup.select("table tr"):
        cells = [td.get_text(strip=True) for td in row.select("td, th")]
        if len(cells) >= 2:
            lines.append(" | ".join(cells))
    return "\n".join(lines[:40])


def _parse_extraction_output(text: str, trading_date: str) -> ExtractionResult:
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


def _parse_section(text: str, section_letter: str) -> list[Stock]:
    stocks = []
    section_pattern = rf"━━【{section_letter}】[^━]*━━(.*?)(?=━━【[A-Z]】|$)"
    match = re.search(section_pattern, text, re.DOTALL)
    if not match:
        return stocks

    section_text = match.group(1)
    entry_pattern = r"■\s*\[?(\d{4,5}[A-Z]?)\]?\s+(.+?)(?=■|\Z)"
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
