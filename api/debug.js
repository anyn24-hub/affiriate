export default function handler(req, res) {
  const appId = process.env.RAKUTEN_APP_ID || '';
  res.status(200).json({
    appId_length: appId.length,
    appId_first4: appId.substring(0, 4),
    affId_set: !!process.env.RAKUTEN_AFF_ID,
  });
}
