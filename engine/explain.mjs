// Spiegazioni delle decisioni e revisione delle operazioni: il "perché" di ogni scelta e gli spunti per correggere il tiro.
import crypto from 'crypto';

const fp = x => { if (x == null || !isFinite(x)) return '-'; const d = x >= 1000 ? 2 : x >= 1 ? 4 : x >= 0.01 ? 6 : 8; return Number(x.toFixed(d)).toString(); };
const pc = (x, d = 1) => x == null || !isFinite(x) ? '-' : (x >= 0 ? '+' : '') + (x * 100).toFixed(d) + '%';
const giorni = (candles, cfg) => +(candles * cfg.interval / 1440).toFixed(1);

// Filtri e motivi di scarto, con il parametro di config.json che li governa
export const FILTERS = {
  rottura: { name: 'Rottura dei massimi', param: 'entry.breakoutLookback' },
  tendenza: { name: 'Tendenza', param: 'entry.emaFast / entry.emaSlow' },
  volume: { name: 'Volume', param: 'entry.volumeRatioMin' },
  rsi: { name: 'RSI (eccesso)', param: 'entry.rsiMax' },
  forza: { name: 'Forza contro Bitcoin', param: 'entry.rsLookback' },
  liquidita: { name: 'Liquidità', param: 'universe.minVolume24h' },
  regime: { name: 'Mercato in ribasso', param: 'regime.enabled / regime.emaLength' },
  posti: { name: 'Nessun posto libero / battuto da un altro', param: 'risk.maxPositions' },
  prezzo: { name: 'Prezzo già scappato', param: 'execution.maxChasePct' },
};

// Versione delle regole: cambia quando cambi config.json, così ogni decisione dice con quali regole è stata presa
const RULE_KEYS = ['universe', 'regime', 'entry', 'risk', 'execution'];
export function rulesVersion(cfg) {
  const pick = Object.fromEntries(RULE_KEYS.map(k => [k, cfg[k]]));
  return crypto.createHash('sha1').update(JSON.stringify(pick)).digest('hex').slice(0, 6);
}
export function rulesSnapshot(cfg) { return JSON.parse(JSON.stringify(Object.fromEntries(RULE_KEYS.map(k => [k, cfg[k]])))); }
export function rulesDiff(a, b, prefix = '') {
  const out = [];
  for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    const x = a?.[k], y = b?.[k], key = prefix ? `${prefix}.${k}` : k;
    if (x && y && typeof x === 'object' && !Array.isArray(x)) out.push(...rulesDiff(x, y, key));
    else if (JSON.stringify(x) !== JSON.stringify(y)) out.push(`${key}: ${Array.isArray(x) ? 'elenco' : JSON.stringify(x)} → ${Array.isArray(y) ? 'elenco modificato' : JSON.stringify(y)}`);
  }
  return out;
}

// Riga di spiegazione per ogni filtro d'ingresso, con valore misurato e soglia
export function filterLines(ev, cfg) {
  const e = cfg.entry, c = ev.checks, Q = cfg.quote;
  const L = (k, text) => ({ k, ok: !!c[k], text: `${c[k] ? '✔' : '✘'} ${text}` });
  return [
    L('rottura', `Rottura: chiusura ${fp(ev.close)} ${c.rottura ? `sopra (${pc(ev.close / ev.hh - 1)})` : 'non sopra'} il massimo degli ultimi ${giorni(e.breakoutLookback, cfg)} giorni (${fp(ev.hh)})`),
    L('tendenza', `Tendenza: prezzo ${ev.close > ev.emaS ? 'sopra' : 'sotto'} la media a ${e.emaSlow} candele (${fp(ev.emaS)}); media a ${e.emaFast} ${ev.emaF > ev.emaS ? 'sopra' : 'sotto'} quella a ${e.emaSlow}`),
    L('volume', `Volume: ${ev.volRatio.toFixed(1)}× la media delle settimane precedenti (minimo richiesto ${e.volumeRatioMin}×)`),
    L('rsi', `RSI ${ev.rsi != null ? ev.rsi.toFixed(0) : '-'} (massimo ${e.rsiMax}: oltre è considerato troppo tirato)`),
    L('forza', `Forza: ${pc(ev.ret)} in ${giorni(e.rsLookback, cfg)} giorni contro ${pc(ev.btcRet)} di Bitcoin (differenza ${pc(ev.rs)})`),
    L('liquidita', `Liquidità: ${Math.round(ev.vol24).toLocaleString('it-IT')} ${Q} scambiati nelle ultime 24 ore (minimo ${cfg.universe.minVolume24h.toLocaleString('it-IT')})`),
  ];
}
export const failedKeys = ev => Object.entries(ev.checks).filter(([, v]) => !v).map(([k]) => k);
export function shortFail(k, ev, cfg) {
  const e = cfg.entry;
  return {
    rottura: `rottura (${pc(ev.close / ev.hh - 1)} dal massimo)`,
    tendenza: 'tendenza',
    volume: `volume (${ev.volRatio.toFixed(1)}× contro ${e.volumeRatioMin}×)`,
    rsi: `RSI troppo alto (${ev.rsi?.toFixed(0)})`,
    forza: `forza contro BTC (${pc(ev.rs)})`,
    liquidita: 'liquidità',
  }[k] || k;
}

