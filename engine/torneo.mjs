// Torneo di strategie: stesse monete, stesso storico pluriennale (archivio Binance), stessi costi.
// Ogni strategia parte da 100 e viene confrontata con Bitcoin semestre per semestre. Uso: YEARS=3 node engine/torneo.mjs
import zlib from 'zlib';
import { cfg, writeJson } from './common.mjs';
import * as kraken from './kraken.mjs';
import { emaArr } from './strategy.mjs';

const YEARS = Math.min(8, Math.max(1, +(process.env.YEARS || 3)));
const LOOKBACK = +(process.env.LOOKBACK || 30);          // giorni per misurare la forza
const TREND = +(process.env.TREND || 50);                // giorni della media di tendenza
const MOCK = !!process.env.MOCK;
const RENAME = { XBT: 'BTC', XDG: 'DOGE' };
const COST = cfg.execution.feePct + cfg.execution.slippagePct; // costo per lato (commissione + slippage)

// ---------- dati (come nel test su più anni)
function unzipFirst(buf) {
  let e = buf.length - 22; while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('zip non valido');
  const cd = buf.readUInt32LE(e + 16), method = buf.readUInt16LE(cd + 10), csize = buf.readUInt32LE(cd + 20), loff = buf.readUInt32LE(cd + 42);
  const start = loff + 30 + buf.readUInt16LE(loff + 26) + buf.readUInt16LE(loff + 28), data = buf.subarray(start, start + csize);
  return (method === 0 ? data : zlib.inflateRawSync(data)).toString('utf8');
}
function parseCsv(txt) {
  const out = [];
  for (const line of txt.split('\n')) { const x = line.split(','); if (x.length < 6 || !/^\d/.test(x[0])) continue;
    let t = +x[0]; t = t > 1e14 ? t / 1e6 : t / 1e3; out.push({ t: Math.round(t), c: +x[4] }); }
  return out;
}
const months = []; { const now = new Date(); let y = now.getUTCFullYear(), m = now.getUTCMonth();
  for (let k = 0; k < YEARS * 12; k++) { m--; if (m < 0) { m = 11; y--; } months.unshift(`${y}-${String(m + 1).padStart(2, '0')}`); } }
async function fetchMonth(sym, ym) {
  const url = `https://data.binance.vision/data/spot/monthly/klines/${sym}/4h/${sym}-4h-${ym}.zip`;
  for (let a = 1; a <= 3; a++) { try { const r = await fetch(url); if (r.status === 404) return []; if (!r.ok) throw new Error('HTTP ' + r.status);
      return parseCsv(unzipFirst(Buffer.from(await r.arrayBuffer()))); } catch (e) { if (a === 3) { console.warn('Salto', sym, ym, e.message); return []; } await new Promise(r => setTimeout(r, 1500 * a)); } }
}
async function pool(items, n, fn) { const res = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; res[k] = await fn(items[k]); } })); return res; }

