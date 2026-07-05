export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url } = req.query;
  if (!url) return res.status(200).json({ name: null });

  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'ja,en;q=0.9',
      },
      signal: AbortSignal.timeout(7000),
    });
    if (!r.ok) return res.status(200).json({ name: null, _debug: `status:${r.status}` });

    const html = await r.text();

    // <title> タグから商品名を取得（「商品名 | ショップ名 | 楽天市場」形式）
    const tm = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (tm) {
      let name = tm[1]
        .replace(/\s*[|｜]\s*.{1,60}楽天市場.*$/i, '')
        .replace(/\s*[|｜].*$/, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/【[^】]*】/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      if (name && name.length > 5 && !name.includes('…')) {
        return res.status(200).json({ name });
      }
    }
    return res.status(200).json({ name: null, _debug: 'no_title' });
  } catch (e) {
    return res.status(200).json({ name: null, _debug: `err:${e.message}` });
  }
}
