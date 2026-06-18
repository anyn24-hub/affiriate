"""
stock_extractor.py
J-Quants API V2 で実行日から最新の決算発表銘柄を取得し、
時価総額上位10社に絞り込んで Groq API で整形する。
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

FORMAT_PROMPT_TEMPLATE = """あなたは「日本市場リサーチ専門のエージェント」です。
以下のデータをもとに、指定フォーマットで出力してください。

対象取引日: {trading_date}

【決算データ（J-Quants）】
※{trading_date}に決算発表した企業（時価総額上位）
{earnings_data}

出力ルール:
- 上記リストにある企業をそのまま出力する（絞り込み不要・全種別対象）
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

    trading_date, earnings_data = _get_earnings_with_fallback(jquants_refresh_token)

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


def _get_earnings_with_fallback(api_key: str) -> tuple[str, str]:
    """
    最新の決算発表データを取得する。
    1. みんかぶ（直近10営業日を試行）
    2. J-Quantsカレンダー（フォールバック、4〜6週前のデータになる場合あり）
    """
    now = datetime.now(JST)
    candidate = now.date()

    if now.hour < 15 or (now.hour == 15 and now.minute < 30):
        candidate -= timedelta(days=1)

    for attempt in range(10):
        while not _is_trading_day(candidate):
            candidate -= timedelta(days=1)

        date_str = candidate.strftime("%Y-%m-%d")
        logger.info(f"[{attempt+1}/10] {date_str} を試行中...")

        data = _fetch_minkabu_earnings(date_str)
        if data:
            logger.info(f"みんかぶで取引日確定: {date_str}")
            return date_str, data

        candidate -= timedelta(days=1)

    # フォールバック: J-Quantsカレンダーから最新利用可能データを取得
    logger.warning("みんかぶ失敗 → J-Quantsカレンダーへフォールバック")
    if api_key:
        actual_date, data = _fetch_jquants_calendar(api_key)
        if data:
            return actual_date, data

    today_str = datetime.now(JST).date().strftime("%Y-%m-%d")
    return today_str, ""


def _fetch_jquants_calendar(api_key: str) -> tuple[str, str]:
    """J-Quantsカレンダーから最新利用可能な決算データを返す。"""
    try:
        import jquantsapi, pandas as pd
        cli = jquantsapi.ClientV2(api_key=api_key)
        cal_df = cli.get_eq_earnings_cal()
        if cal_df is None or cal_df.empty:
            return "", ""
        date_col = "Date" if "Date" in cal_df.columns else cal_df.columns[0]
        cal_df[date_col] = cal_df[date_col].astype(str).str[:10]
        today_str = datetime.now(JST).date().strftime("%Y-%m-%d")
        past = [d for d in sorted(cal_df[date_col].unique()) if d <= today_str]
        if not past:
            return "", ""
        best_date = past[-1]
        df = cal_df[cal_df[date_col] == best_date].copy()
        if "CoName" in df.columns:
            df = df.rename(columns={"CoName": "CompanyName"})
        if "FQ" in df.columns:
            df = df.rename(columns={"FQ": "TypeOfDocument"})
        if "Code" not in df.columns:
            return "", ""
        df["Code"] = df["Code"].astype(str).str.zfill(4)
        lines = ["証券コード | 企業名 | 決算種別 | 発表日"]
        for _, row in df.iterrows():
            code = str(row.get("Code", "")).strip().lstrip("0") or str(row.get("Code", "")).strip()
            name = str(row.get("CompanyName", "")).strip()
            cat = _normalize_category(str(row.get("TypeOfDocument", "")).strip())
            if code and code != "nan":
                lines.append(f"{code} | {name} | {cat} | {best_date}")
        if len(lines) <= 1:
            return "", ""
        logger.info(f"J-Quantsカレンダー: {best_date} {len(lines)-1}社")
        return best_date, "\n".join(lines)
    except Exception as e:
        logger.warning(f"J-Quantsカレンダー例外: {e}")
        return "", ""