let chosen;
if (MOCK) { const mock = await import('./mock.mjs'); chosen = await mock.getPairs(cfg.quote); }
else {
  const pairs = await kraken.getPairs(cfg.quote), ex = new Set(cfg.universe.exclude);
  const usable = pairs.filter(p => !ex.has(p.base)), tick = await kraken.getTickers(usable);
  chosen = usable.filter(p => tick[p.altname]).sort((a, b) => tick[b.altname].vol24Quote - tick[a.altname].vol24Quote)
    .filter(p => tick[p.altname].vol24Quote >= cfg.universe.minVolume24h).slice(0, cfg.universe.maxPairs);
}
chosen = chosen.map((p, rank) => ({ ...p, rank, coin: RENAME[p.base] || p.base, sym: (RENAME[p.base] || p.base) + 'USDT' }));
console.log(`Scarico ${YEARS} anni per ${chosen.length} titoli…`);
const daily = {}; // moneta -> Map(giorno -> chiusura giornaliera)
await pool(chosen, 4, async p => {
  let cs;
  if (MOCK) { const mock = await import('./mock.mjs'); cs = (await mock.getCandles(p)).map(k => ({ t: k.t, c: k.c })); }
  else cs = (await pool(months, 6, ym => fetchMonth(p.sym, ym))).flat();
  if (cs.length < 300) return;
  const m = new Map(); for (const k of cs.sort((a, b) => a.t - b.t)) m.set(Math.floor(k.t / 86400), k.c); // ultima candela del giorno = chiusura
  daily[p.coin] = m;
});
const coins = chosen.filter(p => daily[p.coin]);
if (!daily.BTC) throw new Error('Storico di Bitcoin non disponibile');
const days = [...daily.BTC.keys()].sort((a, b) => a - b);
const top10 = new Set(coins.slice(0, 10).map(p => p.coin));
console.log(`Monete con storico: ${coins.length}. Le 10 principali: ${[...top10].join(', ')}`);

// medie di tendenza giornaliere
const trend = {};
for (const coin of ['BTC', 'ETH']) if (daily[coin]) { const d = [...daily[coin].keys()].sort((a, b) => a - b), e = emaArr(d.map(x => daily[coin].get(x)), TREND);
  trend[coin] = new Map(d.map((x, i) => [x, i >= TREND ? e[i] : null])); }
const up = (coin, d) => { const p = daily[coin]?.get(d), e = trend[coin]?.get(d); return p != null && e != null && p > e; };
const strength = (coin, d) => { const a = daily[coin].get(d), b = daily[coin].get(d - LOOKBACK); return a != null && b != null && daily[coin].has(d - 60) ? a / b - 1 : null; };
const isMonday = d => (d + 3) % 7 === 0;

// ---------- motore comune: ogni giorno la strategia indica le monete da tenere (a pesi uguali)
function run(name, desc, pick) {
  let cash = 100, hold = {}, trades = 0; const curve = [];
  const start = days[Math.max(TREND, LOOKBACK, 60)];
  for (const d of days) {
    if (d < start) continue;
    const val = () => cash + Object.entries(hold).reduce((s, [c, q]) => s + q * (daily[c].get(d) ?? lastPx[c]), 0);
    for (const c of Object.keys(hold)) if (daily[c].has(d)) lastPx[c] = daily[c].get(d);
    const want = pick(d, Object.keys(hold));
    if (want) {
      const set = new Set(want);
      for (const c of Object.keys(hold)) if (!set.has(c) && daily[c].has(d)) { cash += hold[c] * daily[c].get(d) * (1 - COST); delete hold[c]; trades++; }
      const add = want.filter(c => !hold[c] && daily[c].has(d));
      if (add.length) { const target = val() / want.length, each = Math.min(target, cash / add.length);
        for (const c of add) { hold[c] = each * (1 - COST) / daily[c].get(d); cash -= each; trades++; lastPx[c] = daily[c].get(d); } }
    }
    curve.push({ d, e: val() });
  }
  return summarize(name, desc, curve, trades);
}
const lastPx = {};
function summarize(name, desc, curve, trades) {
  let peak = 0, dd = 0; for (const p of curve) { peak = Math.max(peak, p.e); dd = Math.max(dd, 1 - p.e / peak); }
  const yrs = (curve.at(-1).d - curve[0].d) / 365, fin = curve.at(-1).e, hit = curve.find(p => p.e >= 1000);
  const at = d => { let r = curve[0]; for (const p of curve) { if (p.d > d) break; r = p; } return r.e; };
  const periods = [];
  for (let y = new Date(curve[0].d * 864e5).getUTCFullYear(); y <= new Date(curve.at(-1).d * 864e5).getUTCFullYear(); y++) for (const h of [0, 1]) {
    const a = Date.UTC(y, h * 6, 1) / 864e5, b = Date.UTC(y, h * 6 + 6, 1) / 864e5 - 1;
    if (b < curve[0].d || a > curve.at(-1).d) continue;
    periods.push({ label: `${h ? '2°' : '1°'} sem. ${y}`, a, b, ret: at(b) / at(Math.max(a - 1, curve[0].d)) - 1 });
  }
  return { name, desc, final: fin, multiple: fin / 100, cagr: Math.pow(fin / 100, 1 / yrs) - 1, maxDrawdown: dd, trades, tradesPerMonth: trades / (yrs * 12),
    daysTo10x: hit ? hit.d - curve[0].d : null, periods, curve: curve.filter((p, i) => i % 3 === 0 || i === curve.length - 1).map(p => ({ t: p.d * 86400, e: +p.e.toFixed(2) })) };
}
const rotation = (n, onlyTop10) => (d, held) => {
  if (!up('BTC', d)) return [];                            // mercato in ribasso: liquidità (controllo giornaliero)
  if (!isMonday(d)) return null;                           // la scelta delle monete si fa una volta a settimana
  const list = coins.filter(p => !onlyTop10 || top10.has(p.coin)).map(p => ({ c: p.coin, s: strength(p.coin, d) }))
    .filter(x => x.s != null && x.s > 0).sort((a, b) => b.s - a.s).slice(0, n).map(x => x.c);
  return list;
};

