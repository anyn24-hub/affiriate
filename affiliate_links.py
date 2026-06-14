"""
楽天アフィリエイト リンクリスト
投稿ごとにランダムで1つ選ばれてX投稿文に追加されます。

追加方法: RAKUTEN_BOOK_LINKS リストにURLを追加するだけ。
"""

import random

# ── 楽天アフィリエイト：決算書・財務分析関連書籍 ──────────────────────────────
# 下記リストに楽天アフィリエイトリンクを追加してください。
# 例: "https://hb.afl.rakuten.co.jp/hgc/xxxxxxxx/?pc=https%3A%2F%2Fbooks.rakuten.co.jp%2F..."
RAKUTEN_BOOK_LINKS: list[dict] = [
    # {
    #     "title": "本のタイトル（ログ用）",
    #     "url": "https://hb.afl.rakuten.co.jp/hgc/..."
    # },
    # ↑ 上の形式でリンクを追加してください
]

# リンクが未設定の場合のフォールバック（楽天ブックス「決算書」検索ページ）
_FALLBACK_URL = "https://books.rakuten.co.jp/search?sitem=%E6%B1%BA%E7%AE%97%E6%9B%B8"


def get_random_affiliate_link() -> str:
    """リストからランダムに1つのアフィリエイトリンクを返す。リストが空ならフォールバックURLを返す。"""
    if not RAKUTEN_BOOK_LINKS:
        return _FALLBACK_URL
    return random.choice(RAKUTEN_BOOK_LINKS)["url"]
