/* Saturdius — CFB paper-performance dashboard (no external dependencies) */

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
  const map = { win: ['W', 'badge-win'], loss: ['L', 'badge-loss'], push: ['P', 'badge-push'] };
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
  const leans = s.leans || {};
  const cal = s.calibration || {};

  el('flags-made').textContent = flags.made ?? 0;

  const w = flags.wins || 0, l = flags.losses || 0, p = flags.pushes || 0;
  el('flag-record').textContent = `${w}-${l}${p > 0 ? `-${p}` : ''}`;

  const unitsEl = el('units-pnl');
  const units = parseFloat(flags.units_won) || 0;
  unitsEl.textContent = fmtUnits(units);
  unitsEl.className = 'stat-value ' + (units > 0 ? 'pos' : units < 0 ? 'neg' : '');

  el('lean-count').textContent = leans.made ?? 0;

  const edgeEl = el('calib-edge');
  const edge = cal.overall_edge_vs_breakeven;
  if (edge === null || edge === undefined) {
    edgeEl.textContent = '—';
    edgeEl.className = 'stat-value';
  } else {
    edgeEl.textContent = (edge >= 0 ? '+' : '') + (edge * 100).toFixed(1) + 'pp';
    edgeEl.className = 'stat-value ' + (edge > 0 ? 'pos' : edge < 0 ? 'neg' : '');
  }

  el('last-updated').textContent = s.last_updated_utc ? `Updated ${fmtDate(s.last_updated_utc)}` : '';
}

// ── Calibration rows (no chart library — plain bar + tick) ─────────────────

function renderCalibration(cal) {
  const wrap = el('calibration-rows');
  const buckets = (cal && cal.buckets) || [];
  if (!buckets.length) {
    wrap.innerHTML = '<div class="empty-row">No graded picks yet.</div>';
    return;
  }

  wrap.innerHTML = buckets.map(b => {
    const realizedPct = b.realized_win_rate === null ? 0 : b.realized_win_rate * 100;
    const breakevenPct = b.breakeven_rate === null ? 0 : b.breakeven_rate * 100;
    const cls = (b.realized_win_rate === null) ? ''
      : (b.realized_win_rate >= b.breakeven_rate ? 'above' : 'below');
    const realizedStr = b.realized_win_rate === null ? 'n/a (all push)' : fmtPct(b.realized_win_rate);
    return `
      <div class="calib-row">
        <div class="calib-label">${b.bucket_label}</div>
        <div class="calib-track" title="realized ${realizedStr} vs break-even ${fmtPct(b.breakeven_rate)}">
          <div class="calib-fill ${cls}" style="width:${Math.min(realizedPct, 100)}%"></div>
          <div class="calib-tick" style="left:${Math.min(breakevenPct, 100)}%"></div>
        </div>
        <div class="calib-stats">n=${b.n} · ${realizedStr}</div>
      </div>`;
  }).join('');
}

// ── Picks tables ─────────────────────────────────────────────────────────────

function renderFlags(picks) {
  const tbody = el('flags-table-body');
  const flags = (picks || []).filter(p => p.kind === 'flag');
  if (!flags.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-row">No flags graded yet.</td></tr>';
    return;
  }
  tbody.innerHTML = flags.map(p => `
    <tr>
      <td>${fmtDate(p.graded_at_utc)}</td>
      <td>${p.matchup || '—'}</td>
      <td>${(p.market || '—').toUpperCase()}</td>
      <td>${p.selection || '—'}</td>
      <td>${fmtLine(p.line, p.market)}</td>
      <td>${p.p !== null && p.p !== undefined ? fmtPct(p.p) : '—'}</td>
      <td>${p.units !== undefined && p.units !== null ? p.units + 'u' : '—'}</td>
      <td>${badge(p.result)}</td>
    </tr>`).join('');
}

function renderLeans(picks) {
  const tbody = el('leans-table-body');
  const leans = (picks || []).filter(p => p.kind === 'lean');
  if (!leans.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-row">No leans graded yet.</td></tr>';
    return;
  }
  tbody.innerHTML = leans.slice(0, 30).map(p => `
    <tr>
      <td>${fmtDate(p.graded_at_utc)}</td>
      <td>${p.matchup || '—'}</td>
      <td>${(p.market || '—').toUpperCase()}</td>
      <td>${p.selection || '—'}</td>
      <td>${fmtLine(p.line, p.market)}</td>
      <td>${p.p !== null && p.p !== undefined ? fmtPct(p.p) : '—'}</td>
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
  renderCalibration(summary && summary.calibration);
  renderFlags(picks);
  renderLeans(picks);
}

document.addEventListener('DOMContentLoaded', init);
setInterval(init, 5 * 60 * 1000);