const results = [
  run('Bitcoin compra e tieni', 'Compra Bitcoin il primo giorno e non lo vende mai.', () => ['BTC']),
  run('Bitcoin con tendenza', `Tiene Bitcoin solo quando è sopra la sua media di ${TREND} giorni, altrimenti liquidità. Controllo giornaliero.`, d => up('BTC', d) ? ['BTC'] : []),
  daily.ETH ? run('BTC + ETH con tendenza', `Metà Bitcoin e metà Ethereum, ognuno tenuto solo sopra la propria media di ${TREND} giorni.`, d => ['BTC', 'ETH'].filter(c => up(c, d))) : null,
  run('Rotazione: la più forte', `Ogni lunedì compra la moneta salita di più negli ultimi ${LOOKBACK} giorni (tutte le monete). Liquidità se Bitcoin è sotto la sua media.`, rotation(1, false)),
  run('Rotazione: le 3 più forti', `Ogni lunedì le 3 monete salite di più negli ultimi ${LOOKBACK} giorni (tutte le monete). Liquidità se Bitcoin è sotto la sua media.`, rotation(3, false)),
  run('Rotazione: 3 più forti tra le 10 principali', `Come sopra, ma solo tra le 10 monete più scambiate.`, rotation(3, true)),
].filter(Boolean);
const btcP = results[0].periods;
for (const r of results) { r.beatBtc = r.periods.filter((p, i) => p.ret > btcP[i].ret).length; r.positive = r.periods.filter(p => p.ret > 0).length; }

writeJson('torneo.json', { generated: new Date().toISOString(), years: YEARS, lookback: LOOKBACK, trend: TREND, cost: COST, coins: coins.length, top10: [...top10], results });
const p = x => x == null ? '-' : (x * 100).toFixed(1) + '%';
console.log(`\nTorneo su ${YEARS} anni, ${coins.length} monete, costo ${p(COST)} per lato\n`);
console.table(results.map(r => ({ strategia: r.name, 'da 100 a': r.final.toFixed(0), 'all\'anno': p(r.cagr), 'perdita max': p(-r.maxDrawdown), 'operazioni/mese': r.tradesPerMonth.toFixed(1),
  'semestri positivi': `${r.positive}/${r.periods.length}`, 'batte BTC': `${r.beatBtc}/${r.periods.length}`, 'giorni per 10x': r.daysTo10x ?? 'mai' })));
console.table(Object.fromEntries(results.map(r => [r.name, Object.fromEntries(r.periods.map(x => [x.label, p(x.ret)]))])));
