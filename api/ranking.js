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
    // ふるさと納税: 商品名チェックなし（多様な返礼品を許容）
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
    // 1. Jina.ai prefix "Image 3: " を除去
    t = t.replace(/^Image\s*\d+[:\s]+/i, '');
    // 2. 楽天ランキング装飾記号（≪≫《》【】）の中身を除去（販促タグのみ）
    t = t.replace(/≪[^≫]{0,60}≫/g, '');
    t = t.replace(/《[^》]{0,60}》/g, '');
    t = t.replace(/[≪≫《》]/g, '');
    t = t.replace(/【[^】]*】/g, '');
    // 3. 装飾記号を除去（商品名には含まれない）
    t = t.replace(/[♪★☆♦♥♡✨🎁🔥💥👑⭐✅]/g, '');
    t = t.replace(/[\u{1F300}-\u{1FFFF}]/gu, '');
    // 4. 空白正規化・末尾トリム
    t = t.replace(/\s{2,}/g, ' ').trim();
    t = t.replace(/[,、。\s]+$/, '').trim();

    const NG_NAME = /^(キャンペーン|ポイント|バナー|クーポン|お知らせ|楽天市場|ランキング|ベストコスメ|アワード|campaign|banner|PR|Image|TOP)$/i;
    if (!t || t.length < 3) return '';
    if (NG_NAME.test(t.replace(/\s/g, ''))) return '';
    if (/で同梱|ご注文|お届け手続き/.test(t)) return '';
    return t;
  }

  // ── ふるさと納税専用: event.rakuten.co.jp/furusato/ranking/ ─────────────
  if (genre === '566870') {
    try {
      const jinaUrl = 'https://r.jina.ai/https://event.rakuten.co.jp/furusato/ranking/';
      const r = await fetch(jinaUrl, {
        headers: { 'Accept': 'text/plain', 'X-No-Cache': 'true' },
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) throw new Error(`Jina ${r.status}`);
      const text = await r.text();

      const seen = new Set();
      const seenShops = new Set();
      const items = [];

      // テキストリンクから完全商品名を収集
      const textNameMapF = new Map();
      const reTxtF = /\[([^\]]{5,120})\]\((https:\/\/item\.rakuten\.co\.jp\/[^)]+)\)/g;
      let mtf;
      while ((mtf = reTxtF.exec(text)) !== null) {
        const txt = mtf[1].trim();
        const url = mtf[2].split('?')[0].replace(/\/$/, '') + '/';
        if (/^!/.test(txt)) continue;
        const existing = textNameMapF.get(url) || '';
        if (txt.length > existing.length) textNameMapF.set(url, txt);
      }

      // パターン1: [![alt](img)](itemUrl)
      const re1 = /\[!\[([^\]]*)\]\(([^)]*)\)\]\((https:\/\/item\.rakuten\.co\.jp\/[^)]+)\)/g;
      let m;
      while ((m = re1.exec(text)) !== null && items.length < 15) {
        const altText = m[1];
        const rawTitle = (textNameMapF.get(m[3].split('?')[0].replace(/\/$/, '') + '/') || '').length > altText.length
          ? textNameMapF.get(m[3].split('?')[0].replace(/\/$/, '') + '/') : altText;
        const imgUrl = (m[2] || '').split('?')[0];
        const rawUrl = m[3].split('?')[0].replace(/\/$/, '') + '/';
        if (seen.has(rawUrl)) continue;
        seen.add(rawUrl);
        const shopMatch = rawUrl.match(/item\.rakuten\.co\.jp\/([^\/]+)\//);
        const shop = shopMatch ? shopMatch[1].toLowerCase() : '';
        if (shop && seenShops.has(shop)) continue;
        const name = cleanTitle(rawTitle);
        if (!name || name.length < 3 || !isValidProductName(name)) continue;
        if (shop) seenShops.add(shop);
        items.push({ name, url: makeAff(rawUrl), itemUrl: rawUrl, imageUrl: imgUrl || null });
      }

      // パターン2: [商品名](itemUrl) — 画像なしリンク
      if (items.length < 3) {
        const re2 = /\[([^\]]{4,60})\]\((https:\/\/item\.rakuten\.co\.jp\/[^)]+)\)/g;
        while ((m = re2.exec(text)) !== null && items.length < 15) {
          const rawTitle = m[1];
          const rawUrl = m[2].split('?')[0].replace(/\/$/, '') + '/';
          if (seen.has(rawUrl)) continue;
          seen.add(rawUrl);
          const shopMatch = rawUrl.match(/item\.rakuten\.co\.jp\/([^\/]+)\//);
          const shop = shopMatch ? shopMatch[1].toLowerCase() : '';
          if (shop && seenShops.has(shop)) continue;
          const name = cleanTitle(rawTitle);
          if (!name || name.length < 3 || !isValidProductName(name)) continue;
          if (shop) seenShops.add(shop);
          items.push({ name, url: makeAff(rawUrl), itemUrl: rawUrl, imageUrl: null });
        }
      }

      if (items.length >= 1) {
        return res.status(200).json({ items: items.slice(0, 15), _src: 'furusato' });
      }
    } catch (e) {
      // fall through to standard scraper
    }
    return res.status(200).json({ items: [], _error: 'ふるさと納税ランキングを取得できませんでした。時間をおいて再試行してください。' });
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

    // まずテキストリンク [商品名](item.rakuten.co.jp/...) を収集して完全名を優先
    const textNameMap = new Map(); // url → longest text name
    const reTxt = /\[([^\]]{5,120})\]\((https:\/\/item\.rakuten\.co\.jp\/[^)]+)\)/g;
    let mt;
    while ((mt = reTxt.exec(text)) !== null) {
      const txt = mt[1].trim();
      const url = mt[2].split('?')[0].replace(/\/$/, '') + '/';
      if (/^!/.test(txt)) continue; // skip image markdown
      const existing = textNameMap.get(url) || '';
      if (txt.length > existing.length) textNameMap.set(url, txt);
    }

    // 画像リンク [![alt](img)](itemUrl) でURL・画像を収集
    const re = /\[!\[([^\]]*)\]\((https?:\/\/[^)]*r10s\.jp[^)]*)\)\]\((https:\/\/item\.rakuten\.co\.jp\/[^)]+)\)/g;
    const seen = new Set();
    const seenShops = new Set();
    const items = [];
    let m;
    while ((m = re.exec(text)) !== null && items.length < 15) {
      const altText = m[1];
      const imgUrl = m[2].split('?')[0];
      const rawUrl = m[3].split('?')[0].replace(/\/$/, '') + '/';
      // テキストリンクの名前が長ければそちらを優先（altは途中で切れることがある）
      const rawTitle = (textNameMap.get(rawUrl) || '').length > altText.length
        ? textNameMap.get(rawUrl) : altText;

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
