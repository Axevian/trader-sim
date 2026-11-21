// Scarica l'elenco dei titoli, sceglie i più scambiati e le loro candele da 4 ore.
import src from './data.mjs';
import { prepare } from './strategy.mjs';
export async function loadMarket(cfg, mustInclude = []) {
  const pairs = await src.getPairs(cfg.quote);
  const ex = new Set(cfg.universe.exclude);
  const usable = pairs.filter(p => !ex.has(p.base));
  const tick = await src.getTickers(usable);
  const ranked = usable.filter(p => tick[p.altname]).sort((a, b) => tick[b.altname].vol24Quote - tick[a.altname].vol24Quote);
  const chosen = ranked.filter(p => tick[p.altname].vol24Quote >= cfg.universe.minVolume24h).slice(0, cfg.universe.maxPairs);
  for (const alt of [cfg.regime.pair, ...mustInclude]) {
    if (!chosen.find(p => p.altname === alt)) { const p = pairs.find(x => x.altname === alt); if (p) chosen.push(p); }
  }
  const series = {};
  for (const p of chosen) {
    try { const cs = await src.getCandles(p, cfg.interval); if (cs.length > 30) series[p.altname] = { pair: p, ...prepare(cs, cfg) }; }
    catch (e) { console.warn('Salto', p.altname, e.message); }
    await src.sleep(1100);
  }
  return { series, tick, btc: series[cfg.regime.pair] || null };
}
