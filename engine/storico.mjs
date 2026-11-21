// Test su più anni: stessa strategia, candele da 4 ore dall'archivio pubblico di Binance (data.binance.vision).
// I titoli sono quelli scambiati oggi su Kraken in EUR; i prezzi storici sono le coppie in USDT su Binance
// (stesso andamento, valuta diversa). Uso: YEARS=3 [PARAM=risk.maxPositions VALUES=1,3] node engine/storico.mjs
import fs from 'fs';
import zlib from 'zlib';
import { cfg, writeJson, stats } from './common.mjs';
import * as kraken from './kraken.mjs';
import { prepare, evaluate, regimeOk, warmup } from './strategy.mjs';
import { Portfolio } from './portfolio.mjs';
import { forecast } from './forecast.mjs';

const YEARS = Math.min(8, Math.max(1, +(process.env.YEARS || 3)));
const PARAM = (process.env.PARAM || '').trim();
const VALUES = (process.env.VALUES || '').split(',').map(s => s.trim()).filter(Boolean).map(Number).filter(isFinite);
const MOCK = !!process.env.MOCK;
const RENAME = { XBT: 'BTC', XDG: 'DOGE' };

// --- lettura di un file zip con un solo file CSV (senza librerie esterne)
function unzipFirst(buf) {
  let e = buf.length - 22; while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('zip non valido');
  const cd = buf.readUInt32LE(e + 16);
  const method = buf.readUInt16LE(cd + 10), csize = buf.readUInt32LE(cd + 20), loff = buf.readUInt32LE(cd + 42);
  const start = loff + 30 + buf.readUInt16LE(loff + 26) + buf.readUInt16LE(loff + 28);
  const data = buf.subarray(start, start + csize);
  return (method === 0 ? data : zlib.inflateRawSync(data)).toString('utf8');
}
function parseCsv(txt) {
  const out = [];
  for (const line of txt.split('\n')) {
    const x = line.split(','); if (x.length < 6 || !/^\d/.test(x[0])) continue;
    let t = +x[0]; t = t > 1e14 ? t / 1e6 : t / 1e3; // microsecondi dal 2025, millisecondi prima
    out.push({ t: Math.round(t), o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5] });
  }
  return out;
}
const months = [];
{ const now = new Date(); let y = now.getUTCFullYear(), m = now.getUTCMonth(); // mese corrente escluso (ancora incompleto)
  for (let k = 0; k < YEARS * 12; k++) { m--; if (m < 0) { m = 11; y--; } months.unshift(`${y}-${String(m + 1).padStart(2, '0')}`); } }

async function fetchMonth(sym, ym) {
  const url = `https://data.binance.vision/data/spot/monthly/klines/${sym}/4h/${sym}-4h-${ym}.zip`;
  for (let a = 1; a <= 3; a++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'trader-sim/1.0' } });
      if (r.status === 404) return [];
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return parseCsv(unzipFirst(Buffer.from(await r.arrayBuffer())));
    } catch (e) { if (a === 3) { console.warn('Salto', sym, ym, e.message); return []; } await new Promise(r => setTimeout(r, 1500 * a)); }
  }
}
async function pool(items, n, fn) { const res = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; res[k] = await fn(items[k]); } })); return res; }

// --- universo: i titoli più scambiati oggi su Kraken in EUR, come nella simulazione dal vivo
let chosen;
if (MOCK) {
  const mock = await import('./mock.mjs');
  chosen = (await mock.getPairs(cfg.quote)).map(p => ({ ...p, sym: (RENAME[p.base] || p.base) + 'USDT' }));
} else {
  const pairs = await kraken.getPairs(cfg.quote), ex = new Set(cfg.universe.exclude);
  const usable = pairs.filter(p => !ex.has(p.base)), tick = await kraken.getTickers(usable);
  chosen = usable.filter(p => tick[p.altname]).sort((a, b) => tick[b.altname].vol24Quote - tick[a.altname].vol24Quote)
    .filter(p => tick[p.altname].vol24Quote >= cfg.universe.minVolume24h).slice(0, cfg.universe.maxPairs);
  if (!chosen.find(p => p.altname === cfg.regime.pair)) { const p = pairs.find(x => x.altname === cfg.regime.pair); if (p) chosen.push(p); }
  chosen = chosen.map(p => ({ ...p, sym: (RENAME[p.base] || p.base) + 'USDT' }));
}
console.log(`Scarico ${YEARS} anni di candele da 4 ore per ${chosen.length} titoli (${months[0]} → ${months.at(-1)})…`);

