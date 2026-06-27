export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { genre = '' } = req.query;

  const VALID_GENRES = ['410899', '100044', '216131', '100533'];
  if (!VALID_GENRES.includes(genre)) {
    return res.status(200).json({ items: [], _error: 'ジャンル不明' });
  }

  const affId = process.env.RAKUTEN_AFF_ID || '5335e187.bd9b90cd.5335e188.d302f85f';
  const rssUrl = `https://ranking.rakuten.co.jp/daily/${genre}/rss/`;

  try {
    const r = await fetch(rssUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'ja,en-US;q=0.9',
      },
    });

    if (!r.ok) {
      return res.status(200).json({ items: [], _error: `RSS取得失敗: HTTP ${r.status}` });
    }

    const xml = await r.text();
    const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];

    const items = [];
    for (const m of itemBlocks) {
      if (items.length >= 3) break;
      const block = m[1];

      // title (with optional CDATA)
      let title = block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1]?.trim() || '';
      title = title
        .replace(/\s*[｜|]\s*.*楽天.*$/i, '')
        .replace(/楽天市場[:：]\s*/i, '')
        .replace(/\s*-\s*楽天市場.*$/i, '')
        .trim();
      if (!title || title.length < 3) continue;

      // link (prefer <link>, fall back to <guid>)
      let link = block.match(/<link[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i)?.[1]?.trim()
               || block.match(/<guid[^>]*>(?:<!\[CDATA\[)?(https?:\/\/[^<\]]+)(?:\]\]>)?<\/guid>/i)?.[1]?.trim()
               || '';
      link = link.trim();
      if (!link || !link.includes('rakuten')) continue;

      // strip query params, normalise trailing slash
      link = link.split('?')[0].replace(/\/$/, '') + '/';

      const affiliateUrl = affId
        ? `https://hb.afl.rakuten.co.jp/ichiba/${affId}/?pc=${encodeURIComponent(link)}&link_type=text`
        : link;

      items.push({ name: title, url: affiliateUrl, itemUrl: link });
    }

    if (!items.length) {
      return res.status(200).json({ items: [], _error: 'RSSから商品を取得できませんでした', _xmlSample: xml.slice(0, 600) });
    }

    return res.status(200).json({ items });
  } catch (e) {
    return res.status(200).json({ items: [], _error: e.message });
  }
}
