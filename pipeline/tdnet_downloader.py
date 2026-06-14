"""
tdnet_downloader.py
TDnetから指定日の決算短信PDFを取得してGoogle Driveにアップロードする。
銘柄コードではなく「対象日付 × 決算カテゴリ」で全件検索する方式。
"""

import io
import json
import logging
import time
from typing import Optional

import requests
from bs4 import BeautifulSoup
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload

logger = logging.getLogger(__name__)

TDNET_BASE = "https://www.release.tdnet.info"
DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"]

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ja,en;q=0.9",
    "Referer": "https://www.release.tdnet.info/",
}

EARNINGS_KEYWORDS = ["決算短信", "決算説明", "業績予想", "四半期報告", "通期"]


def build_drive_service(service_account_json: str):
    info = json.loads(service_account_json)
    credentials = service_account.Credentials.from_service_account_info(
        info, scopes=DRIVE_SCOPES
    )
    return build("drive", "v3", credentials=credentials)


def search_tdnet_by_date(trading_date: str, stock_codes: list[str], session: requests.Session) -> list[dict]:
    """
    TDnetを日付で検索して、対象銘柄コードの決算短信PDFリンクを取得する。
    trading_date: "YYYY-MM-DD" 形式
    """
    date_str = trading_date.replace("-", "")  # → YYYYMMDD

    # TDnetの日付別開示一覧URL
    url = f"{TDNET_BASE}/inbs/I_main_00.html"
    params = {
        "dv": "",
        "stpr": "B",   # 決算短信カテゴリ
        "dm": date_str,
    }

    try:
        resp = session.get(url, params=params, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        resp.encoding = "utf-8"
    except requests.RequestException as e:
        logger.warning(f"TDnet日付検索失敗: {e}")
        return []

    soup = BeautifulSoup(resp.text, "lxml")
    results = []
    stock_code_set = set(stock_codes)

    for row in soup.select("table#kaiji-list-main tr, table tr"):
        cells = row.find_all("td")
        if len(cells) < 3:
            continue

        row_text = row.get_text()

        # 銘柄コードが対象リストに含まれるか確認
        matched_code = None
        for code in stock_code_set:
            if code in row_text:
                matched_code = code
                break
        if not matched_code:
            continue

        # 決算関連キーワードが含まれるか確認
        if not any(kw in row_text for kw in EARNINGS_KEYWORDS):
            continue

        # PDFリンクを取得
        for a in row.find_all("a", href=True):
            href = a["href"]
            if ".pdf" in href.lower() or "pdf" in href.lower():
                full_url = href if href.startswith("http") else TDNET_BASE + "/" + href.lstrip("/")
                title = a.get_text(strip=True) or row_text.strip()[:50]
                results.append({
                    "stock_code": matched_code,
                    "title": title,
                    "url": full_url,
                })
                logger.info(f"[{matched_code}] TDnet PDF発見: {title}")
                break

    if not results:
        logger.warning(f"TDnet日付検索（{trading_date}）: 対象銘柄の決算PDFが見つかりませんでした。")
        logger.info("代替: 銘柄コード別に個別検索を試みます...")
        results = _search_by_stock_codes(stock_codes, session)

    return results


def _search_by_stock_codes(stock_codes: list[str], session: requests.Session) -> list[dict]:
    """フォールバック: 銘柄コード別にTDnetを検索する。"""
    results = []
    for code in stock_codes[:5]:  # 上位5件に絞る
        url = f"{TDNET_BASE}/inbs/I_main_00.html"
        params = {"sc": code, "dv": "", "stpr": "B"}
        try:
            resp = session.get(url, params=params, headers=HEADERS, timeout=15)
            resp.raise_for_status()
            resp.encoding = "utf-8"
            soup = BeautifulSoup(resp.text, "lxml")
            for row in soup.select("table tr"):
                row_text = row.get_text()
                if not any(kw in row_text for kw in EARNINGS_KEYWORDS):
                    continue
                for a in row.find_all("a", href=True):
                    href = a["href"]
                    if ".pdf" in href.lower():
                        full_url = href if href.startswith("http") else TDNET_BASE + "/" + href.lstrip("/")
                        results.append({"stock_code": code, "title": a.get_text(strip=True), "url": full_url})
                        break
        except Exception as e:
            logger.warning(f"[{code}] 個別検索失敗: {e}")
        time.sleep(1.0)
    return results


def download_pdf(url: str, session: requests.Session) -> Optional[bytes]:
    try:
        resp = session.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        return resp.content
    except requests.RequestException as e:
        logger.warning(f"PDF ダウンロード失敗 {url}: {e}")
        return None


def upload_to_drive(drive_service, file_bytes: bytes, filename: str, folder_id: str) -> Optional[str]:
    file_metadata = {"name": filename, "parents": [folder_id]}
    media = MediaIoBaseUpload(io.BytesIO(file_bytes), mimetype="application/pdf", resumable=True)
    try:
        f = drive_service.files().create(
            body=file_metadata, media_body=media, fields="id, webViewLink"
        ).execute()
        logger.info(f"Drive アップロード完了: {filename} → {f.get('webViewLink', '')}")
        return f.get("id")
    except Exception as e:
        logger.error(f"Drive アップロード失敗 ({filename}): {e}")
        return None


def process_stocks(
    stock_codes: list[str],
    folder_id: str,
    service_account_json: str,
    dry_run: bool = False,
    trading_date: str = "",
    rate_limit_delay: float = 1.5,
) -> dict[str, list[str]]:
    if dry_run:
        logger.info(f"[DRY RUN] {len(stock_codes)}銘柄のTDnet処理をスキップ。")
        return {code: ["dry-run-file-id"] for code in stock_codes}

    if not folder_id:
        logger.error("DRIVE_FOLDER_ID が未設定です。GitHub Secretsに追加してください。")
        return {}

    drive_service = build_drive_service(service_account_json)
    session = requests.Session()
    results: dict[str, list[str]] = {}

    # 日付一括検索
    docs = search_tdnet_by_date(trading_date, stock_codes, session)

    if not docs:
        logger.warning("TDnetからPDFが取得できませんでした。")
        return {code: [] for code in stock_codes}

    for doc in docs:
        code = doc["stock_code"]
        logger.info(f"[{code}] PDF ダウンロード中: {doc['url']}")
        pdf_bytes = download_pdf(doc["url"], session)
        if not pdf_bytes:
            results.setdefault(code, [])
            continue

        filename = f"{code}_{doc['title'][:60].replace('/', '_')}.pdf"
        file_id = upload_to_drive(drive_service, pdf_bytes, filename, folder_id)
        results.setdefault(code, [])
        if file_id:
            results[code].append(file_id)
        time.sleep(rate_limit_delay)

    uploaded = sum(len(v) for v in results.values())
    logger.info(f"TDnet処理完了: {uploaded}件アップロード。")
    return results
