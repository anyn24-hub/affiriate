export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { genre = '' } = req.query;

  // Real Rakuten shop pages (server-rendered HTML, contains item.rakuten.co.jp links)
  const SHOPS = {
    '410899': [
      'https://www.rakuten.co.jp/letao/',
      'https://www.rakuten.co.jp/morozoff/',
      'https://www.rakuten.co.jp/ginza-sembikiya/',
    ],
    '100044': [
      'https://www.rakuten.co.jp/ankerjapan/',
      'https://www.rakuten.co.jp/elecom/',
      'https://www.rakuten.co.jp/r-kojima/',
    ],
    '216131': [
      'https://www.rakuten.co.jp/orbis/',
      'https://www.rakuten.co.jp/chifure/',
      'https://www.rakuten.co.jp/shiseido-sp/',
    ],
    '100533': [
      'https://www.rakuten.co.jp/dhc/',
      'https://www.rakuten.co.jp/fancl-official/',
      'https://www.rakuten.co.jp/suntory-kenko/',
    ],
  };

  const shops = SHOPS[genre];
  if (!shops) return res.status(200).json({ items: [], _error: 'ジャンル不明' });

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
      .replace(/\s*\|.*$/, '')
      .trim();
  }

  function extractItemUrls(html) {
    const seen = new Set();
    const urls = [];
    // Match item.rakuten.co.jp/{shop}/{itemId}/ patterns
    const re = /["'](https?:\/\/item\.rakuten\.co\.jp\/([a-zA-Z0-9_\-\.]+)\/([a-zA-Z0-9_\-\.]+)\/)["']/g;
    let m;
    while ((m = re.exec(html)) !== null && urls.length < 15) {
      const u = m[1];
      // Skip if it looks like a shop top page (no item ID segment)
      if (!seen.has(u)) { seen.add(u); urls.push(u); }
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

  // ── Strategy 1: Known shop pages (server-rendered) ────────────
  for (const shopUrl of shops) {
    try {
      const r = await fetch(shopUrl, {
        headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' },
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) continue;
      const html = await r.text();
      const itemUrls = extractItemUrls(html);
      if (itemUrls.length < 1) continue;
      const items = await resolveItems(itemUrls);
      if (items.length >= 1) return res.status(200).json({ items });
    } catch {}
  }

  // ── Strategy 2: Yahoo Japan search ───────────────────────────
  const SEARCH_KW = {
    '410899': 'スイーツ 人気',
    '100044': 'ガジェット 便利グッズ',
    '216131': 'コスメ スキンケア',
    '100533': 'サプリメント 健康',
  };
  try {
    const q = encodeURIComponent(`site:item.rakuten.co.jp ${SEARCH_KW[genre] || ''}`);
    const r = await fetch(`https://search.yahoo.co.jp/search?p=${q}&ei=UTF-8`, {
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

  // ── Strategy 3: DuckDuckGo ────────────────────────────────────
  try {
    const q = encodeURIComponent(`site:item.rakuten.co.jp ${SEARCH_KW[genre] || ''}`);
    const r = await fetch(`https://html.duckduckgo.com/html/?q=${q}`, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja,en;q=0.9' },
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) {
      const html = await r.text();
      let itemUrls = [...html.matchAll(/uddg=(https?%3A%2F%2Fitem\.rakuten[^&"]+)/gi)]
        .map(m => decodeURIComponent(m[1]).split('?')[0].replace(/\/$/, '') + '/');
      if (!itemUrls.length) itemUrls = extractItemUrls(html);
      itemUrls = [...new Set(itemUrls)].slice(0, 10);
      const items = await resolveItems(itemUrls);
      if (items.length >= 1) return res.status(200).json({ items });
    }
  } catch {}

  return res.status(200).json({ items: [], _error: '商品を取得できませんでした' });
}