// Spiegazione di dimensione e stop di un acquisto
export function sizingLines(pos, eqBefore, sig, cfg) {
  const rk = cfg.risk, raw = rk.initialStopAtr * sig.atrPct;
  const stopPct = 1 - pos.stop / pos.entry;
  const lim = raw < rk.minStopPct ? ` (portato al minimo ${pc(rk.minStopPct, 0)})` : raw > rk.maxStopPct ? ` (limitato al massimo ${pc(rk.maxStopPct, 0)})` : '';
  return [
    `Importo: capitale ${fp(eqBefore)} ${cfg.quote} diviso ${rk.maxPositions} ${rk.maxPositions === 1 ? 'posizione' : 'posizioni'} (regola maxPositions)`,
    `Volatilità tipica (ATR) ${pc(sig.atrPct)} a candela → stop iniziale ${pc(-stopPct)} = ${rk.initialStopAtr} × ATR${lim}`,
    `Stop mobile: ${rk.trailAtr} × ATR = ${pc(-pos.trailDist / pos.entry)} sotto il massimo raggiunto; si alza soltanto`,
    `Stop temporale: se dopo ${rk.timeStopCandles} candele (${giorni(rk.timeStopCandles, cfg)} giorni) non guadagna almeno ${pc(rk.timeStopMinGain, 0)}, si esce`,
  ];
}

// Diagnosi automatica di un'operazione chiusa
export function diagnose(t) {
  const mfe = t.mfe ?? 0, give = mfe - t.ret;
  if (t.reason?.startsWith('stop temporale')) return { tag: 'non partito', text: `Non è partito: in ${t.candles} candele il massimo è stato ${pc(mfe)}.` };
  if (t.reason === 'tentativo fallito') return { tag: 'chiusura forzata', text: 'Chiuso perché il capitale è sceso sotto la soglia di fallimento.' };
  if (t.ret <= 0 && mfe < 0.02) return { tag: 'falsa rottura', text: `Falsa rottura: è salito al massimo di ${pc(mfe)} e poi è sceso fino allo stop.` };
  if (t.ret <= 0 && mfe >= 0.05) return { tag: 'guadagno restituito', text: `Era in guadagno di ${pc(mfe)} ma è uscito in perdita (${pc(t.ret)}): lo stop mobile non ha protetto il guadagno.` };
  if (t.ret <= 0) return { tag: 'perdita normale', text: `Movimento debole (massimo ${pc(mfe)}), uscita allo stop.` };
  if (mfe > 0 && give > mfe / 2) return { tag: 'uscita tardiva', text: `Guadagno ${pc(t.ret)}, ma al massimo era ${pc(mfe)}: ha restituito più di metà del movimento.` };
  return { tag: 'buona cattura', text: `Guadagno ${pc(t.ret)} su un massimo di ${pc(mfe)}: catturata la maggior parte del movimento.` };
}

// Calcola cosa è successo DOPO a un titolo scartato o venduto (rendimento a H candele e massimo raggiunto)
export function fillForward(shadows, series, H, nowT, interval) {
  for (const s of shadows) {
    if (s.done) continue;
    const S = series[s.pair], i = S?.idx.get(s.t);
    if (i != null && i + H < S.cs.length) {
      let mx = -Infinity; for (let j = i + 1; j <= i + H; j++) mx = Math.max(mx, S.cs[j].h);
      s.fwd = +(S.cs[i + H].c / s.p - 1).toFixed(4); s.max = +(mx / s.p - 1).toFixed(4); s.done = true;
    } else if (nowT - s.t > 3 * H * interval * 60) { s.done = true; s.expired = true; }
  }
}
// Evita di contare cento volte lo stesso titolo scartato per lo stesso motivo in candele consecutive
export function addShadow(list, sh, H, interval) {
  const dup = list.some(x => x.kind === sh.kind && x.pair === sh.pair && x.k === sh.k && Math.abs(sh.t - x.t) < H * interval * 60);
  if (!dup) list.push(sh);
}

