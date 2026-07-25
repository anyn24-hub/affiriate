const SBI_CN_URL =
  'https://www.sbisec.co.jp/ETGate/?_ControlID=WPLETmgR001Control' +
  '&_PageID=WPLETmgR001Mdtl20&_DataStoreID=DSWPLETmgR001Control' +
  '&_ActionID=DefaultAID&burl=iris_economicCalendar&cat1=market' +
  '&cat2=economicCalender&dir=tl1-cal%7Ctl2-schedule%7Ctl3-foreign%7Ctl4-CN' +
  '&file=index.html&getFlg=on&OutSide=on';

const SBI_JP_PAGE =
  'https://www.sbisec.co.jp/ETGate/?_ControlID=WPLETmgR001Control' +
  '&_PageID=WPLETmgR001Mdtl20&_DataStoreID=DSWPLETmgR001Control' +
  '&_ActionID=DefaultAID&burl=iris_economicCalendar&cat1=market' +
  '&cat2=economicCalender&dir=tl1-cal%7Ctl2-schedule%7Ctl3-stock%7Ctl4-calsel' +
  '&file=index.html&getFlg=on&OutSide=on';

const SBI_JP_CAL  = 'https://vc.iris.sbisec.co.jp/calendar/settlement/stock/announcement_calendar_list.do';
const SBI_JP_DATE = 'https://vc.iris.sbisec.co.jp/calendar/settlement/stock/announcement_info_date.do';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
  'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

async function fetchHtml(url) {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
    },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const buf = await resp.arrayBuffer();
  try { return new TextDecoder('shift-jis').decode(buf); }
  catch (_) { return new TextDecoder('utf-8').decode(buf); }
}

// Extract current SBI JP API hash from their calendar page
async function getJpHash() {
  const html = await fetchHtml(SBI_JP_PAGE);
  const patterns = [
    /announcement_calendar_list\.do\?hash=([0-9a-f]{40})/,
    /announcement_info_date\.do\?hash=([0-9a-f]{40})/,
    /[&?]hash=([0-9a-f]{40})/,
    /["']hash["']\s*[=:]\s*["']([0-9a-f]{40})["']/,
    /var\s+hash\s*=\s*["']([0-9a-f]{40})["']/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1];
  }
  return null;
}

// Call SBI JSONP endpoint server-side and parse result
async function sbiJsonpFetch(url) {
  const fullUrl = `${url}&callback=cb`;
  const resp = await fetch(fullUrl, {
    headers: { 'User-Agent': UA, 'Accept': '*/*', 'Accept-Language': 'ja-JP,ja;q=0.9' },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const text = await resp.text();
  // Strip JSONP wrapper: cb({...}) or cb([...])
  const m = text.match(/^[^(]+\(([\s\S]*)\)\s*;?\s*$/);
  if (!m) throw new Error('JSONP parse error');
  // SBI returns relaxed JSON with trailing commas — strip them before parsing
  const cleaned = m[1].replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(cleaned);
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);

    // /jp-cal — proxy JP settlement calendar (list of dates with announcements)
    if (url.pathname === '/jp-cal') {
      try {
        const hash = await getJpHash();
        if (!hash) return json({ error: 'hash not found', body: [] }, 502);
        const params = new URLSearchParams({
          hash,
          type: url.searchParams.get('type') || 'delay',
          baseYM: url.searchParams.get('baseYM') || '',
          selectedDate: url.searchParams.get('selectedDate') || '',
          span: url.searchParams.get('span') || '2',
        });
        const data = await sbiJsonpFetch(`${SBI_JP_CAL}?${params}`);
        return json(data);
      } catch (e) {
        return json({ error: e.message, body: [] }, 502);
      }
    }

    // /jp-date — proxy JP company list for a specific date
    if (url.pathname === '/jp-date') {
      try {
        const hash = await getJpHash();
        if (!hash) return json({ error: 'hash not found', body: [] }, 502);
        const params = new URLSearchParams({
          hash,
          type: url.searchParams.get('type') || 'delay',
          selectedDate: url.searchParams.get('selectedDate') || '',
        });
        const data = await sbiJsonpFetch(`${SBI_JP_DATE}?${params}`);
        return json(data);
      } catch (e) {
        return json({ error: e.message, body: [] }, 502);
      }
    }

    // / (root) — CN companies (existing behavior)
    try {
      const html = await fetchHtml(SBI_CN_URL);
      const m = html.match(/var\s+schedule_data\s*=\s*\[([\s\S]*?)\];/);
      if (!m) return json({ error: 'schedule_data not found', companies: [] });
      const companies = [];
      const re = /ticker:\s*"([^"]*)"\s*,\s*name:\s*"([^"]*)"\s*,\s*date:\s*"([^"]*)"/g;
      let entry;
      while ((entry = re.exec(m[1])) !== null) {
        companies.push({ ticker: entry[1], name: entry[2], date: entry[3].replace(/\//g, '') });
      }
      return json({ companies });
    } catch (e) {
      return json({ error: e.message, companies: [] }, 500);
    }
  },
};
