// Heatmap page: Fast 1..256 x Slow 1..256 using MA-cross simulator logic + Fee/Tax

let stockNames = [];
let stockSeries = {}; // name -> prices[]
let volumeSeriesAll = {}; // name -> volumes[]
let dates = [];
let selectedStock = null;
let priceSeries = [];
let volumeSeries = [];

// csv 資料夾中的股票列表
const STOCK_LIST = [
  "AAPL", "AMGN", "AMZN", "AXP", "BA", "CAT", "CRM", "CSCO", "CVX", "DIS",
  "GS", "HD", "HON", "IBM", "JNJ", "JPM", "KO", "MCD", "MMM", "MRK",
  "MSFT", "NKE", "NVDA", "PG", "SHW", "TRV", "UNH", "V", "VZ", "WMT", "DIA", "SPY"
];

// ---------- CSV load (新格式: date,close,volume) ----------

// 解析單一股票 CSV (date,open,high,low,close,volume)
function parseSingleStockCSV(text, stockName) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { dates: [], prices: [], volumes: [] };

  const localDates = [];
  const prices = [];
  const volumes = [];

  // 跳過 header
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 6) continue;

    localDates.push(cols[0].trim());
    const price = parseFloat(cols[4]);   // close 在第 5 欄 (index 4)
    const volume = parseFloat(cols[5]);  // volume 在第 6 欄 (index 5)
    prices.push(!isNaN(price) ? price : NaN);
    volumes.push(!isNaN(volume) ? volume : NaN);
  }

  return { dates: localDates, prices, volumes };
}

// 載入單一股票的資料
async function loadStockData(stockName) {
  try {
    const resp = await fetch(`../csv/${stockName}_history.csv`);
    if (!resp.ok) throw new Error(`${stockName}_history.csv not found`);
    const text = await resp.text();
    const { dates: localDates, prices, volumes } = parseSingleStockCSV(text, stockName);

    stockSeries[stockName] = prices;
    volumeSeriesAll[stockName] = volumes;

    // 如果是目前選的股票，更新全域資料
    if (selectedStock === stockName || selectedStock === null) {
      selectedStock = stockName;
      dates = localDates;
      priceSeries = prices;
      volumeSeries = volumes;
    }

    return true;
  } catch (err) {
    console.warn(`載入 ${stockName} 失敗:`, err);
    return false;
  }
}

// 初始化：載入股票列表和第一個股票的資料
async function loadCSV() {
  stockNames = [...STOCK_LIST];
  populateStockSelect();

  // 先載入第一個股票
  if (stockNames.length > 0) {
    selectedStock = stockNames[0];
    await loadStockData(selectedStock);
  }

  bindDateDefaults();
}

