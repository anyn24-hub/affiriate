export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const appId = process.env.RAKUTEN_APP_ID || '';
  const affId = process.env.RAKUTEN_AFF_ID || '';
  const { genre = '', kw = '' } = req.query;

  // UUID形式のappIdは楽天APIで動作しないため自動取得を無効化
  return res.status(200).json({
    Items: [],
    count: 0,
    _noKey: true,
  });

  const GENRE_KW = {
    '410899': 'スイーツ',
    '215783': 'ガジェット',
    '216131': 'コスメ 美容',
    '100533': '健康食品',
  };
  const keyword = kw || GENRE_KW[genre] || 'ランキング';

  const params = new URLSearchParams({
    applicationId: appId,
    keyword,
    hits: '20',
    sort: '-reviewCount',
    format: 'json',
  });
  if (affId) params.set('affiliateId', affId);
  if (genre) params.set('genreId', genre);

  try {
    const r = await fetch(
      `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601?${params}`
    );
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
