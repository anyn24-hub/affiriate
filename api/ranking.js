export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { genre = '' } = req.query;

  const GENRE_KW = {
    '410899': 'スイーツ',
    '100044': 'ガジェット',
    '216131': 'コスメ',
    '100533': 'サプリ 健康',
  };

  const kw = GENRE_KW[genre];
  if (!kw) {
    return res.status(200).json({ items: [], _error: 'ジャンル不明' });
  }

  const affId = process.env.RAKUTEN_AFF_ID || '5335e187.bd9b90cd.5335e188.d302f85f';

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

  function extractItemUrls(html) {
    const urls = new Set();
    // href 属性内の item URL（最も確実）
    const hrefPat = /href=["'](https?:\/\/item\.rakuten\.co\.jp\/[^"'<>\s]+)["']/g;
    for (const m of html.matchAll(hrefPat)) urls.add(m[1].split('?')[0].replace(/\/$/, '') + '/');
    // JSON 埋め込みデータ内の itemUrl
    const jsonPat = /"(?:itemUrl|item_url|url)"\s*:\s*"(https?:\/\/item\.rakuten\.co\.jp\/[^"]+)"/g;
    for (const m of html.matchAll(jsonPat)) urls.add(m[1].split('?')[0].replace(/\/$/, '') + '/');
    // 直接 URL 記述
    const directPat = /https?:\/\/item\.rakuten\.co\.jp\/[a-zA-Z0-9_.%-]+\/[a-zA-Z0-9_.%-]+\/?/g;
    for (const m of html.matchAll(directPat)) urls.add(m[0].replace(/\/$/, '') + '/');
    return [...urls].filter(u => !/campaign|banner|ad\.|^\/ad\//.test(u));
  }

  const tryUrls = [
    `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(kw)}/?s=2&genreId=${genre}`,
    `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(kw)}/?s=2`,
    `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(kw + ' 送料無料')}/?s=2`,
  ];

  let foundUrls = [];
  for (const url of tryUrls) {
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': UA,
          'Accept-Language': 'ja,en-US;q=0.9',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
        },
        redirect: 'follow',
      });
      const html = await r.text();
      foundUrls = extractItemUrls(html).slice(0, 10);
      if (foundUrls.length >= 3) break;
    } catch {}
  }

  if (!foundUrls.length) {
    return res.status(200).json({ items: [], _error: '商品URLを取得できませんでした。URLを手動で貼り付けてください。', _debug: `kw=${kw} genre=${genre}` });
  }

  const items = [];
  for (const itemUrl of foundUrls.slice(0, 6)) {
    if (items.length >= 3) break;
    try {
      const pr = await fetch(itemUrl, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'ja,en;q=0.9' },
        redirect: 'follow',
      });
      const phtml = await pr.text();
      let title = phtml.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
                || phtml.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1]
                || phtml.match(/<title>([^<]+)<\/title>/i)?.[1]
                || '';
      title = title.replace(/\s*[｜|]\s*.*楽天.*$/i, '').replace(/楽天市場[:：]\s*/i, '').replace(/\s*-\s*楽天市場.*$/i, '').trim();
      if (!title || title.length < 3) continue;

      const affiliateUrl = affId
        ? `https://hb.afl.rakuten.co.jp/ichiba/${affId}/?pc=${encodeURIComponent(itemUrl)}&link_type=text`
        : itemUrl;

      items.push({ name: title, url: affiliateUrl, itemUrl });
    } catch {}
  }

  if (!items.length) {
    return res.status(200).json({ items: [], _error: '商品情報を取得できませんでした。URLを手動で貼り付けてください。' });
  }

  return res.status(200).json({ items });
}
