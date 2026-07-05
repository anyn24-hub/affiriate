export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { genre = '' } = req.query;

  const GENRE_RANKING_ID = {
    '410899': '551167', // スイーツ・お菓子
    '100044': '564500', // スマートフォン・タブレット（ガジェット）
    '216131': '100939', // 美容・コスメ・香水
    '100533': '100938', // ダイエット・健康（非表示・バックエンドのみ）
  };

  const rankingId = GENRE_RANKING_ID[genre];
  // ふるさと納税は別URL、それ以外はrankingId必須
  if (!rankingId && genre !== '566870') {
    return res.status(200).json({ items: [], _error: 'ジャンル不明' });
  }

  const affId = process.env.RAKUTEN_AFF_ID || '5335e187.bd9b90cd.5335e188.d302f85f';

  function makeAff(itemUrl) {
    return `https://hb.afl.rakuten.co.jp/ichiba/${affId}/?pc=${encodeURIComponent(itemUrl)}&link_type=text`;
  }

  const SWEETS_EXCLUDE = /ミックスナッツ|アーモンド|カシューナッツ|くるみ|ピスタチオ|マカダミア|ナッツ[^ケ]|おつまみ|珍味|ジャーキー|グラノーラ|プロテイン|サプリ|青汁|コラーゲン|ドライフルーツのみ/;
  const HEALTH_OVERINDEX_EXCLUDE = /ダイエット食品|プロテインバー|置き換え|断食|カロリー制限|糖質制限|脂肪燃焼|メタボ|痩身|スリム|減量/;

  const GENRE_REQUIRED = {
    '100044': /ケース|フィルム|充電器|ケーブル|バッテリー|スタンド|カバー|保護|ハブ|イヤホン|ヘッドホン|ルーター|マウス|キーボード|モバイルバッテリー|USB/,
    '410899': /チョコ|アイス|プリン|チーズケーキ|ワッフル|クッキー|焼き菓子|和菓子|ゼリー|フルーツ|スイーツ|詰め合わせ|ケーキ|饅頭|大福|羊羹|カヌレ|マドレーヌ|バウム|タルト|マカロン|シュークリーム|菓子/,
    '216131': /洗顔|化粧水|美容液|日焼け止め|ヘアオイル|シャンプー|トリートメント|リップ|クリーム|乳液|コンディショナー|ヘアマスク|ファンデ|スキンケア|ヘアケア/,
    '100533': /炭酸水|ナッツ|入浴剤|アイマスク|お茶|プロテイン|サプリ|ビタミン|マルチ|ストレッチ|乳酸菌|酵素|食物繊維|ヨーグルト|ノンカフェイン|グルコサミン|コエンザイム/,
    // 566870(ふるさと納税): チェックなし
  };

  const GENRE_EXCLUDE = {
    '100044': /スマートフォン本体|タブレット本体|SIMフリー[^\s]{0,10}本体|ノートパソコン本体/,
    '216131': /美顔器|美容機器|リフトアップ|若返り|ナノアクション|EMS機器/,
  };

  function isValidProductName(name) {
    if (!name || name.length < 3) return false;
    if (/[（(]/.test(name) && !/[）)]/.test(name)) return false;
    if (/^\d{4}/.test(name.trim())) return false;
    if (/^(お中元|本日\d|早割|楽天限定|SALE|特価|クリアランス|送料無料|最大\d|ポイント|クーポン)/.test(name.replace(/\s/g, ''))) return false;
    if (/[★♪≪≫《》]/.test(name)) return false;
    return true;
  }

  function cleanTitle(raw) {
    let t = (raw || '').trim();
    t = t.replace(/^Image\s*\d+[:\s]+/i, '');
    t = t.replace(/≪[^≫]{0,60}≫/g, '');
    t = t.replace(/《[^》]{0,60}》/g, '');
    t = t.replace(/[≪≫《》]/g, '');
    t = t.replace(/【[^】]*】/g, '');
    t = t.replace(/[♪★☆♦♥♡✨🎁🔥💥👑⭐✅]/g, '');
    t = t.replace(/[\u{1F300}-\u{1FFFF}]/gu, '');
    t = t.replace(/\s{2,}/g, ' ').trim();
    t = t.replace(/[,、。\s]+$/, '').trim();
    const NG_NAME = /^(キャンペーン|ポイント|バナー|クーポン|お知らせ|楽天市場|ランキング|ベストコスメ|アワード|campaign|banner|PR|Image|TOP)$/i;
    if (!t || t.length < 3) return '';
    if (NG_NAME.test(t.replace(/\s/g, ''))) return '';
    if (/で同梱|ご注文|お届け手続き/.test(t)) return '';
    return t;
  }

  // 商品ページから完全な商品名を取得（「…」で切れている場合のみ）
  async function fetchFullName(itemUrl) {
    try {
      const r = await fetch(`https://r.jina.ai/${itemUrl}`, {
        headers: { 'Accept': 'text/plain', 'X-No-Cache': 'true' },
        signal: AbortSignal.timeout(4000),
      });
      if (!r.ok) return null;
      const text = await r.text();
      for (const line of text.split('\n')) {
        const m = line.match(/^Title:\s*(.+)/i);
        if (m) {
          const title = m[1].trim()
            .replace(/\s*[|｜]\s*.{1,40}楽天市場.*$/i, '')
            .replace(/\s*[|｜].*$/, '');
          const cleaned = cleanTitle(title);
          if (cleaned && cleaned.length > 5) return cleaned;
        }
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  // ランキングページから商品を収集する共通処理
  function parseRankingText(text, genreId) {
    // テキストリンク [商品名](url) から完全名を収集（altより長い場合に優先）
    const textNameMap = new Map();
    const reTxt = /\[([^\]]{5,})\]\((https:\/\/item\.rakuten\.co\.jp\/[^)]+)\)/g;
    let mt;
    while ((mt = reTxt.exec(text)) !== null) {
      const txt = mt[1].trim();
      if (/^!/.test(txt)) continue;
      const url = mt[2].split('?')[0].replace(/\/$/, '') + '/';
      const existing = textNameMap.get(url) || '';
      if (txt.length > existing.length) textNameMap.set(url, txt);
    }

    // 画像リンク [![alt](img)](url) でURL・画像URLを収集
    const re = /\[!\[([^\]]*)\]\((https?:\/\/[^)]*r10s\.jp[^)]*)\)\]\((https:\/\/item\.rakuten\.co\.jp\/[^)]+)\)/g;
    const seen = new Set();
    const seenShops = new Set();
    const items = [];
    let m;
    while ((m = re.exec(text)) !== null && items.length < 15) {
      const altText = m[1];
      const imgUrl = m[2].split('?')[0];
      const rawUrl = m[3].split('?')[0].replace(/\/$/, '') + '/';

      if (seen.has(rawUrl)) continue;
      seen.add(rawUrl);

      const shopMatch = rawUrl.match(/item\.rakuten\.co\.jp\/([^\/]+)\//);
      const shop = shopMatch ? shopMatch[1].toLowerCase() : '';
      if (shop && seenShops.has(shop)) continue;

      // テキストリンクの名前が長ければそちらを優先
      const textName = textNameMap.get(rawUrl) || '';
      const rawTitle = textName.length > altText.length ? textName : altText;

      if (genreId === '410899' && SWEETS_EXCLUDE.test(rawTitle)) continue;
      if (genreId === '100533' && HEALTH_OVERINDEX_EXCLUDE.test(rawTitle)) continue;

      const name = cleanTitle(rawTitle);
      if (!name || name.length < 3) continue;
      if (!isValidProductName(name)) continue;

      const req = GENRE_REQUIRED[genreId];
      if (req && !req.test(name)) continue;
      const excl = GENRE_EXCLUDE[genreId];
      if (excl && excl.test(name)) continue;

      if (shop) seenShops.add(shop);
      items.push({ name, url: makeAff(rawUrl), itemUrl: rawUrl, imageUrl: imgUrl || null });
    }

    // 画像なしのテキストリンクだけの場合も収集（ふるさと納税など）
    if (items.length < 3) {
      const re2 = /\[([^\]]{5,})\]\((https:\/\/item\.rakuten\.co\.jp\/[^)]+)\)/g;
      let m2;
      while ((m2 = re2.exec(text)) !== null && items.length < 15) {
        if (/^!/.test(m2[1])) continue;
        const rawUrl = m2[2].split('?')[0].replace(/\/$/, '') + '/';
        if (seen.has(rawUrl)) continue;
        seen.add(rawUrl);
        const shopMatch = rawUrl.match(/item\.rakuten\.co\.jp\/([^\/]+)\//);
        const shop = shopMatch ? shopMatch[1].toLowerCase() : '';
        if (shop && seenShops.has(shop)) continue;
        const name = cleanTitle(m2[1]);
        if (!name || name.length < 3) continue;
        if (!isValidProductName(name)) continue;
        const req = GENRE_REQUIRED[genreId];
        if (req && !req.test(name)) continue;
        if (shop) seenShops.add(shop);
        items.push({ name, url: makeAff(rawUrl), itemUrl: rawUrl, imageUrl: null });
      }
    }

    return items;
  }

  // ── ふるさと納税専用: event.rakuten.co.jp/furusato/ranking/ ─────────────
  if (genre === '566870') {
    try {
      const r = await fetch('https://r.jina.ai/https://event.rakuten.co.jp/furusato/ranking/', {
        headers: { 'Accept': 'text/plain', 'X-No-Cache': 'true' },
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) throw new Error(`Jina ${r.status}`);
      const text = await r.text();
      const items = parseRankingText(text, '566870');
      let n = 0;
      for (const item of items) {
        if (n >= 4) break;
        if (item.name.endsWith('…') || item.name.endsWith('...')) {
          const full = await fetchFullName(item.itemUrl);
          if (full) { item.name = full; n++; }
        }
      }
      if (items.length >= 1) return res.status(200).json({ items, _src: 'furusato' });
    } catch (e) {
      // fall through
    }
    return res.status(200).json({ items: [], _error: 'ふるさと納税ランキングを取得できませんでした。時間をおいて再試行してください。' });
  }

  // ── 通常ジャンル: ranking.rakuten.co.jp ────────────────────────────────
  try {
    const r = await fetch(`https://r.jina.ai/https://ranking.rakuten.co.jp/daily/${rankingId}/`, {
      headers: { 'Accept': 'text/plain', 'X-No-Cache': 'true' },
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) throw new Error(`Jina ${r.status}`);
    const text = await r.text();
    const items = parseRankingText(text, genre);
    let n = 0;
    for (const item of items) {
      if (n >= 4) break;
      if (item.name.endsWith('…') || item.name.endsWith('...')) {
        const full = await fetchFullName(item.itemUrl);
        if (full) { item.name = full; n++; }
      }
    }
    if (items.length >= 1) return res.status(200).json({ items, _src: 'jina' });
  } catch (e) {
    // fall through to static pool
  }

  // ── Static fallback ───────────────────────────────────────────────────────
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
