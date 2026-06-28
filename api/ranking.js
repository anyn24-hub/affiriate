export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { genre = '' } = req.query;

  // Verified real Rakuten item URLs with confirmed titles and images from Wayback Machine
  const POOL = {
    '410899': [
      { url: 'https://item.rakuten.co.jp/morozoff/0010/', title: 'モロゾフ ミルクチョコレート詰合せ', image: 'https://shop.r10s.jp/morozoff/cabinet/sv2020/0010.jpg' },
      { url: 'https://item.rakuten.co.jp/morozoff/0021/', title: 'モロゾフ プレミアムチョコレートセレクション', image: 'https://shop.r10s.jp/morozoff/cabinet/sv25/0021.jpg' },
      { url: 'https://item.rakuten.co.jp/morozoff/0020/', title: 'モロゾフ まいど・ミルフィーユ・大阪', image: 'https://shop.r10s.jp/morozoff/cabinet/item/0020.jpg' },
      { url: 'https://item.rakuten.co.jp/bourbon/366369/', title: 'ブルボン アルカリイオン水', image: '' },
      { url: 'https://item.rakuten.co.jp/bourbon/367948/', title: 'ブルボン 天然水', image: '' },
    ],
    '100044': [
      { url: 'https://item.rakuten.co.jp/elecom/357749/', title: 'エレコム 配線カバー ケーブルカバー', image: 'https://shop.r10s.jp/elecom/cabinet/s720_07/ld-ga1207_03.jpg' },
      { url: 'https://item.rakuten.co.jp/elecom/3660619400164/', title: 'LaCie 耐衝撃ポータブルHDD', image: 'https://shop.r10s.jp/elecom/cabinet/s500_02/2euapa_03.jpg' },
      { url: 'https://item.rakuten.co.jp/elecom/3660619404698/', title: 'LaCie モバイルドライブ HDD', image: 'https://shop.r10s.jp/elecom/cabinet/s500_09/sthg4000400_03.jpg' },
      { url: 'https://item.rakuten.co.jp/elecom/3660619410231/', title: 'LaCie 大容量外付けHDD', image: 'https://shop.r10s.jp/elecom/cabinet/s500_19/sths10000800_03r.jpg' },
    ],
    '216131': [
      { url: 'https://item.rakuten.co.jp/dhcshop-2/8000000002/', title: 'DHC マイルドソープ 透明石鹸', image: 'https://shop.r10s.jp/gold/dhcshop-2/pic/8000000002.jpg' },
      { url: 'https://item.rakuten.co.jp/dhcshop-2/8000000003/', title: 'DHC 薬用レチノAエッセンス', image: 'https://shop.r10s.jp/gold/dhcshop-2/pic/8000000003.jpg' },
      { url: 'https://item.rakuten.co.jp/dhcshop-2/8000002144/', title: 'DHC マルチビタミン 90日分', image: 'https://shop.r10s.jp/dhcshop-2/cabinet/pic/8000002144.jpg' },
      { url: 'https://item.rakuten.co.jp/dhcshop-2/8000002151/', title: 'DHC マルチミネラル 90日分', image: 'https://shop.r10s.jp/dhcshop-2/cabinet/pic/8000002151.jpg' },
    ],
    '100533': [
      { url: 'https://item.rakuten.co.jp/kenkocom/10098/', title: 'ビタミンC タケダ 300錠', image: 'https://shop.r10s.jp/kenkocom/cabinet/098/10098.jpg' },
      { url: 'https://item.rakuten.co.jp/kenkocom/10527/', title: 'ポカリスエット パウダー 1L用 5袋セット', image: 'https://shop.r10s.jp/kenkocom/cabinet/527/10527.jpg' },
      { url: 'https://item.rakuten.co.jp/dhcshop-2/8000002144/', title: 'DHC マルチビタミン 90日分', image: 'https://shop.r10s.jp/dhcshop-2/cabinet/pic/8000002144.jpg' },
      { url: 'https://item.rakuten.co.jp/dhcshop-2/8000002221/', title: 'DHC 濃縮紅麹 30日分', image: 'https://shop.r10s.jp/gold/dhcshop-2/pic/8000002221.jpg' },
    ],
  };

  const pool = POOL[genre];
  if (!pool) return res.status(200).json({ items: [], _error: 'ジャンル不明' });

  const affId = process.env.RAKUTEN_AFF_ID || '5335e187.bd9b90cd.5335e188.d302f85f';

  function makeAff(itemUrl) {
    return `https://hb.afl.rakuten.co.jp/ichiba/${affId}/?pc=${encodeURIComponent(itemUrl)}&link_type=text`;
  }

  // Shuffle and pick 3
  const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, 3);
  const items = shuffled.map(p => ({
    name: p.title,
    url: makeAff(p.url),
    itemUrl: p.url,
    imageUrl: p.image || null,
  }));

  return res.status(200).json({ items, _src: 'static' });
}
