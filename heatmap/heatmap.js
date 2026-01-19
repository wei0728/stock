// Heatmap page: Fast 1..256 x Slow 1..256 using MA-cross simulator logic + Fee/Tax

let stockNames = [];
let stockSeries = {}; // name -> prices[]
let dates = [];
let selectedStock = null;
let priceSeries = [];

// ---------- CSV load (same format as multistocks.csv in your project) ----------
async function loadCSV() {
  const resp = await fetch('../multistocks.csv');
  if (!resp.ok) throw new Error('multistocks.csv not found');
  const text = await resp.text();
  parseMultiStockCSV(text);
  populateStockSelect();
  bindDateDefaults();
}

function parseMultiStockCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return;
  const header = lines[0].split(',').map(s => s.trim());
  stockNames = header.slice(1);
  stockSeries = {};
  stockNames.forEach(n => (stockSeries[n] = []));
  dates = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 2) continue;
    dates.push(cols[0].trim());
    for (let j = 1; j < cols.length && j <= stockNames.length; j++) {
      const name = stockNames[j - 1];
      const v = parseFloat(cols[j]);
      stockSeries[name].push(Number.isFinite(v) ? v : NaN);
    }
  }
  if (stockNames.length) {
    selectedStock = stockNames[0];
    priceSeries = stockSeries[selectedStock];
  }
}

function populateStockSelect() {
  const sel = document.getElementById('stockSelect');
  sel.innerHTML = '';
  stockNames.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  });
  sel.value = selectedStock || '';
  sel.addEventListener('change', () => {
    selectedStock = sel.value;
    priceSeries = stockSeries[selectedStock] || [];
    // reset caches when stock changes
    resetMACache();
  });
}

function bindDateDefaults() {
  const startEl = document.getElementById('simStartDate');
  const endEl = document.getElementById('simEndDate');
  if (!startEl || !endEl || !dates.length) return;

  // NOTE: <input type="date"> only accepts YYYY-MM-DD.
  const toISO = normalizeToISODate;

  // default: last ~1 year if possible
  endEl.value = toISO(dates[dates.length - 1]);
  const back = Math.max(0, dates.length - 260);
  startEl.value = toISO(dates[back]);
}

 // ---------- Date helpers ----------

// In your multistocks.csv, dates may be 'YYYY/MM/DD', 'M/D/YYYY', etc.
// <input type="date"> needs 'YYYY-MM-DD', and your stock.html uses a robust dateToIndex().
// Below is the same idea: try multiple formats + fallback to nearest match.

function pad2(n) { return String(n).padStart(2, '0'); }

