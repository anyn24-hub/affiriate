export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const appId = process.env.RAKUTEN_APP_ID || '3fea067e-ff6e-46e3-ab90-82fa7628daad';
  const affId = process.env.RAKUTEN_AFF_ID || '5335e187.bd9b90cd.5335e188.d302f85f';
  const { genre = '', kw = '' } = req.query;

  const keyword = kw || 'ランキング';

  const params = new URLSearchParams({
    applicationId: appId,
    keyword,
    hits: '20',
    sort: 'standard',
    format: 'json',
  });
  if (affId) params.set('affiliateId', affId);
  if (genre) params.set('genreId', genre);

  try {
    const r = await fetch(
      `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601?${params}`
    );
    const data = await r.json();
    // 楽天APIがエラーを返した場合はフロントに伝える
    if (data.error) {
      return res.status(200).json({ Items: [], count: 0, _error: `楽天API: ${data.error_description || data.error}` });
    }
    return res.status(200).json(data);
  } catch (e) {
    return res.status(200).json({ Items: [], count: 0, _error: e.message });
  }
}
