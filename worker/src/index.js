const SBI_CN_URL =
  'https://www.sbisec.co.jp/ETGate/?_ControlID=WPLETmgR001Control' +
  '&_PageID=WPLETmgR001Mdtl20&_DataStoreID=DSWPLETmgR001Control' +
  '&_ActionID=DefaultAID&burl=iris_economicCalendar&cat1=market' +
  '&cat2=economicCalender&dir=tl1-cal%7Ctl2-schedule%7Ctl3-foreign%7Ctl4-CN' +
  '&file=index.html&getFlg=on&OutSide=on';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    try {
      const resp = await fetch(SBI_CN_URL, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
            'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
        },
      });

      if (!resp.ok) {
        return json({ error: `SBI returned ${resp.status}`, companies: [] }, 502);
      }

      // Decode Shift-JIS (SBI sends Windows-31J / Shift-JIS)
      const buf = await resp.arrayBuffer();
      let html;
      try {
        html = new TextDecoder('shift-jis').decode(buf);
      } catch (_) {
        html = new TextDecoder('utf-8').decode(buf);
      }

      // Extract the schedule_data array block
      const m = html.match(/var\s+schedule_data\s*=\s*\[([\s\S]*?)\];/);
      if (!m) {
        return json({ error: 'schedule_data not found in SBI page', companies: [] });
      }

      // Parse each entry with regex (avoids JSON key-quoting issues with JS object literals)
      const companies = [];
      const re = /ticker:\s*"([^"]*)"\s*,\s*name:\s*"([^"]*)"\s*,\s*date:\s*"([^"]*)"/g;
      let entry;
      while ((entry = re.exec(m[1])) !== null) {
        // Convert YYYY/MM/DD → YYYYMMDD to match the format used elsewhere
        const date = entry[3].replace(/\//g, '');
        companies.push({ ticker: entry[1], name: entry[2], date });
      }

      return json({ companies });
    } catch (e) {
      return json({ error: e.message, companies: [] }, 500);
    }
  },
};