def _fetch_minkabu_earnings(trading_date: str) -> str:
    """
    株探（kabutan）の決算発表スケジュールから指定日の銘柄を取得する。
    https://s.kabutan.jp/warnings/news_schedule/?market=all
    """
    try:
        from bs4 import BeautifulSoup

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
            "Accept-Language": "ja,en;q=0.9",
        }
        date_nodash = trading_date.replace("-", "")

        # 複数URLフォーマットを試みる
        urls = [
            f"https://s.kabutan.jp/warnings/news_schedule/?market=all&date={date_nodash}",
            f"https://s.kabutan.jp/warnings/news_schedule/?market=all&yyyymmdd={date_nodash}",
            f"https://kabutan.jp/warning/?mode=2&market=1&date={date_nodash}",
            f"https://kabutan.jp/warning/?mode=2&market=1",
        ]

        resp = None
        used_url = ""
        for url in urls:
            r = requests.get(url, headers=headers, timeout=20)
            logger.info(f"kabutan: {r.status_code} ({url})")
            if r.ok:
                resp = r
                used_url = url
                break

        if resp is None:
            return ""

        soup = BeautifulSoup(resp.text, "lxml")
        # HTMLの先頭500文字をログに出力（構造確認用）
        logger.info(f"kabutan HTML先頭: {resp.text[:800].replace(chr(10), ' ')}")
        lines = ["証券コード | 企業名 | 決算種別 | 発表日"]
        seen = set()

        for row in soup.select("tr"):
            cols = row.find_all(["td", "th"])
            if len(cols) < 2:
                continue
            code = ""
            for a in row.find_all("a", href=True):
                m = re.search(r"code=(\d{4,5})|/(\d{4,5})[/\.]", a["href"])
                if m:
                    code = m.group(1) or m.group(2)
                    break
            if not code:
                m = re.search(r"\b(\d{4,5})\b", cols[0].get_text())
                if m:
                    code = m.group(1)
            if not code or code in seen:
                continue

            # 日付フィルタ（ページに複数日付混在の場合）
            row_text = row.get_text()
            if trading_date.replace("-", "/") in row_text or date_nodash in row_text or trading_date in row_text:
                pass  # 日付一致
            elif any(url == used_url for url in urls[:2]):
                pass  # 日付パラメータ付きURLなら全行対象
            else:
                # 日付なしURLの場合は日付チェック
                if trading_date.replace("-", "/") not in row_text and trading_date not in row_text:
                    continue

            seen.add(code)
            name = ""
            for col in cols[1:3]:
                t = col.get_text(strip=True)
                if t and not re.match(r"^\d", t) and len(t) > 1:
                    name = t
                    break
            category_text = ""
            for col in cols:
                t = col.get_text(strip=True)
                if any(k in t for k in ["決算", "四半期", "本決算", "Q"]):
                    category_text = t
                    break
            category = _normalize_category(category_text) if category_text else "決算発表"
            lines.append(f"{code} | {name} | {category} | {trading_date}")

        if len(lines) <= 1:
            logger.info(f"kabutan: {trading_date} はデータなし（HTMLサンプル: {soup.get_text()[:200]}）")
            return ""

        logger.info(f"kabutan: {len(lines)-1}社取得")
        return "\n".join(lines)

    except Exception as e:
        logger.warning(f"kabutan 例外: {e}")
        return ""


def _extract_jquants_token(cli) -> str:
    """ClientV2インスタンスからIDトークンを取り出す（複数の属性名を試みる）。"""
    # 小さいAPIコールでトークンを生成させる
    try:
        cli.get_listed_info()
    except Exception:
        pass
    for attr in ["_id_token", "id_token", "_access_token", "access_token", "_token", "token"]:
        val = getattr(cli, attr, None)
        if val and isinstance(val, str) and len(val) > 20:
            logger.info(f"IDトークン取得成功 (attribute: {attr})")
            return val
    for method in ["get_id_token", "_get_id_token", "get_access_token"]:
        fn = getattr(cli, method, None)
        if fn and callable(fn):
            try:
                val = fn()
                if val:
                    logger.info(f"IDトークン取得成功 (method: {method})")
                    return val
            except Exception:
                pass
    logger.warning("IDトークン取得失敗: 属性が見つかりません")
    return ""