// Analisi complessiva: dove la strategia sbaglia e quale parametro guardare
export function analyze({ trades, shadows }, cfg) {
  const R = cfg.review || {}, H = R.horizonCandles ?? 12, MIN = R.minSample ?? 10, hd = giorni(H, cfg);
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const taken = { n: trades.length, avgRet: avg(trades.map(t => t.ret)), avgMfe: avg(trades.map(t => t.mfe ?? 0)) };

  const done = shadows.filter(s => s.done && !s.expired);
  // termine di paragone corretto: cosa hanno fatto nei primi H candele i titoli effettivamente comprati
  const preso = done.filter(s => s.kind === 'preso');
  taken.nFwd = preso.length; taken.avgFwd = avg(preso.map(s => s.fwd)); taken.avgMax = avg(preso.map(s => s.max));
  taken.pctUp = preso.length ? preso.filter(s => s.fwd > 0).length / preso.length : null;
  const byFilter = Object.entries(FILTERS).map(([k, f]) => {
    const g = done.filter(s => s.kind === 'scartato' && s.k === k);
    return { k, name: f.name, param: f.param, n: g.length, avgFwd: avg(g.map(s => s.fwd)), avgMax: avg(g.map(s => s.max)),
      pctUp: g.length ? g.filter(s => s.fwd > 0).length / g.length : null, big: g.length ? g.filter(s => s.max >= 0.10).length / g.length : null };
  }).filter(r => r.n > 0);

  const reasons = [...new Set(trades.map(t => t.reason))];
  const byExit = reasons.map(r => {
    const g = trades.filter(t => t.reason === r), after = done.filter(s => s.kind === 'uscita' && s.k === r);
    return { reason: r, n: g.length, avgRet: avg(g.map(t => t.ret)), avgMfe: avg(g.map(t => t.mfe ?? 0)),
      avgGiveBack: avg(g.map(t => (t.mfe ?? 0) - t.ret)), nAfter: after.length, afterFwd: avg(after.map(s => s.fwd)), afterMax: avg(after.map(s => s.max)) };
  });
  const tags = {}; for (const t of trades) { const d = t.diag?.tag || diagnose(t).tag; tags[d] = (tags[d] || 0) + 1; }

  // Spunti automatici: solo con un campione minimo, e sempre come ipotesi da verificare
  const hints = [];
  const ref = taken.nFwd >= 3 ? taken.avgFwd : (taken.avgRet ?? 0), refTxt = taken.nFwd >= 3 ? `dei titoli comprati (${pc(ref)} nello stesso intervallo)` : `delle operazioni fatte (${pc(ref)})`;
  for (const r of byFilter) {
    if (r.n < MIN || r.avgFwd == null) continue;
    if (r.avgFwd > Math.max(ref + 0.02, 0.01)) hints.push({ level: 'allenta', text: `Il filtro "${r.name}" ha scartato ${r.n} titoli che nei ${hd} giorni successivi hanno fatto in media ${pc(r.avgFwd)}, meglio ${refTxt}. ${r.k === 'posti' ? `Valuta più posizioni contemporanee (${r.param}) o un criterio di scelta diverso.` : `Valuta di renderlo meno severo (${r.param}).`}` });
    else if (r.avgFwd < -0.01) hints.push({ level: 'ok', text: `Il filtro "${r.name}" funziona: i ${r.n} titoli scartati sono poi scesi in media del ${pc(r.avgFwd)} in ${hd} giorni.` });
  }
  const n = trades.length;
  if (n >= MIN) {
    if ((tags['falsa rottura'] || 0) / n > 0.4) hints.push({ level: 'stringi', text: `${tags['falsa rottura']} operazioni su ${n} sono false rotture (mai salite oltre il 2%). Valuta segnali più severi: volume minimo più alto (entry.volumeRatioMin) o massimo di riferimento più lungo (entry.breakoutLookback).` });
    if ((tags['guadagno restituito'] || 0) + (tags['uscita tardiva'] || 0) > n * 0.3) hints.push({ level: 'stringi', text: `In ${(tags['guadagno restituito'] || 0) + (tags['uscita tardiva'] || 0)} operazioni su ${n} è stata restituita gran parte del guadagno. Valuta uno stop mobile più stretto (risk.trailAtr, oggi ${cfg.risk.trailAtr}).` });
    if ((tags['non partito'] || 0) / n > 0.4) hints.push({ level: 'info', text: `${tags['non partito']} operazioni su ${n} chiuse dallo stop temporale: molti segnali non hanno slancio. Valuta filtri d'ingresso più severi o più pazienza (risk.timeStopCandles).` });
  }
  for (const e of byExit) {
    if (e.nAfter >= MIN && e.afterFwd > 0.05) hints.push({ level: 'allenta', text: `Dopo le uscite per "${e.reason}" il prezzo è salito ancora in media del ${pc(e.afterFwd)} in ${hd} giorni: uscite forse premature (${e.reason.startsWith('stop temporale') ? 'risk.timeStopCandles' : 'risk.trailAtr'}).` });
  }
  if (!hints.length) hints.push({ level: 'info', text: `Ancora nessuno spunto affidabile: servono almeno ${MIN} casi per ogni tipo di decisione.` });
  return { horizon: H, horizonDays: hd, minSample: MIN, taken, byFilter, byExit, tags, hints };
}
