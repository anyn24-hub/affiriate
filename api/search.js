export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const appId = process.env.RAKUTEN_APP_ID;
  const affId = process.env.RAKUTEN_AFF_ID;

  if (!appId) {
    return res.status(500).json({ error: 'RAKUTEN_APP_ID not configured' });
  }

  const { kw = '', hits = '20' } = req.query;
  if (!kw) return res.status(400).json({ error: 'kw is required' });

  const params = new URLSearchParams({
    applicationId: appId,
    keyword: kw,
    hits,
    sort: '-reviewCount',
    format: 'json',
  });
  if (affId) params.set('affiliateId', affId);

  try {
    const r = await fetch(
      `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601?${params}`
    );
    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json(data);
    }
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
