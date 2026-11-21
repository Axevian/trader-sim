const $ = id => document.getElementById(id);
let Q = 'EUR', IV = 240;
// i dati usano l'ora di apertura della candela: mostriamo l'ora di chiusura, cioè quando il segnale è disponibile
const dtc = t => t ? dt(t + IV * 60) : '–';
const money = (x, d = 2) => x == null || !isFinite(x) ? '–' : x.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' ' + (Q === 'EUR' ? '€' : Q);
const price = x => x == null || !isFinite(x) ? '–' : x.toLocaleString('it-IT', { maximumSignificantDigits: 6 });
const pct = (x, d = 1) => x == null || !isFinite(x) ? '–' : (x >= 0 ? '+' : '') + (x * 100).toLocaleString('it-IT', { maximumFractionDigits: d }) + '%';
const cls = x => x > 0 ? 'pos' : x < 0 ? 'neg' : '';
const dt = t => t ? new Date(t * 1000).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–';
const days = d => d == null ? '–' : d < 1 ? Math.round(d * 24) + ' ore' : Math.round(d) + ' giorni';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const table = (head, rows) => rows.length ? `<div class="tablewrap"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="empty">Nessun dato per ora.</p>';

const whyBox = (why, open) => why?.length ? `<details class="why"${open ? ' open' : ''}><summary>Perché?</summary><ul>${why.map(l => `<li>${esc(l)}</li>`).join('')}</ul></details>` : '';
const ver = v => v ? `<span class="ver" title="Versione delle regole (config.json) usata per questa decisione">regole ${esc(v)}</span>` : '';
const trWhy = t => `<details class="why"><summary>${esc(t.diag?.tag || 'dettagli')}</summary><b>Perché è entrato</b><ul>${(t.whyIn || []).map(l => `<li>${esc(l)}</li>`).join('') || '<li>Non registrato (operazione precedente al diario)</li>'}</ul><b>Perché è uscito</b><ul>${(t.whyOut || [esc(t.reason)]).map(l => `<li>${esc(l)}</li>`).join('')}</ul></details>`;

function renderAnalysis(a, el, title) {
  if (!el) return;
  if (!a) { el.innerHTML = `<h3>${title}</h3><p class="empty">Nessun dato ancora.</p>`; return; }
  const hc = { allenta: 'Allentare?', stringi: 'Stringere?', ok: 'Funziona', info: 'Nota' };
  const t = a.taken;
  el.innerHTML = `<h3>${title}</h3>
    <ul class="hints">${a.hints.map(h => `<li class="h-${h.level}"><span class="pill">${hc[h.level] || h.level}</span> ${esc(h.text)}</li>`).join('')}</ul>
    <p class="hint">Titoli comprati: ${t.nFwd || 0} casi, nei ${a.horizonDays} giorni successivi al segnale in media ${pct(t.avgFwd)} (saliti nel ${t.pctUp != null ? (t.pctUp * 100).toFixed(0) + '%' : '–'} dei casi). Confrontali con gli scartati qui sotto: se gli scartati fanno meglio, il filtro sta togliendo occasioni.</p>
    ${table(['Scartati per', 'Casi', `Dopo ${a.horizonDays} gg`, 'Massimo medio', 'Saliti', 'Saliti oltre +10%', 'Parametro'],
      a.byFilter.map(r => [esc(r.name), r.n, `<span class="${cls(r.avgFwd)}">${pct(r.avgFwd)}</span>`, pct(r.avgMax), r.pctUp != null ? (r.pctUp * 100).toFixed(0) + '%' : '–', r.big != null ? (r.big * 100).toFixed(0) + '%' : '–', `<code>${esc(r.param)}</code>`]))}
    ${table(['Uscite per', 'Operazioni', 'Risultato medio', 'Massimo medio raggiunto', 'Restituito in media', `Prezzo ${a.horizonDays} gg dopo l'uscita`],
      a.byExit.map(r => [esc(r.reason), r.n, `<span class="${cls(r.avgRet)}">${pct(r.avgRet)}</span>`, pct(r.avgMfe), pct(-r.avgGiveBack), r.nAfter ? `<span class="${cls(r.afterFwd)}">${pct(r.afterFwd)}</span> (${r.nAfter})` : '–']))}
    <p class="hint">Diagnosi delle operazioni: ${Object.entries(a.tags).map(([k, v]) => `${esc(k)} ${v}`).join(' · ') || '–'}. Gli spunti richiedono almeno ${a.minSample} casi.</p>`;
}

async function load(name) {
  try { const r = await fetch(`data/${name}?v=${Date.now()}`); return r.ok ? await r.json() : null; } catch { return null; }
}

function chart(id, datasets) {
  const el = $(id); if (!window.Chart || !el) return;
  if (el._c) el._c.destroy();
  el._c = new Chart(el, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
      interaction: { mode: 'nearest', intersect: false },
      scales: {
        x: { type: 'linear', ticks: { color: '#8b949e', callback: v => new Date(v).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }) }, grid: { color: '#21262d' } },
        y: { type: 'logarithmic', ticks: { color: '#8b949e', callback: v => Number(v).toLocaleString('it-IT') }, grid: { color: '#21262d' } }
      },
      plugins: { legend: { labels: { color: '#e6edf3' } }, tooltip: { callbacks: { title: i => new Date(i[0].parsed.x).toLocaleString('it-IT'), label: i => `${i.dataset.label}: ${money(i.parsed.y)}` } } },
      elements: { point: { radius: 0 }, line: { borderWidth: 2 } }
    }
  });
}
const series = (arr, label, color, dash) => ({ label, data: arr.filter(p => p.e != null && p.e > 0).map(p => ({ x: p.t * 1000, y: p.e })), borderColor: color, backgroundColor: color, borderDash: dash || [] });

function renderLive(s) {
  Q = s.quote || 'EUR'; IV = s.settings?.interval || 240;
  const P = s.portfolio, set = s.settings, eq = s.currentEquity;
  const next = s.lastCandleT ? s.lastCandleT + 2 * set.interval * 60 : null; // chiusura della candela successiva
  $('updated').innerHTML = `Ultimo aggiornamento: <b>${new Date(s.updated).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}</b><br>Ultima candela chiusa elaborata: ${dtc(s.lastCandleT)} · prossimo aggiornamento previsto dopo le ${dt(next)}`;
  const regime = s.regime ? (s.regime.ok ? '<span class="pill ok">Favorevole</span>' : '<span class="pill no">Ribasso: in liquidità</span>') : '–';
  const startEq = set.startCapital;
  $('kpis').innerHTML = [
    ['Capitale attuale', money(eq), `Tentativo n. ${P.attempt} · partito da ${money(startEq, 0)}`],
    ['Prossimo traguardo', money(P.target, 0), `Mancano ${money(Math.max(0, P.target - eq))}`],
    ['Compensi maturati', money(P.payouts), `${P.milestones.length} traguardi raggiunti`],
    ['Operazioni chiuse', P.trades.length, `Vincenti ${pct(s.stats.winRate, 0).replace('+', '')}`],
    ['Perdita max dal picco', pct(-s.stats.maxDrawdown), 'nel tentativo peggiore'],
    ['Mercato', regime, s.regime?.close ? `BTC ${price(s.regime.close)} vs media ${price(s.regime.ema)}` : ''],
  ].map(([l, v, sub]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${sub}</div></div>`).join('');

  const base = P.milestones.length ? P.target / set.targetMultiple : startEq;
  const prog = Math.max(0, Math.min(1, Math.log(Math.max(eq, 1e-9) / base) / Math.log(P.target / base)));
  $('progress').innerHTML = `<div class="row"><span>${money(base, 0)}</span><span><b>${(prog * 100).toFixed(1)}%</b> del percorso (scala moltiplicativa)</span><span>${money(P.target, 0)}</span></div><div class="bar"><div style="width:${prog * 100}%"></div></div>
    <div class="row"><span>Soglia di fallimento: ${money(set.failThreshold, 0)}</span><span>Compenso al traguardo: ${pct(set.payoutPct, 0).replace('+', '')} del traguardo = ${money(set.payoutPct * P.target)}</span></div>`;

  const acts = s.actions || [];
  $('actions').innerHTML = acts.length ? acts.map((a, i) => `<div class="act ${a.type}"><button onclick="navigator.clipboard.writeText(this.dataset.t);this.textContent='Copiato'" data-t="${esc(a.text)}">Copia</button>
      <div class="tt">${esc(a.text)}</div>
      <div class="meta">${dtc(a.t)}${a.type === 'COMPRA' ? ` · Stop mobile: ${pct(-a.trailPct)} dal massimo raggiunto (aggiornato ogni 4 ore)` : ''} ${ver(a.v)}</div>${whyBox(a.why, a.type === 'COMPRA')}</div>`).join('')
    : '<p class="empty">Nessuna istruzione ancora: attendi la prima elaborazione.</p>';

  $('positions').innerHTML = table(['Titolo', 'Ingresso', 'Prezzo', 'Risultato', 'Stop', 'Investito'],
    P.positions.map(p => { const now = s.prices?.[p.pair] ?? p.lastPrice; const r = now / p.entry - 1; return [esc(p.label), price(p.entry), price(now), `<span class="${cls(r)}">${pct(r)}</span>`, price(p.stop), money(p.cost)]; }));

  const f = s.forecast;
  $('forecast').innerHTML = f ? `<p>Da <b>${money(f.start)}</b> a <b>${money(f.target, 0)}</b>, rimescolando ${f.sample} operazioni reali (test + dal vivo) in 5.000 futuri possibili:</p>
    <div class="kpis" style="grid-template-columns:1fr 1fr 1fr"><div class="kpi"><div class="l">Arriva al traguardo</div><div class="v pos">${(f.pHit * 100).toFixed(0)}%</div></div>
    <div class="kpi"><div class="l">Fallisce prima</div><div class="v neg">${(f.pFail * 100).toFixed(0)}%</div></div>
    <div class="kpi"><div class="l">Tempo tipico</div><div class="v">${days(f.daysMedian)}</div><div class="s">tra ${days(f.daysP25)} e ${days(f.daysP75)}</div></div></div>
    <p class="hint">Rendimento medio per operazione ${pct(f.meanReturn)}. Stima statistica, non una promessa: con poche operazioni è molto incerta.</p>`
    : '<p class="empty">Servono almeno 8 operazioni (dal test sul passato o dal vivo) per stimare probabilità e tempi.</p>';

  if (P.equity.length > 1) chart('liveChart', [series(P.equity, 'Capitale simulato', '#58a6ff'), { ...series(P.equity.map(p => ({ t: p.t, e: P.target })), 'Traguardo', '#d29922', [6, 4]) }]);
  else $('liveEmpty').hidden = false;

  const ck = c => ['rottura', 'tendenza', 'volume', 'rsi', 'forza', 'liquidita'].map(k => `<span class="chk" title="${k}">${c.checks[k] ? '✅' : '·'}</span>`).join('');
  $('candidates').innerHTML = table(['Titolo', 'Segnale', 'Punteggio', 'Prezzo', 'Volume ×', 'Forza vs BTC', 'RSI', 'Rottura · Tendenza · Volume · RSI · Forza · Liquidità', 'Cosa manca'],
    (s.candidates || []).map(c => [esc(c.pair), c.ok ? '<span class="pill ok">COMPRA</span>' : '<span class="pill">no</span>', c.score, price(c.close), c.volRatio, `<span class="${cls(c.rs)}">${c.rs}%</span>`, c.rsi ?? '–', ck(c),
      `<span class="wrap">${c.missing?.length ? esc(c.missing.join(', ')) : 'niente'}</span>${whyBox(c.why)}`]));

  $('trades').innerHTML = table(['Titolo', 'Entrata', 'Uscita', 'Prezzo in', 'Prezzo out', 'Risultato', 'Guadagno', 'Massimo toccato', 'Punto peggiore', 'Motivo', 'Diagnosi e perché'],
    [...P.trades].reverse().map(t => [esc(t.label), dtc(t.entryT), dtc(t.exitT), price(t.entry), price(t.exit), `<span class="${cls(t.ret)}">${pct(t.ret)}</span>`, `<span class="${cls(t.pnl)}">${money(t.pnl)}</span>`, pct(t.mfe), pct(t.mae), esc(t.reason), trWhy(t)]));

  const rowsM = P.milestones.map(m => ['Traguardo', dtc(m.t), `n. ${m.attempt}`, money(m.target, 0), money(m.payout)]);
  const rowsA = P.attempts.map(a => ['Tentativo fallito', dtc(a.end), `n. ${a.n}`, money(a.final), `${a.milestones} traguardi`]);
  $('milestones').innerHTML = table(['Evento', 'Quando', 'Tentativo', 'Valore', 'Compenso / note'], [...rowsM, ...rowsA]);

  const lf = $('logFilter'), drawLog = () => {
    const f = lf?.value || '', L = (P.log || []).filter(a => !f || a.type === f || (f === 'NOOP' && ['NESSUNA', 'ATTESA', 'SALTATO'].includes(a.type)));
    $('log').innerHTML = L.slice(0, 80).map(a => `<div class="act ${a.type}"><div>${esc(a.text)}</div><div class="meta">${dtc(a.t)} ${ver(a.v)}</div>${whyBox(a.why)}</div>`).join('') || '<p class="empty">Ancora vuoto.</p>';
  };
  if (lf) lf.onchange = drawLog; drawLog();
  renderAnalysis(s.analysis, $('anLive'), 'Simulazione dal vivo');
}

