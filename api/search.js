export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const affId = process.env.RAKUTEN_AFF_ID || '';
  const { genre = '', kw = '' } = req.query;

  // Build search keyword from genre or use provided kw
  const GENRE_KW = {
    '410899': 'スイーツ お菓子',
    '215783': 'ガジェット 家電',
    '216131': '化粧品 コスメ',
    '100533': '健康食品 サプリ',
  };
  const keyword = kw || GENRE_KW[genre] || 'ランキング';

  // Rakuten search page (sorted by review count)
  const searchUrl = `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(keyword)}/?s=2&p=1`;

  try {
    const r = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ja,en;q=0.9',
      },
    });

    if (!r.ok) return res.status(r.status).json({ error: `Rakuten search failed: ${r.status}` });

    const html = await r.text();

    // Extract product items via regex (item.rakuten.co.jp links + nearby titles)
    const items = [];
    const seen = new Set();

    // Pattern: data-item-id or item links with titles
    const linkRe = /"(https?:\/\/item\.rakuten\.co\.jp\/[^"?]+)"/g;
    const titleRe = /<div[^>]+class="[^"]*title[^"]*"[^>]*>\s*<a[^>]+href="(https?:\/\/item\.rakuten\.co\.jp\/[^"?]+)"[^>]*(?:title="([^"]*)")?[^>]*>([^<]*)</g;

    // Try to find title+url together
    let m;
    while ((m = titleRe.exec(html)) !== null && items.length < 20) {
      const url = m[1].replace(/\/$/, '') + '/';
      if (seen.has(url)) continue;
      seen.add(url);
      const title = (m[2] || m[3] || '').replace(/\s+/g, ' ').trim();
      if (title.length < 4) continue;
      const affiliateUrl = affId
        ? `https://hb.afl.rakuten.co.jp/ichiba/${affId}/?pc=${encodeURIComponent(url)}&link_type=text`
        : url;
      items.push({
        itemName: title.slice(0, 50),
        itemUrl: url,
        affiliateUrl,
        itemPrice: 0,
        reviewCount: 0,
        reviewAverage: 0,
        postageFlag: 0,
        itemCaption: '',
        mediumImageUrls: [],
      });
    }

    // Fallback: just extract URLs if no titles found
    if (items.length < 3) {
      while ((m = linkRe.exec(html)) !== null && items.length < 20) {
        const url = m[1].replace(/\/$/, '') + '/';
        if (seen.has(url)) continue;
        seen.add(url);
        const affiliateUrl = affId
          ? `https://hb.afl.rakuten.co.jp/ichiba/${affId}/?pc=${encodeURIComponent(url)}&link_type=text`
          : url;
        items.push({
          itemName: url.split('/').slice(-2, -1)[0] || '商品',
          itemUrl: url,
          affiliateUrl,
          itemPrice: 0,
          reviewCount: 0,
          reviewAverage: 0,
          postageFlag: 0,
          itemCaption: '',
          mediumImageUrls: [],
        });
      }
    }

    return res.status(200).json({
      Items: items.slice(0, 20).map(item => ({ Item: item })),
      count: items.length,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
