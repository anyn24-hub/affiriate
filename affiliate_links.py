"""
楽天ブックスAPIから「決算書」関連書籍をランダム取得してアフィリエイトリンクを返す。

必要な設定（GitHub Secrets または .env）:
  RAKUTEN_APP_ID      : 楽天ウェブサービスのアプリID（無料登録 → https://webservice.rakuten.co.jp/）
  RAKUTEN_AFFILIATE_ID: 楽天アフィリエイトのアフィリエイトID（例: 1.1234567.0）
                        楽天アフィリエイト管理画面 → ツール → リンク作成 → アフィリエイトIDを確認

どちらか未設定の場合はフォールバックURLを使用。
"""

import logging
import random
import urllib.parse

import requests

logger = logging.getLogger(__name__)

# 検索キーワード（複数ある場合はランダムに選ぶ）
_SEARCH_KEYWORDS = ["決算書", "財務諸表", "財務分析", "会計 入門"]

_RAKUTEN_BOOKS_API = "https://app.rakuten.co.jp/services/api/BooksBook/Search/20170404"

# APIが使えない場合のフォールバック
_FALLBACK_URL = "https://books.rakuten.co.jp/search?sitem=%E6%B1%BA%E7%AE%97%E6%9B%B8"


def get_random_affiliate_link(app_id: str = "", affiliate_id: str = "") -> str:
    """
    楽天ブックスAPIで決算書関連本をランダム検索し、アフィリエイトリンクを返す。
    app_id / affiliate_id が未設定の場合はフォールバックURLを返す。
    """
    if not app_id or not affiliate_id:
        logger.warning(
            "RAKUTEN_APP_ID または RAKUTEN_AFFILIATE_ID が未設定。"
            "フォールバックURLを使用します。"
            "設定方法: https://webservice.rakuten.co.jp/"
        )
        return _FALLBACK_URL

    keyword = random.choice(_SEARCH_KEYWORDS)
    try:
        link = _fetch_random_book_link(app_id, affiliate_id, keyword)
        if link:
            logger.info(f"楽天アフィリエイトリンク取得成功: {link}")
            return link
    except Exception as e:
        logger.warning(f"楽天API取得エラー: {e}。フォールバックURLを使用します。")

    return _FALLBACK_URL


def _fetch_random_book_link(app_id: str, affiliate_id: str, keyword: str) -> str:
    """楽天ブックスAPIを呼び出してランダムな本のアフィリエイトURLを返す。"""
    params = {
        "applicationId": app_id,
        "affiliateId": affiliate_id,
        "keyword": keyword,
        "booksGenreId": "001",  # 本カテゴリ
        "hits": 20,             # 上位20件から選ぶ
        "sort": "sales",        # 売れ筋順
        "format": "json",
    }

    resp = requests.get(_RAKUTEN_BOOKS_API, params=params, timeout=10)
    resp.raise_for_status()
    data = resp.json()

    items = data.get("Items", [])
    if not items:
        logger.warning(f"楽天API: キーワード「{keyword}」で書籍が見つかりませんでした。")
        return ""

    # 売れ筋上位20件からランダムに1冊選ぶ
    item = random.choice(items)["Item"]
    title = item.get("title", "")
    affiliate_url = item.get("affiliateUrl", "")

    if affiliate_url:
        logger.info(f"選択された本: 『{title}』")
        return affiliate_url

    # affiliateUrlが空の場合、itemUrlをアフィリエイト経由に変換
    item_url = item.get("itemUrl", "")
    if item_url:
        logger.info(f"選択された本（直接URL変換）: 『{title}』")
        encoded = urllib.parse.quote(item_url, safe="")
        return f"https://hb.afl.rakuten.co.jp/ichiba/affiliate/?pc={encoded}&m={encoded}&id={affiliate_id}"

    return ""
