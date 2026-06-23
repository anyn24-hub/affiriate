export default async function handler(req, res) {
  const appId = process.env.RAKUTEN_APP_ID || '';
  const appIdNoHyphens = appId.replace(/-/g, '');

  async function tryId(id) {
    const params = new URLSearchParams({ applicationId: id, keyword: 'スイーツ', hits: '3', format: 'json' });
    const r = await fetch(`https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601?${params}`);
    const text = await r.text();
    return { status: r.status, response: text.substring(0, 200) };
  }

  try {
    const [withHyphens, withoutHyphens] = await Promise.all([tryId(appId), tryId(appIdNoHyphens)]);
    return res.status(200).json({
      withHyphens: { id: appId, ...withHyphens },
      withoutHyphens: { id: appIdNoHyphens, ...withoutHyphens },
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