def _fetch_jquants_top10(trading_date: str, api_key: str) -> tuple[str, str]:
    """
    J-Quants V2 で指定日の決算発表銘柄を取得し、
    (実際に使った日付, データ文字列) を返す。データなしの場合は ("", "") を返す。
    """
    try:
        import jquantsapi
        import pandas as pd

        cli = jquantsapi.ClientV2(api_key=api_key)
        # trading_dateが空の場合は今日をデフォルトにする
        if not trading_date:
            trading_date = datetime.now(JST).date().strftime("%Y-%m-%d")
        date_nodash = trading_date.replace("-", "")

        # ── 決算発表データ取得 ──────────────────────────────
        ann_df = None

        # 方法1: 決算発表予定カレンダー（過去・未来含む全件取得）
        try:
            cal_df = cli.get_eq_earnings_cal()
            if cal_df is not None and not cal_df.empty:
                date_col = "Date" if "Date" in cal_df.columns else cal_df.columns[0]
                cal_df[date_col] = cal_df[date_col].astype(str).str[:10]
                unique_dates = sorted(cal_df[date_col].unique())
                logger.info(f"earnings-calendar: 全{len(cal_df)}件, 日付一覧={unique_dates}")
                # 指定日以前で最新の日付を使う
                past_dates = [d for d in unique_dates if d <= trading_date]
                if past_dates:
                    best_date = past_dates[-1]
                    ann_df = cal_df[cal_df[date_col] == best_date].copy()
                    logger.info(f"earnings-calendar 使用日付: {best_date} ({len(ann_df)}社)")
                    if "Code" not in ann_df.columns:
                        for col in ["code", "stock_code", "StockCode"]:
                            if col in ann_df.columns:
                                ann_df = ann_df.rename(columns={col: "Code"})
                                break
                    # CompanyNameカラム統一
                    if "CompanyName" not in ann_df.columns and "CoName" in ann_df.columns:
                        ann_df = ann_df.rename(columns={"CoName": "CompanyName"})
                    # TypeOfDocumentカラム統一
                    if "TypeOfDocument" not in ann_df.columns and "FQ" in ann_df.columns:
                        ann_df = ann_df.rename(columns={"FQ": "TypeOfDocument"})
                    trading_date = best_date  # 実際に使った日付を返す
                else:
                    logger.info(f"earnings-calendar: {trading_date}以前のデータなし, 日付={unique_dates}")
        except Exception as e:
            logger.warning(f"earnings-calendar 例外: {e}")

        if ann_df is None or ann_df.empty:
            return "", ""

        # Codeカラムを文字列に統一（先頭ゼロ保持）
        if "Code" in ann_df.columns:
            ann_df["Code"] = ann_df["Code"].astype(str).str.zfill(4)

        # ── 株価データ取得（時価総額代用: TurnoverValue） ─────
        try:
            prices_df = cli.get_prices_daily_quotes(date_yyyymmdd=date_nodash)
            if prices_df is not None and not prices_df.empty:
                prices_df["Code"] = prices_df["Code"].astype(str).str.zfill(4)
                # MarketCapitalization があれば使う、なければ TurnoverValue
                cap_col = "MarketCapitalization" if "MarketCapitalization" in prices_df.columns else "TurnoverValue"
                prices_sub = prices_df[["Code", cap_col]].copy()
                prices_sub = prices_sub.rename(columns={cap_col: "_sort_value"})
                ann_df = ann_df.merge(prices_sub, on="Code", how="left")
                ann_df["_sort_value"] = pd.to_numeric(ann_df["_sort_value"], errors="coerce").fillna(0)
                ann_df = ann_df.sort_values("_sort_value", ascending=False)
                logger.info(f"株価データ結合完了（ソート基準: {cap_col}）")
        except Exception as e:
            logger.warning(f"株価データ取得エラー: {e}")

        # ── 上位10社 ─────────────────────────────────────────
        top10 = ann_df.head(10)

        lines = [f"証券コード | 企業名 | 決算種別 | 発表日"]
        for _, row in top10.iterrows():
            code = str(row.get("Code", "")).strip().lstrip("0") or str(row.get("Code", "")).strip()
            name = str(row.get("CompanyName", row.get("company_name", ""))).strip()
            # 決算種別
            cat_raw = str(row.get("TypeOfDocument", row.get("FiscalYear", ""))).strip()
            category = _normalize_category(cat_raw)
            # 発表日
            disc_date = str(row.get("DisclosedDate", row.get("Date", trading_date))).strip()

            if code and code != "nan":
                lines.append(f"{code} | {name} | {category} | {disc_date}")

        if len(lines) <= 1:
            return "", ""

        logger.info(f"上位{len(lines)-1}社を出力")
        return trading_date, "\n".join(lines)

    except Exception as e:
        logger.warning(f"_fetch_jquants_top10 例外: {e}")
        return "", ""


def _normalize_category(raw: str) -> str:
    """決算種別を人間が読みやすい形式に変換する。"""
    mapping = {
        "FYQ1": "第1四半期", "FYQ2": "第2四半期", "FYQ3": "第3四半期",
        "FY": "本決算", "Annual": "本決算",
        "Q1": "第1四半期", "Q2": "第2四半期", "Q3": "第3四半期", "Q4": "本決算",
    }
    for key, val in mapping.items():
        if key in raw:
            return val
    if "第1" in raw or "1Q" in raw:
        return "第1四半期"
    if "第2" in raw or "2Q" in raw:
        return "第2四半期"
    if "第3" in raw or "3Q" in raw:
        return "第3四半期"
    if "本決算" in raw or "通期" in raw or "年度" in raw:
        return "本決算"
    return raw if raw and raw != "nan" else "決算発表"


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
