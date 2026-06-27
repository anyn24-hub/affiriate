export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { genre = '' } = req.query;

  // ジャンルIDからランキングページURL
  const GENRE_URL = {
    '410899': 'https://ranking.rakuten.co.jp/daily/410899/',   // スイーツ
    '100044': 'https://ranking.rakuten.co.jp/daily/100044/',   // ガジェット・家電
    '216131': 'https://ranking.rakuten.co.jp/daily/216131/',   // コスメ・美容
    '100533': 'https://ranking.rakuten.co.jp/daily/100533/',   // 健康・ダイエット
  };

  const rankingUrl = GENRE_URL[genre];
  if (!rankingUrl) {
    return res.status(200).json({ items: [], _error: 'ジャンル不明' });
  }

  const affId = process.env.RAKUTEN_AFF_ID || '5335e187.bd9b90cd.5335e188.d302f85f';

  try {
    const r = await fetch(rankingUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept-Language': 'ja,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    const html = await r.text();

    // 商品URLを抽出（item.rakuten.co.jp/...）
    const urlPattern = /https?:\/\/item\.rakuten\.co\.jp\/[a-zA-Z0-9_\-]+\/[a-zA-Z0-9_\-]+\/?/g;
    const foundUrls = [...new Set(html.match(urlPattern) || [])].slice(0, 10);

    if (!foundUrls.length) {
      return res.status(200).json({ items: [], _error: 'ランキングから商品URLを取得できませんでした' });
    }

    // 各商品ページからタイトルを取得（最大3件）
    const items = [];
    for (const itemUrl of foundUrls.slice(0, 6)) {
      if (items.length >= 3) break;
      try {
        const pr = await fetch(itemUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
            'Accept-Language': 'ja,en;q=0.9',
          },
        });
        const phtml = await pr.text();
        let title = phtml.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
                  || phtml.match(/<title>([^<]+)<\/title>/i)?.[1]
                  || '';
        title = title.replace(/\s*[｜|]\s*.*楽天.*$/i, '').replace(/楽天市場[:：]\s*/i, '').trim();
        if (!title || title.length < 3) continue;

        const affiliateUrl = affId
          ? `https://hb.afl.rakuten.co.jp/ichiba/${affId}/?pc=${encodeURIComponent(itemUrl)}&link_type=text`
          : itemUrl;

        items.push({ name: title, url: affiliateUrl, itemUrl });
      } catch {}
    }

    return res.status(200).json({ items });
  } catch (e) {
    return res.status(200).json({ items: [], _error: e.message });
  }
}
