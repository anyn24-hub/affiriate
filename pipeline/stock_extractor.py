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

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.8",
    "Referer": "https://irbank.net/",
}

FORMAT_PROMPT_TEMPLATE = """あなたは「日本市場リサーチ専門のエージェント」です。
以下のデータをもとに、指定フォーマットで出力してください。

対象取引日: {trading_date}

【決算データ（irbank.net）】
※{trading_date}に決算発表した企業一覧
{earnings_data}

出力ルール:
- 上記リストから最大12社を選ぶ（本決算を優先し、次に第4四半期、その次に第3四半期の順）
- 同じ種別の場合は証券コードが小さい（＝大手）順に並べる
- 事業内容は実際の事業を15文字以内で具体的に記載（一般的な業種知識から補完してよい）
- データがない場合は「（該当なし）」と記載
- 時価総額データはないので順位付けは不要。リストにある企業をそのまま選定すること

出力形式:
▼ 対象取引日: {trading_date}

━━ 本日決算の大手企業（最大12社）━━
■ [証券コード] 企業名
・カテゴリー：本決算 or 第X四半期
・事業内容：（15文字程度）

@kessan_class #決算

【検証ログ】
・選定した銘柄数と根拠
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
    trading_date, earnings_data = _get_trading_date_with_data()

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


def _get_trading_date_with_data() -> tuple[str, str]:
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
    for _ in range(5):
        date_str = candidate.strftime("%Y-%m-%d")
        logger.info(f"対象取引日: {date_str} を試行中...")
        data = _fetch_irbank_earnings(date_str)
        if data:
            logger.info(f"対象取引日確定: {date_str}（{len(data.splitlines())}行取得）")
            return date_str, data
        candidate -= timedelta(days=1)
        for _ in range(7):
            if _is_trading_day(candidate):
                break
            candidate -= timedelta(days=1)

    latest = _get_latest_trading_date()
    logger.warning(f"データが見つからず。最新取引日 {latest} を使用。")
    return latest, ""


def _fetch_irbank_earnings(trading_date: str) -> str:
    """irbank.netから指定日に決算発表した企業一覧を取得する。"""
    url = f"https://irbank.net/market/kessan?y={trading_date}"
    time.sleep(2)  # サーバー負荷軽減のため少し待つ
    try:
        resp = requests.get(url, headers=_HEADERS, timeout=20)
        logger.info(f"irbank HTTP {resp.status_code} for {trading_date}")
        if resp.status_code == 403:
            logger.warning("irbank 403 Forbidden。")
            return ""
        resp.raise_for_status()
        return _parse_irbank_html(resp.text)
    except requests.RequestException as e:
        logger.warning(f"irbank取得エラー: {e}")
        return ""


def _parse_irbank_html(html: str) -> str:
    """irbank.netのHTMLから企業リストを抽出する。"""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "lxml")

    seen = set()
    lines = ["証券コード | 企業名 | 決算種別"]

    # テーブル行を探す
    for row in soup.select("table tr"):
        cells = row.find_all("td")
        if len(cells) < 2:
            continue
        # 証券コードのリンクを探す
        link = row.find("a", href=re.compile(r"^/\d{4}"))
        if not link:
            continue
        code = link["href"].strip("/")
        name = link.get_text(strip=True)
        # 決算種別（本決算・第X四半期）
        category = ""
        for cell in cells:
            text = cell.get_text(strip=True)
            if re.search(r"本決算|第[１-４1-4]四半期|第[１-４1-4]Q", text):
                category = text
                break
        if code and name and code not in seen:
            seen.add(code)
            lines.append(f"{code} | {name} | {category}")

    if len(seen) == 0:
        logger.warning(f"irbank HTML解析: 銘柄が見つかりません（HTMLサイズ: {len(html)}文字）")
        return ""

    logger.info(f"irbank解析: {len(seen)}社を抽出")
    return "\n".join(lines)


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
