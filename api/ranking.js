export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { genre = '' } = req.query;

  // Shops verified to have item URLs in Wayback CDX (2024+)
  const GENRE_SHOPS = {
    '410899': ['bourbon', 'morozoff', 'yamada-denki'],
    '100044': ['elecom', 'yamada-denki', 'biccamera'],
    '216131': ['dhc', 'elecom', 'yamada-denki'],
    '100533': ['dhc', 'kenkocom', 'yamada-denki'],
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
    t = t.replace(/【[^】]{0,200}】/g, '');
    t = t.replace(/\[[^\]]{0,200}\]/g, '');
    t = t.replace(/＜[^＞]{0,100}＞/g, '');
    t = t.replace(/〔[^〕]{0,200}〕/g, '');
    t = t.replace(/（[^）]{0,80}[円ポP%％送無料][^）]{0,80}）/g, '');
    t = t.replace(/\s*[｜|]\s*.*楽天.*$/i, '');
    t = t.replace(/楽天市場[:：]\s*/i, '');
    t = t.replace(/\s*-\s*楽天市場.*$/i, '');
    t = t.replace(/送料無料[^\s]{0,20}/g, '');
    t = t.replace(/\s{2,}/g, ' ').trim();
    if (t.length > 60) t = t.slice(0, 60).trim();
    return t;
  }

  // Decode HTML entities (for titles like &amp; &quot; etc.)
  function decodeEntities(s) {
    return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  }

  async function fetchWaybackItem(itemUrl, timestamp) {
    try {
      const waybackUrl = `https://web.archive.org/web/${timestamp}/${itemUrl}`;
      const pr = await fetch(waybackUrl, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'ja,en;q=0.9' },
        redirect: 'follow',
        signal: AbortSignal.timeout(12000),
      });
      if (!pr.ok) return null;

      // Detect charset from Content-Type header (Rakuten pages are EUC-JP)
      const ct = pr.headers.get('content-type') || '';
      const charsetMatch = ct.match(/charset=([^\s;]+)/i);
      const charset = charsetMatch ? charsetMatch[1].toLowerCase() : 'utf-8';

      const buf = await pr.arrayBuffer();
      let html;
      try {
        html = new TextDecoder(charset).decode(buf);
      } catch {
        // Fallback: try euc-jp then utf-8
        try { html = new TextDecoder('euc-jp').decode(buf); }
        catch { html = new TextDecoder('utf-8', { fatal: false }).decode(buf); }
      }

      const rawTitle =
        html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1]
        || html.match(/<title>([^<]+)<\/title>/i)?.[1]
        || '';
      const title = cleanTitle(decodeEntities(rawTitle));

      let imageUrl =
        html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1]
        || null;
      // Strip Wayback proxy prefix: /web/20240101000000im_/https://...
      if (imageUrl && imageUrl.includes('web.archive.org')) {
        const m = imageUrl.match(/web\.archive\.org\/web\/[^/]+im_\/(https?:\/\/.+)/);
        if (m) imageUrl = m[1];
      }

      if (!title || title.length < 3) return null;
      return { title, imageUrl: imageUrl || null, itemUrl };
    } catch {
      return null;
    }
  }

  async function fetchCdxItems(shopName) {
    try {
      const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent('item.rakuten.co.jp/' + shopName + '/*')}&output=json&fl=original,timestamp&filter=statuscode:200&collapse=urlkey&limit=50&from=20220101`;
      const r = await fetch(cdxUrl, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return [];
      const data = await r.json();
      return data.slice(1)
        .map(row => ({ url: row[0], ts: row[1] }))
        .filter(({ url }) => {
          if (url.includes('?') || url.includes('#')) return false;
          const path = url.replace(/^https?:\/\/item\.rakuten\.co\.jp\//, '');
          const parts = path.split('/').filter(Boolean);
          if (parts.length !== 2) return false;
          if (parts[0] !== shopName) return false; // exact shop match
          const itemId = parts[1];
          if (/^c($|\d)/.test(itemId)) return false;
          if (itemId.length < 4) return false;
          return true;
        });
    } catch {
      return [];
    }
  }

  const cdxResults = await Promise.allSettled(shops.map(s => fetchCdxItems(s)));
  const seen = new Set();
  const entries = cdxResults
    .flatMap(r => r.status === 'fulfilled' ? r.value : [])
    .filter(e => {
      if (seen.has(e.url)) return false;
      seen.add(e.url);
      return true;
    })
    .slice(0, 15);

  if (entries.length >= 1) {
    const fetched = await Promise.allSettled(
      entries.map(({ url, ts }) => fetchWaybackItem(url, ts))
    );
    const items = fetched
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value)
      .slice(0, 3)
      .map(it => ({ name: it.title, url: makeAff(it.itemUrl), itemUrl: it.itemUrl, imageUrl: it.imageUrl }));
    if (items.length >= 1) return res.status(200).json({ items, _src: 'wayback' });
  }

  return res.status(200).json({ items: [], _error: '商品を取得できませんでした', _cdxCount: entries.length });
}
