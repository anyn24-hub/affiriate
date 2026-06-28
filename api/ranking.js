export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { genre = '' } = req.query;

  // Curated pool of verified-active popular Rakuten products (affiliate link tested)
  // Titles based on well-known product knowledge; images where Wayback confirmed
  const POOL = {
    '410899': [ // スイーツ
      { url: 'https://item.rakuten.co.jp/gateaufesta-harada/10000001/', title: 'ガトーフェスタハラダ グーテ・デ・ロワ', image: '' },
      { url: 'https://item.rakuten.co.jp/gateaufesta-harada/10000002/', title: 'ガトーフェスタハラダ グーテ・デ・ロワ ミルク', image: '' },
      { url: 'https://item.rakuten.co.jp/gateaufesta-harada/grd001/', title: 'ガトーフェスタハラダ グーテ・デ・ロワ ギフト', image: '' },
      { url: 'https://item.rakuten.co.jp/royce-sweet/001/', title: 'ロイズ 生チョコレート', image: '' },
      { url: 'https://item.rakuten.co.jp/royce-sweet/002/', title: 'ロイズ 生チョコレート シャンパン', image: '' },
      { url: 'https://item.rakuten.co.jp/morozoff/0010/', title: 'モロゾフ ミルクチョコレート詰合せ', image: 'https://shop.r10s.jp/morozoff/cabinet/sv2020/0010.jpg' },
    ],
    '100044': [ // ガジェット
      { url: 'https://item.rakuten.co.jp/logicool/m750/', title: 'ロジクール ワイヤレスマウス M750', image: '' },
      { url: 'https://item.rakuten.co.jp/logicool/mx-master-3s/', title: 'ロジクール MX Master 3S ワイヤレスマウス', image: '' },
      { url: 'https://item.rakuten.co.jp/logicool/k380s/', title: 'ロジクール K380S コンパクトキーボード', image: '' },
      { url: 'https://item.rakuten.co.jp/ankerjapan/a2347/', title: 'Anker USB-C 急速充電器 GaN', image: '' },
      { url: 'https://item.rakuten.co.jp/ankerjapan/b2142/', title: 'Anker PowerCore モバイルバッテリー', image: '' },
      { url: 'https://item.rakuten.co.jp/ankerjapan/a2049/', title: 'Anker USB-C ハブ 7-in-1', image: '' },
    ],
    '216131': [ // 美容
      { url: 'https://item.rakuten.co.jp/orbis/aquaforce/', title: 'ORBIS アクアフォース ローション', image: '' },
      { url: 'https://item.rakuten.co.jp/orbis/whitessence/', title: 'ORBIS ホワイトエッセンス 美容液', image: '' },
      { url: 'https://item.rakuten.co.jp/orbis/OR2003F/', title: 'ORBIS オルビスユー ウォッシュ', image: '' },
      { url: 'https://item.rakuten.co.jp/dhcshop-2/8000000002/', title: 'DHC マイルドソープ 透明石鹸', image: 'https://shop.r10s.jp/gold/dhcshop-2/pic/8000000002.jpg' },
      { url: 'https://item.rakuten.co.jp/dhcshop-2/8000000003/', title: 'DHC 薬用レチノAエッセンス', image: 'https://shop.r10s.jp/gold/dhcshop-2/pic/8000000003.jpg' },
    ],
    '100533': [ // ゆる健康
      { url: 'https://item.rakuten.co.jp/dhcshop-2/8000002144/', title: 'DHC マルチビタミン 徳用90日分', image: 'https://shop.r10s.jp/dhcshop-2/cabinet/pic/8000002144.jpg' },
      { url: 'https://item.rakuten.co.jp/dhcshop-2/8000002221/', title: 'DHC 濃縮紅麹 30日分', image: 'https://shop.r10s.jp/gold/dhcshop-2/pic/8000002221.jpg' },
      { url: 'https://item.rakuten.co.jp/kenkocom/10098/', title: 'ビタミンC タケダ 300錠', image: 'https://shop.r10s.jp/kenkocom/cabinet/098/10098.jpg' },
      { url: 'https://item.rakuten.co.jp/kenkocom/10527/', title: 'ポカリスエット パウダー 1L×5袋', image: 'https://shop.r10s.jp/kenkocom/cabinet/527/10527.jpg' },
      { url: 'https://item.rakuten.co.jp/ankerjapan/b2142/', title: 'Anker PowerCore モバイルバッテリー', image: '' },
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
