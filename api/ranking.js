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

  // スイーツ枠で除外するキーワード（ナッツ・健康食品・おつまみ系）
  const SWEETS_EXCLUDE = /ミックスナッツ|アーモンド|カシューナッツ|くるみ|ピスタチオ|マカダミア|ナッツ[^ケ]|おつまみ|珍味|ジャーキー|グラノーラ|プロテイン|サプリ|青汁|コラーゲン|ドライフルーツのみ/;

  // ゆる健康枠でサプリ・ダイエット系に偏りすぎないよう補助除外（一部のみ）
  const HEALTH_OVERINDEX_EXCLUDE = /ダイエット食品|プロテインバー|置き換え|断食|カロリー制限|糖質制限|脂肪燃焼|メタボ|痩身|スリム|減量/;

  // スイーツ商品カテゴリキーワード（優先抽出用）
  const SWEETS_TYPES = ['チーズケーキ','アイスクリーム','アイス','チョコレート','チョコ','プリン','ワッフル','クッキー','焼き菓子','バウムクーヘン','バウム','シュークリーム','タルト','カヌレ','マドレーヌ','マカロン','どら焼き','大福','羊羹','饅頭','和菓子','詰め合わせ','スイーツ','ゼリー','フルーツゼリー','お菓子'];

  // 美容商品カテゴリキーワード（優先抽出用）
  const BEAUTY_TYPES = ['美容液','化粧水','クリーム','乳液','シャンプー','トリートメント','コンディショナー','洗顔','日焼け止め','ヘアオイル','ヘアマスク','ファンデーション','リップ','アイクリーム','美容'];

  function cleanTitle(raw) {
    let t = (raw || '').trim();
    // 1. Strip Jina.ai prefix "Image 3: "
    t = t.replace(/^Image\s*\d+[:\s]+/i, '');
    // 2. Remove ALL bracket/fence content (including ≪≫《》)
    t = t.replace(/≪[^≫]{0,60}≫/g, '');
    t = t.replace(/《[^》]{0,60}》/g, '');
    t = t.replace(/【[^】]*】/g, '');
    t = t.replace(/\[[^\]]*\]/g, '');
    t = t.replace(/＜[^＞]*＞/g, '');
    t = t.replace(/〔[^〕]*〕/g, '');
    t = t.replace(/＼[^/／]*[/／]/g, '');
    t = t.replace(/「[^」]{0,30}」/g, '');
    t = t.replace(/（[^）]{0,60}）/g, '');
    // 3. Remove everything up to (and including) the first ！
    t = t.replace(/^[^！]{0,80}！+\s*/g, '');
    // 4. Remove promotional patterns
    const promo = [
      /本日\d+時まで[^\s]{0,10}/g, /楽天限定[^\s]{0,10}/g,
      /20\d{2}年?\s*/g,
      /リピ続出中\S*/g, /話題\S*の/g, /大人気\S*/g,
      /楽天[^\s！]{0,15}(1位|ランキング|大賞|受賞|冠|獲得|優良)/g,
      /累計\S*/g, /送料無料\S*/g, /P\d+倍\S*/g,
      /クーポン[^\s]{0,15}/g, /今なら\S*/g, /先着\S*/g, /期間限定\S*/g,
      /\S+で(紹介|話題)\S*/g,
      /[♪★☆♦♥♡✨🎁🔥💥👑⭐✅]/g,
      /\d+[\d,\.]*\s*(mAh|ml|kg|g|L|個入|個|枚|本|袋|錠|粒|冊|種類|円相当|円台)\S*/gi,
      /楽天市場[:：]\s*/ig, /\s*[｜|]\s*.*/g,
    ];
    promo.forEach(re => { t = t.replace(re, ''); });
    // 5. Normalize punctuation to space + letter normalization (M A C → MAC)
    t = t.replace(/[！!？?。、，・]\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
    t = t.replace(/\b([A-Za-z]) ([A-Za-z]) ([A-Za-z])\b/g, '$1$2$3');
    t = t.replace(/\b([A-Za-z]) ([A-Za-z])\b/g, '$1$2');
    // Remove trailing open brackets/punct
    t = t.replace(/[（(「『【≪《,、。\s]+$/, '').trim();

    const NG_NAME = /ポイント|キャンペーン|バナー|クーポン|プレゼント|ギフトセット|お知らせ|楽天市場|ランキング|ベストコスメ|アワード|同梱|注文|配送|お届け|手続き|申し込み/;
    function trimSmart(s, max) {
      if (s.length <= max) return s;
      const cut = s.slice(0, max);
      const lastSp = cut.lastIndexOf(' ');
      return (lastSp > max * 0.5 ? cut.slice(0, lastSp) : cut).trim();
    }

    // 6. スイーツ枠専用: 商品カテゴリキーワードを優先抽出して「ブランド + カテゴリ」形式に
    if (genre === '410899') {
      const sweetsType = SWEETS_TYPES.find(w => t.includes(w));
      if (sweetsType) {
        const idx = t.indexOf(sweetsType);
        const before = t.slice(0, idx).trim().split(/\s+/).filter(w => w.length >= 2 && w.length <= 12);
        const brand = before[before.length - 1] || '';
        const result = brand ? `${brand} ${sweetsType}` : sweetsType;
        return trimSmart(result, 24);
      }
    }

    // 7. 美容枠専用: 商品カテゴリキーワードを優先抽出して「ブランド + カテゴリ」形式に
    if (genre === '216131') {
      const beautyType = BEAUTY_TYPES.find(w => t.includes(w));
      if (beautyType) {
        const idx = t.indexOf(beautyType);
        const before = t.slice(0, idx).trim().split(/\s+/).filter(w => w.length >= 2 && w.length <= 14);
        const brand = before[before.length - 1] || '';
        const result = brand ? `${brand} ${beautyType}` : beautyType;
        return trimSmart(result, 24);
      }
    }

    // 8. クリーニング後のテキストをそのまま使う
    if (/で同梱|ご注文|お届け|手続き|を.*[申送配]/.test(t)) return '';
    const SKIP = new Set(['父の日','母の日','お中元','お歳暮','バレンタイン','ホワイトデー','ハロウィン','クリスマス','誕生日','ギフト','プレゼント','贈り物','セット']);
    const words = t.split(/\s+/).filter(w => w.length > 0);
    while (words.length > 1 && SKIP.has(words[0])) words.shift();
    let result = '';
    for (const w of words) {
      if (!result) { result = w; }
      else if (result.replace(/[a-zA-Z0-9\s]/g, '').length < 4) { result += ' ' + w; }
      else break;
    }
    result = trimSmart(result, 24);
    const NOT_PRODUCT = /^(キャンペーン|ポイント|バナー|広告|お知らせ|ランキング|楽天市場|楽天|プレゼント|ギフト|ベストコスメ|アワード|campaign|banner|point|PR|Image|sale|SALE|TOP|top)$/i;
    if (NOT_PRODUCT.test(result.replace(/\s/g, ''))) return '';
    if (NG_NAME.test(result)) return '';
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
    // 1〜10位を取得してフロント側でランダム選出できるようにする
    const re = /\[!\[([^\]]*)\]\((https?:\/\/[^)]*r10s\.jp[^)]*)\)\]\((https:\/\/item\.rakuten\.co\.jp\/[^)]+)\)/g;
    const seen = new Set();
    const seenShops = new Set(); // 同一ショップ（ブランド）の重複を防ぐ
    const items = [];
    let m;
    while ((m = re.exec(text)) !== null && items.length < 10) {
      const rawTitle = m[1];
      const imgUrl = m[2].split('?')[0];
      const rawUrl = m[3].split('?')[0].replace(/\/$/, '') + '/';

      if (seen.has(rawUrl)) continue;
      seen.add(rawUrl);

      // ショップ名を抽出してブランド重複チェック
      const shopMatch = rawUrl.match(/item\.rakuten\.co\.jp\/([^\/]+)\//);
      const shop = shopMatch ? shopMatch[1].toLowerCase() : '';
      if (shop && seenShops.has(shop)) continue;

      // スイーツ枠でナッツ・健康食品系を除外
      if (genre === '410899' && SWEETS_EXCLUDE.test(rawTitle)) continue;
      // ゆる健康枠でダイエット食品系への偏りを除外
      if (genre === '100533' && HEALTH_OVERINDEX_EXCLUDE.test(rawTitle)) continue;

      const name = cleanTitle(rawTitle);
      if (!name || name.length < 3) continue;

      if (shop) seenShops.add(shop);

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
