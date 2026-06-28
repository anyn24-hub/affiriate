export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { genre = '' } = req.query;

  const GENRE_NAMES = {
    '410899': 'スイーツ',
    '100044': 'ガジェット',
    '216131': '美容',
    '100533': 'ゆる健康',
  };
  if (!GENRE_NAMES[genre]) {
    return res.status(200).json({ items: [], _error: 'ジャンル不明' });
  }

  const appId    = process.env.RAKUTEN_APP_ID || '3fea067e-ff6e-46e3-ab90-82fa7628daad';
  const affId    = process.env.RAKUTEN_AFF_ID || '5335e187.bd9b90cd.5335e188.d302f85f';

  // ── Rakuten Item Search API (primary) ──────────────────────────────────────
  if (appId) {
    try {
      const params = new URLSearchParams({
        applicationId: appId,
        affiliateId:   affId,
        genreId:       genre,
        sort:          '-reviewCount',   // popular first
        availability:  '1',             // in-stock only
        hits:          '10',
        formatVersion: '2',
      });
      const apiUrl = `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601?${params}`;
      const r = await fetch(apiUrl, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error(`API ${r.status}`);
      const data = await r.json();
      if (data.error) throw new Error(data.error_description || data.error);

      const rawItems = (data.Items || []).filter(it => it.availability === 1);

      function cleanTitle(raw) {
        let t = (raw || '').trim();
        t = t.replace(/【[^】]{0,200}】/g, '');
        t = t.replace(/\[[^\]]{0,200}\]/g, '');
        t = t.replace(/＜[^＞]{0,100}＞/g, '');
        t = t.replace(/〔[^〕]{0,200}〕/g, '');
        t = t.replace(/（[^）]{0,60}[円ポP%％送無料][^）]{0,60}）/g, '');
        t = t.replace(/\s*[｜|]\s*.*楽天.*$/i, '');
        t = t.replace(/楽天市場[:：]\s*/i, '');
        t = t.replace(/\s*-\s*楽天市場.*$/i, '');
        t = t.replace(/送料無料[^\s]{0,20}/g, '');
        t = t.replace(/\s{2,}/g, ' ').trim();
        if (t.length > 40) t = t.slice(0, 40).trim();
        return t;
      }

      const items = rawItems.slice(0, 3).map(it => ({
        name:     cleanTitle(it.itemName),
        url:      it.affiliateUrl || it.itemUrl,
        itemUrl:  it.itemUrl,
        imageUrl: it.mediumImageUrls?.[0] || null,
      }));

      if (items.length >= 1) {
        return res.status(200).json({ items, _src: 'api' });
      }
    } catch (e) {
      // fall through to static pool
    }
  }

  // ── Static fallback (CDX-verified URLs only) ──────────────────────────────
  // Used when RAKUTEN_APP_ID is not set.
  const POOL = {
    '410899': [ // スイーツ
      { url: 'https://item.rakuten.co.jp/morozoff/0010/', title: 'モロゾフ ミルクチョコレート詰合せ', image: 'https://shop.r10s.jp/morozoff/cabinet/sv2020/0010.jpg' },
      { url: 'https://item.rakuten.co.jp/morozoff/0016/', title: 'モロゾフ ファンシーチョコレート詰合せ', image: 'https://shop.r10s.jp/morozoff/cabinet/sv2020/0016.jpg' },
      { url: 'https://item.rakuten.co.jp/morozoff/0021/', title: 'モロゾフ チョコレート菓子詰合せ', image: 'https://shop.r10s.jp/morozoff/cabinet/sv2020/0021.jpg' },
    ],
    '100044': [ // ガジェット
      { url: 'https://item.rakuten.co.jp/elecom/357749/', title: 'エレコム USBハブ 7ポート', image: '' },
      { url: 'https://item.rakuten.co.jp/elecom/399339/', title: 'エレコム ワイヤレスマウス', image: '' },
      { url: 'https://item.rakuten.co.jp/elecom/399755/', title: 'エレコム Bluetoothキーボード', image: '' },
    ],
    '216131': [ // 美容
      { url: 'https://item.rakuten.co.jp/dhcshop-2/8000000002/', title: 'DHC 薬用マイルドソープ', image: 'https://shop.r10s.jp/gold/dhcshop-2/pic/8000000002.jpg' },
      { url: 'https://item.rakuten.co.jp/dhcshop-2/8000000003/', title: 'DHC 薬用レチノAエッセンス', image: 'https://shop.r10s.jp/gold/dhcshop-2/pic/8000000003.jpg' },
      { url: 'https://item.rakuten.co.jp/dhcshop-2/8000002144/', title: 'DHC マルチビタミン 徳用90日分', image: 'https://shop.r10s.jp/dhcshop-2/cabinet/pic/8000002144.jpg' },
    ],
    '100533': [ // ゆる健康
      { url: 'https://item.rakuten.co.jp/dhcshop-2/8000002144/', title: 'DHC マルチビタミン 徳用90日分', image: 'https://shop.r10s.jp/dhcshop-2/cabinet/pic/8000002144.jpg' },
      { url: 'https://item.rakuten.co.jp/dhcshop-2/8000002221/', title: 'DHC 濃縮紅麹 30日分', image: 'https://shop.r10s.jp/gold/dhcshop-2/pic/8000002221.jpg' },
      { url: 'https://item.rakuten.co.jp/kenkocom/10098/', title: 'ビタミンC タケダ 300錠', image: 'https://shop.r10s.jp/kenkocom/cabinet/098/10098.jpg' },
    ],
  };

  function makeAff(itemUrl) {
    return `https://hb.afl.rakuten.co.jp/ichiba/${affId}/?pc=${encodeURIComponent(itemUrl)}&link_type=text`;
  }

  const pool = POOL[genre] || [];
  const items = [...pool].sort(() => Math.random() - 0.5).slice(0, 3).map(p => ({
    name:     p.title,
    url:      makeAff(p.url),
    itemUrl:  p.url,
    imageUrl: p.image || null,
  }));

  return res.status(200).json({ items, _src: 'static' });
}
