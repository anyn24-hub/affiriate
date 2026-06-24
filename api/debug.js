export default async function handler(req, res) {
  const appId = process.env.RAKUTEN_APP_ID || '';

  async function tryEndpoint(label, url) {
    try {
      const r = await fetch(url);
      const text = await r.text();
      return { label, status: r.status, response: text.substring(0, 300) };
    } catch (e) {
      return { label, error: e.message };
    }
  }

  const baseParams = `applicationId=${encodeURIComponent(appId)}&hits=3&format=json`;

  const results = await Promise.all([
    tryEndpoint(
      'Search_20220601',
      `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601?${baseParams}&keyword=スイーツ`
    ),
    tryEndpoint(
      'Ranking_20170628',
      `https://app.rakuten.co.jp/services/api/IchibaItem/Ranking/20170628?${baseParams}&genreId=410899`
    ),
    tryEndpoint(
      'Ranking_genre_all',
      `https://app.rakuten.co.jp/services/api/IchibaItem/Ranking/20170628?${baseParams}`
    ),
  ]);

  return res.status(200).json({ appId, results });
}
