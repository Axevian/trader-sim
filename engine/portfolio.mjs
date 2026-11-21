// Portafoglio virtuale: ordini, stop, traguardi, compensi e tentativi.
import { sizingLines, diagnose, rulesVersion } from './explain.mjs';
const r2 = x => Math.round(x * 100) / 100;
export class Portfolio {
  constructor(cfg, state) { this.cfg = cfg; this.s = state || Portfolio.fresh(cfg); this.actions = []; this.v = rulesVersion(cfg); }
  static fresh(cfg) {
    return { attempt: 1, attemptStart: null, cash: cfg.startCapital, positions: [], trades: [], equity: [],
      milestones: [], attempts: [], payouts: 0, pendingPayout: 0, target: cfg.startCapital * cfg.targetMultiple, log: [] };
  }
  equity(prices = {}) {
    const s = this.s;
    return s.cash - s.pendingPayout + s.positions.reduce((a, p) => a + p.qty * (prices[p.pair] ?? p.lastPrice), 0);
  }
  act(a) { this.actions.push({ ...a, v: this.v }); }
  slots() { return this.cfg.risk.maxPositions - this.s.positions.length; }

  // Apertura posizione: price = prezzo di riferimento (prima dello slippage)
  open({ pair, label, price, t, sig, why = [] }) {
    const { feePct, slippagePct, maxChasePct } = this.cfg.execution, rk = this.cfg.risk, s = this.s;
    const free = s.cash - s.pendingPayout; if (free <= 1) return null;
    const eqBefore = this.equity(), alloc = Math.min(free, eqBefore / rk.maxPositions);
    const fill = price * (1 + slippagePct);
    const qty = alloc / (fill * (1 + feePct));
    const stopPct = Math.min(rk.maxStopPct, Math.max(rk.minStopPct, rk.initialStopAtr * sig.atrPct));
    const trailDist = rk.trailAtr * sig.atrPct * fill;
    const pos = { id: `${pair}-${t}`, pair, label, qty, entry: fill, cost: alloc, t, stop: fill * (1 - stopPct), highest: fill,
      trailDist, held: 0, lastT: t, lastPrice: fill, timeOk: false, attempt: s.attempt, score: sig.score, lowest: fill, v: this.v };
    const sizing = sizingLines(pos, eqBefore, sig, this.cfg);
    pos.why = [...why, ...sizing];
    s.cash -= alloc; s.positions.push(pos);
    if (!s.attemptStart) s.attemptStart = t;
    this.act({ type: 'COMPRA', t, pair: label, amount: r2(alloc), refPrice: price, maxPrice: price * (1 + maxChasePct), stop: pos.stop,
      trailPct: trailDist / fill, why: pos.why,
      text: `COMPRA ${label} per ${r2(alloc)} ${this.cfg.quote}. Prezzo di riferimento ${fmt(price)}, non entrare sopra ${fmt(price * (1 + maxChasePct))}. Stop iniziale ${fmt(pos.stop)}.` });
    return pos;
  }
  close(pos, price, t, reason, detail) {
    const { feePct } = this.cfg.execution, s = this.s;
    const proceeds = pos.qty * price * (1 - feePct);
    const cost = pos.cost, ret = proceeds / cost - 1;
    // mfe/mae: massimo guadagno e massima perdita toccati durante l'operazione (al lordo dei costi)
    const tr = { pair: pos.pair, label: pos.label, entryT: pos.t, exitT: t, entry: pos.entry, exit: price, cost,
      proceeds, pnl: proceeds - cost, ret, reason, attempt: pos.attempt, candles: pos.held,
      mfe: +(pos.highest / pos.entry - 1).toFixed(4), mae: +((pos.lowest ?? pos.entry) / pos.entry - 1).toFixed(4), v: pos.v, whyIn: pos.why || [] };
    tr.diag = diagnose(tr);
    const pc = x => (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%';
    tr.whyOut = [detail || `Regola: ${reason}`,
      `Massimo raggiunto ${pc(tr.mfe)} (${fmt(pos.highest)}), punto peggiore ${pc(tr.mae)}; durata ${pos.held} candele (${(pos.held * this.cfg.interval / 60).toFixed(0)} ore)`,
      `Diagnosi: ${tr.diag.text}`];
    s.trades.push(tr);
    s.cash += proceeds; s.positions = s.positions.filter(p => p !== pos);
    if (s.pendingPayout > 0) { const take = Math.min(s.pendingPayout, s.cash); s.cash -= take; s.pendingPayout -= take; }
    this.act({ type: 'VENDI', t, pair: pos.label, price, reason, ret, why: tr.whyOut,
      text: `VENDI ${pos.label} (${reason}). Prezzo ${fmt(price)}, risultato ${(100 * (proceeds / pos.cost - 1)).toFixed(1)}%.` });
  }
  // Gestione di una candela chiusa per una posizione aperta
  processCandle(pos, k) {
    if (k.t <= pos.lastT) return;
    const slip = this.cfg.execution.slippagePct, rk = this.cfg.risk;
    let exit = null;
    if (k.o <= pos.stop) exit = { price: k.o * (1 - slip), reason: 'apertura sotto lo stop',
      detail: `La candela ha aperto a ${fmt(k.o)}, già sotto lo stop ${fmt(pos.stop)}: vendita all'apertura (caso peggiore, salto di prezzo)` };
    else if (k.l <= pos.stop) {
      const trailing = pos.stop > pos.entry;
      exit = { price: pos.stop * (1 - slip), reason: trailing ? 'stop mobile' : 'stop loss',
        detail: trailing ? `Il prezzo è sceso a ${fmt(k.l)} toccando lo stop mobile ${fmt(pos.stop)} (massimo ${fmt(pos.highest)} meno ${this.cfg.risk.trailAtr} × ATR): guadagno protetto`
          : `Il prezzo è sceso a ${fmt(k.l)} toccando lo stop ${fmt(pos.stop)}: il movimento atteso non c'è stato, perdita limitata` };
    }
    pos.lowest = Math.min(pos.lowest ?? pos.entry, exit ? Math.min(k.l, exit.price) : k.l);
    if (exit) pos.highest = Math.max(pos.highest, Math.min(k.h, k.o)); // nella candela d'uscita contiamo solo l'apertura
    pos.lastT = k.t; pos.lastPrice = k.c;
    if (exit) return this.close(pos, exit.price, k.t, exit.reason, exit.detail);
    const oldStop = pos.stop;
    pos.held++; pos.highest = Math.max(pos.highest, k.h);
    pos.stop = Math.max(pos.stop, pos.highest - pos.trailDist);
    if (!pos.timeOk && pos.held >= rk.timeStopCandles) {
      if (k.c >= pos.entry * (1 + rk.timeStopMinGain)) pos.timeOk = true;
      else return this.close(pos, k.c * (1 - slip), k.t, 'stop temporale: non è partito',
        `Dopo ${pos.held} candele il prezzo (${fmt(k.c)}) non supera l'ingresso del ${(rk.timeStopMinGain * 100).toFixed(0)}% richiesto (${fmt(pos.entry * (1 + rk.timeStopMinGain))}): si libera il capitale per un titolo più forte`);
    }
    if (pos.stop > oldStop * 1.0005) this.act({ type: 'AGGIORNA_STOP', t: k.t, pair: pos.label, stop: pos.stop,
      why: [`Nuovo massimo ${fmt(pos.highest)} (${((pos.highest / pos.entry - 1) * 100).toFixed(1)}% dall'ingresso)`,
        `Stop = massimo − ${this.cfg.risk.trailAtr} × ATR = ${fmt(pos.stop)}; se scatta ora il risultato è ${((pos.stop / pos.entry - 1) * 100).toFixed(1)}% prima dei costi`],
      text: `MANTIENI ${pos.label}: alza lo stop a ${fmt(pos.stop)}.` });
  }
  checkMilestone(prices, t) {
    const s = this.s, cfg = this.cfg; const eq = this.equity(prices);
    if (eq >= s.target) {
      const payout = cfg.payoutPct * s.target;
      s.milestones.push({ t, attempt: s.attempt, target: s.target, payout, equity: eq });
      s.payouts += payout; s.pendingPayout += payout;
      const take = Math.min(s.pendingPayout, s.cash); s.cash -= take; s.pendingPayout -= take;
      const base = eq - payout; const old = s.target; s.target = base * cfg.targetMultiple;
      this.act({ type: 'TRAGUARDO', t, payout, why: [`Capitale ${fmt(eq)} ≥ traguardo ${fmt(old)}`, `Compenso = ${(cfg.payoutPct * 100).toFixed(0)}% del traguardo; nuovo traguardo = (capitale − compenso) × ${cfg.targetMultiple}`], text: `TRAGUARDO ${fmt(old)} ${cfg.quote} raggiunto! Compenso: ${r2(payout)} ${cfg.quote}${s.pendingPayout > 0 ? ' (da mettere da parte alla prossima vendita)' : ''}. Nuovo traguardo: ${fmt(s.target)}.` });
    }
  }
  checkFail(prices, t) {
    const s = this.s, cfg = this.cfg; const eq = this.equity(prices);
    if (eq >= cfg.failThreshold) return;
    const slip = cfg.execution.slippagePct;
    for (const p of [...s.positions]) this.close(p, (prices[p.pair] ?? p.lastPrice) * (1 - slip), t, 'tentativo fallito');
    const unpaid = s.pendingPayout; s.payouts -= unpaid;
    s.attempts.push({ n: s.attempt, start: s.attemptStart, end: t, result: 'fallito', final: this.equity(), milestones: s.milestones.filter(m => m.attempt === s.attempt).length });
    s.attempt++; s.cash = cfg.startCapital; s.pendingPayout = 0; s.target = cfg.startCapital * cfg.targetMultiple; s.attemptStart = null;
    this.act({ type: 'RIPARTENZA', t, why: [`Capitale ${fmt(eq)} sotto la soglia di fallimento ${cfg.failThreshold}`, 'Posizioni chiuse e nuovo tentativo con il capitale di partenza'], text: `Tentativo ${s.attempt - 1} fallito (capitale sotto ${cfg.failThreshold} ${cfg.quote}). Si riparte da ${cfg.startCapital} ${cfg.quote}.` });
  }
  mark(prices, t) {
    for (const p of this.s.positions) if (prices[p.pair] != null) p.lastPrice = prices[p.pair];
    this.s.equity.push({ t, e: r2(this.equity(prices)), a: this.s.attempt });
  }
}
export function fmt(x) {
  if (x == null || !isFinite(x)) return '-';
  const d = x >= 1000 ? 2 : x >= 1 ? 4 : x >= 0.01 ? 6 : 8;
  return Number(x.toFixed(d)).toString();
}
