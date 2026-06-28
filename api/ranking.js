export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { genre = '' } = req.query;

  // Correct Rakuten ranking genre IDs (verified via ranking.rakuten.co.jp sitemap)
  const GENRE_RANKING_ID = {
    '410899': '551167', // スイーツ・お菓子
    '100044': '564500', // スマートフォン・タブレット（ガジェット）
    '216131': '100939', // 美容・コスメ・香水
    '100533': '100938', // ダイエット・健康
  };

  const rankingId = GENRE_RANKING_ID[genre];
  if (!rankingId) return res.status(200).json({ items: [], _error: 'ジャンル不明' });

  const affId = process.env.RAKUTEN_AFF_ID || '5335e187.bd9b90cd.5335e188.d302f85f';

  function makeAff(itemUrl) {
    return `https://hb.afl.rakuten.co.jp/ichiba/${affId}/?pc=${encodeURIComponent(itemUrl)}&link_type=text`;
  }

  function cleanTitle(raw) {
    let t = (raw || '').trim();
    // 1. Strip Jina.ai prefix "Image 3: "
    t = t.replace(/^Image\s*\d+[:\s]+/i, '');
    // 2. Remove ALL bracket/fence content (must be before ！ split)
    t = t.replace(/【[^】]*】/g, '');
    t = t.replace(/\[[^\]]*\]/g, '');
    t = t.replace(/＜[^＞]*＞/g, '');
    t = t.replace(/〔[^〕]*〕/g, '');
    t = t.replace(/＼[^/／]*[/／]/g, '');
    t = t.replace(/「[^」]{0,30}」/g, '');
    t = t.replace(/（[^）]{0,60}）/g, '');
    // 3. Remove everything up to (and including) the first ！ — promotional text precedes ！
    t = t.replace(/^[^！]{0,80}！+\s*/g, '');
    // 4. Remove remaining promotional patterns
    const promo = [
      /リピ続出中\S*/g, /話題\S*の/g, /大人気\S*/g,
      /楽天[^\s！]{0,15}(1位|ランキング|大賞|受賞|冠|獲得|優良)/g,
      /累計\S*/g,                        // 累計〇〇突破 → 全削除
      /送料無料\S*/g, /P\d+倍\S*/g,
      /クーポン[^\s]{0,15}/g,
      /今なら\S*/g, /先着\S*/g, /期間限定\S*/g,
      /\S+で(紹介|話題)\S*/g,
      /\d+[\d,\.]*\s*(mAh|ml|kg|g|L|個入|個|枚|本|袋|錠|粒|冊|種類|円相当|円台)\S*/gi,
      /楽天市場[:：]\s*/ig,
      /\s*[｜|]\s*.*/g,
    ];
    promo.forEach(re => { t = t.replace(re, ''); });
    // 5. Normalize punctuation to space
    t = t.replace(/[！!？?。、，・]\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
    // 6. Generic extraction: longest katakana run (≥5 chars) = product category noun
    //    e.g. "フロム蔵王 マルチアイスBOX24" → "マルチアイス"
    //         "mileda パウダーファンデーション" → "パウダーファンデーション"
    // First katakana run ≥5 chars = product category (appears before brand in title)
    const kataMatch = t.match(/[ァ-ヶー]{5,}/);
    if (kataMatch) return kataMatch[0].slice(0, 18);
    // 7. Fallback: skip leading occasion/brand-like words, take first noun phrase
    const SKIP = new Set(['父の日','母の日','お中元','お歳暮','バレンタイン','ホワイトデー','ハロウィン','クリスマス','誕生日','ギフト','プレゼント','贈り物','セット']);
    const words = t.split(/\s+/).filter(w => w.length > 0);
    while (words.length > 1 && SKIP.has(words[0])) words.shift();
    let result = '';
    for (const w of words) {
      if (!result) { result = w; }
      else if (result.replace(/[a-zA-Z0-9\s]/g, '').length < 4) { result += ' ' + w; }
      else break;
    }
    if (result.length > 18) result = result.slice(0, 18).trim();
    return result;
  }

  // ── Jina.ai reader → Rakuten ranking page (no API key needed) ───────────
  try {
    const jinaUrl = `https://r.jina.ai/https://ranking.rakuten.co.jp/daily/${rankingId}/`;

    const r = await fetch(jinaUrl, {
      headers: {
        'Accept': 'text/plain',
        'X-No-Cache': 'true',
      },
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) throw new Error(`Jina ${r.status}`);
    const text = await r.text();

    // Parse: [![alt](imgUrl)](itemUrl)
    const re = /\[!\[([^\]]*)\]\((https?:\/\/[^)]*r10s\.jp[^)]*)\)\]\((https:\/\/item\.rakuten\.co\.jp\/[^)]+)\)/g;
    const seen = new Set();
    const items = [];
    let m;
    while ((m = re.exec(text)) !== null && items.length < 3) {
      const rawTitle = m[1];
      const imgUrl = m[2].split('?')[0];
      const rawUrl = m[3].split('?')[0].replace(/\/$/, '') + '/';

      if (seen.has(rawUrl)) continue;
      seen.add(rawUrl);

      const name = cleanTitle(rawTitle);
      if (!name || name.length < 3) continue;

      items.push({
        name,
        url: makeAff(rawUrl),
        itemUrl: rawUrl,
        imageUrl: imgUrl || null,
      });
    }

    if (items.length >= 1) {
      return res.status(200).json({ items, _src: 'jina' });
    }
  } catch (e) {
    // fall through to static pool
  }

  // ── Static fallback (CDX-verified only) ──────────────────────────────────
  const POOL = {
    '410899': [
      { url: 'https://item.rakuten.co.jp/morozoff/0010/', title: 'モロゾフ ミルクチョコレート詰合せ', image: 'https://shop.r10s.jp/morozoff/cabinet/sv2020/0010.jpg' },
      { url: 'https://item.rakuten.co.jp/morozoff/0016/', title: 'モロゾフ ファンシーチョコレート詰合せ', image: 'https://shop.r10s.jp/morozoff/cabinet/sv2020/0016.jpg' },
      { url: 'https://item.rakuten.co.jp/morozoff/0021/', title: 'モロゾフ チョコレート菓子詰合せ', image: 'https://shop.r10s.jp/morozoff/cabinet/sv2020/0021.jpg' },
    ],
    '100044': [
      { url: 'https://item.rakuten.co.jp/elecom/357749/', title: 'エレコム USBハブ 7ポート', image: '' },
      { url: 'https://item.rakuten.co.jp/elecom/399339/', title: 'エレコム ワイヤレスマウス', image: '' },
      { url: 'https://item.rakuten.co.jp/elecom/399755/', title: 'エレコム Bluetoothキーボード', image: '' },
    ],
    '216131': [
      { url: 'https://item.rakuten.co.jp/dhcshop-2/8000000002/', title: 'DHC 薬用マイルドソープ', image: 'https://shop.r10s.jp/gold/dhcshop-2/pic/8000000002.jpg' },
      { url: 'https://item.rakuten.co.jp/dhcshop-2/8000000003/', title: 'DHC 薬用レチノAエッセンス', image: 'https://shop.r10s.jp/gold/dhcshop-2/pic/8000000003.jpg' },
      { url: 'https://item.rakuten.co.jp/dhcshop-2/8000002144/', title: 'DHC マルチビタミン 徳用90日分', image: 'https://shop.r10s.jp/dhcshop-2/cabinet/pic/8000002144.jpg' },
    ],
    '100533': [
      { url: 'https://item.rakuten.co.jp/dhcshop-2/8000002144/', title: 'DHC マルチビタミン 徳用90日分', image: 'https://shop.r10s.jp/dhcshop-2/cabinet/pic/8000002144.jpg' },
      { url: 'https://item.rakuten.co.jp/dhcshop-2/8000002221/', title: 'DHC 濃縮紅麹 30日分', image: 'https://shop.r10s.jp/gold/dhcshop-2/pic/8000002221.jpg' },
      { url: 'https://item.rakuten.co.jp/kenkocom/10098/', title: 'ビタミンC タケダ 300錠', image: 'https://shop.r10s.jp/kenkocom/cabinet/098/10098.jpg' },
    ],
  };

  const pool = POOL[genre] || [];
  const items = [...pool].sort(() => Math.random() - 0.5).slice(0, 3).map(p => ({
    name: p.title,
    url: makeAff(p.url),
    itemUrl: p.url,
    imageUrl: p.image || null,
  }));

  return res.status(200).json({ items, _src: 'static' });
}
