export default async function handler(req, res) {
  const appId = process.env.RAKUTEN_APP_ID || '';

  async function tryEndpoint(label, url, headers = {}) {
    try {
      const r = await fetch(url, { headers });
      const text = await r.text();
      return { label, status: r.status, response: text.substring(0, 200) };
    } catch (e) {
      return { label, error: e.message };
    }
  }

  const base = `applicationId=${encodeURIComponent(appId)}&hits=3&format=json&keyword=スイーツ`;
  const searchUrl = `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601?${base}`;

  const refererHeaders = {
    'Referer': 'https://web-liart-gamma-13.vercel.app/',
    'Origin': 'https://web-liart-gamma-13.vercel.app',
  };

  const results = await Promise.all([
    tryEndpoint('no_referer', searchUrl),
    tryEndpoint('with_referer', searchUrl, refererHeaders),
  ]);

  return res.status(200).json({ appId, results });
}
