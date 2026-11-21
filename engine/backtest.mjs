// Test sul passato: stessa logica della simulazione dal vivo, applicata agli ultimi ~120 giorni (720 candele da 4 ore).
import { cfg, writeJson, stats } from './common.mjs';
import { loadMarket } from './universe.mjs';
import { evaluate, regimeOk, warmup } from './strategy.mjs';
import { Portfolio } from './portfolio.mjs';
import { forecast } from './forecast.mjs';
import { filterLines, failedKeys, fillForward, addShadow, analyze, rulesVersion } from './explain.mjs';

const m = await loadMarket(cfg);
const ref = m.btc || Object.values(m.series).sort((a, b) => b.cs.length - a.cs.length)[0];
const timeline = ref.cs.map(k => k.t);
const W = warmup(cfg);
if (timeline.length <= W + 10) throw new Error('Storico troppo corto per il test');
const pf = new Portfolio(cfg, null);
const last = {}; let pending = [];
const maxChase = cfg.execution.maxChasePct;
const H = cfg.review?.horizonCandles ?? 12, shadows = [];
const sh = (k, c, t) => addShadow(shadows, { kind: 'scartato', k, pair: c.pair, label: c.label, t, p: c.close }, H, cfg.interval);

for (let n = 0; n < timeline.length; n++) {
  const t = timeline[n];
  for (const [alt, S] of Object.entries(m.series)) { const i = S.idx.get(t); if (i != null) last[alt] = S.cs[i].c; }
  if (n < W) continue;
  // a) esecuzione degli ingressi decisi alla candela precedente, all'apertura di questa
  for (const p of pending) {
    if (pf.slots() <= 0) break;
    const S = m.series[p.pair]; const i = S.idx.get(t); if (i == null) continue;
    const open = S.cs[i].o; if (open > p.close * (1 + maxChase)) { sh('prezzo', p, timeline[n - 1]); continue; }
    addShadow(shadows, { kind: 'preso', k: 'preso', pair: p.pair, label: p.label, t: timeline[n - 1], p: p.close }, H, cfg.interval);
    pf.open({ pair: p.pair, label: p.label, price: open, t: timeline[n - 1], sig: p,
      why: [...filterLines(p, cfg).map(l => l.text), `Scelta: punteggio ${p.score.toFixed(1)}${p.alts ? `; alternative: ${p.alts}` : ''}`, `Ingresso all'apertura della candela successiva: ${open.toPrecision(6)}`] });
  }
  pending = [];
  // b) gestione delle posizioni con la candela corrente
  const nT = pf.s.trades.length;
  for (const pos of [...pf.s.positions]) { const S = m.series[pos.pair]; const i = S.idx.get(t); if (i != null) pf.processCandle(pos, S.cs[i]); }
  pf.checkMilestone(last, t);
  pf.checkFail(last, t);
  for (const tr of pf.s.trades.slice(nT)) addShadow(shadows, { kind: 'uscita', k: tr.reason, pair: tr.pair, label: tr.label, t: tr.exitT, p: tr.exit }, H, cfg.interval);
  // c) segnali sulla chiusura di questa candela (tutti i titoli valutati, anche per studiare gli scartati)
  if (n < timeline.length - 1) {
    const held = new Set(pf.s.positions.map(p => p.pair)); const list = [];
    for (const S of Object.values(m.series)) {
      const i = S.idx.get(t); if (i == null || held.has(S.pair.altname)) continue;
      const ev = evaluate(S, i, m.btc, cfg); if (!ev) continue;
      const c = { pair: S.pair.altname, label: S.pair.wsname, ...ev };
      if (ev.ok) list.push(c); else if (failedKeys(ev).length === 1) sh(failedKeys(ev)[0], c, t);
    }
    list.sort((a, b) => b.score - a.score);
    if (!regimeOk(m.btc, t, cfg)) list.forEach(c => sh('regime', c, t));
    else {
      pending = list.slice(0, Math.max(0, pf.slots()));
      for (const c of pending) c.alts = list.filter(o => !pending.includes(o)).slice(0, 3).map(o => `${o.label} (${o.score.toFixed(1)})`).join(', ');
      list.slice(pending.length).forEach(c => sh('posti', c, t));
    }
  }
  pf.mark(last, t);
}

const s = pf.s, startT = timeline[W], endT = timeline.at(-1), days = (endT - startT) / 86400;
const eqNow = pf.equity(last);
const st = stats(s.trades, s.equity, cfg.startCapital);
st.days = days; st.daysPerTrade = s.trades.length ? days / s.trades.length : null;
st.finalEquity = eqNow; st.payouts = s.payouts; st.attempts = s.attempt; st.failed = s.attempts.length; st.milestones = s.milestones.length;
st.capitalUsed = cfg.startCapital * s.attempt; st.net = eqNow + s.payouts - st.capitalUsed;
const b0 = m.btc ? m.btc.cs[m.btc.idx.get(startT)]?.c : null, b1 = m.btc?.cs.at(-1).c;
st.btcReturn = b0 && b1 ? b1 / b0 - 1 : null;
const btcCurve = m.btc ? s.equity.map(p => { const i = m.btc.idx.get(p.t); return { t: p.t, e: i != null ? +(cfg.startCapital * m.btc.cs[i].c / b0).toFixed(2) : null }; }) : [];
fillForward(shadows, m.series, H, endT, cfg.interval);
const analysis = analyze({ trades: s.trades, shadows }, cfg);
const fc = forecast({ returns: s.trades.map(t => t.ret), alloc: 1 / cfg.risk.maxPositions, start: cfg.startCapital, target: cfg.startCapital * cfg.targetMultiple, fail: cfg.failThreshold, daysPerTrade: st.daysPerTrade });

writeJson('backtest.json', { generated: new Date().toISOString(), quote: cfg.quote, startT, endT, pairs: Object.keys(m.series).length,
  stats: st, forecast: fc, analysis, rulesVersion: rulesVersion(cfg), equity: s.equity, btcCurve, trades: s.trades, milestones: s.milestones, attempts: s.attempts });
console.log(JSON.stringify({ periodo_giorni: days.toFixed(0), titoli: Object.keys(m.series).length, ...st, forecast: fc }, null, 1));
