export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { genre = '' } = req.query;

  const GENRE_KW = {
    '410899': 'スイーツ 送料無料',
    '100044': 'ガジェット USB 送料無料',
    '216131': 'コスメ 化粧水 送料無料',
    '100533': 'サプリ 健康食品 送料無料',
  };

  const kw = GENRE_KW[genre];
  if (!kw) {
    return res.status(200).json({ items: [], _error: 'ジャンル不明' });
  }

  const affId = process.env.RAKUTEN_AFF_ID || '5335e187.bd9b90cd.5335e188.d302f85f';

  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

  // 楽天検索ページからitem URLを抽出（動的レンダリングのranking.rakuten.co.jpより安定）
  const searchUrls = [
    `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(kw)}/?s=2&genreId=${genre}`,
    `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(kw)}/?s=2`,
  ];

  let foundUrls = [];

  for (const url of searchUrls) {
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': UA,
          'Accept-Language': 'ja,en;q=0.9',
          'Accept': 'text/html,application/xhtml+xml',
        },
        redirect: 'follow',
      });
      const html = await r.text();

      // item.rakuten.co.jp URLを抽出（クエリパラメータ含む場合も対応）
      const pat = /https?:\/\/item\.rakuten\.co\.jp\/[a-zA-Z0-9_.%-]+\/[a-zA-Z0-9_.%-]+\/?/g;
      const matches = [...new Set(html.match(pat) || [])];
      // 広告・バナー系を除外
      foundUrls = matches.filter(u => !u.includes('campaign') && !u.includes('banner')).slice(0, 10);

      if (foundUrls.length >= 3) break;
    } catch {}
  }

  if (!foundUrls.length) {
    return res.status(200).json({ items: [], _error: '検索ページから商品URLを取得できませんでした' });
  }

  // 各商品ページからタイトルを取得（最大6件試し3件集める）
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
