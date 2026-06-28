export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { genre = '' } = req.query;

  const GENRE_CONFIG = {
    '410899': { kw: 'スイーツ 人気 楽天ランキング' },
    '100044': { kw: 'ガジェット 便利グッズ 人気 楽天' },
    '216131': { kw: 'コスメ スキンケア 人気 楽天' },
    '100533': { kw: 'サプリメント 健康 人気 楽天' },
  };

  const cfg = GENRE_CONFIG[genre];
  if (!cfg) return res.status(200).json({ items: [], _error: 'ジャンル不明' });

  const affId = process.env.RAKUTEN_AFF_ID || '5335e187.bd9b90cd.5335e188.d302f85f';
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

  function makeAff(itemUrl) {
    return `https://hb.afl.rakuten.co.jp/ichiba/${affId}/?pc=${encodeURIComponent(itemUrl)}&link_type=text`;
  }

  function cleanTitle(raw) {
    return (raw || '')
      .replace(/\s*[｜|]\s*.*楽天.*$/i, '')
      .replace(/楽天市場[:：]\s*/i, '')
      .replace(/\s*-\s*楽天市場.*$/i, '')
      .trim();
  }

  async function fetchItemTitle(itemUrl) {
    const pr = await fetch(itemUrl, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'ja,en;q=0.9' },
      redirect: 'follow',
    });
    const phtml = await pr.text();
    const title = cleanTitle(
      phtml.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
      || phtml.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1]
      || phtml.match(/<title>([^<]+)<\/title>/i)?.[1]
    );
    return title && title.length >= 3 ? title : null;
  }

  // ── Strategy 1: Rakuten Ranking RSS ──────────────────────────────────────
  try {
    const rssUrl = `https://ranking.rakuten.co.jp/daily/${genre}/rss/`;
    const r = await fetch(rssUrl, {
      headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml, text/xml, */*', 'Accept-Language': 'ja' },
    });
    if (r.ok) {
      const xml = await r.text();
      const blocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
      const items = [];
      for (const m of blocks) {
        if (items.length >= 3) break;
        const block = m[1];
        const title = cleanTitle(
          block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1]?.trim()
        );
        if (!title || title.length < 3) continue;
        let link = (
          block.match(/<link[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i)?.[1]?.trim()
          || block.match(/<guid[^>]*>(?:<!\[CDATA\[)?(https?:\/\/[^<\]]+)(?:\]\]>)?<\/guid>/i)?.[1]?.trim()
          || ''
        ).trim();
        if (!link || !link.includes('item.rakuten.co.jp')) continue;
        link = link.split('?')[0].replace(/\/$/, '') + '/';
        items.push({ name: title, url: makeAff(link), itemUrl: link });
      }
      if (items.length >= 1) return res.status(200).json({ items });
    }
  } catch {}

  // ── Strategy 2: DuckDuckGo search → item.rakuten.co.jp URL discovery ─────
  try {
    const query = encodeURIComponent(`site:item.rakuten.co.jp ${cfg.kw}`);
    const ddgRes = await fetch(`https://html.duckduckgo.com/html/?q=${query}`, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja,en;q=0.9' },
    });
    if (ddgRes.ok) {
      const html = await ddgRes.text();

      // DDG wraps real URLs in uddg= param
      let itemUrls = [...html.matchAll(/uddg=(https?%3A%2F%2Fitem\.rakuten[^&"]+)/gi)]
        .map(m => decodeURIComponent(m[1]).split('?')[0].replace(/\/$/, '') + '/');

      // Fallback: direct href extraction
      if (!itemUrls.length) {
        itemUrls = [...html.matchAll(/href=["'](https?:\/\/item\.rakuten\.co\.jp\/[^"'<>\s]+)["']/gi)]
          .map(m => m[1].split('?')[0].replace(/\/$/, '') + '/');
      }

      itemUrls = [...new Set(itemUrls)].slice(0, 6);

      const items = [];
      for (const itemUrl of itemUrls) {
        if (items.length >= 3) break;
        try {
          const title = await fetchItemTitle(itemUrl);
          if (title) items.push({ name: title, url: makeAff(itemUrl), itemUrl });
        } catch {}
      }
      if (items.length >= 1) return res.status(200).json({ items });
    }
  } catch {}

  return res.status(200).json({ items: [], _error: '商品を取得できませんでした' });
}
