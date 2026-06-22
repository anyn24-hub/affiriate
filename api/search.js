export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const affId = process.env.RAKUTEN_AFF_ID || '';
  const { genre = '', kw = '' } = req.query;

  // Try genre-specific RSS first, fall back to overall
  const urls = genre
    ? [
        `https://ranking.rakuten.co.jp/daily/${genre}/rss.xml`,
        `https://ranking.rakuten.co.jp/daily/rss.xml`,
      ]
    : [`https://ranking.rakuten.co.jp/daily/rss.xml`];

  let xml = '';
  let lastErr = '';
  for (const url of urls) {
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*',
          'Accept-Language': 'ja,en;q=0.9',
          'Referer': 'https://ranking.rakuten.co.jp/',
          'Cache-Control': 'no-cache',
        },
      });
      if (r.ok) { xml = await r.text(); break; }
      lastErr = `HTTP ${r.status} from ${url}`;
    } catch (e) {
      lastErr = e.message;
    }
  }

  if (!xml) return res.status(502).json({ error: `RSS fetch failed: ${lastErr}` });

  // Parse RSS <item> blocks
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];

    const getTag = (tag) => {
      const cdataMatch = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`));
      if (cdataMatch) return cdataMatch[1];
      const plainMatch = block.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`));
      return plainMatch ? plainMatch[1] : '';
    };

    const title = getTag('title').trim();
    // <link> in RSS is tricky (follows namespace); match text between </title> and <description>
    const linkMatch = block.match(/<link[^>]*>([^<]+)<\/link>/) ||
                      block.match(/<link[^>]*\/?>[\s\S]*?<!\[CDATA\[([\s\S]*?)\]\]>/);
    const rawLink = linkMatch ? linkMatch[1].trim() : '';
    const desc = getTag('description');

    if (!title || !rawLink) continue;

    // Keyword filter (case-insensitive)
    if (kw && !title.includes(kw) && !desc.includes(kw)) continue;

    // Extract price from description HTML
    const priceMatch = desc.match(/¥([\d,]+)/) || desc.match(/([\d,]+)円/);
    const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : 0;

    // Extract image URL
    const imgMatch = desc.match(/src="([^"]+)"/);
    const imgUrl = imgMatch ? imgMatch[1] : '';

    // Build affiliate URL if affId configured
    const itemUrl = rawLink;
    const affiliateUrl = affId
      ? `https://hb.afl.rakuten.co.jp/ichiba/${affId}/?pc=${encodeURIComponent(itemUrl)}&link_type=text`
      : itemUrl;

    items.push({
      itemName: title,
      itemUrl,
      affiliateUrl,
      itemPrice: price,
      mediumImageUrls: imgUrl ? [{ imageUrl: imgUrl }] : [],
      reviewCount: 0,
      reviewAverage: 0,
      postageFlag: 0,
      itemCaption: desc.replace(/<[^>]+>/g, '').slice(0, 100),
    });

    if (items.length >= 20) break;
  }

  return res.status(200).json({
    Items: items.map(item => ({ Item: item })),
    count: items.length,
  });
}
