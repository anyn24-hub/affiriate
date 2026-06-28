export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { genre = '' } = req.query;

  const affId = process.env.RAKUTEN_AFF_ID || '5335e187.bd9b90cd.5335e188.d302f85f';

  function makeAff(itemUrl) {
    return `https://hb.afl.rakuten.co.jp/ichiba/${affId}/?pc=${encodeURIComponent(itemUrl)}&link_type=text`;
  }

  // Static popular items per genre (real Rakuten item URLs)
  const STATIC_ITEMS = {
    // スイーツ (410899)
    '410899': [
      {
        name: 'ルタオ ドゥーブルフロマージュ（濃厚チーズケーキ）',
        itemUrl: 'https://item.rakuten.co.jp/letao/10000003/',
      },
      {
        name: 'バスクチーズケーキ 5号 誕生日ケーキ スイーツ',
        itemUrl: 'https://item.rakuten.co.jp/furutoya/basque-5/',
      },
      {
        name: '銀座千疋屋 フルーツゼリー 詰め合わせ ギフト',
        itemUrl: 'https://item.rakuten.co.jp/ginza-sembikiya/gc-48/',
      },
    ],
    // ガジェット (100044)
    '100044': [
      {
        name: 'Anker PowerCore 10000 モバイルバッテリー コンパクト 大容量',
        itemUrl: 'https://item.rakuten.co.jp/ankerjapan/a1263/',
      },
      {
        name: 'Anker USB-C 充電器 65W GaN 急速充電 PD対応',
        itemUrl: 'https://item.rakuten.co.jp/ankerjapan/a2667/',
      },
      {
        name: 'Belkin MagSafe対応 ワイヤレス充電スタンド 15W',
        itemUrl: 'https://item.rakuten.co.jp/r-kojima/4250001168/',
      },
    ],
    // 美容 (216131)
    '216131': [
      {
        name: 'ORBIS オルビスユー ホワイトニングモイスチャー 保湿クリーム',
        itemUrl: 'https://item.rakuten.co.jp/orbis/mst050/',
      },
      {
        name: 'HAKU 薬用 美白美容液 ファンデーション SPF50+',
        itemUrl: 'https://item.rakuten.co.jp/shiseido-sp/mq4022/',
      },
      {
        name: 'ちふれ 化粧水 しっとりタイプ 大容量 詰め替え用 500mL',
        itemUrl: 'https://item.rakuten.co.jp/chifure/4971710320466/',
      },
    ],
    // ゆる健康 (100533)
    '100533': [
      {
        name: 'DHC マルチビタミン 60日分 栄養機能食品',
        itemUrl: 'https://item.rakuten.co.jp/dhc/multivitamin-60/',
      },
      {
        name: 'ファンケル 大人のカロリミット 機能性表示食品 30日分',
        itemUrl: 'https://item.rakuten.co.jp/fancl-official/1870/',
      },
      {
        name: 'サントリー セサミン＆ビタミンE 120粒 60日分 ゴマ',
        itemUrl: 'https://item.rakuten.co.jp/suntory-kenko/sasamin01/',
      },
    ],
  };

  const staticList = STATIC_ITEMS[genre];
  if (!staticList) return res.status(200).json({ items: [], _error: 'ジャンル不明' });

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

  function cleanTitle(raw) {
    return (raw || '')
      .replace(/\s*[｜|]\s*.*楽天.*$/i, '')
      .replace(/楽天市場[:：]\s*/i, '')
      .replace(/\s*-\s*楽天市場.*$/i, '')
      .trim();
  }

  async function fetchItemTitle(itemUrl) {
    try {
      const pr = await fetch(itemUrl, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'ja,en;q=0.9' },
        redirect: 'follow',
        signal: AbortSignal.timeout(5000),
      });
      if (!pr.ok) return null;
      const phtml = await pr.text();
      const title = cleanTitle(
        phtml.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
        || phtml.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1]
        || phtml.match(/<title>([^<]+)<\/title>/i)?.[1]
      );
      return title && title.length >= 3 ? title : null;
    } catch {
      return null;
    }
  }

  // Try to fetch live titles; fall back to static names if blocked
  const items = [];
  for (const entry of staticList) {
    if (items.length >= 3) break;
    const liveTitle = await fetchItemTitle(entry.itemUrl);
    items.push({
      name: liveTitle || entry.name,
      url: makeAff(entry.itemUrl),
      itemUrl: entry.itemUrl,
    });
  }

  return res.status(200).json({ items });
}
