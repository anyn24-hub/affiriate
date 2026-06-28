export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { genre = '' } = req.query;

  const GENRE_CONFIG = {
    '410899': { kw: 'スイーツ', label: 'スイーツ' },
    '100044': { kw: 'ガジェット', label: 'ガジェット' },
    '216131': { kw: 'コスメ', label: '美容' },
    '100533': { kw: 'サプリ', label: 'ゆる健康' },
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
      .replace(/\s*\|.*$/i, '')
      .trim();
  }

  function extractItemUrls(html) {
    const seen = new Set();
    const urls = [];
    const re = /href=["'](https?:\/\/item\.rakuten\.co\.jp\/[a-zA-Z0-9_\-\.]+\/[a-zA-Z0-9_\-\.\/]+)/gi;
    let m;
    while ((m = re.exec(html)) !== null && urls.length < 10) {
      let u = m[1].split('?')[0].replace(/\/$/, '') + '/';
      // Require at least shop/item structure: /shop/item/
      if (u.split('/').filter(Boolean).length >= 4 && !seen.has(u)) {
        seen.add(u);
        urls.push(u);
      }
    }
    return urls;
  }

  async function fetchItem(itemUrl) {
    try {
      const pr = await fetch(itemUrl, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'ja,en;q=0.9' },
        redirect: 'follow',
        signal: AbortSignal.timeout(7000),
      });
      if (!pr.ok) return { title: null, imageUrl: null };
      const html = await pr.text();
      const title = cleanTitle(
        html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1]
        || html.match(/<title>([^<]+)<\/title>/i)?.[1]
      );
      const imageUrl =
        html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1]
        || null;
      return { title: title && title.length >= 3 ? title : null, imageUrl: imageUrl || null };
    } catch {
      return { title: null, imageUrl: null };
    }
  }

  async function resolveItems(itemUrls) {
    const items = [];
    for (const itemUrl of itemUrls) {
      if (items.length >= 3) break;
      const { title, imageUrl } = await fetchItem(itemUrl);
      if (title) items.push({ name: title, url: makeAff(itemUrl), itemUrl, imageUrl });
    }
    return items;
  }

  // ── Strategy 1: Rakuten Ranking page ─────────────────────────
  try {
    const url = `https://ranking.rakuten.co.jp/daily/${genre}/`;
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' },
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) {
      const html = await r.text();
      const itemUrls = extractItemUrls(html);
      if (itemUrls.length >= 1) {
        const items = await resolveItems(itemUrls);
        if (items.length >= 1) return res.status(200).json({ items });
      }
    }
  } catch {}

  // ── Strategy 2: Rakuten Search page ──────────────────────────
  try {
    const url = `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(cfg.kw)}/${genre}/?s=4`;
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' },
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) {
      const html = await r.text();
      const itemUrls = extractItemUrls(html);
      if (itemUrls.length >= 1) {
        const items = await resolveItems(itemUrls);
        if (items.length >= 1) return res.status(200).json({ items });
      }
    }
  } catch {}

  // ── Strategy 3: DuckDuckGo search ────────────────────────────
  try {
    const query = encodeURIComponent(`site:item.rakuten.co.jp ${cfg.kw} 人気`);
    const r = await fetch(`https://html.duckduckgo.com/html/?q=${query}`, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja,en;q=0.9' },
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) {
      const html = await r.text();
      let itemUrls = [...html.matchAll(/uddg=(https?%3A%2F%2Fitem\.rakuten[^&"]+)/gi)]
        .map(m => decodeURIComponent(m[1]).split('?')[0].replace(/\/$/, '') + '/');
      if (!itemUrls.length) {
        itemUrls = [...html.matchAll(/href=["'](https?:\/\/item\.rakuten\.co\.jp\/[^"'<>\s]+)["']/gi)]
          .map(m => m[1].split('?')[0].replace(/\/$/, '') + '/');
      }
      itemUrls = [...new Set(itemUrls)].slice(0, 8);
      const items = await resolveItems(itemUrls);
      if (items.length >= 1) return res.status(200).json({ items });
    }
  } catch {}

  return res.status(200).json({ items: [], _error: '商品を取得できませんでした' });
}
