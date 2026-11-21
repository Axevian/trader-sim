// Esecuzione ogni 4 ore (GitHub Actions): aggiorna il portafoglio virtuale e scrive i dati del cruscotto.
import { cfg, readJson, writeJson, stats } from './common.mjs';
import { loadMarket } from './universe.mjs';
import { evaluate, regimeOk } from './strategy.mjs';
import { Portfolio, fmt } from './portfolio.mjs';
import { forecast } from './forecast.mjs';
import { filterLines, failedKeys, shortFail, rulesVersion, rulesSnapshot, rulesDiff, fillForward, addShadow, analyze } from './explain.mjs';

const pc = x => (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%';
const H = cfg.review?.horizonCandles ?? 12;
const prev = readJson('state.json');
const pf = new Portfolio(cfg, prev?.portfolio);
const review = prev?.review || { shadows: [] };
const pendingPairs = [...new Set(review.shadows.filter(s => !s.done).map(s => s.pair))];
const m = await loadMarket(cfg, [...new Set([...pf.s.positions.map(p => p.pair), ...pendingPairs])]);
const ref = m.btc || Object.values(m.series)[0];
if (!ref) throw new Error('Nessun dato di mercato ricevuto');
const T = ref.cs.at(-1).t;
const isNew = T > (prev?.lastCandleT || 0);
let candidates = prev?.candidates || [], regime = prev?.regime || null;
const rules = { v: rulesVersion(cfg), cfg: rulesSnapshot(cfg), since: prev?.rules?.since || T, history: prev?.rules?.history || [] };

const prices = {};
for (const [alt, S] of Object.entries(m.series)) prices[alt] = S.cs.at(-1).c;

if (isNew) {
  // 0) Regole cambiate rispetto all'ultima esecuzione? Lo scriviamo nel diario, così sai da quando valgono
  if (prev?.rules && prev.rules.v !== rules.v) {
    const diff = rulesDiff(prev.rules.cfg, rules.cfg);
    rules.since = T; rules.history = [{ t: T, from: prev.rules.v, to: rules.v, changes: diff }, ...rules.history].slice(0, 50);
    pf.act({ type: 'REGOLE', t: T, why: diff, text: `Regole cambiate (versione ${prev.rules.v} → ${rules.v}). Da qui in poi le decisioni seguono i nuovi parametri.` });
  }
  const nTrades0 = pf.s.trades.length;

  // 1) Gestione delle posizioni aperte su tutte le candele chiuse dall'ultimo controllo
  for (const pos of [...pf.s.positions]) {
    const S = m.series[pos.pair]; if (!S) continue;
    for (const k of S.cs) { if (!pf.s.positions.includes(pos)) break; if (k.t > pos.lastT) pf.processCandle(pos, k); }
  }
  pf.checkMilestone(prices, T);
  pf.checkFail(prices, T);
  // le uscite vengono seguite anche dopo: il prezzo è salito ancora? (uscite premature)
  for (const t of pf.s.trades.slice(nTrades0)) addShadow(review.shadows, { kind: 'uscita', k: t.reason, pair: t.pair, label: t.label, t: t.exitT, p: t.exit }, H, cfg.interval);

  // 2) Scansione del mercato
  const list = [];
  for (const S of Object.values(m.series)) {
    const i = S.cs.length - 1; if (S.cs[i].t !== T) continue;
    const ev = evaluate(S, i, m.btc, cfg);
    if (ev) list.push({ pair: S.pair.altname, label: S.pair.wsname, ...ev });
  }
  list.sort((a, b) => (b.ok - a.ok) || (b.score - a.score));
  const rOk = regimeOk(m.btc, T, cfg);
  regime = m.btc ? { ok: rOk, close: m.btc.cs.at(-1).c, ema: m.btc.regimeEma.at(-1) } : { ok: true };
  const regimeLine = m.btc ? `${rOk ? '✔' : '✘'} Mercato: Bitcoin ${fmt(regime.close)} ${regime.close > regime.ema ? 'sopra' : 'sotto'} la sua media di ${cfg.regime.emaLength} candele (${fmt(regime.ema)})${cfg.regime.enabled ? '' : ' (filtro disattivato)'}` : 'Mercato: dati Bitcoin non disponibili, filtro ignorato';

  // 3) Nuovi ingressi
  const held = new Set(pf.s.positions.map(p => p.pair));
  const okList = list.filter(c => c.ok && !held.has(c.pair));
  const nearMiss = list.filter(c => !c.ok && failedKeys(c).length === 1);
  const taken = new Set();
  if (rOk) {
    for (const [rank, c] of okList.entries()) {
      if (pf.slots() <= 0) { addShadow(review.shadows, { kind: 'scartato', k: 'posti', pair: c.pair, label: c.label, t: T, p: c.close }, H, cfg.interval); continue; }
      const live = m.tick[c.pair]?.last ?? c.close;
      if (live > c.close * (1 + cfg.execution.maxChasePct)) {
        addShadow(review.shadows, { kind: 'scartato', k: 'prezzo', pair: c.pair, label: c.label, t: T, p: c.close }, H, cfg.interval);
        pf.act({ type: 'SALTATO', t: T, pair: c.label, why: [`Segnale alla chiusura: ${fmt(c.close)}; prezzo attuale ${fmt(live)} (${pc(live / c.close - 1)})`, `Limite di inseguimento: ${pc(cfg.execution.maxChasePct)} (regola execution.maxChasePct)`],
          text: `${c.label} aveva il segnale, ma il prezzo è già scappato oltre il limite: operazione saltata.` });
        continue;
      }
      const others = okList.filter(o => o !== c && !taken.has(o.pair)).slice(0, 3);
      const why = [regimeLine, ...filterLines(c, cfg).map(l => l.text),
        `Scelta: ${okList.length === 1 ? 'unico titolo a superare tutti i filtri' : `${rank + 1}° per punteggio (${c.score.toFixed(1)}) tra ${okList.length} titoli con tutti i filtri ok${others.length ? '; alternative: ' + others.map(o => `${o.label} (${o.score.toFixed(1)})`).join(', ') : ''}`}`,
        `Prezzo dal vivo ${fmt(live)} contro chiusura del segnale ${fmt(c.close)} (${pc(live / c.close - 1)}), entro il limite di ${pc(cfg.execution.maxChasePct)}`];
      if (pf.open({ pair: c.pair, label: c.label, price: live, t: T, sig: c, why })) { taken.add(c.pair); addShadow(review.shadows, { kind: 'preso', k: 'preso', pair: c.pair, label: c.label, t: T, p: c.close }, H, cfg.interval); }
    }
  } else {
    for (const c of okList) addShadow(review.shadows, { kind: 'scartato', k: 'regime', pair: c.pair, label: c.label, t: T, p: c.close }, H, cfg.interval);
    if (pf.slots() > 0) pf.act({ type: 'ATTESA', t: T, why: [regimeLine, okList.length ? `Senza questo filtro avrebbe comprato: ${okList.slice(0, 3).map(c => c.label).join(', ')}` : 'Nessun titolo avrebbe comunque superato tutti i filtri'],
      text: 'Mercato in ribasso (Bitcoin sotto la sua media di lungo periodo): nessun nuovo acquisto, si resta in liquidità.' });
  }
  for (const c of nearMiss) { const k = failedKeys(c)[0]; addShadow(review.shadows, { kind: 'scartato', k, pair: c.pair, label: c.label, t: T, p: c.close }, H, cfg.interval); }

  // 4) Promemoria per le posizioni mantenute, con il loro stato
  for (const p of pf.s.positions) {
    if (pf.actions.some(a => a.pair === p.label)) continue;
    const now = prices[p.pair] ?? p.lastPrice, rk = cfg.risk;
    pf.act({ type: 'MANTIENI', t: T, pair: p.label, stop: p.stop, why: [
      `Risultato attuale ${pc(now / p.entry - 1)}; massimo raggiunto ${pc(p.highest / p.entry - 1)}`,
      `Distanza dallo stop: ${pc(p.stop / now - 1)} (stop ${fmt(p.stop)})`,
      p.timeOk ? 'Controllo dei 2 giorni superato: resta finché non scatta lo stop mobile'
        : `Stop temporale: ${Math.max(0, rk.timeStopCandles - p.held)} candele per arrivare ad almeno ${fmt(p.entry * (1 + rk.timeStopMinGain))} (${pc(rk.timeStopMinGain, 0)})`,
    ], text: `MANTIENI ${p.label}. Stop a ${fmt(p.stop)}.` });
  }
  if (!pf.actions.some(a => ['COMPRA', 'VENDI', 'SALTATO', 'ATTESA'].includes(a.type)) && pf.slots() > 0) {
    const nm = nearMiss.slice(0, 3);
    pf.act({ type: 'NESSUNA', t: T, why: [regimeLine, `${list.length} titoli analizzati, ${list.filter(c => c.ok).length} con tutti i filtri ok`,
      ...(nm.length ? nm.map(c => `Quasi: ${c.label}, mancava solo ${shortFail(failedKeys(c)[0], c, cfg)}`) : ['Nessun titolo vicino al segnale'])],
      text: 'Nessuna operazione: nessun titolo supera tutti i filtri.' });
  }

  pf.mark(prices, T);
  candidates = list.slice(0, 15).map(c => ({ pair: c.label, ok: c.ok, score: +c.score.toFixed(1), close: c.close, volRatio: +c.volRatio.toFixed(2),
    rs: +(c.rs * 100).toFixed(1), rsi: c.rsi != null ? +c.rsi.toFixed(0) : null, checks: c.checks,
    missing: failedKeys(c).map(k => shortFail(k, c, cfg)), why: filterLines(c, cfg).map(l => l.text) }));
  pf.s.log = [...pf.actions.slice().reverse(), ...(pf.s.log || [])].slice(0, 300);
}

// 5) Revisione: cosa è successo dopo agli scartati e alle uscite, e spunti per correggere il tiro
fillForward(review.shadows, m.series, H, T, cfg.interval);
review.shadows = review.shadows.sort((a, b) => b.t - a.t).slice(0, 1500);
const analysis = analyze({ trades: pf.s.trades, shadows: review.shadows }, cfg);

// 6) Previsore del traguardo: rendimenti delle operazioni dal vivo + test sul passato
const bt = readJson('backtest.json');
const returns = [...(bt?.trades || []).map(t => t.ret), ...pf.s.trades.map(t => t.ret)];
const fc = forecast({ returns, alloc: 1 / cfg.risk.maxPositions, start: pf.equity(prices), target: pf.s.target, fail: cfg.failThreshold,
  daysPerTrade: bt?.stats?.daysPerTrade || null });

writeJson('state.json', {
  updated: new Date().toISOString(), lastCandleT: T, isNew, quote: cfg.quote,
  settings: { startCapital: cfg.startCapital, failThreshold: cfg.failThreshold, targetMultiple: cfg.targetMultiple, payoutPct: cfg.payoutPct, maxPositions: cfg.risk.maxPositions, interval: cfg.interval },
  rules, regime, candidates, actions: isNew ? pf.actions : (prev?.actions || []), forecast: fc, analysis, review,
  currentEquity: pf.equity(prices), prices: Object.fromEntries(pf.s.positions.map(p => [p.pair, prices[p.pair]])),
  stats: stats(pf.s.trades, pf.s.equity, cfg.startCapital), portfolio: pf.s,
});
console.log(isNew ? `Candela ${new Date(T * 1000).toISOString()} elaborata: ${pf.actions.map(a => a.type).join(', ')}` : 'Nessuna nuova candela: dati invariati.');
