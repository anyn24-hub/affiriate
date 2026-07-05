export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url } = req.query;
  if (!url) return res.status(200).json({ name: null });

  try {
    const r = await fetch(`https://r.jina.ai/${url}`, {
      headers: { 'Accept': 'text/plain', 'X-No-Cache': 'true' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return res.status(200).json({ name: null });

    const text = await r.text();
    for (const line of text.split('\n')) {
      const m = line.match(/^Title:\s*(.+)/i);
      if (m) {
        const name = m[1].trim()
          .replace(/\s*[|｜]\s*.{1,60}楽天市場.*$/i, '')
          .replace(/\s*[|｜].*$/, '')
          .replace(/【[^】]*】/g, '')
          .replace(/\s{2,}/g, ' ')
          .trim();
        if (name && name.length > 5) return res.status(200).json({ name });
      }
    }
    return res.status(200).json({ name: null });
  } catch (_) {
    return res.status(200).json({ name: null });
  }
}
