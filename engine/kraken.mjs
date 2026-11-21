// Dati pubblici di Kraken: nessuna chiave, nessun token.
const BASE = 'https://api.kraken.com/0/public/';
export const sleep = ms => new Promise(r => setTimeout(r, ms));

async function call(path, params = {}, tries = 4) {
  const qs = Object.keys(params).length ? '?' + new URLSearchParams(params) : '';
  const url = BASE + path + qs;
  for (let a = 1; a <= tries; a++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'trader-sim/1.0' } });
      const j = await res.json();
      if (j.error && j.error.length) {
        const msg = j.error.join(', ');
        if (/Rate limit|Unavailable|Busy|Too many/i.test(msg) && a < tries) { await sleep(3000 * a); continue; }
        throw new Error(msg);
      }
      return j.result;
    } catch (e) {
      if (a === tries || /Unknown asset pair|Invalid arguments/i.test(e.message)) throw e;
      await sleep(2000 * a);
    }
  }
}

export async function getPairs(quote) {
  const r = await call('AssetPairs');
  return Object.entries(r)
    .filter(([k, v]) => v.wsname && v.wsname.endsWith('/' + quote) && !k.endsWith('.d') && !(v.altname || '').endsWith('.d') && (!v.status || v.status === 'online'))
    .map(([k, v]) => ({ key: k, altname: v.altname, wsname: v.wsname, base: v.wsname.split('/')[0] }));
}

function parseTicker(t) {
  return { last: +t.c[0], ask: +t.a[0], bid: +t.b[0], vol24Quote: (+t.v[1]) * (+t.p[1]) };
}

export async function getTickers(pairs) {
  const out = {};
  for (let i = 0; i < pairs.length; i += 40) {
    const chunk = pairs.slice(i, i + 40);
    try {
      const r = await call('Ticker', { pair: chunk.map(p => p.altname).join(',') });
      for (const p of chunk) {
        const t = r[p.key] || r[p.altname] || r[p.wsname];
        if (t) out[p.altname] = parseTicker(t);
      }
    } catch (e) {
      for (const p of chunk) { // un simbolo non valido fa fallire il blocco: riprovo uno per uno
        try { const r = await call('Ticker', { pair: p.altname }); const t = Object.values(r)[0]; if (t) out[p.altname] = parseTicker(t); } catch {}
        await sleep(1100);
      }
    }
    await sleep(1100);
  }
  return out;
}

export async function getCandles(pair, interval) {
  const r = await call('OHLC', { pair: pair.altname, interval });
  const k = Object.keys(r).find(x => x !== 'last');
  const rows = (r[k] || []).map(x => ({ t: x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[6] }));
  rows.pop(); // l'ultima candela non è ancora chiusa
  return rows;
}