const series = {}, missing = [];
await pool(chosen, 4, async p => {
  let cs;
  if (MOCK) { const mock = await import('./mock.mjs'); cs = await mock.getCandles(p); }
  else cs = (await pool(months, 6, ym => fetchMonth(p.sym, ym))).flat();
  cs = cs.filter((k, i, a) => i === 0 || k.t > a[i - 1].t);
  if (cs.length > 300) series[p.altname] = { pair: p, ...prepare(cs, cfg) }; else missing.push(p.wsname);
});
const btc = series[cfg.regime.pair] || null;
if (!btc) throw new Error('Storico di Bitcoin non disponibile: impossibile eseguire il test');
const timeline = btc.cs.map(k => k.t);
console.log(`Titoli con storico: ${Object.keys(series).length}. Senza storico su Binance: ${missing.join(', ') || 'nessuno'}`);

const setp = (o, path, v) => { const k = path.split('.'); let x = o; for (const p of k.slice(0, -1)) x = x[p]; if (!(k.at(-1) in x)) throw new Error('Parametro sconosciuto: ' + path); x[k.at(-1)] = v; };
const getp = (o, path) => path.split('.').reduce((x, p) => x?.[p], o);

function simulate(c) {
  const W = warmup(c), pf = new Portfolio(c, null), last = {}; let pending = [];
  for (let n = 0; n < timeline.length; n++) {
    const t = timeline[n];
    for (const [alt, S] of Object.entries(series)) { const i = S.idx.get(t); if (i != null) last[alt] = S.cs[i].c; }
    if (n < W) continue;
    for (const p of pending) {
      if (pf.slots() <= 0) break;
      const S = series[p.pair], i = S.idx.get(t); if (i == null) continue;
      const open = S.cs[i].o; if (open > p.close * (1 + c.execution.maxChasePct)) continue;
      pf.open({ pair: p.pair, label: p.label, price: open, t: timeline[n - 1], sig: p });
    }
    pending = [];
    for (const pos of [...pf.s.positions]) { const S = series[pos.pair], i = S.idx.get(t); if (i != null) pf.processCandle(pos, S.cs[i]); }
    pf.checkMilestone(last, t); pf.checkFail(last, t);
    if (pf.slots() > 0 && regimeOk(btc, t, c) && n < timeline.length - 1) {
      const held = new Set(pf.s.positions.map(p => p.pair)), list = [];
      for (const S of Object.values(series)) {
        const i = S.idx.get(t); if (i == null || i < W || held.has(S.pair.altname)) continue;
        const ev = evaluate(S, i, btc, c); if (ev?.ok) list.push({ pair: S.pair.altname, label: S.pair.wsname, ...ev });
      }
      pending = list.sort((a, b) => b.score - a.score).slice(0, pf.slots());
    }
    pf.mark(last, t);
  }
  const s = pf.s, t0 = timeline[W], days = (timeline.at(-1) - t0) / 86400, eq = pf.equity(last);
  const st = stats(s.trades, s.equity, c.startCapital), alloc = 1 / c.risk.maxPositions;
  const tags = {}; for (const tr of s.trades) tags[tr.diag.tag] = (tags[tr.diag.tag] || 0) + 1;
  // risultati per semestre: si giudica la strategia in fasi di mercato diverse
  const periods = [];
  for (let y = new Date(t0 * 1000).getUTCFullYear(); y <= new Date(timeline.at(-1) * 1000).getUTCFullYear(); y++) for (const h of [0, 1]) {
    const a = Date.UTC(y, h * 6, 1) / 1000, b = Date.UTC(y, h * 6 + 6, 1) / 1000;
    if (b <= t0 || a > timeline.at(-1)) continue;
    const tr = s.trades.filter(x => x.exitT >= a && x.exitT < b);
    const gw = tr.filter(x => x.pnl > 0).reduce((q, x) => q + x.ret, 0), gl = -tr.filter(x => x.pnl <= 0).reduce((q, x) => q + x.ret, 0);
    const bi0 = btc.cs.findIndex(k => k.t >= Math.max(a, t0)); let bi1 = btc.cs.findIndex(k => k.t >= b); if (bi1 < 0) bi1 = btc.cs.length - 1;
    periods.push({ label: `${h ? '2°' : '1°'} sem. ${y}`, trades: tr.length, winRate: tr.length ? tr.filter(x => x.pnl > 0).length / tr.length : null,
      growth: tr.reduce((g, x) => g * (1 + x.ret * alloc), 1) - 1, profitFactor: gl > 0 ? gw / gl : null,
      btc: bi0 >= 0 ? btc.cs[bi1].c / btc.cs[bi0].c - 1 : null });
  }
  const dpt = s.trades.length ? days / s.trades.length : null;
  const fc = forecast({ returns: s.trades.map(t => t.ret), alloc, start: c.startCapital, target: c.startCapital * c.targetMultiple, fail: c.failThreshold, daysPerTrade: dpt });
  const growthAll = s.trades.reduce((g, x) => g * (1 + x.ret * alloc), 1) - 1;
  return { value: PARAM ? getp(c, PARAM) : null, finalEquity: +eq.toFixed(2), net: +(eq + s.payouts - c.startCapital * s.attempt).toFixed(2),
    payouts: s.payouts, milestones: s.milestones.length, attempts: s.attempt, growth: growthAll, trades: st.trades, winRate: st.winRate,
    avgWin: st.avgWin, avgLoss: st.avgLoss, profitFactor: st.profitFactor, maxDrawdown: st.maxDrawdown, tags, periods,
    positivePeriods: periods.filter(p => p.trades && p.growth > 0).length, activePeriods: periods.filter(p => p.trades).length,
    pHit: fc?.pHit ?? null, daysMedian: fc?.daysMedian ?? null, days };
}