// 保留舊的 parseMultiStockCSV 作為備用
function parseMultiStockCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return;
  const header = lines[0].split(',').map(s => s.trim());
  stockNames = header.slice(1);
  stockSeries = {};
  volumeSeriesAll = {};
  stockNames.forEach(n => {
    stockSeries[n] = [];
    volumeSeriesAll[n] = [];
  });
  dates = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 2) continue;
    dates.push(cols[0].trim());
    for (let j = 1; j < cols.length && j <= stockNames.length; j++) {
      const name = stockNames[j - 1];
      const v = parseFloat(cols[j]);
      stockSeries[name].push(Number.isFinite(v) ? v : NaN);
      volumeSeriesAll[name].push(NaN);
    }
  }
  if (stockNames.length) {
    selectedStock = stockNames[0];
    priceSeries = stockSeries[selectedStock];
    volumeSeries = volumeSeriesAll[selectedStock] || [];
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
  sel.addEventListener('change', async () => {
    selectedStock = sel.value;

    // 如果還沒載入過這個股票的資料，先載入
    if (!stockSeries[selectedStock] || stockSeries[selectedStock].length === 0) {
      await loadStockData(selectedStock);
    } else {
      priceSeries = stockSeries[selectedStock] || [];
      volumeSeries = volumeSeriesAll[selectedStock] || [];
      // 需要重新載入日期（因為每個股票可能日期不同）
      await loadStockData(selectedStock);
    }

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

// ---------- NEW: Hover preview trade chart (optional) ----------
// 如果你的 heatmap.html 有加：
// <canvas id="hmPreview"></canvas>
// <div id="hmPreviewInfo"></div>
// 就會啟用 hover 預覽交易圖；沒加的話會自動回退到原本 tooltip 行為。
const previewCanvas = document.getElementById('hmPreview');
const previewCtx = previewCanvas ? previewCanvas.getContext('2d') : null;
const previewInfo = document.getElementById('hmPreviewInfo');

// 高 DPI 支援 - 提高 canvas 解析度
if (previewCanvas && previewCtx) {
  const dpr = window.devicePixelRatio || 1;
  const rect = previewCanvas.getBoundingClientRect();
  // 設定實際像素大小
  previewCanvas.width = rect.width * dpr;
  previewCanvas.height = rect.height * dpr;
  // 縮放繪圖上下文
  previewCtx.scale(dpr, dpr);
  // 保存邏輯尺寸供繪圖使用
  previewCanvas._logicalWidth = rect.width;
  previewCanvas._logicalHeight = rect.height;
}

let lastHoverKey = '';
let hoverTimer = null;
const previewCache = new Map(); // key -> result

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

// ---------- NEW: trade preview simulation (does NOT modify simulatePair) ----------
function simulatePairWithTrades(fast, slow, opts) {
  const N = priceSeries.length;
  if (!N) return null;
  if (!(fast >= 1 && fast <= 256 && slow >= 1 && slow <= 256)) return null;
  if (opts.onlyUpper && slow <= fast) return { invalid: true, reason: 'slow <= fast (onlyUpper=1)' };

  ensureMACache(opts.maType);
  const fastArr = maCache[opts.maType][fast];
  const slowArr = maCache[opts.maType][slow];
  if (!fastArr || !slowArr) return null;

  const from = opts.from;
  const to = opts.to;
  const fillNext = (opts.fillMode === 'nextClose');

  const feeRate = opts.fee.feeRate;
  const feeMin  = opts.fee.feeMin;
  const feeMax  = opts.fee.feeMax;
  const taxRate = opts.fee.taxRate;
  const taxMin  = opts.fee.taxMin;
  const taxMax  = opts.fee.taxMax;

  let cash = opts.fund;
  let shares = 0;

  const buys = [];   // {i, px}
  const sells = [];  // {i, px}
  let trades = 0;

  for (let i = from + 1; i <= to; i++) {
    const f0 = fastArr[i - 1], s0 = slowArr[i - 1];
    const f1 = fastArr[i],     s1 = slowArr[i];
    if (!Number.isFinite(f0) || !Number.isFinite(s0) || !Number.isFinite(f1) || !Number.isFinite(s1)) continue;

    const d0 = f0 - s0;
    const d1 = f1 - s1;

    const golden = (d0 < 0 && d1 > 0);
    const death  = (d0 > 0 && d1 < 0);

    // SELL
    if (shares > 0 && death) {
      const fi = fillNext ? ((i + 1 <= to) ? (i + 1) : -1) : i;
      if (fi === -1) continue;
      const px = priceSeries[fi];
      if (!Number.isFinite(px)) continue;

      const amount = shares * px;
      const fee = calcFee(amount, feeRate, feeMin, feeMax);
      const tax = calcTax(amount, taxRate, taxMin, taxMax);

      cash += (amount - fee - tax);
      sells.push({ i: fi, px });
      shares = 0;
      trades++;
      continue;
    }

    // BUY
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
        buys.push({ i: fi, px });
      }
    }
  }

  // FORCE CLOSE
  if (shares > 0) {
    const px = priceSeries[to];
    if (Number.isFinite(px)) {
      const amount = shares * px;
      const fee = calcFee(amount, feeRate, feeMin, feeMax);
      const tax = calcTax(amount, taxRate, taxMin, taxMax);
      cash += (amount - fee - tax);
      sells.push({ i: to, px });
      shares = 0;
      trades++;
    }
  }

  const nav = cash;
  const roi = (nav - opts.fund) / opts.fund * 100;

  // Build series for drawing
  const series = [];
  let yMin = Infinity, yMax = -Infinity;

  for (let i = from; i <= to; i++) {
    const px = priceSeries[i];
    const fa = fastArr[i];
    const sa = slowArr[i];

    series.push({ i, date: dates[i], px, fa, sa });

    for (const v of [px, fa, sa]) {
      if (Number.isFinite(v)) {
        if (v < yMin) yMin = v;
        if (v > yMax) yMax = v;
      }
    }
  }

  if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || yMax === yMin) {
    yMin = 0; yMax = 1;
  }

  return { fast, slow, roi, nav, trades, series, buys, sells, yMin, yMax };
}

