// Confronto di parametri: stesso storico, stessa logica del test sul passato, valori diversi di un parametro.
// Uso: PARAM=risk.trailAtr VALUES=3,2.5,2,1.5 node engine/confronto.mjs
import { cfg, writeJson, stats } from './common.mjs';
import { loadMarket } from './universe.mjs';
import { evaluate, regimeOk, warmup } from './strategy.mjs';
import { Portfolio } from './portfolio.mjs';
import { forecast } from './forecast.mjs';

const PARAM = process.env.PARAM || 'risk.trailAtr';
const VALUES = (process.env.VALUES || '3,2.5,2,1.5').split(',').map(Number).filter(v => isFinite(v));
const setp = (o, path, v) => { const k = path.split('.'); let x = o; for (const p of k.slice(0, -1)) x = x[p]; if (!(k.at(-1) in x)) throw new Error('Parametro sconosciuto: ' + path); x[k.at(-1)] = v; };
const getp = (o, path) => path.split('.').reduce((x, p) => x?.[p], o);

const m = await loadMarket(cfg);   // i dati vengono scaricati una volta sola
const ref = m.btc || Object.values(m.series).sort((a, b) => b.cs.length - a.cs.length)[0];
const timeline = ref.cs.map(k => k.t);

function simulate(c) {
  const W = warmup(c), pf = new Portfolio(c, null), last = {}; let pending = [];
  for (let n = 0; n < timeline.length; n++) {
    const t = timeline[n];
    for (const [alt, S] of Object.entries(m.series)) { const i = S.idx.get(t); if (i != null) last[alt] = S.cs[i].c; }
    if (n < W) continue;
    for (const p of pending) {
      if (pf.slots() <= 0) break;
      const S = m.series[p.pair], i = S.idx.get(t); if (i == null) continue;
      const open = S.cs[i].o; if (open > p.close * (1 + c.execution.maxChasePct)) continue;
      pf.open({ pair: p.pair, label: p.label, price: open, t: timeline[n - 1], sig: p });
    }
    pending = [];
    for (const pos of [...pf.s.positions]) { const S = m.series[pos.pair], i = S.idx.get(t); if (i != null) pf.processCandle(pos, S.cs[i]); }
    pf.checkMilestone(last, t); pf.checkFail(last, t);
    if (pf.slots() > 0 && regimeOk(m.btc, t, c) && n < timeline.length - 1) {
      const held = new Set(pf.s.positions.map(p => p.pair)), list = [];
      for (const S of Object.values(m.series)) {
        const i = S.idx.get(t); if (i == null || held.has(S.pair.altname)) continue;
        const ev = evaluate(S, i, m.btc, c); if (ev?.ok) list.push({ pair: S.pair.altname, label: S.pair.wsname, ...ev });
      }
      pending = list.sort((a, b) => b.score - a.score).slice(0, pf.slots());
    }
    pf.mark(last, t);
  }
  const s = pf.s, days = (timeline.at(-1) - timeline[W]) / 86400, eq = pf.equity(last);
  const st = stats(s.trades, s.equity, c.startCapital);
  const tags = {}; for (const tr of s.trades) tags[tr.diag.tag] = (tags[tr.diag.tag] || 0) + 1;
  const dpt = s.trades.length ? days / s.trades.length : null;
  const fc = forecast({ returns: s.trades.map(t => t.ret), alloc: 1 / c.risk.maxPositions, start: c.startCapital, target: c.startCapital * c.targetMultiple, fail: c.failThreshold, daysPerTrade: dpt });
  const net = eq + s.payouts - c.startCapital * s.attempt;
  return { value: getp(c, PARAM), finalEquity: +eq.toFixed(2), net: +net.toFixed(2), ret: net / c.startCapital, trades: st.trades, winRate: st.winRate,
    avgWin: st.avgWin, avgLoss: st.avgLoss, profitFactor: st.profitFactor, maxDrawdown: st.maxDrawdown, attempts: s.attempt, milestones: s.milestones.length,
    avgMfe: s.trades.length ? s.trades.reduce((a, t) => a + t.mfe, 0) / s.trades.length : null, tags,
    pHit: fc?.pHit ?? null, daysMedian: fc?.daysMedian ?? null, days };
}

const results = VALUES.map(v => { const c = structuredClone(cfg); setp(c, PARAM, v); return simulate(c); });
const current = getp(cfg, PARAM);
writeJson('confronto.json', { generated: new Date().toISOString(), param: PARAM, current, startT: timeline[warmup(cfg)], endT: timeline.at(-1), pairs: Object.keys(m.series).length, results });
const p = x => x == null ? '-' : (x * 100).toFixed(1) + '%';
console.log(`\nConfronto ${PARAM} (attuale: ${current}) su ${Object.keys(m.series).length} titoli, ${results[0]?.days.toFixed(0)} giorni\n`);
console.table(results.map(r => ({ valore: r.value, finale: r.finalEquity, netto: r.net, operazioni: r.trades, vincenti: p(r.winRate), 'vinc/perd': `${p(r.avgWin)} / ${p(r.avgLoss)}`,
  'fatt.profitto': r.profitFactor?.toFixed(2) ?? '-', 'perdita max': p(-r.maxDrawdown), 'prob 10x': p(r.pHit), 'giorni tipici': r.daysMedian?.toFixed(0) ?? '-' })));