function renderBacktest(b) {
  if (!b) { $('btStats').innerHTML = '<p class="empty">Test non ancora eseguito. Avvialo da GitHub: Actions → "Test sul passato" → Run workflow.</p>'; return; }
  Q = b.quote || Q;
  const s = b.stats;
  $('btStats').innerHTML = `<p class="hint">Periodo ${dtc(b.startT)} → ${dtc(b.endT)} (${Math.round(s.days)} giorni) su ${b.pairs} titoli. Generato il ${new Date(b.generated).toLocaleString('it-IT')}.</p>
  <div class="kpis">${[
    ['Capitale finale', money(s.finalEquity), `tentativo n. ${s.attempts}`],
    ['Compensi', money(s.payouts), `${s.milestones} traguardi`],
    ['Risultato netto', `<span class="${cls(s.net)}">${money(s.net)}</span>`, `capitale usato ${money(s.capitalUsed, 0)} (${s.failed} ripartenze)`],
    ['Bitcoin compra e tieni', `<span class="${cls(s.btcReturn)}">${pct(s.btcReturn)}</span>`, 'stesso periodo'],
    ['Operazioni', s.trades, `vincenti ${(s.winRate * 100).toFixed(0)}% · una ogni ${days(s.daysPerTrade)}`],
    ['Media vincite / perdite', `<span class="pos">${pct(s.avgWin)}</span> / <span class="neg">${pct(s.avgLoss)}</span>`, `fattore di profitto ${s.profitFactor ? s.profitFactor.toFixed(2) : '–'}`],
    ['Perdita max dal picco', pct(-s.maxDrawdown), `migliore ${pct(s.best)} · peggiore ${pct(s.worst)}`],
    ['Probabilità 10x', b.forecast ? (b.forecast.pHit * 100).toFixed(0) + '%' : '–', b.forecast ? `tempo tipico ${days(b.forecast.daysMedian)}` : 'servono più operazioni'],
  ].map(([l, v, sub]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${sub}</div></div>`).join('')}</div>
  <p class="hint">Attenzione: i titoli sono scelti tra i più scambiati di oggi, quindi il test tende a essere ottimista. Commissioni e slippage sono inclusi.</p>`;
  chart('btChart', [series(b.equity, 'Strategia', '#3fb950'), series(b.btcCurve, 'Bitcoin compra e tieni', '#8b949e', [4, 4])]);
  $('btTrades').innerHTML = '<h2 style="margin-top:14px">Operazioni del test</h2>' + table(['Titolo', 'Entrata', 'Uscita', 'Risultato', 'Massimo toccato', 'Motivo', 'Diagnosi e perché'],
    [...b.trades].reverse().map(t => [esc(t.label), dtc(t.entryT), dtc(t.exitT), `<span class="${cls(t.ret)}">${pct(t.ret)}</span>`, pct(t.mfe), esc(t.reason), trWhy(t)]));
  renderAnalysis(b.analysis, $('anBt'), `Test sul passato${b.rulesVersion ? ` (regole ${esc(b.rulesVersion)})` : ''}`);
}

(async () => {
  const [s, b] = await Promise.all([load('state.json'), load('backtest.json')]);
  if (s) renderLive(s); else { $('updated').textContent = 'Nessun dato ancora: avvia la prima esecuzione da GitHub Actions.'; }
  renderBacktest(b);
})();