function clearPreviewCanvas(message) {
  if (!previewCtx || !previewCanvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W = previewCanvas._logicalWidth || previewCanvas.width / dpr;
  const H = previewCanvas._logicalHeight || previewCanvas.height / dpr;
  previewCtx.clearRect(0, 0, W * dpr, H * dpr);
  if (message) {
    previewCtx.globalAlpha = 0.9;
    previewCtx.fillStyle = '#999';
    previewCtx.font = '13px sans-serif';
    previewCtx.fillText(message, 12, 20);
    previewCtx.globalAlpha = 1;
  }
}

function drawPreview(res) {
  if (!previewCtx || !previewCanvas) return;

  // 使用邏輯尺寸（高 DPI 支援）
  const dpr = window.devicePixelRatio || 1;
  const W = previewCanvas._logicalWidth || previewCanvas.width / dpr;
  const H = previewCanvas._logicalHeight || previewCanvas.height / dpr;
  previewCtx.clearRect(0, 0, W * dpr, H * dpr);

  if (!res) {
    clearPreviewCanvas('No data');
    return;
  }
  if (res.invalid) {
    clearPreviewCanvas(res.reason || 'invalid');
    return;
  }

  const padL = 55, padR = 14, padT = 16, padB = 36;
  const x0 = padL, x1 = W - padR;
  const y0 = padT, y1 = H - padB;

  const n = res.series.length;
  const yMin = res.yMin, yMax = res.yMax;

  const xOf = (k) => x0 + (k * (x1 - x0)) / Math.max(1, n - 1);
  const yOf = (v) => y1 - ((v - yMin) * (y1 - y0)) / (yMax - yMin);

  // 繪製網格和座標軸數字
  previewCtx.strokeStyle = 'rgba(255,255,255,0.1)';
  previewCtx.fillStyle = '#999';
  previewCtx.font = '10px sans-serif';
  previewCtx.textAlign = 'right';
  previewCtx.textBaseline = 'middle';

  // Y軸網格線和數字 (價格)
  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const val = yMin + (yMax - yMin) * (i / yTicks);
    const y = yOf(val);
    // 網格線
    previewCtx.globalAlpha = 0.3;
    previewCtx.beginPath();
    previewCtx.moveTo(x0, y);
    previewCtx.lineTo(x1, y);
    previewCtx.stroke();
    // 數字
    previewCtx.globalAlpha = 0.8;
    previewCtx.fillText(val.toFixed(1), x0 - 6, y);
  }

  // X軸網格線和數字 (日期)
  previewCtx.textAlign = 'center';
  previewCtx.textBaseline = 'top';
  const xTicks = Math.min(6, n - 1);
  for (let i = 0; i <= xTicks; i++) {
    const k = Math.round(i * (n - 1) / xTicks);
    const x = xOf(k);
    // 網格線
    previewCtx.globalAlpha = 0.3;
    previewCtx.beginPath();
    previewCtx.moveTo(x, y0);
    previewCtx.lineTo(x, y1);
    previewCtx.stroke();
    // 日期
    previewCtx.globalAlpha = 0.8;
    if (res.series[k] && res.series[k].date) {
      const dateStr = res.series[k].date.slice(5); // MM-DD
      previewCtx.fillText(dateStr, x, y1 + 6);
    }
  }

  // axes
  previewCtx.strokeStyle = 'rgba(255,255,255,0.5)';
  previewCtx.globalAlpha = 1;
  previewCtx.beginPath();
  previewCtx.moveTo(x0, y0);
  previewCtx.lineTo(x0, y1);
  previewCtx.lineTo(x1, y1);
  previewCtx.stroke();

  function drawLine(getV) {
    previewCtx.beginPath();
    let started = false;
    for (let k = 0; k < n; k++) {
      const v = getV(res.series[k]);
      if (!Number.isFinite(v)) { started = false; continue; }
      const x = xOf(k);
      const y = yOf(v);
      if (!started) { previewCtx.moveTo(x, y); started = true; }
      else previewCtx.lineTo(x, y);
    }
    previewCtx.stroke();
  }

  // price / fast / slow (透明度區分)
  previewCtx.lineWidth = 2;
  previewCtx.globalAlpha = 1.0;
  previewCtx.strokeStyle = '#90caf9'; // 藍色 - 價格線
  drawLine(p => p.px);

  previewCtx.lineWidth = 1.5;
  previewCtx.globalAlpha = 0.9;
  previewCtx.strokeStyle = '#00ffa0'; // 綠色 - 快線 (fast MA)
  drawLine(p => p.fa);

  previewCtx.lineWidth = 1.5;
  previewCtx.globalAlpha = 0.9;
  previewCtx.strokeStyle = '#ff6b6b'; // 紅色 - 慢線 (slow MA)
  drawLine(p => p.sa);

  previewCtx.globalAlpha = 1;

  function drawPoints(arr, isBuy) {
    previewCtx.fillStyle = isBuy ? '#00ffa0' : '#ff6b6b'; // 綠色買入，紅色賣出
    for (const p of arr) {
      const k = p.i - res.series[0].i;
      if (k < 0 || k >= n) continue;
      const x = xOf(k);
      const y = yOf(p.px);
      previewCtx.beginPath();
      previewCtx.arc(x, y, 5, 0, Math.PI * 2);
      previewCtx.fill();
      previewCtx.fillStyle = isBuy ? '#00ffa0' : '#ff6b6b';
      previewCtx.font = 'bold 10px sans-serif';
      previewCtx.fillText(isBuy ? 'B' : 'S', x + 7, y - 7);
    }
  }

  drawPoints(res.buys, true);
  drawPoints(res.sells, false);

  // 繪製圖例 (Legend)
  const legendX = x1 - 180;
  const legendY = y0 + 8;
  const lineLen = 20;
  const legendItems = [
    { color: '#90caf9', label: 'Price' },
    { color: '#00ffa0', label: `Fast MA (${res.fast})` },
    { color: '#ff6b6b', label: `Slow MA (${res.slow})` }
  ];

  previewCtx.font = '11px sans-serif';
  previewCtx.globalAlpha = 0.85;
  
  // 半透明背景
  previewCtx.fillStyle = 'rgba(0,0,0,0.6)';
  previewCtx.fillRect(legendX - 8, legendY - 12, 175, legendItems.length * 18 + 10);
  
  legendItems.forEach((item, i) => {
    const ly = legendY + i * 18;
    // 線條
    previewCtx.strokeStyle = item.color;
    previewCtx.lineWidth = 2;
    previewCtx.beginPath();
    previewCtx.moveTo(legendX, ly);
    previewCtx.lineTo(legendX + lineLen, ly);
    previewCtx.stroke();
    // 文字
    previewCtx.fillStyle = '#eee';
    previewCtx.fillText(item.label, legendX + lineLen + 6, ly + 4);
  });

  previewCtx.globalAlpha = 1;
}

