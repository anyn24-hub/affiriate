export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { genre = '' } = req.query;

  // CDX-verified product pool: all URLs confirmed via Wayback CDX (statuscode:200).
  // Rakuten is Akamai-blocked from Vercel IPs, so static pool is the only viable approach.
  const POOL = {
    '410899': [ // スイーツ — morozoff shop (CDX-confirmed items from 2023-2025)
      { url: 'https://item.rakuten.co.jp/morozoff/0010/', title: 'モロゾフ ミルクチョコレート詰合せ', image: 'https://shop.r10s.jp/morozoff/cabinet/sv2020/0010.jpg' },
      { url: 'https://item.rakuten.co.jp/morozoff/0016/', title: 'モロゾフ ファンシーチョコレート詰合せ', image: 'https://shop.r10s.jp/morozoff/cabinet/sv2020/0016.jpg' },
      { url: 'https://item.rakuten.co.jp/morozoff/0021/', title: 'モロゾフ チョコレート菓子詰合せ', image: 'https://shop.r10s.jp/morozoff/cabinet/sv2020/0021.jpg' },
      { url: 'https://item.rakuten.co.jp/morozoff/0030/', title: 'モロゾフ ミックス菓子詰合せ', image: 'https://shop.r10s.jp/morozoff/cabinet/sv2020/0030.jpg' },
      { url: 'https://item.rakuten.co.jp/morozoff/0049/', title: 'モロゾフ ギフトセット', image: 'https://shop.r10s.jp/morozoff/cabinet/sv2020/0049.jpg' },
      { url: 'https://item.rakuten.co.jp/morozoff/0062/', title: 'モロゾフ チョコレートギフト', image: 'https://shop.r10s.jp/morozoff/cabinet/sv2020/0062.jpg' },
    ],
    '100044': [ // ガジェット — elecom shop (CDX-confirmed items from 2023-2025)
      { url: 'https://item.rakuten.co.jp/elecom/357749/', title: 'エレコム USBハブ 7ポート', image: 'https://shop.r10s.jp/elecom/cabinet/257/357749.jpg' },
      { url: 'https://item.rakuten.co.jp/elecom/399339/', title: 'エレコム ワイヤレスマウス コンパクト', image: 'https://shop.r10s.jp/elecom/cabinet/399/399339.jpg' },
      { url: 'https://item.rakuten.co.jp/elecom/399755/', title: 'エレコム Bluetooth キーボード', image: 'https://shop.r10s.jp/elecom/cabinet/399/399755.jpg' },
      { url: 'https://item.rakuten.co.jp/elecom/431294/', title: 'エレコム スマホスタンド 卓上', image: 'https://shop.r10s.jp/elecom/cabinet/431/431294.jpg' },
      { url: 'https://item.rakuten.co.jp/elecom/4549550042215/', title: 'エレコム USB-C ケーブル 1m', image: 'https://shop.r10s.jp/elecom/cabinet/42/4549550042215.jpg' },
    ],
    '216131': [ // 美容 — DHCshop (CDX-confirmed items)
      { url: 'https://item.rakuten.co.jp/dhcshop-2/8000000002/', title: 'DHC 薬用マイルドソープ', image: 'https://shop.r10s.jp/gold/dhcshop-2/pic/8000000002.jpg' },
      { url: 'https://item.rakuten.co.jp/dhcshop-2/8000000003/', title: 'DHC 薬用レチノAエッセンス', image: 'https://shop.r10s.jp/gold/dhcshop-2/pic/8000000003.jpg' },
      { url: 'https://item.rakuten.co.jp/dhcshop-2/8000002144/', title: 'DHC マルチビタミン 徳用90日分', image: 'https://shop.r10s.jp/dhcshop-2/cabinet/pic/8000002144.jpg' },
    ],
    '100533': [ // ゆる健康 — DHCshop + kenkocom (CDX-confirmed items)
      { url: 'https://item.rakuten.co.jp/dhcshop-2/8000002144/', title: 'DHC マルチビタミン 徳用90日分', image: 'https://shop.r10s.jp/dhcshop-2/cabinet/pic/8000002144.jpg' },
      { url: 'https://item.rakuten.co.jp/dhcshop-2/8000002221/', title: 'DHC 濃縮紅麹 30日分', image: 'https://shop.r10s.jp/gold/dhcshop-2/pic/8000002221.jpg' },
      { url: 'https://item.rakuten.co.jp/kenkocom/10098/', title: 'ビタミンC タケダ 300錠', image: 'https://shop.r10s.jp/kenkocom/cabinet/098/10098.jpg' },
      { url: 'https://item.rakuten.co.jp/kenkocom/10527/', title: 'ポカリスエット パウダー 1L×5袋', image: 'https://shop.r10s.jp/kenkocom/cabinet/527/10527.jpg' },
    ],
  };

  const pool = POOL[genre];
  if (!pool) return res.status(200).json({ items: [], _error: 'ジャンル不明' });

  const affId = process.env.RAKUTEN_AFF_ID || '5335e187.bd9b90cd.5335e188.d302f85f';

  function makeAff(itemUrl) {
    return `https://hb.afl.rakuten.co.jp/ichiba/${affId}/?pc=${encodeURIComponent(itemUrl)}&link_type=text`;
  }

  const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, 3);
  const items = shuffled.map(p => ({
    name: p.title,
    url: makeAff(p.url),
    itemUrl: p.url,
    imageUrl: p.image || null,
  }));

  return res.status(200).json({ items, _src: 'static' });
}
