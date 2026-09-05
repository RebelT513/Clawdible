/* Clawdible — CFB paper-performance dashboard (no external dependencies) */

async function load(url) {
  try {
    const r = await fetch(url + '?t=' + Date.now());
    return r.ok ? r.json() : null;
  } catch {
    return null;
  }
}

function el(id) { return document.getElementById(id); }

function fmtUnits(n) {
  const v = parseFloat(n);
  if (isNaN(v)) return '—';
  return (v > 0 ? '+' : '') + v.toFixed(2) + 'u';
}

function fmtPct(v, digits = 1) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return (v * 100).toFixed(digits) + '%';
}

function badge(result) {
  const r = (result || '').toLowerCase();
  const map = {
    win: ['W', 'badge-win'],
    loss: ['L', 'badge-loss'],
    push: ['P', 'badge-push'],
    pending: ['…', 'badge-push'],
  };
  const [label, cls] = map[r] || ['—', 'badge-push'];
  return `<span class="badge ${cls}">${label}</span>`;
}

function fmtLine(line, market) {
  if (line === null || line === undefined) return '—';
  const n = parseFloat(line);
  if (market === 'spread') return (n > 0 ? '+' : '') + n;
  return String(n);
}

function fmtDate(iso) {
  if (!iso) return '—';
  return String(iso).replace('T', ' ').replace(/(\.\d+)?(\+00:00|Z)?$/, '').slice(0, 16) + ' UTC';
}

// ── Stat strip ───────────────────────────────────────────────────────────────

function renderSummary(s) {
  if (!s) return;

  const flags = s.flags || {};

  el('flags-made').textContent = flags.made ?? 0;

  const w = flags.wins || 0, l = flags.losses || 0, p = flags.pushes || 0;
  el('flag-record').textContent = `${w}-${l}${p > 0 ? `-${p}` : ''}`;

  const unitsEl = el('units-pnl');
  const units = parseFloat(flags.units_won) || 0;
  unitsEl.textContent = fmtUnits(units);
  unitsEl.className = 'stat-value ' + (units > 0 ? 'pos' : units < 0 ? 'neg' : '');

  el('pending-count').textContent = flags.pending ?? 0;

  el('last-updated').textContent = s.last_updated_utc ? `Updated ${fmtDate(s.last_updated_utc)}` : '';
}

// ── Picks table ──────────────────────────────────────────────────────────────

function renderPicks(picks) {
  const tbody = el('flags-table-body');
  const rows = (picks || []).filter(p => p.kind === 'flag');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-row">No picks yet.</td></tr>';
    return;
  }
  // newest game date first; pending (no result) above graded within a date
  rows.sort((a, b) => String(b.game_date || '').localeCompare(String(a.game_date || '')));
  tbody.innerHTML = rows.map(p => `
    <tr>
      <td>${p.game_date || '—'}</td>
      <td>${p.matchup || '—'}</td>
      <td>${(p.market || '—').toUpperCase()}</td>
      <td>${p.selection || '—'}</td>
      <td>${fmtLine(p.line, p.market)}</td>
      <td>${p.p !== null && p.p !== undefined ? fmtPct(p.p) : '—'}</td>
      <td>${p.units !== undefined && p.units !== null ? p.units + 'u' : '—'}</td>
      <td>${badge(p.result)}</td>
    </tr>`).join('');
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

async function init() {
  const [summary, picks] = await Promise.all([
    load('data/summary.json'),
    load('data/picks.json'),
  ]);
  renderSummary(summary);
  renderPicks(picks);
}

document.addEventListener('DOMContentLoaded', init);
setInterval(init, 5 * 60 * 1000);
