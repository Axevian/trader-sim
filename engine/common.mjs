import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
export const dataDir = path.join(root, 'docs', 'data');
export function readJson(name) { const p = path.join(dataDir, name); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; }
export function writeJson(name, obj) { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(path.join(dataDir, name), JSON.stringify(obj)); }
export function stats(trades, equity, start) {
  const wins = trades.filter(t => t.pnl > 0), losses = trades.filter(t => t.pnl <= 0);
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  let peak = -Infinity, maxDD = 0, att = null;
  for (const p of equity) { if (p.a !== att) { att = p.a; peak = p.e; } peak = Math.max(peak, p.e); maxDD = Math.max(maxDD, peak > 0 ? 1 - p.e / peak : 0); }
  const gw = wins.reduce((a, t) => a + t.pnl, 0), gl = -losses.reduce((a, t) => a + t.pnl, 0);
  return { trades: trades.length, winRate: trades.length ? wins.length / trades.length : 0, avgWin: avg(wins.map(t => t.ret)), avgLoss: avg(losses.map(t => t.ret)),
    best: trades.length ? Math.max(...trades.map(t => t.ret)) : 0, worst: trades.length ? Math.min(...trades.map(t => t.ret)) : 0,
    profitFactor: gl > 0 ? gw / gl : null, maxDrawdown: maxDD };
}
