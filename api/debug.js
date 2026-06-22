export default async function handler(req, res) {
  const appId = process.env.RAKUTEN_APP_ID || '';
  const affId = process.env.RAKUTEN_AFF_ID || '';

  const params = new URLSearchParams({
    applicationId: appId,
    keyword: 'スイーツ',
    hits: '3',
    format: 'json',
  });

  try {
    const r = await fetch(
      `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601?${params}`
    );
    const text = await r.text();
    return res.status(200).json({
      appId_length: appId.length,
      appId_value: appId,
      status: r.status,
      response: text.substring(0, 300),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
