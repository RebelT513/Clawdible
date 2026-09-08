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

function fmtOdds(odds, assumed) {
  if (odds === null || odds === undefined) return '—';
  const n = parseInt(odds, 10);
  if (isNaN(n)) return '—';
  return (n > 0 ? '+' + n : String(n)) + (assumed ? '*' : '');
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
    tbody.innerHTML = '<tr><td colspan="9" class="empty-row">No picks yet.</td></tr>';
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
      <td>${fmtOdds(p.odds, p.odds_is_assumed)}</td>
      <td>${p.p !== null && p.p !== undefined ? fmtPct(p.p) : '—'}</td>
      <td>${p.units !== undefined && p.units !== null ? p.units + 'u' : '—'}</td>
      <td>${badge(p.result)}</td>
    </tr>`).join('');
}

// ── Units-over-time chart (hand-rolled SVG — no external chart library) ────
//
// Visual pattern matches the MLB dashboard's Chart.js "Cumulative P&L" chart
// (Clawdius, dashboard/app.js#renderPnlChart): a filled line colored green/red
// by the sign of the ending value, a dashed zero/break-even reference line,
// light gridlines, and a hover tooltip. Hand-rolled here because the CFB
// dashboard may not pull in a CDN library (CLAUDE.md 9 / no external resources).

const CHART_COLOR_GOOD = '#3fb950';
const CHART_COLOR_CRITICAL = '#f85149';
const CHART_COLOR_MUTED = '#8b949e';
const CHART_PAD = { top: 12, right: 14, bottom: 22, left: 46 };

function profitPerStake(odds) {
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}

function fmtUnitsShort(v) {
  const n = parseFloat(v) || 0;
  return (n > 0 ? '+' : '') + n.toFixed(1) + 'u';
}

function fmtDateShort(d) {
  if (!d) return '';
  const parts = String(d).split('-');
  if (parts.length === 3) return `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`;
  return String(d);
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Cumulative units series — same math as summary.flags.units_won (odds_math
// .profit_per_stake): +units*profit(odds) on win, -units on loss, 0 on push.
// Grouped by game_date (not per-pick) so multiple same-day picks collapse to
// one x-axis point, per spec. A synthetic {cum:0} point is prepended before
// the first date so a single graded date still draws a visible segment
// (0 -> ending value) instead of a lone dot.
function computeUnitsSeries(picks) {
  const graded = (picks || []).filter(p => p.kind === 'flag' &&
    ['win', 'loss', 'push'].includes(String(p.result || '').toLowerCase()));
  if (!graded.length) return null;

  const byDate = new Map();
  for (const p of graded) {
    const d = p.game_date || '—';
    const stake = parseFloat(p.units) || 0;
    const result = String(p.result).toLowerCase();
    const odds = parseFloat(p.odds);
    let delta = 0;
    if (result === 'win') delta = stake * profitPerStake(isNaN(odds) ? -110 : odds);
    else if (result === 'loss') delta = -stake;
    byDate.set(d, (byDate.get(d) || 0) + delta);
  }

  const dates = [...byDate.keys()].sort();
  let running = 0;
  const points = [{ x: 0, date: null, cum: 0, isStart: true }];
  dates.forEach((d, i) => {
    running += byDate.get(d);
    points.push({ x: i + 1, date: d, cum: parseFloat(running.toFixed(4)), isStart: false });
  });
  return points;
}

// Endpoint cross-check: the curve's final cumulative value must equal
// summary.flags.units_won (both derive from the same vig-aware formula).
// A mismatch means the two computations drifted apart — surface it loudly
// rather than silently rendering a wrong-looking curve.
function verifyUnitsEndpoint(curveEnd, summary) {
  const expected = parseFloat(summary && summary.flags && summary.flags.units_won);
  if (isNaN(expected)) return;
  const drift = Math.abs(curveEnd - expected);
  if (drift > 0.01) {
    console.warn(
      `[units-chart] endpoint mismatch: chart=${curveEnd.toFixed(2)}u ` +
      `summary.flags.units_won=${expected.toFixed(2)}u (drift ${drift.toFixed(4)}u)`
    );
  } else {
    console.debug(`[units-chart] endpoint check OK: ${curveEnd.toFixed(2)}u matches summary.`);
  }
}

let _unitsResizeHandler = null;
let _lastUnitsPoints = null;

function drawUnitsChart(wrap, points) {
  const width = Math.max(wrap.clientWidth || 0, 280);
  const height = wrap.clientHeight || 240;
  const { top, right, bottom, left } = CHART_PAD;
  const innerW = width - left - right;
  const innerH = height - top - bottom;
  const n = points.length;

  const values = points.map(p => p.cum);
  let yMin = Math.min(0, ...values);
  let yMax = Math.max(0, ...values);
  if (yMin === yMax) { yMin -= 1; yMax += 1; }
  const yPad = (yMax - yMin) * 0.18 || 1;
  yMin -= yPad; yMax += yPad;

  const xFor = i => left + (n <= 1 ? innerW / 2 : (innerW * i) / (n - 1));
  const yFor = v => top + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

  const finalCum = points[n - 1].cum;
  const finalPositive = finalCum >= 0;
  const lineColor = finalPositive ? CHART_COLOR_GOOD : CHART_COLOR_CRITICAL;

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(p.x).toFixed(2)} ${yFor(p.cum).toFixed(2)}`).join(' ');
  const zeroY = yFor(0);
  const areaPath = `${linePath} L ${xFor(points[n - 1].x).toFixed(2)} ${zeroY.toFixed(2)} ` +
                    `L ${xFor(points[0].x).toFixed(2)} ${zeroY.toFixed(2)} Z`;

  // Horizontal gridlines + y-axis tick labels
  const gridCount = 4;
  let gridLines = '';
  let axisLabelsY = '';
  for (let i = 0; i <= gridCount; i++) {
    const v = yMin + ((yMax - yMin) * i) / gridCount;
    const y = yFor(v);
    gridLines += `<line class="chart-gridline" x1="${left}" y1="${y.toFixed(2)}" x2="${(width - right).toFixed(2)}" y2="${y.toFixed(2)}" />`;
    axisLabelsY += `<text class="chart-axis-label" x="${left - 8}" y="${(y + 3).toFixed(2)}" text-anchor="end">${fmtUnitsShort(v)}</text>`;
  }

  // X-axis date labels, decimated so they never overlap at mobile widths
  const maxLabels = width < 420 ? 3 : width < 700 ? 5 : 8;
  const realPoints = points.filter(p => !p.isStart);
  const step = Math.max(1, Math.ceil(realPoints.length / maxLabels));
  let axisLabelsX = '';
  realPoints.forEach((p, i) => {
    if (i % step !== 0 && i !== realPoints.length - 1) return;
    axisLabelsX += `<text class="chart-axis-label" x="${xFor(p.x).toFixed(2)}" y="${height - 4}" text-anchor="middle">${fmtDateShort(p.date)}</text>`;
  });

  const showDots = n <= 40;
  const dots = showDots ? points.map((p, i) => {
    const r = p.isStart ? 2.5 : 3.5;
    const fill = p.isStart ? CHART_COLOR_MUTED : lineColor;
    return `<circle class="chart-point" cx="${xFor(p.x).toFixed(2)}" cy="${yFor(p.cum).toFixed(2)}" r="${r}" fill="${fill}" data-idx="${i}" />`;
  }).join('') : '';

  wrap.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img"
         aria-label="Cumulative units over time, ending at ${fmtUnitsShort(finalCum)}">
      <defs>
        <linearGradient id="units-area-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${lineColor}" stop-opacity="0.22" />
          <stop offset="100%" stop-color="${lineColor}" stop-opacity="0" />
        </linearGradient>
      </defs>
      ${gridLines}
      <line class="chart-zeroline" x1="${left}" y1="${zeroY.toFixed(2)}" x2="${(width - right).toFixed(2)}" y2="${zeroY.toFixed(2)}" />
      <path class="chart-area" d="${areaPath}" fill="url(#units-area-grad)" />
      <path class="chart-line" d="${linePath}" stroke="${lineColor}" />
      ${dots}
      ${axisLabelsY}
      ${axisLabelsX}
      <line class="chart-crosshair" id="units-crosshair" x1="${left}" y1="${top}" x2="${left}" y2="${top + innerH}" style="display:none" />
    </svg>
    <div class="chart-tooltip" id="units-tooltip"></div>`;

  attachUnitsHover(wrap, points, xFor, yFor);
}

function attachUnitsHover(wrap, points, xFor, yFor) {
  const svg = wrap.querySelector('svg');
  const crosshair = wrap.querySelector('#units-crosshair');
  const tooltip = wrap.querySelector('#units-tooltip');
  if (!svg || !tooltip || !crosshair) return;

  function nearestPoint(clientX) {
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const scaleX = rect.width ? vb.width / rect.width : 1;
    const localX = (clientX - rect.left) * scaleX;
    let nearest = points[0], best = Infinity;
    for (const p of points) {
      const d = Math.abs(xFor(p.x) - localX);
      if (d < best) { best = d; nearest = p; }
    }
    return { nearest, rect, vb };
  }

  function showAt(clientX, clientY) {
    const { nearest, rect, vb } = nearestPoint(clientX);
    const px = xFor(nearest.x), py = yFor(nearest.cum);
    crosshair.setAttribute('x1', px); crosshair.setAttribute('x2', px);
    crosshair.style.display = '';

    const cls = nearest.cum > 0 ? 'pos' : nearest.cum < 0 ? 'neg' : 'neu';
    const label = nearest.isStart ? 'Start' : nearest.date;
    tooltip.innerHTML = `<div class="tt-date">${label}</div><div class="tt-value ${cls}">${fmtUnits(nearest.cum)}</div>`;

    const scaleX = rect.width / vb.width, scaleY = rect.height / vb.height;
    const wrapRect = wrap.getBoundingClientRect();
    tooltip.style.left = (rect.left - wrapRect.left + px * scaleX) + 'px';
    tooltip.style.top = (rect.top - wrapRect.top + py * scaleY) + 'px';
    tooltip.classList.add('visible');
  }

  function hide() {
    crosshair.style.display = 'none';
    tooltip.classList.remove('visible');
  }

  svg.addEventListener('mousemove', e => showAt(e.clientX, e.clientY));
  svg.addEventListener('mouseleave', hide);
  svg.addEventListener('touchstart', e => { if (e.touches[0]) showAt(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
  svg.addEventListener('touchmove', e => { if (e.touches[0]) showAt(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
  svg.addEventListener('touchend', hide);
}

function renderUnitsChart(picks, summary) {
  const wrap = el('units-chart-wrap');
  const legend = el('units-chart-legend');
  const card = el('units-chart-card');
  if (!wrap) return;

  const points = computeUnitsSeries(picks);
  if (!points || points.length < 2) {
    wrap.innerHTML = '<div class="chart-empty" id="units-chart-empty">No graded picks yet.</div>';
    if (legend) legend.style.display = 'none';
    _lastUnitsPoints = null;
    return;
  }

  if (legend) legend.style.display = '';
  const lineSwatch = legend ? legend.querySelector('.swatch-line') : null;
  if (lineSwatch) {
    lineSwatch.style.borderTopColor = points[points.length - 1].cum >= 0 ? CHART_COLOR_GOOD : CHART_COLOR_CRITICAL;
  }

  verifyUnitsEndpoint(points[points.length - 1].cum, summary);

  _lastUnitsPoints = points;
  drawUnitsChart(wrap, points);

  if (!_unitsResizeHandler) {
    _unitsResizeHandler = debounce(() => {
      if (_lastUnitsPoints) drawUnitsChart(wrap, _lastUnitsPoints);
    }, 150);
    window.addEventListener('resize', _unitsResizeHandler);
  }
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

async function init() {
  const [summary, picks] = await Promise.all([
    load('data/summary.json'),
    load('data/picks.json'),
  ]);
  renderSummary(summary);
  renderUnitsChart(picks, summary);
  renderPicks(picks);
}

document.addEventListener('DOMContentLoaded', init);
setInterval(init, 5 * 60 * 1000);
