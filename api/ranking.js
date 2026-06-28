export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { genre = '' } = req.query;

  // Known Rakuten shops per genre
  const GENRE_SHOPS = {
    '410899': ['item.rakuten.co.jp/letao', 'item.rakuten.co.jp/bourbon', 'item.rakuten.co.jp/morozoff'],
    '100044': ['item.rakuten.co.jp/ankerjapan', 'item.rakuten.co.jp/elecom', 'item.rakuten.co.jp/sanwa-supply'],
    '216131': ['item.rakuten.co.jp/orbis', 'item.rakuten.co.jp/chifure', 'item.rakuten.co.jp/dhc'],
    '100533': ['item.rakuten.co.jp/dhc', 'item.rakuten.co.jp/fancl-official', 'item.rakuten.co.jp/suntory-kenko'],
  };

  const shops = GENRE_SHOPS[genre];
  if (!shops) return res.status(200).json({ items: [], _error: 'ジャンル不明' });

  const affId = process.env.RAKUTEN_AFF_ID || '5335e187.bd9b90cd.5335e188.d302f85f';
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

  function makeAff(itemUrl) {
    return `https://hb.afl.rakuten.co.jp/ichiba/${affId}/?pc=${encodeURIComponent(itemUrl)}&link_type=text`;
  }

  function cleanTitle(raw) {
    let t = (raw || '').trim();
    // Remove promotional brackets first
    t = t.replace(/【[^】]{0,120}】/g, '');
    t = t.replace(/\[[^\]]{0,120}\]/g, '');
    t = t.replace(/＜[^＞]{0,60}＞/g, '');
    t = t.replace(/〔[^〕]{0,120}〕/g, '');
    t = t.replace(/（[^）]{0,60}[円ポP%％][^）]{0,30}）/g, '');
    // Remove Rakuten suffixes
    t = t.replace(/\s*[｜|]\s*.*楽天.*$/i, '');
    t = t.replace(/楽天市場[:：]\s*/i, '');
    t = t.replace(/\s*-\s*楽天市場.*$/i, '');
    t = t.replace(/\s{2,}/g, ' ').trim();
    return t;
  }

  async function fetchItem(itemUrl) {
    try {
      const pr = await fetch(itemUrl, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'ja,en;q=0.9' },
        redirect: 'follow',
        signal: AbortSignal.timeout(6000),
      });
      if (!pr.ok) return null;
      const html = await pr.text();
      const rawTitle =
        html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1]
        || html.match(/<title>([^<]+)<\/title>/i)?.[1]
        || '';
      const title = cleanTitle(rawTitle);
      const imageUrl =
        html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1]
        || null;
      if (!title || title.length < 3) return null;
      return { title, imageUrl: imageUrl || null, itemUrl };
    } catch {
      return null;
    }
  }

  // Fetch URLs from Wayback Machine CDX API for a given shop
  async function fetchCdxUrls(shopBase) {
    try {
      const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(shopBase + '/*')}&output=json&fl=original&filter=statuscode:200&collapse=urlkey&limit=20&from=20240101&fastLatest=true`;
      const r = await fetch(cdxUrl, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(7000),
      });
      if (!r.ok) return [];
      const data = await r.json();
      return data.slice(1) // skip header row
        .map(row => row[0])
        .filter(url => {
          // Must be item.rakuten.co.jp/{shop}/{itemId}/ structure
          const path = url.replace(/^https?:\/\/item\.rakuten\.co\.jp/, '');
          const parts = path.split('/').filter(Boolean);
          return parts.length >= 2 && parts[1].length >= 3;
        });
    } catch {
      return [];
    }
  }

  // ── Strategy 1: Wayback Machine CDX (parallel across shops) ──
  const cdxResults = await Promise.allSettled(shops.map(s => fetchCdxUrls(s)));
  const cdxUrls = [...new Set(
    cdxResults.flatMap(r => r.status === 'fulfilled' ? r.value : [])
  )].slice(0, 12);

  if (cdxUrls.length >= 1) {
    // Fetch item pages in parallel
    const fetched = await Promise.allSettled(cdxUrls.slice(0, 9).map(u => fetchItem(u)));
    const items = fetched
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value)
      .slice(0, 3)
      .map(it => ({ name: it.title, url: makeAff(it.itemUrl), itemUrl: it.itemUrl, imageUrl: it.imageUrl }));
    if (items.length >= 1) return res.status(200).json({ items });
  }

  // ── Strategy 2: Yahoo Japan search ───────────────────────────
  const SEARCH_KW = {
    '410899': 'スイーツ 人気 楽天',
    '100044': 'ガジェット 便利 楽天',
    '216131': 'コスメ スキンケア 楽天',
    '100533': 'サプリ 健康 楽天',
  };
  try {
    const q = encodeURIComponent(`site:item.rakuten.co.jp ${SEARCH_KW[genre]}`);
    const r = await fetch(`https://search.yahoo.co.jp/search?p=${q}&ei=UTF-8`, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja' },
      signal: AbortSignal.timeout(7000),
    });
    if (r.ok) {
      const html = await r.text();
      const seen = new Set();
      const itemUrls = [];
      const re = /["'](https?:\/\/item\.rakuten\.co\.jp\/([a-zA-Z0-9_\-\.]+)\/([a-zA-Z0-9_\-\.]+)\/)["']/g;
      let m;
      while ((m = re.exec(html)) !== null && itemUrls.length < 9) {
        if (!seen.has(m[1])) { seen.add(m[1]); itemUrls.push(m[1]); }
      }
      if (itemUrls.length >= 1) {
        const fetched = await Promise.allSettled(itemUrls.map(u => fetchItem(u)));
        const items = fetched
          .filter(r => r.status === 'fulfilled' && r.value)
          .map(r => r.value)
          .slice(0, 3)
          .map(it => ({ name: it.title, url: makeAff(it.itemUrl), itemUrl: it.itemUrl, imageUrl: it.imageUrl }));
        if (items.length >= 1) return res.status(200).json({ items });
      }
    }
  } catch {}

  // ── Strategy 3: DuckDuckGo ────────────────────────────────────
  try {
    const q = encodeURIComponent(`site:item.rakuten.co.jp ${SEARCH_KW[genre]}`);
    const r = await fetch(`https://html.duckduckgo.com/html/?q=${q}`, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja,en;q=0.9' },
      signal: AbortSignal.timeout(7000),
    });
    if (r.ok) {
      const html = await r.text();
      const itemUrls = [...html.matchAll(/uddg=(https?%3A%2F%2Fitem\.rakuten[^&"]+)/gi)]
        .map(m => decodeURIComponent(m[1]).split('?')[0].replace(/\/$/, '') + '/')
        .slice(0, 9);
      if (itemUrls.length >= 1) {
        const fetched = await Promise.allSettled(itemUrls.map(u => fetchItem(u)));
        const items = fetched
          .filter(r => r.status === 'fulfilled' && r.value)
          .map(r => r.value)
          .slice(0, 3)
          .map(it => ({ name: it.title, url: makeAff(it.itemUrl), itemUrl: it.itemUrl, imageUrl: it.imageUrl }));
        if (items.length >= 1) return res.status(200).json({ items });
      }
    }
  } catch {}

  return res.status(200).json({ items: [], _error: '商品を取得できませんでした' });
}
