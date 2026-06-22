export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url required' });
  if (!url.includes('rakuten.co.jp')) {
    return res.status(400).json({ error: '楽天のURLのみ対応しています' });
  }

  const affId = process.env.RAKUTEN_AFF_ID || '';

  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept-Language': 'ja,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });

    const html = await r.text();
    const finalUrl = r.url;

    // Extract og:title
    let title = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
              || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1]
              || html.match(/<title>([^<]+)<\/title>/i)?.[1]
              || '';

    // Clean up Rakuten suffixes
    title = title
      .replace(/\s*[｜|]\s*.*楽天.*$/i, '')
      .replace(/楽天市場[:：]\s*/i, '')
      .replace(/\s*-\s*楽天市場.*$/i, '')
      .trim();

    // og:image
    const image = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
                || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1]
                || '';

    // Construct affiliate URL
    const itemUrl = finalUrl;
    const affiliateUrl = affId && !itemUrl.includes('afl.rakuten')
      ? `https://hb.afl.rakuten.co.jp/ichiba/${affId}/?pc=${encodeURIComponent(itemUrl)}&link_type=text`
      : itemUrl;

    return res.status(200).json({ title, image, affiliateUrl, itemUrl });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
