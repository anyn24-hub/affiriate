"""
stock_extractor.py
irbank.net（決算カレンダー）で発表日の決算銘柄を取得し、
Groq API（無料）で整形・分析する。
J-Quants APIはフォールバック用（発表日フィルタが使えないため非推奨）。
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

# irbank.net用 User-Agent（ブラウザを偽装してブロック回避）
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ja-JP,ja;q=0.9",
    "Referer": "https://irbank.net/",
}

FORMAT_PROMPT_TEMPLATE = """あなたは「日本市場リサーチ専門のエージェント」です。
以下のデータをもとに、指定フォーマットで出力してください。

対象取引日: {trading_date}

【決算データ（irbank.net）】
※{trading_date}に決算発表した企業一覧
{earnings_data}

出力ルール:
- 上記リストから最大10社を選ぶ（本決算を優先し、次に第4四半期、その次に第3四半期の順）
- 同じ種別の場合は証券コードが小さい（＝大手）順に並べる
- 事業内容は実際の事業を15文字以内で具体的に記載（一般的な業種知識から補完してよい）
- データがない場合は「（該当なし）」と記載
- 時価総額データはないので順位付けは不要。リストにある企業をそのまま選定すること

出力形式:
▼ 対象取引日: {trading_date}

━━ 本日決算の大手企業（時価総額上位・最大10社）━━
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

    # Step 1: 対象取引日を特定
    trading_date = _get_latest_trading_date()
    logger.info(f"対象取引日: {trading_date}")

    # Step 2: irbank.netで決算データ取得（メイン）
    earnings_data = _fetch_irbank_earnings(trading_date)
    logger.info(f"irbank決算: {len(earnings_data.splitlines())}行")

    # Step 3: Groq APIで整形
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


def _get_latest_trading_date() -> str:
    """市場が閉まっている最新の取引日を返す（YYYY-MM-DD形式）。"""
    now = datetime.now(JST)
    logger.info(f"現在時刻(JST): {now.strftime('%Y-%m-%d %H:%M')} weekday={now.weekday()}")
    candidate = now.date()
    # 土日・祝日、または15:30前なら今日は取引日でない
    market_closed_today = (
        candidate.weekday() >= 5
        or (candidate.month, candidate.day) in _JP_HOLIDAYS
        or now.hour < 15
        or (now.hour == 15 and now.minute < 30)
    )
    if market_closed_today:
        candidate -= timedelta(days=1)
    # 土日・祝日を遡る
    for _ in range(14):
        if candidate.weekday() < 5 and (candidate.month, candidate.day) not in _JP_HOLIDAYS:
            break
        candidate -= timedelta(days=1)
    logger.info(f"算出された取引日: {candidate}")
    return candidate.strftime("%Y-%m-%d")


def _fetch_irbank_earnings(trading_date: str) -> str:
    """irbank.netから指定日に決算発表した企業一覧を取得する。リトライ付き。"""
    url = f"https://irbank.net/market/kessan?y={trading_date}"
    delays = [3, 6, 12]  # リトライ間隔（秒）

    for attempt in range(4):
        try:
            resp = requests.get(url, headers=_HEADERS, timeout=20)
            logger.info(f"irbank HTTP {resp.status_code} (attempt {attempt+1})")
            if resp.status_code == 403:
                if attempt < len(delays):
                    logger.warning(f"irbank 403 Forbidden。{delays[attempt]}秒後リトライ...")
                    time.sleep(delays[attempt])
                    continue
                logger.warning("irbank 403: リトライ上限に達しました。")
                return ""
            resp.raise_for_status()
            return _parse_irbank_html(resp.text, trading_date)
        except requests.RequestException as e:
            if attempt < len(delays):
                logger.warning(f"irbank取得エラー: {e}。リトライ...")
                time.sleep(delays[attempt])
            else:
                logger.warning(f"irbank取得失敗: {e}")
                return ""
    return ""


def _parse_irbank_html(html: str, trading_date: str) -> str:
    """irbank.netのHTMLから企業リストを抽出する。"""
    # <a href="/XXXX">企業名</a> のパターンを抽出
    pattern = r'href="/(\d{4,5}[A-Z]?)">([^<]+)</a>'
    matches = re.findall(pattern, html)

    # 決算種別パターン（本決算・第X四半期）
    category_pattern = r'(本決算|第[１-４1-4]四半期|第[１-４1-4]Q)'

    if not matches:
        logger.warning(f"irbank HTML解析: 銘柄が見つかりません（HTMLサイズ: {len(html)}文字）")
        return ""

    seen = set()
    lines = ["証券コード | 企業名"]
    for code, name in matches:
        name = name.strip()
        if code not in seen and len(name) > 1 and not name.startswith("http"):
            seen.add(code)
            lines.append(f"{code} | {name}")

    logger.info(f"irbank解析: {len(seen)}社を抽出")
    return "\n".join(lines)



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
