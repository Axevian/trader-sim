// Previsore: rimescola i rendimenti delle operazioni per stimare probabilità e tempi del traguardo.
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function forecast({ returns, alloc = 1, start, target, fail, daysPerTrade, paths = 5000, maxTrades = 2000 }) {
  if (!returns || returns.length < 8 || !(start > fail)) return null;
  const r = rng(12345); let hits = 0, fails = 0; const tt = [];
  for (let p = 0; p < paths; p++) {
    let e = start;
    for (let k = 0; k < maxTrades; k++) {
      e *= 1 + returns[Math.floor(r() * returns.length)] * alloc;
      if (e >= target) { hits++; tt.push(k + 1); break; }
      if (e < fail) { fails++; break; }
    }
  }
  tt.sort((a, b) => a - b);
  const q = f => tt.length ? tt[Math.min(tt.length - 1, Math.floor(f * tt.length))] : null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  return { pHit: hits / paths, pFail: fails / paths, pOpen: 1 - (hits + fails) / paths, tradesMedian: q(0.5), tradesP25: q(0.25), tradesP75: q(0.75),
    daysMedian: q(0.5) && daysPerTrade ? q(0.5) * daysPerTrade : null, daysP25: q(0.25) && daysPerTrade ? q(0.25) * daysPerTrade : null,
    daysP75: q(0.75) && daysPerTrade ? q(0.75) * daysPerTrade : null, sample: returns.length, meanReturn: mean, daysPerTrade, start, target };
}