const variants = PARAM && VALUES.length ? VALUES : [null];
const results = variants.map(v => { const c = structuredClone(cfg); if (v != null) setp(c, PARAM, v); return simulate(c); });
const W = warmup(cfg), b0 = btc.cs[W].c, b1 = btc.cs.at(-1).c;
writeJson('storico.json', { generated: new Date().toISOString(), source: MOCK ? 'mock' : 'Binance (USDT), titoli Kraken EUR', years: YEARS,
  startT: timeline[W], endT: timeline.at(-1), pairs: Object.keys(series).length, missing, param: PARAM || null, current: PARAM ? getp(cfg, PARAM) : null,
  btcReturn: b1 / b0 - 1, results });

const p = x => x == null ? '-' : (x * 100).toFixed(1) + '%';
console.log(`\nTest su ${(results[0].days / 365).toFixed(1)} anni, ${Object.keys(series).length} titoli. Bitcoin compra e tieni: ${p(b1 / b0 - 1)}\n`);
console.table(results.map(r => ({ ...(PARAM ? { valore: r.value } : {}), 'capitale finale': r.finalEquity, compensi: +r.payouts.toFixed(2), netto: r.net, tentativi: r.attempts,
  operazioni: r.trades, vincenti: p(r.winRate), 'fatt.profitto': r.profitFactor?.toFixed(2) ?? '-', 'perdita max': p(-r.maxDrawdown), 'semestri positivi': `${r.positivePeriods}/${r.activePeriods}` })));
for (const r of results) {
  console.log(PARAM ? `\n${PARAM} = ${r.value}` : '\nRisultati per semestre');
  console.table(r.periods.map(x => ({ periodo: x.label, operazioni: x.trades, vincenti: p(x.winRate), 'crescita stimata': p(x.growth), 'fatt.profitto': x.profitFactor?.toFixed(2) ?? '-', bitcoin: p(x.btc) })));
}
