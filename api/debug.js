export default async function handler(req, res) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ja,en;q=0.9',
  };

  async function tryUrl(label, url) {
    try {
      const r = await fetch(url, { headers });
      const text = await r.text();
      const hasItems = text.includes('item.rakuten.co.jp');
      return { label, status: r.status, hasItems, preview: text.slice(0, 150) };
    } catch (e) {
      return { label, error: e.message };
    }
  }

  const results = await Promise.all([
    tryUrl('ichiba_ranking', 'https://ichiba.rakuten.co.jp/ranking/'),
    tryUrl('ichiba_sweets', 'https://ichiba.rakuten.co.jp/ranking/?g=410899'),
    tryUrl('item_search', 'https://search.rakuten.co.jp/search/mall/%E3%82%B9%E3%82%A4%E3%83%BC%E3%83%84/?s=2'),
  ]);

  return res.status(200).json({ results });
}