function normalizeToISODate(dtStr) {
  if (!dtStr) return '';
  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}$/.test(dtStr)) return dtStr;

  // YYYY/MM/DD or YYYY/M/D
  let m = dtStr.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;

  // M/D/YYYY or MM/DD/YYYY
  m = dtStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${pad2(m[1])}-${pad2(m[2])}`;

  // Fallback: Date parse (use local date fields to avoid TZ shifts)
  const d = new Date(dtStr);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  return '';
}

function dateToIndex(htmlDate) {
  if (!htmlDate) return -1;

  // 1) direct match (in case your dates already store ISO)
  let idx = dates.indexOf(htmlDate);
  if (idx !== -1) return idx;

  // 2) Expand formats like stock.html does (htmlDate is YYYY-MM-DD)
  const parts = htmlDate.split('-');
  if (parts.length < 3) return -1;

  const y = parts[0];
  const mm = parts[1];
  const dd = parts[2];

  const m = String(parseInt(mm, 10));
  const d = String(parseInt(dd, 10));

  // M/D/YYYY
  idx = dates.indexOf(`${m}/${d}/${y}`);
  if (idx !== -1) return idx;

  // MM/DD/YYYY
  idx = dates.indexOf(`${mm}/${dd}/${y}`);
  if (idx !== -1) return idx;

  // YYYY/MM/DD
  idx = dates.indexOf(`${y}/${mm}/${dd}`);
  if (idx !== -1) return idx;

  // YYYY/M/D
  idx = dates.indexOf(`${y}/${m}/${d}`);
  if (idx !== -1) return idx;

  // 3) As a final attempt: compare Date()'s day equality
  const pick = new Date(htmlDate);
  idx = dates.findIndex(dt => {
    const dp = new Date(dt);
    return !isNaN(dp.getTime()) && dp.toDateString() === pick.toDateString();
  });
  return idx;
}

function nearestDateIndex(htmlDate) {
  if (!htmlDate) return -1;
  const t = new Date(htmlDate);
  if (isNaN(t.getTime())) return -1;

  let best = -1;
  let bestDiff = Infinity;

  for (let i = 0; i < dates.length; i++) {
    const di = new Date(dates[i]);
    if (isNaN(di.getTime())) continue;
    const diff = Math.abs(di.getTime() - t.getTime());
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return best;
}

function toIndexOrDefault(htmlDate, defIdx) {
  if (!htmlDate) return defIdx;
  let idx = dateToIndex(htmlDate);
  if (idx === -1) idx = nearestDateIndex(htmlDate);
  return idx === -1 ? defIdx : idx;
}

// ---------- Fee / Tax params ----------
function numFrom(id, fallback) {
  const el = document.getElementById(id);
  const v = el ? parseFloat(el.value) : NaN;
  return Number.isFinite(v) ? v : fallback;
}

// Default values (same as script.js)
const DEFAULT_SIM_FEE_RATE = 0.001425;  // brokerage fee rate (buy & sell)
const DEFAULT_SIM_FEE_MIN  = 0.0;       // minimum fee per trade
const DEFAULT_SIM_FEE_MAX  = 1e100;     // cap (usually not needed)

const DEFAULT_SIM_TAX_RATE = 0.0;       // transaction tax rate (usually sell-only)
const DEFAULT_SIM_TAX_MIN  = 0.0;
const DEFAULT_SIM_TAX_MAX  = 1e100;

// Read simulator fee/tax parameters from navbar inputs (if they exist).
// IDs (same as script.js): simFeeRate, simFeeMin, simFeeMax, simFeeDiscount, simTaxRate, simTaxMin, simTaxMax
function getSimFeeTaxParams() {
  const feeRateEl = document.getElementById("simFeeRate");
  const feeMinEl  = document.getElementById("simFeeMin");
  const feeMaxEl  = document.getElementById("simFeeMax");
  const feeDiscEl = document.getElementById("simFeeDiscount"); // optional (e.g. 0.6)

  const taxRateEl = document.getElementById("simTaxRate");
  const taxMinEl  = document.getElementById("simTaxMin");
  const taxMaxEl  = document.getElementById("simTaxMax");

  let feeRate = parseFloat(feeRateEl?.value);
  let feeMin  = parseFloat(feeMinEl?.value);
  let feeMax  = parseFloat(feeMaxEl?.value);
  let feeDisc = parseFloat(feeDiscEl?.value);

  let taxRate = parseFloat(taxRateEl?.value);
  let taxMin  = parseFloat(taxMinEl?.value);
  let taxMax  = parseFloat(taxMaxEl?.value);

  if (!Number.isFinite(feeRate) || feeRate < 0) feeRate = DEFAULT_SIM_FEE_RATE;
  if (!Number.isFinite(feeMin)  || feeMin < 0)  feeMin  = DEFAULT_SIM_FEE_MIN;
  if (!Number.isFinite(feeMax)  || feeMax <= 0) feeMax  = DEFAULT_SIM_FEE_MAX;

  // optional discount multiplier
  if (Number.isFinite(feeDisc) && feeDisc > 0) feeRate *= feeDisc;

  if (!Number.isFinite(taxRate) || taxRate < 0) taxRate = DEFAULT_SIM_TAX_RATE;
  if (!Number.isFinite(taxMin)  || taxMin < 0)  taxMin  = DEFAULT_SIM_TAX_MIN;
  if (!Number.isFinite(taxMax)  || taxMax <= 0) taxMax  = DEFAULT_SIM_TAX_MAX;

  return { feeRate, feeMin, feeMax, taxRate, taxMin, taxMax };
}

function clamp(x, lo, hi) {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

// Calculate fee for a trade amount. (same logic as script.js)
function calcFee(tradeAmount, feeRate, minFee, maxFee) {
  if (!Number.isFinite(tradeAmount) || tradeAmount <= 0) return 0;
  let fee = tradeAmount * feeRate;
  if (Number.isFinite(minFee)) fee = Math.max(minFee, fee);
  if (Number.isFinite(maxFee)) fee = Math.min(maxFee, fee);
  return fee;
}

// Calculate tax for a trade amount (typically sell-only). (same logic as script.js)
function calcTax(tradeAmount, taxRate, minTax, maxTax) {
  if (!Number.isFinite(tradeAmount) || tradeAmount <= 0) return 0;
  let tax = tradeAmount * taxRate;
  if (Number.isFinite(minTax)) tax = Math.max(minTax, tax);
  if (Number.isFinite(maxTax)) tax = Math.min(maxTax, tax);
  return tax;
}

// Given current cash & price, find max shares you can buy after including fee. (same as script.js)
function maxBuySharesWithFee(cash, price, feeRate, feeMin, feeMax) {
  if (!Number.isFinite(cash) || cash <= 0) return 0;
  if (!Number.isFinite(price) || price <= 0) return 0;

  let hi = Math.floor(cash / price);
  if (hi <= 0) return 0;

  let lo = 0;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    const amount = mid * price;
    const fee = calcFee(amount, feeRate, feeMin, feeMax);
    const cost = amount + fee;
    if (cost <= cash + 1e-12) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// ---------- MA caches (compute O(256 * N) per type) ----------

let maCache = { MA: null, WMA: null, EMA: null };
let maCacheN = 0;

function resetMACache() {
  maCache = { MA: null, WMA: null, EMA: null };
  maCacheN = 0;
}

function ensureMACache(type) {
  const N = priceSeries.length;
  if (maCacheN !== N) {
    resetMACache();
  }
  if (maCache[type]) return;

  // maCache[type][p] = Float64Array(N)
  const out = Array(256);
  // period 0 unused
  out[0] = null;

  if (type === 'MA') {
    // SMA via prefix sum
    const ps = new Float64Array(N + 1);
    const nan = new Uint32Array(N + 1);
    ps[0] = 0;
    nan[0] = 0;
    for (let i = 0; i < N; i++) {
      const v = priceSeries[i];
      const ok = Number.isFinite(v);
      ps[i + 1] = ps[i] + (ok ? v : 0);
      nan[i + 1] = nan[i] + (ok ? 0 : 1);
    }
    for (let p = 1; p <= 256; p++) {
      const arr = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        if (i < p - 1) { arr[i] = NaN; continue; }
        // if window contains NaN => NaN (O(1) check)
        const nanCnt = nan[i + 1] - nan[i + 1 - p];
        if (nanCnt !== 0) { arr[i] = NaN; continue; }
        const sum = ps[i + 1] - ps[i + 1 - p];
        arr[i] = sum / p;
      }
      out[p] = arr;
    }
  } else if (type === 'WMA') {
    for (let p = 1; p <= 256; p++) {
      const arr = new Float64Array(N);
      const denom = (p * (p + 1)) / 2;
      let sum = 0;
      let wsum = 0;
      // init first window end at i = p-1
      for (let i = 0; i < N; i++) arr[i] = NaN;
      if (p - 1 >= N) { out[p] = arr; continue; }

      sum = 0; wsum = 0;
      let ok = true;
      for (let k = 0; k < p; k++) {
        const v = priceSeries[k];
        if (!Number.isFinite(v)) { ok = false; break; }
        sum += v;
        wsum += (k + 1) * v;
      }
      if (ok) arr[p - 1] = wsum / denom;

      for (let i = p; i < N; i++) {
        const outV = priceSeries[i - p];
        const inV = priceSeries[i];
        if (!Number.isFinite(outV) || !Number.isFinite(inV)) {
          // if NaN enters/leaves, recompute window robustly
          ok = true; sum = 0; wsum = 0;
          for (let k = i - p + 1, w = 1; k <= i; k++, w++) {
            const v = priceSeries[k];
            if (!Number.isFinite(v)) { ok = false; break; }
            sum += v;
            wsum += w * v;
          }
          arr[i] = ok ? (wsum / denom) : NaN;
          continue;
        }
        // roll: weights shift down by 1
        // new_wsum = old_wsum - sum + p*inV
        wsum = wsum - sum + p * inV;
        sum = sum - outV + inV;
        arr[i] = wsum / denom;
      }
      out[p] = arr;
    }
  } else if (type === 'EMA') {
    for (let p = 1; p <= 256; p++) {
      const arr = new Float64Array(N);
      for (let i = 0; i < N; i++) arr[i] = NaN;
      if (p - 1 >= N) { out[p] = arr; continue; }

      const alpha = 2 / (p + 1);
      // seed with SMA at index p-1
      let sum = 0;
      let ok = true;
      for (let k = 0; k < p; k++) {
        const v = priceSeries[k];
        if (!Number.isFinite(v)) { ok = false; break; }
        sum += v;
      }
      if (!ok) { out[p] = arr; continue; }
      let run = sum / p;
      arr[p - 1] = run;
      for (let i = p; i < N; i++) {
        const v = priceSeries[i];
        if (!Number.isFinite(v)) { run = NaN; arr[i] = NaN; continue; }
        if (!Number.isFinite(run)) {
          // re-seed if run is NaN: try SMA of last p values
          ok = true; sum = 0;
          for (let k = i - p + 1; k <= i; k++) {
            const vv = priceSeries[k];
            if (!Number.isFinite(vv)) { ok = false; break; }
            sum += vv;
          }
          if (!ok) { arr[i] = NaN; continue; }
          run = sum / p;
          arr[i] = run;
          continue;
        }
        run = run * (1 - alpha) + v * alpha;
        arr[i] = run;
      }
      out[p] = arr;
    }
  }

  maCache[type] = out;
  maCacheN = N;
}

// ---------- Core simulator for a (fast, slow) pair ----------
function simulatePair(fast, slow, opts) {
  const N = priceSeries.length;
  if (!N) return NaN;
  if (!(fast >= 1 && fast <= 256 && slow >= 1 && slow <= 256)) return NaN;
  if (opts.onlyUpper && slow <= fast) return NaN;

  ensureMACache(opts.maType);
  const fastArr = maCache[opts.maType][fast];
  const slowArr = maCache[opts.maType][slow];
  if (!fastArr || !slowArr) return NaN;

  let cash = opts.fund;
  let shares = 0;

  const from = opts.from;
  const to = opts.to;
  const fillNext = (opts.fillMode === 'nextClose');

  const feeRate = opts.fee.feeRate;
  const feeMin  = opts.fee.feeMin;
  const feeMax  = opts.fee.feeMax;
  const taxRate = opts.fee.taxRate;
  const taxMin  = opts.fee.taxMin;
  const taxMax  = opts.fee.taxMax;

  for (let i = from + 1; i <= to; i++) {
    const f0 = fastArr[i - 1], s0 = slowArr[i - 1];
    const f1 = fastArr[i],     s1 = slowArr[i];
    if (!Number.isFinite(f0) || !Number.isFinite(s0) || !Number.isFinite(f1) || !Number.isFinite(s1)) continue;

    const d0 = f0 - s0;
    const d1 = f1 - s1;

    const golden = (d0 < 0 && d1 > 0);
    const death  = (d0 > 0 && d1 < 0);

    if (shares > 0 && death) {
      const fi = fillNext ? ((i + 1 <= to) ? (i + 1) : -1) : i;
      if (fi === -1) continue;
      const px = priceSeries[fi];
      if (!Number.isFinite(px)) continue;
      const amount = shares * px;
      const fee = calcFee(amount, feeRate, feeMin, feeMax);
      const tax = calcTax(amount, taxRate, taxMin, taxMax);
      cash += (amount - fee - tax);
      shares = 0;
      continue;
    }

    if (shares === 0 && golden) {
      const fi = fillNext ? ((i + 1 <= to) ? (i + 1) : -1) : i;
      if (fi === -1) continue;
      const px = priceSeries[fi];
      if (!Number.isFinite(px)) continue;
      const canBuy = maxBuySharesWithFee(cash, px, feeRate, feeMin, feeMax);
      if (canBuy > 0) {
        const amount = canBuy * px;
        const fee = calcFee(amount, feeRate, feeMin, feeMax);
        cash -= (amount + fee);
        shares = canBuy;
      }
    }
  }

  // FORCE CLOSE at end of range: if still holding shares, sell at the last bar close (index `to`)
// This keeps NAV consistent with "must be flat at the end" backtests and makes results comparable to script.js.
if (shares > 0) {
  const fi = to; // force close uses the last available close; no nextClose beyond `to`
  const sellPx = priceSeries[fi];
  if (Number.isFinite(sellPx)) {
    const amount = shares * sellPx;
    const fee = calcFee(amount, feeRate, feeMin, feeMax);
    const tax = calcTax(amount, taxRate, taxMin, taxMax);
    cash += (amount - fee - tax);
    shares = 0;
  }
}

const lastPx = priceSeries[to];
const nav = cash + (shares > 0 && Number.isFinite(lastPx) ? shares * lastPx : 0);
if (opts.metric === 'nav') return nav;
return (nav - opts.fund) / opts.fund * 100;
}

// ---------- Heatmap rendering ----------
const canvas = document.getElementById('hmCanvas');
const ctx = canvas.getContext('2d');
const legend = document.getElementById('hmLegend');
const lctx = legend.getContext('2d');
const tip = document.getElementById('hmTip');
const wrap = document.getElementById('hmCanvasWrap');

let grid = new Float32Array(256 * 256);
let gridMin = NaN, gridMax = NaN;
let lastCSV = '';

function colorFor(t) {
  // t in [0,1]; simple perceptual-ish gradient (blue -> cyan -> green -> yellow -> red)
  t = Math.max(0, Math.min(1, t));
  const stops = [
    [0.00,  20,  40, 160],
    [0.25,  20, 190, 240],
    [0.50,  40, 220, 120],
    [0.75, 240, 210,  80],
    [1.00, 240,  70,  90],
  ];
  let a = stops[0], b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i][0] && t <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; break; }
  }
  const u = (t - a[0]) / (b[0] - a[0] || 1);
  const r = (a[1] + (b[1] - a[1]) * u) | 0;
  const g = (a[2] + (b[2] - a[2]) * u) | 0;
  const bl = (a[3] + (b[3] - a[3]) * u) | 0;
  return [r, g, bl, 256];
}

function drawLegend(minV, maxV) {
  lctx.clearRect(0,0,legend.width, legend.height);
  const h = legend.height;
  const w = legend.width;
  const img = lctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const t = 1 - (y / (h - 1));
    const c = colorFor(t);
    for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4;
      img.data[k] = c[0];
      img.data[k+1] = c[1];
      img.data[k+2] = c[2];
      img.data[k+3] = 256;
    }
  }
  lctx.putImageData(img, 0, 0);
  document.getElementById('hmMin').textContent = Number.isFinite(minV) ? minV.toFixed(2) : '—';
  document.getElementById('hmMax').textContent = Number.isFinite(maxV) ? maxV.toFixed(2) : '—';
}

function renderHeatmap() {
  const img = ctx.createImageData(256, 256);
  const minV = gridMin, maxV = gridMax;
  // 交換軸：x 軸=fast, y 軸=slow
  for (let sy = 1; sy <= 256; sy++) {  // slow, y 軸
    for (let fx = 1; fx <= 256; fx++) {  // fast, x 軸
      const idx = (fx - 1) * 256 + (sy - 1);
      const v = grid[idx];
      // 反轉 y 軸：從 256~1 改為 1~256
      const py = 256 - sy;
      const px = fx - 1;
      const p = (py * 256 + px) * 4;
      if (!Number.isFinite(v) || !Number.isFinite(minV) || !Number.isFinite(maxV) || maxV === minV) {
        img.data[p] = 0; img.data[p+1] = 0; img.data[p+2] = 0; img.data[p+3] = 0;
        continue;
      }
      const t = (v - minV) / (maxV - minV);
      const c = colorFor(t);
      img.data[p] = c[0];
      img.data[p+1] = c[1];
      img.data[p+2] = c[2];
      img.data[p+3] = 256;
    }
  }
  heatmapReady = true;                 // ✅ 新增
  const imgBtn = document.getElementById('hmDownloadImg');
  if (imgBtn) imgBtn.disabled = false; // ✅ 新增
  ctx.putImageData(img, 0, 0);
  drawLegend(minV, maxV);
}

function buildCSV() {
  // CSV: rows = fast (1..256), cols = slow (1..256)
  const lines = [];
  const header = ['fast\\slow'];
  for (let s = 1; s <= 256; s++) header.push(String(s));
  lines.push(header.join(','));
  for (let f = 1; f <= 256; f++) {
    const row = [String(f)];
    for (let s = 1; s <= 256; s++) {
      const v = grid[(f - 1) * 256 + (s - 1)];
      row.push(Number.isFinite(v) ? String(v) : '');
    }
    lines.push(row.join(','));
  }
  return lines.join('\n');
}

function setProgress(on, text, pct) {
  const t = document.getElementById('hmProgressText');
  const b = document.getElementById('hmProgressBar');
  const f = document.getElementById('hmProgressFill');
  if (!t || !b || !f) return;
  t.style.display = on ? 'block' : 'none';
  b.style.display = on ? 'block' : 'none';
  if (on) {
    t.textContent = text;
    f.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }
}

async function generateHeatmap() {
  if (!priceSeries.length || !dates.length) return;


  const fund = Math.max(0, numFrom('simFund', 100000));
  const fillMode = document.getElementById('simFill')?.value || 'signalClose';
  const maType = document.getElementById('hmMAType')?.value || 'MA';
  const metric = document.getElementById('hmMetric')?.value || 'roi';
  const onlyUpper = (document.getElementById('hmOnlyUpper')?.value || '1') === '1';

  const startIdx = toIndexOrDefault(document.getElementById('simStartDate')?.value, 0);
  const endIdx = toIndexOrDefault(document.getElementById('simEndDate')?.value, dates.length - 1);
  const from = Math.max(0, Math.min(startIdx, endIdx));
  const to = Math.min(dates.length - 1, Math.max(startIdx, endIdx));

  const fee = getSimFeeTaxParams();

  // make sure MA cache computed once
  ensureMACache(maType);

  grid = new Float32Array(256 * 256);
  grid.fill(NaN);
  gridMin = NaN; gridMax = NaN;

  const runBtn = document.getElementById('hmRun');
  const dlBtn = document.getElementById('hmDownload');
  const imgBtn = document.getElementById('hmDownloadImg');

  heatmapReady = false;           // ✅ 新增
  if (runBtn) runBtn.disabled = true;
  if (dlBtn) dlBtn.disabled = true;
  if (imgBtn) imgBtn.disabled = true;  // ✅ 新增

  const total = 256 * 256;
  let done = 0;

  setProgress(true, 'Computing…', 0);

  // chunked loop to keep UI responsive
  for (let f = 1; f <= 256; f++) {
    // compute one fast-row per frame
    await new Promise(requestAnimationFrame);

    for (let s = 1; s <= 256; s++) {
      const v = simulatePair(f, s, {
        fund,
        from, to,
        fillMode,
        maType,
        metric,
        onlyUpper,
        fee
      });
      const idx = (f - 1) * 256 + (s - 1);
      grid[idx] = Number.isFinite(v) ? v : NaN;
      if (Number.isFinite(v)) {
        if (!Number.isFinite(gridMin) || v < gridMin) gridMin = v;
        if (!Number.isFinite(gridMax) || v > gridMax) gridMax = v;
      }
      done++;
    }

    if (f % 4 === 0) {
      setProgress(true, `Computing… (fast=${f}/256)`, (done / total) * 100);
    }
  }

  setProgress(true, 'Rendering…', 100);
  renderHeatmap();
  lastCSV = buildCSV();

  setProgress(false, '', 0);
  if (runBtn) runBtn.disabled = false;
  if (dlBtn) dlBtn.disabled = false;
}

// ---------- Pick (fast, slow) on click ----------
let pickedFast = null;
let pickedSlow = null;
let heatmapReady = false;

function getFastSlowFromMouseEvent(e) {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  // 你的 tooltip 算法：x=fast, y=slow 且 y 反轉
  const fx = Math.floor((x / rect.width) * 256) + 1;
  const sy = 256 - Math.floor((y / rect.height) * 256);

  if (fx < 1 || fx > 256 || sy < 1 || sy > 256) return null;
  return { fast: fx, slow: sy };
}


// ---------- Tooltip ----------
function attachTooltip() {
  wrap.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // 交換軸：x=fast, y=slow
    const fx = Math.floor((x / rect.width) * 256) + 1;
    // 反轉 y 軸：從底部開始算起
    const sy = 256 - Math.floor((y / rect.height) * 256);
    if (fx < 1 || fx > 256 || sy < 1 || sy > 256) { tip.style.opacity = 0; return; }

    const v = grid[(fx - 1) * 256 + (sy - 1)];
    const metric = document.getElementById('hmMetric')?.value || 'roi';
    const vStr = Number.isFinite(v)
      ? (metric === 'roi' ? `${v.toFixed(2)}%` : v.toFixed(2))
      : '—';

    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
    tip.style.opacity = 1;
    tip.textContent = `fast=${fx}, slow=${sy} → ${vStr}`;
  });
  wrap.addEventListener('mouseleave', () => { tip.style.opacity = 0; });

}

// ---------- Download CSV ----------
function downloadCSV() {
  const blob = new Blob([lastCSV], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `heatmap_${selectedStock || 'stock'}_${document.getElementById('hmMAType')?.value || 'MA'}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function sanitizeFilePart(s) {
  // Windows 不允許 \ / : * ? " < > |
  return String(s || '')
    .replace(/[\\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .trim();
}

function buildImageName(fast, slow) {
  const stock = sanitizeFilePart(selectedStock || 'stock');
  const ma = sanitizeFilePart(document.getElementById('hmMAType')?.value || 'MA');
  const metric = sanitizeFilePart(document.getElementById('hmMetric')?.value || 'roi');
  const fillMode = sanitizeFilePart(document.getElementById('simFill')?.value || 'signalClose');
  const fund = sanitizeFilePart(document.getElementById('simFund')?.value || '100000');

  const start = sanitizeFilePart(document.getElementById('simStartDate')?.value || 'NA');
  const end = sanitizeFilePart(document.getElementById('simEndDate')?.value || 'NA');

  // 檔名示例：
  // heatmap_MMM_WMA_roi_signalClose_fund100000_2024-01-01_2024-12-31_fast12_slow55.png
  return `heatmap_${stock}_${ma}_${metric}_${fillMode}_fund${fund}_${start}_${end}_fast${fast}_slow${slow}.png`;
}

function downloadHeatmapImage(customName) {
  canvas.toBlob(blob => {
    if (!blob) {
      alert('下載失敗：canvas.toBlob() 取得圖片失敗');
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = customName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}

function downloadSelectedHeatmapImage() {
  if (!heatmapReady) {
    alert('請先生成熱力圖（按「生成熱力圖」）');
    return;
  }

  const filename = buildImageName(pickedFast, pickedSlow);
  downloadHeatmapImage(filename);
}


function downloadHeatmapImage(customName) {
  const canvas = document.getElementById('hmCanvas');

  canvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = customName;   // ← 檔名在這
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}

function buildImageName(fast, slow) {
  const stock = selectedStock || 'stock';
  const ma = document.getElementById('hmMAType')?.value || 'MA';
  const start = document.getElementById('simStartDate')?.value;
  const end = document.getElementById('simEndDate')?.value;

  return `heatmap_${stock}_${ma}_fast${fast}_slow${slow}_${start}_${end}.png`;
}


// ---------- Boot ----------
document.getElementById('hmRun').addEventListener('click', generateHeatmap);
document.getElementById('hmDownload').addEventListener('click', downloadCSV);
document.getElementById('hmDownloadImg').addEventListener('click', downloadSelectedHeatmapImage);
attachTooltip();

loadCSV()
  .then(() => {
    resetMACache();
    })
  .catch(err => {
    console.error(err);
    alert('multistocks.csv 讀取失敗：請確認 heatmap.html 與 multistocks.csv 在同一層、且用伺服器方式開啟（不要 file://）。');
  });
