// Dati finti SOLO per test locali (MOCK=1). Mai usati su GitHub.
export const sleep = async () => {};
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const NAMES = ['XBT','ETH','SOL','ADA','DOT','LINK','AVAX','DOGE','XRP','ATOM','NEAR','INJ','PEPE','WIF','SUI','TIA','APT','ARB','OP','FET'];
const NOW = Math.floor(Date.UTC(2026, 10, 21, 8) / 1000);
export async function getPairs(q) { return NAMES.map(n => ({ key: 'X' + n + 'Z' + q, altname: n + q, wsname: n + '/' + q, base: n })); }
const cache = {};
function series(alt) {
  if (cache[alt]) return cache[alt];
  const r = rng([...alt].reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  let p = 10 + r() * 100; const out = []; let pump = 0;
  const start = NOW - 721 * 14400;
  for (let i = 0; i < 721; i++) {
    if (pump <= 0 && r() < 0.01) pump = 6 + Math.floor(r() * 18);
    const drift = pump > 0 ? 0.02 : -0.0004;
    const ret = drift + (r() - 0.5) * 0.05; pump--;
    const o = p; const c = p * (1 + ret);
    const h = Math.max(o, c) * (1 + r() * 0.02), l = Math.min(o, c) * (1 - r() * 0.02);
    out.push({ t: start + i * 14400, o, h, l, c, v: (pump > 0 ? 6 : 1) * (5000 + r() * 5000) / p * 100 });
    p = c;
  }
  return cache[alt] = out;
}
const END = () => +(process.env.MOCK_END || 721);
export async function getTickers(pairs) { const o = {}; for (const p of pairs) { const s = series(p.altname).slice(0, END()); const c = s[s.length - 1].c; o[p.altname] = { last: c, ask: c, bid: c, vol24Quote: 2e6 }; } return o; }
export async function getCandles(pair) { return series(pair.altname).slice(0, END() - 1); }