function updatePreviewFor(fx, sy) {
  if (!previewCtx || !previewCanvas) return;

  const fund = Math.max(0, numFrom('simFund', 100000));
  const fillMode = document.getElementById('simFill')?.value || 'signalClose';
  const maType = document.getElementById('hmMAType')?.value || 'MA';
  const onlyUpper = (document.getElementById('hmOnlyUpper')?.value || '1') === '1';

  const startIdx = toIndexOrDefault(document.getElementById('simStartDate')?.value, 0);
  const endIdx = toIndexOrDefault(document.getElementById('simEndDate')?.value, dates.length - 1);
  const from = Math.max(0, Math.min(startIdx, endIdx));
  const to = Math.min(dates.length - 1, Math.max(startIdx, endIdx));

  const fee = getSimFeeTaxParams();

  const key = `${selectedStock}|${maType}|${fillMode}|${fund}|${from}|${to}|${onlyUpper}|${fx}|${sy}`;
  if (key === lastHoverKey) return;
  lastHoverKey = key;

  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => {
    let res = previewCache.get(key);
    if (!res) {
      res = simulatePairWithTrades(fx, sy, { fund, from, to, fillMode, maType, onlyUpper, fee });
      previewCache.set(key, res);
    }

    if (previewInfo) {
      if (!res) previewInfo.textContent = `fast=${fx}, slow=${sy}（無資料）`;
      else if (res.invalid) previewInfo.textContent = `fast=${fx}, slow=${sy}（${res.reason}）`;
      else previewInfo.textContent = `${maType} fast=${fx}, slow=${sy} ｜ ROI=${res.roi.toFixed(2)}% ｜ Trades=${res.trades}`;
    }

    drawPreview(res);
  }, 50);
}

// ---------- Tooltip / Hover behavior ----------
function attachTooltip() {
  const hasPreview = !!(previewCanvas && previewCtx);

  wrap.addEventListener('mousemove', (e) => {
    // 用同一套座標轉換（避免你之後改軸時兩邊不同步）
    const picked = getFastSlowFromMouseEvent(e);
    if (!picked) {
      tip.style.opacity = 0;
      if (hasPreview) clearPreviewCanvas('Hover heatmap cell…');
      return;
    }

    // 如果你有加 hmPreview：就改成更新交易圖，不顯示 tooltip
    if (hasPreview) {
      tip.style.opacity = 0;
      updatePreviewFor(picked.fast, picked.slow);
      return;
    }

    // 沒有 hmPreview：維持原本 tooltip 行為（避免你還沒加 HTML 就壞掉）
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const fx = picked.fast;
    const sy = picked.slow;

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

  wrap.addEventListener('mouseleave', () => {
    tip.style.opacity = 0;
    if (previewInfo) previewInfo.textContent = '把滑鼠移到熱力圖上任一格，這裡會顯示該組 fast/slow 的交易圖。';
  });
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
    // 預覽區（如果存在）先清一下
    if (previewCtx && previewCanvas) clearPreviewCanvas('Hover heatmap cell…');
  })
  .catch(err => {
    console.error(err);
    alert('multistocks.csv 讀取失敗：請確認 heatmap.html 與 multistocks.csv 在同一層、且用伺服器方式開啟（不要 file://）。');
  });
