"""
stock_extractor.py
irbank.net（決算カレンダー）で発表日の決算銘柄を取得し、
Groq API（無料）で整形・分析する。
"""

import logging
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import requests
from groq import Groq

logger = logging.getLogger(__name__)

JST = timezone(timedelta(hours=9))

# 日本の祝日（固定分・主要なもの）
_JP_HOLIDAYS = {
    (1, 1), (2, 11), (2, 23), (3, 20), (4, 29),
    (5, 3), (5, 4), (5, 5), (7, 15), (8, 11),
    (9, 15), (9, 23), (10, 13), (11, 3), (11, 23), (12, 23),
}

TDNET_BASE = "https://www.release.tdnet.info"

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ja,en;q=0.9",
    "Referer": "https://www.release.tdnet.info/",
}

FORMAT_PROMPT_TEMPLATE = """あなたは「日本市場リサーチ専門のエージェント」です。
以下のデータをもとに、指定フォーマットで出力してください。

対象取引日: {trading_date}

【決算データ（TDnet）】
※{trading_date}に決算発表した企業一覧
{earnings_data}

出力ルール:
- 上記リストにある企業を最大12社そのまま出力する（絞り込み不要・全種別対象）
- 事業内容は実際の事業を15文字以内で具体的に記載（一般的な業種知識から補完してよい）
- 企業名が空欄の場合は証券コードで検索して正式名称を補完すること
- データがない場合は「（該当なし）」と記載

出力形式（余計な説明文は一切不要）:
▼ 対象取引日: {trading_date}

━━ 本日決算（最大12社）━━
■ [証券コード] 企業名
・カテゴリー：本決算 or 第X四半期
・事業内容：（15文字程度）

@kessan_class #決算
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


def extract_stocks(api_key: str, dry_run: bool = False, jquants_refresh_token: str = "") -> ExtractionResult:
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

    # Step 1: 対象取引日を特定（データがあるまで最大7営業日遡る）
    trading_date, earnings_data = _get_trading_date_with_data(jquants_refresh_token)

    # Step 2: Groq APIで整形
    logger.info("Groq APIで整形中...")
    client = Groq(api_key=api_key)
    prompt = FORMAT_PROMPT_TEMPLATE.format(
        trading_date=trading_date,
        earnings_data=earnings_data if earnings_data else "（決算データなし）",
    )

    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_tokens=1500,
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


def _is_trading_day(d) -> bool:
    return d.weekday() < 5 and (d.month, d.day) not in _JP_HOLIDAYS


def _get_latest_trading_date() -> str:
    """市場が閉まっている最新の取引日を返す（YYYY-MM-DD形式）。"""
    now = datetime.now(JST)
    logger.info(f"現在時刻(JST): {now.strftime('%Y-%m-%d %H:%M')} weekday={now.weekday()}")
    candidate = now.date()
    market_closed_today = (
        not _is_trading_day(candidate)
        or now.hour < 15
        or (now.hour == 15 and now.minute < 30)
    )
    if market_closed_today:
        candidate -= timedelta(days=1)
    for _ in range(14):
        if _is_trading_day(candidate):
            break
        candidate -= timedelta(days=1)
    logger.info(f"算出された取引日: {candidate}")
    return candidate.strftime("%Y-%m-%d")


def _get_trading_date_with_data(api_key: str = "") -> tuple[str, str]:
    """データが取得できる最新の取引日とデータを返す。最大5営業日遡る。"""
    now = datetime.now(JST)
    candidate = now.date()
    market_closed_today = (
        not _is_trading_day(candidate)
        or now.hour < 15
        or (now.hour == 15 and now.minute < 30)
    )
    if market_closed_today:
        candidate -= timedelta(days=1)
    for _ in range(14):
        if _is_trading_day(candidate):
            break
        candidate -= timedelta(days=1)

    # 最大5営業日遡ってデータを探す
    for attempt in range(5):
        date_str = candidate.strftime("%Y-%m-%d")
        logger.info(f"対象取引日: {date_str} を試行中...")
        data = _fetch_tdnet_earnings(date_str, api_key)
        if data:
            logger.info(f"対象取引日確定: {date_str}（{len(data.splitlines())}行取得）")
            return date_str, data
        # 前の営業日へ
        candidate -= timedelta(days=1)
        for _ in range(7):
            if _is_trading_day(candidate):
                break
            candidate -= timedelta(days=1)

    latest = _get_latest_trading_date()
    logger.warning(f"データが見つからず。最新取引日 {latest} を使用。")
    return latest, ""


def _fetch_jquants_announcements(trading_date: str, api_key: str) -> str:
    """jquants-api-client V2ライブラリを使って決算発表企業一覧を取得する。"""
    try:
        import jquantsapi
        cli = jquantsapi.ClientV2(api_key=api_key)
        date_nodash = trading_date.replace("-", "")
        # get_fin_summary = 決算サマリー (fins/announcement相当)
        df = cli.get_fin_summary(date_yyyymmdd=date_nodash)
        if df is None or df.empty:
            logger.info(f"jquants-api-client fin_summary: {trading_date} データなし")
            return ""
        lines = ["証券コード | 企業名 | 決算種別"]
        for _, row in df.iterrows():
            code = str(row.get("Code", row.get("code", ""))).strip()
            name = str(row.get("CompanyName", row.get("company_name", ""))).strip()
            category = str(row.get("TypeOfDocument", row.get("FiscalYear", ""))).strip()
            if code:
                lines.append(f"{code} | {name} | {category}")
        logger.info(f"jquants-api-client fin_summary: {len(df)}社取得")
        return "\n".join(lines)
    except Exception as e:
        logger.warning(f"jquants-api-client fin_summary 例外: {e}")
        return ""


def _fetch_tdnet_earnings(trading_date: str, api_key: str = "") -> str:
    """J-Quants fins/announcement で決算発表企業一覧を取得する。"""
    if not api_key:
        logger.warning("J-Quants APIキーが未設定のためスキップ")
        return ""
    return _fetch_jquants_announcements(trading_date, api_key)


def _parse_extraction_output(text: str, trading_date: str) -> ExtractionResult:
    stocks_a = _parse_section(text, "A")
    stocks_b = _parse_section(text, "B")
    stocks_c = _parse_section(text, "C")
    if not stocks_a and not stocks_b and not stocks_c:
        stocks_a = _parse_flat(text)
    return ExtractionResult(
        raw_text=text,
        trading_date=trading_date,
        stocks_a=stocks_a,
        stocks_b=stocks_b,
        stocks_c=stocks_c,
    )


def _parse_flat(text: str) -> list[Stock]:
    stocks = []
    entry_pattern = r"■\s*\[?(\d{4,5}[A-Z]?)\]?\s+(.+?)(?=■|@kessan|\Z)"
    for entry_match in re.finditer(entry_pattern, text, re.DOTALL):
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
                                content=content, notes=notes, section="A"))
    return stocks


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
