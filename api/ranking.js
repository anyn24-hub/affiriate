export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { genre = '' } = req.query;

  // Only shops verified to have actual item URLs in Wayback CDX
  const GENRE_SHOPS = {
    '410899': ['rakuten24', 'bourbon', 'morozoff'],
    '100044': ['biccamera', 'elecom', 'edion'],
    '216131': ['dhc', 'hb-online', 'elecom'],
    '100533': ['dhc', 'kenkocom', 'rakuten24'],
  };

  const shops = GENRE_SHOPS[genre];
  if (!shops) return res.status(200).json({ items: [], _error: 'ジャンル不明' });

  const affId = process.env.RAKUTEN_AFF_ID || '5335e187.bd9b90cd.5335e188.d302f85f';
  // Use mobile UA — same as api/product.js which is confirmed to work
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

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

  async function fetchItem(itemUrl) {
    try {
      const pr = await fetch(itemUrl, {
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'ja,en;q=0.9',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(7000),
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

  async function fetchCdxUrls(shopName) {
    try {
      const shopBase = `item.rakuten.co.jp/${shopName}`;
      const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(shopBase + '/*')}&output=json&fl=original&filter=statuscode:200&collapse=urlkey&limit=50&from=20220101`;
      const r = await fetch(cdxUrl, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return [];
      const data = await r.json();
      return data.slice(1)
        .map(row => row[0])
        .filter(url => {
          if (url.includes('?') || url.includes('#')) return false;
          const path = url.replace(/^https?:\/\/item\.rakuten\.co\.jp\//, '');
          const parts = path.split('/').filter(Boolean);
          // Exact shop match + exactly 2 path parts (shop/itemId)
          if (parts.length !== 2) return false;
          if (parts[0] !== shopName) return false;
          const itemId = parts[1];
          // Exclude category pages
          if (/^c($|\d)/.test(itemId)) return false;
          if (itemId.length < 4) return false;
          return true;
        });
    } catch {
      return [];
    }
  }

  const cdxResults = await Promise.allSettled(shops.map(s => fetchCdxUrls(s)));
  const cdxUrls = [...new Set(
    cdxResults.flatMap(r => r.status === 'fulfilled' ? r.value : [])
  )];

  if (cdxUrls.length >= 1) {
    // Pick up to 12 URLs to try in parallel (need at least 3 good ones)
    const toFetch = cdxUrls.slice(0, 12);
    const fetched = await Promise.allSettled(toFetch.map(u => fetchItem(u)));
    const items = fetched
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value)
      .slice(0, 3)
      .map(it => ({ name: it.title, url: makeAff(it.itemUrl), itemUrl: it.itemUrl, imageUrl: it.imageUrl }));
    if (items.length >= 1) return res.status(200).json({ items, _src: 'cdx' });
  }

  return res.status(200).json({ items: [], _error: '商品を取得できませんでした', _cdxCount: cdxUrls.length });
}
