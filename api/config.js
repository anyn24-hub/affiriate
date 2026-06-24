export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(200).json({
    affId: process.env.RAKUTEN_AFF_ID || '',
    appId: process.env.RAKUTEN_APP_ID || '',
  });
}
