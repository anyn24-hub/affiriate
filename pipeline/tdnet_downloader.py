"""
tdnet_downloader.py
Downloads latest earnings PDFs from TDnet for given stock codes,
then uploads them to Google Drive.
"""

import io
import json
import logging
import os
import time
from typing import Optional

import requests
from bs4 import BeautifulSoup
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload

logger = logging.getLogger(__name__)

TDNET_BASE = "https://www.release.tdnet.info"
TDNET_SEARCH_URL = f"{TDNET_BASE}/inbs/I_main_00.html"
DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"]

# Keywords that identify earnings documents
EARNINGS_KEYWORDS = ["決算", "業績", "financial", "earnings", "結果"]

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ja,en;q=0.9",
}


def build_drive_service(service_account_json: str):
    """Build Google Drive API service from service account JSON string."""
    info = json.loads(service_account_json)
    credentials = service_account.Credentials.from_service_account_info(
        info, scopes=DRIVE_SCOPES
    )
    return build("drive", "v3", credentials=credentials)


def search_tdnet_for_stock(stock_code: str, session: requests.Session) -> list[dict]:
    """
    Search TDnet for the latest earnings PDF for a given stock code.
    Returns list of dicts with keys: title, url, date.
    """
    params = {
        "sc": stock_code,
        "dv": "",
        "stpr": "B",  # filter: earnings reports
    }

    try:
        resp = session.get(TDNET_SEARCH_URL, params=params, headers=HEADERS, timeout=15)
        resp.raise_for_status()
    except requests.RequestException as e:
        logger.warning(f"[{stock_code}] TDnet request failed: {e}")
        return []

    soup = BeautifulSoup(resp.text, "html.parser")
    results = []

    # TDnet table rows contain document links
    for row in soup.select("table tr"):
        cells = row.find_all("td")
        if len(cells) < 3:
            continue

        # Look for PDF links
        link_tag = row.find("a", href=True)
        if not link_tag:
            continue

        href = link_tag["href"]
        title = link_tag.get_text(strip=True)

        # Filter for earnings-related documents
        is_earnings = any(kw in title for kw in EARNINGS_KEYWORDS)
        if not is_earnings:
            continue

        # Build full URL
        if href.startswith("http"):
            full_url = href
        else:
            full_url = TDNET_BASE + "/" + href.lstrip("/")

        # Extract date from row if available
        date_text = cells[0].get_text(strip=True) if cells else ""

        results.append({
            "title": title,
            "url": full_url,
            "date": date_text,
            "stock_code": stock_code,
        })

    return results


def download_pdf(url: str, session: requests.Session) -> Optional[bytes]:
    """Download a PDF file and return its bytes."""
    try:
        resp = session.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        content_type = resp.headers.get("Content-Type", "")
        if "pdf" not in content_type.lower() and not url.lower().endswith(".pdf"):
            logger.warning(f"URL may not be a PDF (Content-Type: {content_type}): {url}")
        return resp.content
    except requests.RequestException as e:
        logger.warning(f"Failed to download PDF from {url}: {e}")
        return None


def upload_to_drive(
    drive_service,
    file_bytes: bytes,
    filename: str,
    folder_id: str,
    mime_type: str = "application/pdf",
) -> Optional[str]:
    """
    Upload file bytes to Google Drive folder.
    Returns the file ID if successful, None otherwise.
    """
    file_metadata = {
        "name": filename,
        "parents": [folder_id],
    }
    media = MediaIoBaseUpload(io.BytesIO(file_bytes), mimetype=mime_type, resumable=True)

    try:
        file = (
            drive_service.files()
            .create(body=file_metadata, media_body=media, fields="id, webViewLink")
            .execute()
        )
        file_id = file.get("id")
        link = file.get("webViewLink", "")
        logger.info(f"Uploaded '{filename}' to Drive: {link}")
        return file_id
    except Exception as e:
        logger.error(f"Drive upload failed for '{filename}': {e}")
        return None


def process_stocks(
    stock_codes: list[str],
    folder_id: str,
    service_account_json: str,
    dry_run: bool = False,
    rate_limit_delay: float = 1.5,
) -> dict[str, list[str]]:
    """
    For each stock code: search TDnet, download latest earnings PDF, upload to Drive.

    Returns dict mapping stock_code -> list of uploaded Drive file IDs.
    """
    if dry_run:
        logger.info(f"[DRY RUN] Would process {len(stock_codes)} stocks for TDnet download.")
        return {code: ["dry-run-file-id"] for code in stock_codes}

    drive_service = build_drive_service(service_account_json)
    session = requests.Session()
    results: dict[str, list[str]] = {}

    for code in stock_codes:
        logger.info(f"Processing stock {code} on TDnet...")
        file_ids = []

        docs = search_tdnet_for_stock(code, session)
        if not docs:
            logger.warning(f"[{code}] No earnings documents found on TDnet.")
            results[code] = []
            time.sleep(rate_limit_delay)
            continue

        # Take only the most recent document
        latest = docs[0]
        logger.info(f"[{code}] Found document: {latest['title']} ({latest['date']})")

        pdf_bytes = download_pdf(latest["url"], session)
        if pdf_bytes is None:
            logger.warning(f"[{code}] Could not download PDF.")
            results[code] = []
            time.sleep(rate_limit_delay)
            continue

        safe_title = latest["title"].replace("/", "_").replace("\\", "_")[:80]
        filename = f"{code}_{safe_title}.pdf"

        file_id = upload_to_drive(drive_service, pdf_bytes, filename, folder_id)
        if file_id:
            file_ids.append(file_id)

        results[code] = file_ids
        time.sleep(rate_limit_delay)  # be polite to TDnet

    logger.info(
        f"TDnet processing complete. "
        f"{sum(len(v) for v in results.values())} files uploaded."
    )
    return results
