// Logica della strategia: identica per test sul passato e simulazione dal vivo.
export function emaArr(v, n) {
  const k = 2 / (n + 1), out = new Array(v.length); let e;
  for (let i = 0; i < v.length; i++) { e = i === 0 ? v[0] : v[i] * k + e * (1 - k); out[i] = e; }
  return out;
}
export function rsiArr(c, n = 14) {
  const out = new Array(c.length).fill(null); let g = 0, l = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } }
    else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
  }
  return out;
}
export function atrArr(cs, n = 14) {
  const out = new Array(cs.length).fill(null); let a = 0;
  for (let i = 1; i < cs.length; i++) {
    const tr = Math.max(cs[i].h - cs[i].l, Math.abs(cs[i].h - cs[i - 1].c), Math.abs(cs[i].l - cs[i - 1].c));
    if (i <= n) { a += tr; if (i === n) { a /= n; out[i] = a; } } else { a = (a * (n - 1) + tr) / n; out[i] = a; }
  }
  return out;
}
export function prepare(cs, cfg) {
  const c = cs.map(x => x.c);
  return {
    cs,
    emaFast: emaArr(c, cfg.entry.emaFast),
    emaSlow: emaArr(c, cfg.entry.emaSlow),
    regimeEma: emaArr(c, cfg.regime.emaLength),
    rsi: rsiArr(c, 14),
    atr: atrArr(cs, cfg.risk.atrLength),
    idx: new Map(cs.map((x, i) => [x.t, i])),
  };
}
export const warmup = cfg => Math.max(cfg.entry.breakoutLookback, 126, cfg.entry.rsLookback, cfg.entry.emaSlow * 2, cfg.regime.emaLength) + 1;

// Valuta un titolo alla candela i (chiusa).
export function evaluate(S, i, btc, cfg) {
  const e = cfg.entry, cs = S.cs;
  if (i < warmup(cfg) || i >= cs.length) return null;
  const close = cs[i].c;
  let hh = -Infinity; for (let j = i - e.breakoutLookback; j < i; j++) hh = Math.max(hh, cs[j].h);
  let recent = 0; for (let j = i - 5; j <= i; j++) recent += cs[j].v * cs[j].c;
  let base = 0; for (let j = i - 125; j <= i - 6; j++) base += cs[j].v * cs[j].c; base /= 20;
  const volRatio = base > 0 ? recent / base : 0;
  const ret = close / cs[i - e.rsLookback].c - 1;
  let btcRet = 0;
  if (btc) { const bi = btc.idx.get(cs[i].t); if (bi != null && bi >= e.rsLookback) btcRet = btc.cs[bi].c / btc.cs[bi - e.rsLookback].c - 1; }
  const rs = ret - btcRet;
  const rsi = S.rsi[i], atrPct = S.atr[i] / close;
  const checks = {
    rottura: close > hh,
    tendenza: close > S.emaSlow[i] && S.emaFast[i] > S.emaSlow[i],
    volume: volRatio >= e.volumeRatioMin,
    rsi: rsi != null && rsi < e.rsiMax,
    forza: rs > 0,
    liquidita: recent >= cfg.universe.minVolume24h,
  };
  const ok = Object.values(checks).every(Boolean);
  const score = rs * 100 + 10 * Math.log2(Math.max(volRatio, 0.01));
  return { ok, score, close, hh, volRatio, rs, ret, btcRet, rsi, atrPct, checks, vol24: recent, emaF: S.emaFast[i], emaS: S.emaSlow[i] };
}
export function regimeOk(btc, t, cfg) {
  if (!cfg.regime.enabled || !btc) return true;
  const bi = btc.idx.get(t); if (bi == null) return true;
  return btc.cs[bi].c > btc.regimeEma[bi];
}
