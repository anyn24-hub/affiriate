export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { genre = '' } = req.query;

  // Correct Rakuten ranking genre IDs (verified via ranking.rakuten.co.jp sitemap)
  const GENRE_RANKING_ID = {
    '410899': '551167', // スイーツ・お菓子
    '100044': '564500', // スマートフォン・タブレット（ガジェット）
    '216131': '100939', // 美容・コスメ・香水
    '100533': '100938', // ダイエット・健康（非表示・バックエンドのみ）
    '566870': '566870', // ふるさと納税
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

  // ジャンル別: 商品名に必須のカテゴリ語（これがなければ採用しない）
  const GENRE_REQUIRED = {
    '100044': /ケース|フィルム|充電器|ケーブル|バッテリー|スタンド|カバー|保護|ハブ|イヤホン|ヘッドホン|ルーター|マウス|キーボード|モバイルバッテリー|USB/,
    '410899': /チョコ|アイス|プリン|チーズケーキ|ワッフル|クッキー|焼き菓子|和菓子|ゼリー|フルーツ|スイーツ|詰め合わせ|ケーキ|饅頭|大福|羊羹|カヌレ|マドレーヌ|バウム|タルト|マカロン|シュークリーム|菓子/,
    '216131': /洗顔|化粧水|美容液|日焼け止め|ヘアオイル|シャンプー|トリートメント|リップ|クリーム|乳液|コンディショナー|ヘアマスク|ファンデ|スキンケア|ヘアケア/,
    '100533': /炭酸水|ナッツ|入浴剤|アイマスク|お茶|プロテイン|サプリ|ビタミン|マルチ|ストレッチ|乳酸菌|酵素|食物繊維|ヨーグルト|ノンカフェイン|グルコサミン|コエンザイム/,
    '566870': /米|肉|牛|豚|鶏|魚|海老|カニ|ホタテ|イクラ|鮭|サーモン|フルーツ|みかん|りんご|苺|いちご|桃|メロン|スイーツ|お菓子|菓子|洗剤|ティッシュ/,
  };

  // ジャンル別: この語が入っていたら除外
  const GENRE_EXCLUDE = {
    '100044': /スマートフォン本体|タブレット本体|SIMフリー[^\s]{0,10}本体|ノートパソコン本体/,
    '216131': /美顔器|美容機器|リフトアップ|若返り|ナノアクション|EMS機器/,
  };

  function isValidProductName(name) {
    if (!name || name.length < 3) return false;
    // 未閉じ括弧
    if (/[（(]/.test(name) && !/[）)]/.test(name)) return false;
    // 年号先頭（2025/2026など）
    if (/^\d{4}/.test(name.trim())) return false;
    // 販促文のみ
    if (/^(お中元|本日\d|早割|楽天限定|SALE|特価|クリアランス|送料無料|最大\d|ポイント|クーポン)/.test(name.replace(/\s/g, ''))) return false;
    // 記号残り
    if (/[★♪≪≫《》]/.test(name)) return false;
    return true;
  }

  // スイーツ商品カテゴリキーワード（優先抽出用）
  const SWEETS_TYPES = ['チーズケーキ','アイスクリーム','アイス','チョコレート','チョコ','プリン','ワッフル','クッキー','焼き菓子','バウムクーヘン','バウム','シュークリーム','タルト','カヌレ','マドレーヌ','マカロン','どら焼き','大福','羊羹','饅頭','和菓子','詰め合わせ','スイーツ','ゼリー','フルーツゼリー','お菓子'];

  // ふるさと納税 商品キーワード（産地名付きで保持するため短い語を優先）
  const FURUSATO_TYPES = ['ホタテ','イクラ','カニ','海老','えび','鮭','サーモン','牛肉','豚肉','鶏肉','ステーキ','焼き肉','白米','玄米','みかん','りんご','いちご','苺','メロン','桃','ぶどう','フルーツ'];

  // 美容商品カテゴリキーワード（優先抽出用）
  const BEAUTY_TYPES = ['美容液','化粧水','クリーム','乳液','シャンプー','トリートメント','コンディショナー','洗顔','日焼け止め','ヘアオイル','ヘアマスク','ファンデーション','リップ','アイクリーム','ヘアケアセット','スキンケアセット','ヘアケア','スキンケア','美容'];

  function cleanTitle(raw) {
    let t = (raw || '').trim();
    // 1. Strip Jina.ai prefix "Image 3: "
    t = t.replace(/^Image\s*\d+[:\s]+/i, '');
    // 2. Remove ALL bracket/fence content (including ≪≫《》)
    t = t.replace(/≪[^≫]{0,60}≫/g, '');
    t = t.replace(/《[^》]{0,60}》/g, '');
    t = t.replace(/[≪≫《》]/g, ''); // 未閉じ記号も除去
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
    // ブランド名抽出: 先頭1〜2語（英字2語連続はブランドとして結合: TOM FORD等）
    function extractBrand(before) {
      const f = before[0] || '';
      const s = before[1] || '';
      if (f && /^[A-Za-z]/.test(f) && s && /^[A-Za-z]/.test(s)) return `${f} ${s}`;
      return f;
    }

    // 6. クリーニング後のテキストをそのまま返す（販売名を保持）
    if (/で同梱|ご注文|お届け|手続き|を.*[申送配]/.test(t)) return '';
    const NOT_PRODUCT = /^(キャンペーン|ポイント|バナー|広告|お知らせ|ランキング|楽天市場|楽天|プレゼント|ギフト|ベストコスメ|アワード|campaign|banner|point|PR|Image|sale|SALE|TOP|top)$/i;
    if (NOT_PRODUCT.test(t.replace(/\s/g, ''))) return '';
    if (NG_NAME.test(t)) return '';
    return trimSmart(t, 50);
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
    while ((m = re.exec(text)) !== null && items.length < 15) {
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

      // 商品名バリデーション
      if (!isValidProductName(name)) continue;
      const req = GENRE_REQUIRED[genre];
      if (req && !req.test(name)) continue;
      const excl = GENRE_EXCLUDE[genre];
      if (excl && excl.test(name)) continue;

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
    '566870': [],
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
