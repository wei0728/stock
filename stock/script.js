// 全部指標（KD / MA / RSI）都使用 csv 資料夾的股票資料
let stockNames = [];      // ["AAPL","MSFT",...]
let stockSeries = {};     // { "AAPL": [prices...], ... }
let volumeSeriesAll = {}; // { "AAPL": [volumes...], ... }
let selectedStock = null; // 目前選的股票名稱
let priceSeries = [];     // 當前選股的價位序列 (Close)
let volumeSeries = [];    // 當前選股的成交量序列 (Volume)
let TOTAL_DAYS = 0;       // 資料長度
let dates = [];           // 日期字串（與 priceSeries 同長度）

// csv 資料夾中的股票列表
const STOCK_LIST = [
  "AAPL", "AMGN", "AMZN", "AXP", "BA", "CAT", "CRM", "CSCO", "CVX", "DIS",
  "GS", "HD", "HON", "IBM", "JNJ", "JPM", "KO", "MCD", "MMM", "MRK",
  "MSFT", "NKE", "NVDA", "PG", "SHW", "TRV", "UNH", "V", "VZ", "WMT"
];

// KD / MA 指標資料
let period = 3.0;         // KD：K/D 平滑固定 3 → α = 1/3

let dataRSV = [];
let dataK = [];
let dataD = [];

let dataMA = [];   // SMA
let dataWMA = [];
let dataEMA = [];

let macdLine   = [];
let macdSignal = [];
let macdHist   = [];
let macdChart  = null;
let volumeChart = null;

// KD 交叉
let kdGolden = [];
let kdDeath  = [];

// MA 三重交叉（SMA + WMA + EMA）
let maTripleGolden = [];
let maTripleDeath  = [];

// RSI
let rsiData = [];
let rsiChart = null;

// 圖表物件
let kdChart = null;
let maChart = null;

// ✅ 全域：目前圖表顯示區間（index）
let chartStart = 0;
let chartEnd = 0;




// ✅ Chart.js x 軸 tick：用「val」當資料 index（縮放後才不會亂）
function formatDateTick(val) {
  const i = Number(val);
  if (!Number.isFinite(i)) return "";
  return dates?.[i] ?? "";
}

// ============= KD 值 Clamp（限制 0～100）=============

function clampKD(x) {
  if (!Number.isFinite(x)) return NaN;
  return Math.max(0, Math.min(100, x));
}


// ============= 自動讀取 csv 資料夾的股票資料 =============

// 解析單一股票 CSV (date,close,volume)
function parseSingleStockCSV(text, stockName) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { dates: [], prices: [], volumes: [] };

  const localDates = [];
  const prices = [];
  const volumes = [];

  // 跳過 header
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 3) continue;

    localDates.push(cols[0].trim());
    const price = parseFloat(cols[1]);
    const volume = parseFloat(cols[2]);
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

    // 如果是第一個載入的或目前選的股票，更新全域資料
    if (selectedStock === stockName || selectedStock === null) {
      selectedStock = stockName;
      dates = localDates;
      priceSeries = prices;
      volumeSeries = volumes;
      TOTAL_DAYS = prices.length;
    }

    return true;
  } catch (err) {
    console.warn(`載入 ${stockName} 失敗:`, err);
    return false;
  }
}

// 初始載入所有股票名稱，但只載入第一個股票的完整資料
async function initStockData() {
  stockNames = [...STOCK_LIST];
  populateStockSelect();

  // 先載入第一個股票
  if (stockNames.length > 0) {
    selectedStock = stockNames[0];
    await loadStockData(selectedStock);
    computeAll();
    updateCharts();
  }
}

initStockData().catch(err => {
  console.log("初始化股票資料失敗:", err);
});


// ============= 檔案上傳（支援新格式 date,close,volume 或舊格式 multistocks） =============

const csvFileEl = document.getElementById("csvFile");
if (csvFileEl) {
  csvFileEl.addEventListener("change", function (e) {
    const file = e.target.files[0];
    if (!file) return;

    const statusEl = document.getElementById("fileStatus");
    if (statusEl) statusEl.textContent = "已選擇：" + file.name;

    const reader = new FileReader();
    reader.onload = function () {
      const text = reader.result;
      const firstLine = text.trim().split(/\r?\n/)[0].toLowerCase();

      // 判斷是新格式 (date,close,volume) 還是舊格式 (date,stock1,stock2,...)
      if (firstLine.includes("close") && firstLine.includes("volume")) {
        // 新格式：單一股票 CSV
        const stockName = file.name.replace(/_history\.csv$/i, "").replace(/\.csv$/i, "").toUpperCase();
        const { dates: localDates, prices, volumes } = parseSingleStockCSV(text, stockName);

        stockSeries[stockName] = prices;
        volumeSeriesAll[stockName] = volumes;

        if (!stockNames.includes(stockName)) {
          stockNames.push(stockName);
        }

        selectedStock = stockName;
        dates = localDates;
        priceSeries = prices;
        volumeSeries = volumes;
        TOTAL_DAYS = prices.length;

        populateStockSelect();
        document.getElementById("stockSelect").value = stockName;
      } else {
        // 舊格式：multistocks CSV
        parseMultiStockCSV(text);
        populateStockSelect();
      }

      computeAll();
      updateCharts();
    };
    reader.readAsText(file);
  });
}


// ============= 股票選擇更動 =============

const stockSelectEl = document.getElementById("stockSelect");
if (stockSelectEl) {
  stockSelectEl.addEventListener("change", async function (e) {
    const name = e.target.value;
    selectedStock = name;

    // 如果還沒載入過這個股票的資料，先載入
    if (!stockSeries[name] || stockSeries[name].length === 0) {
      await loadStockData(name);
    } else {
      // 使用已載入的資料
      priceSeries = stockSeries[name] || [];
      volumeSeries = volumeSeriesAll[name] || [];
      // 需要重新載入日期（因為每個股票可能日期不同）
      await loadStockData(name);
    }

    TOTAL_DAYS = priceSeries.length;
    computeAll();
    updateCharts();
  });
}


// ============= 解析 multistocks.csv（多股 Close） =============

function parseMultiStockCSV(text) {
  const lines = text.trim().split(/\r?\n/); // 兼容 Windows \r\n
  if (lines.length < 2) return;

  const header = lines[0].split(",").map(s => s.trim());
  stockNames = header.slice(1); // 第一欄是日期

  stockSeries = {};
  volumeSeriesAll = {};
  stockNames.forEach(name => {
    stockSeries[name] = [];
    volumeSeriesAll[name] = []; // 舊格式沒有 volume
  });

  dates = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 2) continue; // 跳過空行

    dates.push(cols[0].trim()); // 日期

    for (let j = 1; j < cols.length && j <= stockNames.length; j++) {
      const name = stockNames[j - 1];
      const val = parseFloat(cols[j]);
      stockSeries[name].push(!isNaN(val) ? val : NaN);
      volumeSeriesAll[name].push(NaN); // 舊格式沒有 volume
    }
  }

  // 預設選第一檔股票
  if (stockNames.length > 0) {
    selectedStock = stockNames[0];
    priceSeries = stockSeries[selectedStock];
    volumeSeries = volumeSeriesAll[selectedStock] || [];
    TOTAL_DAYS = priceSeries.length;
  }
}


// ============= 填股票下拉選單 =============

function populateStockSelect() {
  const sel = document.getElementById("stockSelect");
  if (!sel) return;

  sel.innerHTML = "";
  stockNames.forEach(name => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  });

  if (selectedStock) {
    sel.value = selectedStock;
  }
}


// ============= 計算邏輯 =============
// ⚠️ Alignment FIX:
// - MA/WMA/EMA: 用「包含當天」的 window，所以 MA(5) 前 4 天是 NaN，第 5 天才有值
// - RSV(radius): 用「包含當天」的 window，所以 RSV(9) 第 9 天 (index=8) 就會有值

function RSV(d, radius) {
  // past radius days INCLUDING day d => need d >= radius-1
  if (d < radius - 1) return NaN;
  if (d >= TOTAL_DAYS) return NaN;

  let mn = Infinity;
  let mx = -Infinity;

  // window: [d-radius+1, d]
  for (let i = d - (radius - 1); i <= d; i++) {
    const v = priceSeries[i];
    if (!Number.isFinite(v)) return NaN;
    mn = Math.min(mn, v);
    mx = Math.max(mx, v);
  }

  const close = priceSeries[d];
  if (!Number.isFinite(close)) return NaN;
  if (mx === mn) return NaN;

  return clampKD((close - mn) / (mx - mn) * 100.0);
}

// SMA: window includes day d => need d >= radius-1
function moving_average(d, radius) {
  if (d < radius - 1) return NaN;
  if (d >= TOTAL_DAYS) return NaN;
  let sum = 0.0;
  for (let i = d - (radius - 1); i <= d; i++) {
    const v = priceSeries[i];
    if (!Number.isFinite(v)) return NaN;
    sum += v;
  }
  return sum / radius;
}

// WMA: window includes day d => need d >= radius-1
function weighted_moving_average(d, radius) {
  if (d < radius - 1) return NaN;
  if (d >= TOTAL_DAYS) return NaN;
  let sum = 0.0;
  let wsum = 0.0;

  // oldest weight=1 ... newest weight=radius
  let w = 1.0;
  for (let i = d - (radius - 1); i <= d; i++, w++) {
    const v = priceSeries[i];
    if (!Number.isFinite(v)) return NaN;
    sum += v * w;
    wsum += w;
  }
  return sum / wsum;
}

// EMA: seed uses SMA(radius) at day (radius-1), then update forward including day d
function exponential_moving_average(d, radius) {
  if (d < radius - 1 || d >= TOTAL_DAYS) return NaN;
  const alpha = 2.0 / (radius + 1.0);

  // seed SMA on first window ending at (radius-1)
  let sum = 0.0;
  for (let i = 0; i <= radius - 1; i++) {
    const v = priceSeries[i];
    if (!Number.isFinite(v)) return NaN;
    sum += v;
  }
  let ema = sum / radius;

  // advance from day radius to day d
  for (let i = radius; i <= d; i++) {
    const v = priceSeries[i];
    if (!Number.isFinite(v)) return NaN;
    ema = ema * (1.0 - alpha) + v * alpha;
  }
  return ema;
}

// ============= MACD 計算 =============
// fast: 快線 EMA 週期 (預設 12)
// slow: 慢線 EMA 週期 (預設 26)
// signal: 訊號線 EMA 週期 (預設 9)

function computeMACD(fast, slow, signal) {
  // 先重置
  macdLine   = Array(TOTAL_DAYS).fill(NaN);
  macdSignal = Array(TOTAL_DAYS).fill(NaN);
  macdHist   = Array(TOTAL_DAYS).fill(NaN);

  if (TOTAL_DAYS === 0) return;

  // 基本防呆
  if (!Number.isFinite(fast)   || fast   < 2) fast   = 12;
  if (!Number.isFinite(slow)   || slow   <= fast) slow = fast + 1;
  if (!Number.isFinite(signal) || signal < 1) signal = 9;

  // 1. 先用你現成的 EMA（getMAArray("EMA", N)）算快/慢線
  const emaFast = getMAArray("EMA", fast);
  const emaSlow = getMAArray("EMA", slow);

  // 2. MACD 主線 = 快線 EMA - 慢線 EMA
  for (let i = 0; i < TOTAL_DAYS; i++) {
    const f = emaFast[i];
    const s = emaSlow[i];
    if (Number.isFinite(f) && Number.isFinite(s)) {
      macdLine[i] = f - s;
    } else {
      macdLine[i] = NaN;
    }
  }

  // 3. 訊號線 = MACD 線做 EMA(signal)
  const alpha = 2.0 / (signal + 1.0);

  // 找第一個有限值當起點
  let start = -1;
  for (let i = 0; i < TOTAL_DAYS; i++) {
    if (Number.isFinite(macdLine[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return;                 // 全部都是 NaN
  if (start + signal > TOTAL_DAYS) return;  // 資料太短算不出來

  // 用 MACD[start .. start+signal-1] 做 SMA seed
  let sum = 0.0;
  for (let i = start; i < start + signal; i++) {
    const v = macdLine[i];
    if (!Number.isFinite(v)) return;        // 中間有 NaN 就先放棄
    sum += v;
  }
  let ema = sum / signal;
  const seedIndex = start + signal - 1;
  macdSignal[seedIndex] = ema;
  macdHist[seedIndex]   = macdLine[seedIndex] - ema;

  // 後續用 EMA 遞推
  for (let i = seedIndex + 1; i < TOTAL_DAYS; i++) {
    const v = macdLine[i];
    if (!Number.isFinite(v)) {
      macdSignal[i] = NaN;
      macdHist[i]   = NaN;
      continue;
    }
    ema = ema * (1.0 - alpha) + v * alpha;
    macdSignal[i] = ema;
    macdHist[i]   = macdLine[i] - ema;
  }
}


// ============= RSI 計算 =============

function computeRSI(periodRSI) {
  rsiData = [];
  if (TOTAL_DAYS <= periodRSI) {
    rsiData = Array(TOTAL_DAYS).fill(NaN);
    return;
  }
  rsiData = Array(TOTAL_DAYS).fill(NaN);

  let gains = 0.0;
  let losses = 0.0;

  // 初始值 (Wilder)
  for (let i = 1; i <= periodRSI; i++) {
    const diff = priceSeries[i] - priceSeries[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / periodRSI;
  let avgLoss = losses / periodRSI;
  let rs = avgLoss === 0 ? Infinity : (avgGain / avgLoss);

  rsiData[periodRSI] = clampKD(100 - 100 / (1 + rs));

  // 平滑計算後續
  for (let i = periodRSI + 1; i < TOTAL_DAYS; i++) {
    const diff = priceSeries[i] - priceSeries[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;

    avgGain = (avgGain * (periodRSI - 1) + gain) / periodRSI;
    avgLoss = (avgLoss * (periodRSI - 1) + loss) / periodRSI;

    rs = avgLoss === 0 ? Infinity : (avgGain / avgLoss);
    rsiData[i] = clampKD(100 - 100 / (1 + rs));
  }
}


// ============= 通用交叉偵測 =============

function detectCrosses(seriesA, seriesB, length) {
  const golden = [];
  const death = [];
  if (!seriesA || !seriesB) return { golden, death };

  let prevDiff = null;

  for (let i = 0; i < length; i++) {
    const a = seriesA[i];
    const b = seriesB[i];

    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      prevDiff = null;
      continue;
    }
    const diff = a - b;

    if (prevDiff !== null) {
      if (prevDiff <= 0 && diff > 0) golden.push({ index: i, a, b });
      else if (prevDiff >= 0 && diff < 0) death.push({ index: i, a, b });
    }
    prevDiff = diff;
  }
  return { golden, death };
}


// ============= 計算所有指標 =============

function computeAll() {
  const radiusSlider = document.getElementById("radius");
  if (!radiusSlider) return;

  const maxDays = TOTAL_DAYS > 1 ? TOTAL_DAYS : 2;
  radiusSlider.max = maxDays;

  let radius = parseInt(radiusSlider.value, 10);
  if (!Number.isFinite(radius) || radius < 2) radius = 2;
  if (radius > maxDays) radius = maxDays;
  radiusSlider.value = radius;

  const radiusInput = document.getElementById("radiusInput");
  if (radiusInput) radiusInput.value = radius;

  // ----- 1. KD -----
  dataRSV = Array(TOTAL_DAYS).fill(NaN);
  dataK = Array(TOTAL_DAYS).fill(NaN);
  dataD = Array(TOTAL_DAYS).fill(NaN);

  const alpha = 1.0 / period;

  // 先算好所有 RSV
  for (let i = 0; i < TOTAL_DAYS; i++) {
    dataRSV[i] = RSV(i, radius);
  }

  // 迭代算 K 和 D
  let prevK = 50.0;
  let prevD = 50.0;

  // ✅ first valid RSV is (radius-1)
  const startIndex = radius - 1;

  if (startIndex >= 0 && startIndex < TOTAL_DAYS) {
    const firstRSV = dataRSV[startIndex];
    if (!Number.isNaN(firstRSV)) {
      let currentK = 50.0 * (1.0 - alpha) + firstRSV * alpha;
      dataK[startIndex] = clampKD(currentK);
      prevK = currentK;

      let currentD = 50.0 * (1.0 - alpha) + currentK * alpha;
      dataD[startIndex] = clampKD(currentD);
      prevD = currentD;
    }

    for (let i = startIndex + 1; i < TOTAL_DAYS; i++) {
      const rsv = dataRSV[i];
      if (Number.isNaN(rsv)) continue;

      let k = prevK * (1.0 - alpha) + rsv * alpha;
      dataK[i] = clampKD(k);
      prevK = k;

      let d = prevD * (1.0 - alpha) + k * alpha;
      dataD[i] = clampKD(d);
      prevD = d;
    }
  }

  const kdCross = detectCrosses(dataK, dataD, TOTAL_DAYS);
  kdGolden = kdCross.golden;
  kdDeath  = kdCross.death;

  // ----- 2. SMA / WMA / EMA -----
  dataMA  = Array(TOTAL_DAYS).fill(NaN);
  dataWMA = Array(TOTAL_DAYS).fill(NaN);
  dataEMA = Array(TOTAL_DAYS).fill(NaN);

  for (let i = 0; i < TOTAL_DAYS; i++) {
    dataMA[i]  = moving_average(i, radius);
    dataWMA[i] = weighted_moving_average(i, radius);
  }

  // EMA optimized (aligned to "包含當天" 版本)
  const emaAlpha = 2.0 / (radius + 1.0);

  // seed SMA on first window ending at (radius-1)
  let seedOk = true;
  let seedSum = 0.0;
  if (radius - 1 < TOTAL_DAYS) {
    for (let i = 0; i <= radius - 1; i++) {
      const v = priceSeries[i];
      if (!Number.isFinite(v)) { seedOk = false; break; }
      seedSum += v;
    }
  } else {
    seedOk = false;
  }

  if (seedOk) {
    let run = seedSum / radius;
    dataEMA[radius - 1] = run;

    for (let i = radius; i < TOTAL_DAYS; i++) {
      const v = priceSeries[i];
      if (!Number.isFinite(v)) { run = NaN; dataEMA[i] = NaN; continue; }
      run = run * (1.0 - emaAlpha) + v * emaAlpha;
      dataEMA[i] = run;
    }
  }

  // ----- 3. RSI -----
  const rsiInput = document.getElementById("rsiPeriod");
  let rsiPeriod = 14;
  if (rsiInput) {
    let p = parseInt(rsiInput.value, 10);
    if (!Number.isFinite(p) || p < 2) p = 14;
    rsiInput.value = p;
    rsiPeriod = p;
  }
  if (TOTAL_DAYS > 0) {
    computeRSI(rsiPeriod);
  } else {
    rsiData = [];
  }

  // ----- 4. MACD -----
  let fast  = 12;
  let slow  = 26;
  let sig   = 9;

  const macdFastInput   = document.getElementById("macdFast");
  const macdSlowInput   = document.getElementById("macdSlow");
  const macdSignalInput = document.getElementById("macdSignal");

  if (macdFastInput) {
    let v = parseInt(macdFastInput.value, 10);
    if (!Number.isFinite(v) || v < 2) v = 12;
    macdFastInput.value = v;
    fast = v;
  }
  if (macdSlowInput) {
    let v = parseInt(macdSlowInput.value, 10);
    if (!Number.isFinite(v) || v <= fast) v = fast + 1;
    macdSlowInput.value = v;
    slow = v;
  }
  if (macdSignalInput) {
    let v = parseInt(macdSignalInput.value, 10);
    if (!Number.isFinite(v) || v < 1) v = 9;
    macdSignalInput.value = v;
    sig = v;
  }

  if (TOTAL_DAYS > 0) {
    computeMACD(fast, slow, sig);
  } else {
    macdLine   = [];
    macdSignal = [];
    macdHist   = [];
  }
}


// ============= KD/MA 對應資料 =============

function getDataByName(name) {
  return {
    RSV: dataRSV,
    K:   dataK,
    D:   dataD,
    MA:  dataMA,
    WMA: dataWMA,
    EMA: dataEMA
  }[name];
}

const LINE_STYLES = {
  RSV: { borderColor: "#4FC3F7" },
  K:   { borderColor: "#FFB74D" },
  D:   { borderColor: "#81C784" },
  MA:  { borderColor: "#64B5F6" },
  WMA: { borderColor: "#BA68C8" },
  EMA: { borderColor: "#E57373" }
};

// ⭐ PRICE line style (very visible)
const PRICE_LINE_STYLE = {
  borderColor: "#FFFFFF",
  borderWidth: 2.5,
  pointRadius: 0,
  tension: 0,
  fill: false
};


// ============= KD 圖表 (Fix: 手動清除 Annotation Key 防止殘留) =============

function updateKDChart() {
  if (TOTAL_DAYS === 0) return;
  const canvas = document.getElementById("kdChart");
  if (!canvas) return;

  const lower = parseFloat(document.getElementById("kdOversold")?.value) || 20;
  const upper = parseFloat(document.getElementById("kdOverbought")?.value) || 80;
  const kdSelect = document.getElementById("kdSelect");

  const checked = kdSelect
    ? [...kdSelect.querySelectorAll("input:checked")].map(cb => cb.value)
    : ["K", "D"];

  const datasets = [{
    label: "PRICE",
    data: priceSeries,
    yAxisID: "yPrice",
    order: 1000,
    ...PRICE_LINE_STYLE
  }];

  datasets.push(...checked.map(name => ({
    label: name,
    data: getDataByName(name),
    yAxisID: "y",
    borderWidth: 2,
    fill: false,
    tension: 0,
    pointRadius: 0,
    ...LINE_STYLES[name]
  })));

  const showCross = checked.includes("K") && checked.includes("D");

  if (showCross && kdGolden.length > 0) {
    datasets.push({
      label: "KD Golden",
      type: "scatter",
      data: kdGolden.map(p => ({ x: p.index, y: p.a })),
      yAxisID: "y",
      pointRadius: 6,
      pointStyle: "triangle",
      backgroundColor: "#FFD700",
      borderColor: "#FFFFFF",
      borderWidth: 2,
      order: 998
    });
  }

  if (showCross && kdDeath.length > 0) {
    datasets.push({
      label: "KD Death",
      type: "scatter",
      data: kdDeath.map(p => ({ x: p.index, y: p.a })),
      yAxisID: "y",
      pointRadius: 6,
      pointStyle: "rectRot",
      backgroundColor: "#FF1744",
      borderColor: "#FFFFFF",
      borderWidth: 2,
      order: 998
    });
  }

  let kdShaded = {};
  if (showCross) {
    const shadeRanges = buildShadedRanges(kdGolden, kdDeath);
    kdShaded = buildAnnotationBoxes(shadeRanges, "rgba(0,255,0,0.10)");
  }

  // ✅ 讓上下界色塊只蓋「顯示區間」(chartStart~chartEnd)
  const newAnnotations = {
    overbought: {
      type: "box",
      xMin: chartStart, xMax: chartEnd,
      yMin: upper, yMax: 100,
      backgroundColor: "rgba(255, 214, 0, 0.18)", borderWidth: 0
    },
    oversold: {
      type: "box",
      xMin: chartStart, xMax: chartEnd,
      yMin: 0, yMax: lower,
      backgroundColor: "rgba(33,150,243,0.20)", borderWidth: 0
    },
    ...kdShaded
  };

  const labels = [...Array(TOTAL_DAYS).keys()];

  if (kdChart) {
    kdChart.data.labels = labels;
    kdChart.data.datasets = datasets;

    // ✅ 套用日期範圍（關鍵：這就是 zoom in）
    kdChart.options.scales.x.min = chartStart;
    kdChart.options.scales.x.max = chartEnd;

    const oldAnt = kdChart.options.plugins.annotation.annotations;
    if (oldAnt) {
      Object.keys(oldAnt).forEach(key => delete oldAnt[key]);
      Object.assign(oldAnt, newAnnotations);
    } else {
      kdChart.options.plugins.annotation.annotations = newAnnotations;
    }

    kdChart.update("none");
  } else {
    const ctx = canvas.getContext("2d");
    kdChart = new Chart(ctx, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "nearest", axis: "x", intersect: false },
        plugins: {
          legend: {
            position: "top",
            labels: { color: "#eeeeee", usePointStyle: true, pointStyle: "line" }
          },
          tooltip: { callbacks: { title: (items) => {
            const item = items[0];
            const idx = item.raw && typeof item.raw.x === 'number' ? item.raw.x : item.dataIndex;
            return dates[idx] || "";
          } } },
          zoom: {
            pan: { enabled: true, mode: "x", modifierKey: "ctrl" },
            zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" }
          },
          annotation: { drawTime: "beforeDatasetsDraw", annotations: newAnnotations }
        },
        scales: {
          x: {
            min: chartStart,
            max: chartEnd,
            ticks: { color: "#bdbdbd", callback: (val) => formatDateTick(val) },
            grid: { color: "rgba(255,255,255,0.06)" }
          },
          y: {
            position: "left",
            ticks: { color: "#bdbdbd" },
            grid: { color: "rgba(255,255,255,0.12)" },
            min: 0, max: 100
          },
          yPrice: {
            position: "right",
            ticks: { color: "rgba(255,255,255,0.65)" },
            grid: { drawOnChartArea: false }
          }
        }
      }
    });
  }
}


// ============= MA 圖表 (優化版) =============

function getMAArray(type, period_) {
  // return full series aligned with "包含當天" window for all types
  if (type === "MA") {
    const arr = Array(TOTAL_DAYS).fill(NaN);
    for (let i = 0; i < TOTAL_DAYS; i++) arr[i] = moving_average(i, period_);
    return arr;
  } else if (type === "WMA") {
    const arr = Array(TOTAL_DAYS).fill(NaN);
    for (let i = 0; i < TOTAL_DAYS; i++) arr[i] = weighted_moving_average(i, period_);
    return arr;
  } else if (type === "EMA") {
    const alpha = 2.0 / (period_ + 1.0);
    const arrFull = Array(TOTAL_DAYS).fill(NaN);

    // seed SMA ending at (period_-1)
    if (period_ - 1 >= TOTAL_DAYS) return arrFull;
    let sum = 0.0;
    let ok = true;
    for (let i = 0; i <= period_ - 1; i++) {
      const v = priceSeries[i];
      if (!Number.isFinite(v)) { ok = false; break; }
      sum += v;
    }
    if (!ok) return arrFull;

    let run = sum / period_;
    arrFull[period_ - 1] = run;

    for (let i = period_; i < TOTAL_DAYS; i++) {
      const v = priceSeries[i];
      if (!Number.isFinite(v)) { run = NaN; arrFull[i] = NaN; continue; }
      run = run * (1.0 - alpha) + v * alpha;
      arrFull[i] = run;
    }
    return arrFull;
  }
  return Array(TOTAL_DAYS).fill(NaN);
}

const MA_TYPE_COLORS = {
  MA:  { fast: "#64B5F6", slow: "#1976D2" },
  WMA: { fast: "#BA68C8", slow: "#8E24AA" },
  EMA: { fast: "#E57373", slow: "#C62828" }
};


// ============= MA 圖表 (Fix: 手動清除 Annotation Key 防止殘留) =============

function updateMAChart() {
  if (TOTAL_DAYS === 0) return;
  const canvas = document.getElementById("maChart");
  if (!canvas) return;

  const maSelect = document.getElementById("maSelect");
  const checkedTypes = maSelect
    ? [...maSelect.querySelectorAll("input:checked")].map(cb => cb.value)
    : [];

  const fastInput = document.getElementById("maFast");
  const slowInput = document.getElementById("maSlow");

  let X = parseInt(fastInput?.value, 10);
  let Y = parseInt(slowInput?.value, 10);
  if (fastInput) fastInput.value = X;
  if (slowInput) slowInput.value = Y;

  const datasets = [];

  datasets.push({
    label: "PRICE",
    data: priceSeries,
    order: 1000,
    ...PRICE_LINE_STYLE
  });

  let goldenIdx = [];
  let deathIdx = [];
  const signalByIndex = {};

  checkedTypes.forEach(type => {
    const fastArr = getMAArray(type, X);
    const slowArr = getMAArray(type, Y);

    const crosses = detectCrosses(fastArr, slowArr, TOTAL_DAYS);
    crosses.golden.forEach(p => ((signalByIndex[p.index] ||= {})[type] = "golden"));
    crosses.death.forEach(p => ((signalByIndex[p.index] ||= {})[type] = "death"));

    goldenIdx.push(...crosses.golden.map(p => p.index));
    deathIdx.push(...crosses.death.map(p => p.index));

    datasets.push({
      label: `${type}(${X})`,
      data: fastArr,
      borderWidth: 2,
      fill: false,
      tension: 0,
      pointRadius: 0,
      borderColor: MA_TYPE_COLORS[type].fast
    });
    datasets.push({
      label: `${type}(${Y})`,
      data: slowArr,
      borderWidth: 2,
      fill: false,
      tension: 0,
      pointRadius: 0,
      borderColor: MA_TYPE_COLORS[type].slow
    });

    datasets.push({
      label: `${type} Golden`,
      type: "scatter",
      data: crosses.golden.map(p => ({ x: p.index, y: p.a })),
      pointRadius: 6,
      pointStyle: "triangle",
      backgroundColor: "#FFD700",
      borderColor: "#fff",
      borderWidth: 2,
      order: 998
    });
    datasets.push({
      label: `${type} Death`,
      type: "scatter",
      data: crosses.death.map(p => ({ x: p.index, y: p.a })),
      pointRadius: 6,
      pointStyle: "rectRot",
      backgroundColor: "#FF1744",
      borderColor: "#fff",
      borderWidth: 2,
      order: 998
    });
  });

  maTripleGolden = [];
  maTripleDeath  = [];

  const needTriple = ["MA","WMA","EMA"].every(t => checkedTypes.includes(t));
  if (needTriple) {
    for (const k in signalByIndex) {
      const idx = parseInt(k, 10);
      const s = signalByIndex[k];
      if (s.MA === "golden" && s.WMA === "golden" && s.EMA === "golden") maTripleGolden.push(idx);
      if (s.MA === "death"  && s.WMA === "death"  && s.EMA === "death")  maTripleDeath.push(idx);
    }
    maTripleGolden.sort((a,b)=>a-b);
    maTripleDeath.sort((a,b)=>a-b);
  }

  let shadedBoxes = {};
  if (checkedTypes.length > 0 && goldenIdx.length > 0 && deathIdx.length > 0) {
    goldenIdx.sort((a,b)=>a-b);
    deathIdx.sort((a,b)=>a-b);
    const ranges = buildShadedRangesFromIndexes(goldenIdx, deathIdx);
    shadedBoxes = buildAnnotationBoxes(ranges, "rgba(0,255,0,0.10)");
  }

  const labels = [...Array(TOTAL_DAYS).keys()];

  if (maChart) {
    maChart.data.labels = labels;
    maChart.data.datasets = datasets;

    // ✅ 套用日期範圍（zoom in）
    maChart.options.scales.x.min = chartStart;
    maChart.options.scales.x.max = chartEnd;

    const oldAnt = maChart.options.plugins.annotation.annotations;
    if (oldAnt) {
      Object.keys(oldAnt).forEach(key => delete oldAnt[key]);
      Object.assign(oldAnt, shadedBoxes);
    } else {
      maChart.options.plugins.annotation.annotations = shadedBoxes;
    }

    maChart.update("none");
  } else {
    const ctx = canvas.getContext("2d");
    maChart = new Chart(ctx, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { position: "top", labels: { color: "#eeeeee", usePointStyle: true } },
          tooltip: { callbacks: { title: (items) => {
            const item = items[0];
            const idx = item.raw && typeof item.raw.x === 'number' ? item.raw.x : item.dataIndex;
            return dates[idx] || "";
          } } },
          zoom: {
            pan: { enabled: true, mode: "x", modifierKey: "ctrl" },
            zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" }
          }
        },
        scales: {
          x: {
            min: chartStart,
            max: chartEnd,
            ticks: { color: "#bdbdbd", callback: (val) => formatDateTick(val) },
            grid: { color: "rgba(255,255,255,0.06)" }
          },
          y: {
            ticks: { color: "#bdbdbd" },
            grid: { color: "rgba(255,255,255,0.12)" }
          }
        }
      }
    });
  }
}

// ============= Volume 成交量圖表 =============

function updateVolumeChart() {
  const canvas = document.getElementById("volumeChart");
  if (!canvas) return;
  if (TOTAL_DAYS === 0 || !volumeSeries || volumeSeries.length === 0) return;

  const labels = [...Array(TOTAL_DAYS).keys()];

  // 根據價格漲跌決定長條顏色
  const barColors = volumeSeries.map((vol, i) => {
    if (i === 0) return "rgba(158, 158, 158, 0.7)"; // 第一天無法比較
    const prevPrice = priceSeries[i - 1];
    const currPrice = priceSeries[i];
    if (!Number.isFinite(prevPrice) || !Number.isFinite(currPrice)) {
      return "rgba(158, 158, 158, 0.7)";
    }
    if (currPrice > prevPrice) return "rgba(76, 175, 80, 0.7)";  // 上漲綠色
    if (currPrice < prevPrice) return "rgba(244, 67, 54, 0.7)";  // 下跌紅色
    return "rgba(158, 158, 158, 0.7)"; // 平盤灰色
  });

  if (volumeChart) {
    volumeChart.data.labels = labels;
    volumeChart.data.datasets[0].data = volumeSeries;
    volumeChart.data.datasets[0].backgroundColor = barColors;

    volumeChart.options.scales.x.min = chartStart;
    volumeChart.options.scales.x.max = chartEnd;

    volumeChart.update("none");
    return;
  }

  const ctx = canvas.getContext("2d");
  volumeChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Volume",
        data: volumeSeries,
        backgroundColor: barColors,
        borderWidth: 0,
        barPercentage: 0.8,
        categoryPercentage: 0.9
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "nearest", axis: "x", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => dates[items[0].dataIndex] || "",
            label: (item) => {
              const vol = item.raw;
              if (!Number.isFinite(vol)) return "Volume: N/A";
              // 格式化大數字
              if (vol >= 1e9) return `Volume: ${(vol / 1e9).toFixed(2)}B`;
              if (vol >= 1e6) return `Volume: ${(vol / 1e6).toFixed(2)}M`;
              if (vol >= 1e3) return `Volume: ${(vol / 1e3).toFixed(2)}K`;
              return `Volume: ${vol.toFixed(0)}`;
            }
          }
        },
        zoom: {
          pan: { enabled: true, mode: "x", modifierKey: "ctrl" },
          zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" }
        }
      },
      scales: {
        x: {
          min: chartStart,
          max: chartEnd,
          ticks: { color: "#bdbdbd", callback: (val) => formatDateTick(val) },
          grid: { color: "rgba(255,255,255,0.06)" }
        },
        y: {
          ticks: {
            color: "#bdbdbd",
            callback: (val) => {
              if (val >= 1e9) return (val / 1e9).toFixed(1) + "B";
              if (val >= 1e6) return (val / 1e6).toFixed(1) + "M";
              if (val >= 1e3) return (val / 1e3).toFixed(1) + "K";
              return val;
            }
          },
          grid: { color: "rgba(255,255,255,0.12)" }
        }
      }
    }
  });
}

// ============= MACD 圖表 =============

function updateMACDChart() {
  const canvas = document.getElementById("macdChart");
  if (!canvas) return;
  if (TOTAL_DAYS === 0 || !macdLine.length) return;

  const labels = [...Array(TOTAL_DAYS).keys()];

  if (macdChart) {
    macdChart.data.labels = labels;
    macdChart.data.datasets[0].data = macdLine;
    macdChart.data.datasets[1].data = macdSignal;
    macdChart.data.datasets[2].data = macdHist;

    macdChart.options.scales.x.min = chartStart;
    macdChart.options.scales.x.max = chartEnd;

    macdChart.update("none");
    return;
  }

  const ctx = canvas.getContext("2d");
  macdChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "MACD", data: macdLine, borderColor: "#FFB74D", borderWidth: 2, fill: false, tension: 0, pointRadius: 0, yAxisID: "y" },
        { label: "Signal", data: macdSignal, borderColor: "#4FC3F7", borderWidth: 2, fill: false, tension: 0, pointRadius: 0, yAxisID: "y" },
        {
          label: "Histogram",
          type: "bar",
          data: macdHist,
          yAxisID: "y",
          borderWidth: 0,
          backgroundColor: (ctx) => {
            const v = ctx.raw;
            if (!Number.isFinite(v)) return "rgba(158,158,158,0.4)";
            return v >= 0 ? "rgba(76, 175, 80, 0.6)" : "rgba(244, 67, 54, 0.6)";
          }
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "nearest", axis: "x", intersect: false },
      plugins: {
        legend: { position: "top", labels: { color: "#eeeeee", usePointStyle: true, pointStyle: "line" } },
        tooltip: { callbacks: { title: (items) => {
          const item = items[0];
          const idx = item.raw && typeof item.raw.x === 'number' ? item.raw.x : item.dataIndex;
          return dates[idx] || "";
        } } },
        zoom: {
          pan:  { enabled: true, mode: "x", modifierKey: "ctrl" },
          zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" }
        }
      },
      scales: {
        x: {
          min: chartStart,
          max: chartEnd,
          ticks: { color: "#bdbdbd", callback: (val) => formatDateTick(val) },
          grid: { color: "rgba(255,255,255,0.06)" }
        },
        y: { ticks: { color: "#bdbdbd" }, grid: { color: "rgba(255,255,255,0.12)" } }
      }
    }
  });
}

// ============= RSI 圖表 =============

function updateRSIChart() {
  const canvas = document.getElementById("rsiChart");
  if (!canvas) return;
  if (TOTAL_DAYS === 0 || !rsiData.length) return;

  const oversold = parseFloat(document.getElementById("rsiOversold")?.value) || 30;
  const overbought = parseFloat(document.getElementById("rsiOverbought")?.value) || 70;
  const labels = [...Array(TOTAL_DAYS).keys()];

  if (rsiChart) {
    rsiChart.data.labels = labels;
    rsiChart.data.datasets[0].data = rsiData;

    // ✅ 套用日期範圍（zoom in）
    rsiChart.options.scales.x.min = chartStart;
    rsiChart.options.scales.x.max = chartEnd;

    if (rsiChart.options.plugins.annotation?.annotations) {
      rsiChart.options.plugins.annotation.annotations.overbought.yMin = overbought;
      rsiChart.options.plugins.annotation.annotations.oversold.yMax = oversold;

      // ✅ 讓 RSI 區塊只蓋顯示區間
      rsiChart.options.plugins.annotation.annotations.overbought.xMin = chartStart;
      rsiChart.options.plugins.annotation.annotations.overbought.xMax = chartEnd;
      rsiChart.options.plugins.annotation.annotations.oversold.xMin = chartStart;
      rsiChart.options.plugins.annotation.annotations.oversold.xMax = chartEnd;
    }

    rsiChart.update("none");
    return;
  }

  const ctx = canvas.getContext("2d");
  rsiChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "RSI",
        data: rsiData,
        borderColor: "#AB47BC",
        borderWidth: 2,
        fill: false,
        tension: 0,
        pointRadius: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "nearest", axis: "x", intersect: false },
      plugins: {
        legend: { position: "top", labels: { color: "#eeeeee", usePointStyle: true, pointStyle: "line" } },
        tooltip: { callbacks: { title: (items) => {
          const item = items[0];
          const idx = item.raw && typeof item.raw.x === 'number' ? item.raw.x : item.dataIndex;
          return dates[idx] || "";
        } } },
        annotation: {
          drawTime: "beforeDatasetsDraw",
          annotations: {
            overbought: {
              type: "box",
              xMin: chartStart, xMax: chartEnd,
              yMin: overbought, yMax: 100,
              backgroundColor: "rgba(255, 99, 132, 0.15)", borderWidth: 0
            },
            oversold: {
              type: "box",
              xMin: chartStart, xMax: chartEnd,
              yMin: 0, yMax: oversold,
              backgroundColor: "rgba(33, 150, 243, 0.15)", borderWidth: 0
            }
          }
        },
        zoom: {
          pan: { enabled: true, mode: "x", modifierKey: "ctrl" },
          zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" }
        }
      },
      scales: {
        x: {
          min: chartStart,
          max: chartEnd,
          ticks: { color: "#bdbdbd", callback: (val) => formatDateTick(val) },
          grid: { color: "rgba(255,255,255,0.06)" }
        },
        y: {
          ticks: { color: "#bdbdbd" },
          grid: { color: "rgba(255,255,255,0.12)" },
          min: 0, max: 100
        }
      }
    }
  });
}

// ============= 統計表格更新 =============

function updateCrossStats() {
  const kdGoldenCountEl = document.getElementById("kdGoldenCount");
  const kdDeathCountEl  = document.getElementById("kdDeathCount");
  const kdLastCrossEl   = document.getElementById("kdLastCross");

  const maGoldenCountEl = document.getElementById("maGoldenCount");
  const maDeathCountEl  = document.getElementById("maDeathCount");
  const maLastCrossEl   = document.getElementById("maLastCross");

  // ---- KD ----
  if (kdGoldenCountEl) kdGoldenCountEl.textContent = String(kdGolden.length);
  if (kdDeathCountEl)  kdDeathCountEl.textContent  = String(kdDeath.length);

  if (kdLastCrossEl) {
    let kdLastType = "無";
    if (kdGolden.length || kdDeath.length) {
      const lastG = kdGolden.length ? kdGolden[kdGolden.length - 1].index : -1;
      const lastD = kdDeath.length  ? kdDeath[kdDeath.length - 1].index  : -1;
      if (lastG > lastD) kdLastType = `黃金＠第 ${lastG + 1} 根 (${dates[lastG] || ""})`;
      else               kdLastType = `死亡＠第 ${lastD + 1} 根 (${dates[lastD] || ""})`;
    }
    kdLastCrossEl.textContent = kdLastType;
  }

  // ---- MA 三重交叉 ----
  if (maGoldenCountEl) maGoldenCountEl.textContent = String(maTripleGolden.length);
  if (maDeathCountEl)  maDeathCountEl.textContent  = String(maTripleDeath.length);

  if (maLastCrossEl) {
    let maLastType = "無";
    if (maTripleGolden.length || maTripleDeath.length) {
      const lastG = maTripleGolden.length ? maTripleGolden[maTripleGolden.length - 1] : -1;
      const lastD = maTripleDeath.length  ? maTripleDeath[maTripleDeath.length - 1]  : -1;
      if (lastG > lastD) maLastType = `三重黃金＠第 ${lastG + 1} 筆（${dates[lastG] || ""}）`;
      else               maLastType = `三重死亡＠第 ${lastD + 1} 筆（${dates[lastD] || ""}）`;
    }
    maLastCrossEl.textContent = maLastType;
  }
}


// ============= 日期 → index (增強版，支援多種格式) =============

function dateToIndex(htmlDate) {
  if (!htmlDate) return -1;
  const today = new Date();
  const pick = new Date(htmlDate);
  if (pick.toDateString() === today.toDateString()) {
    return dates.length - 1;
  }

  let idx = dates.indexOf(htmlDate);
  if (idx !== -1) return idx;

  let parts = htmlDate.split("-");
  if (parts.length < 3) return -1;

  let y = parts[0];
  let m = String(parseInt(parts[1], 10));
  let d = String(parseInt(parts[2], 10));
  let mm = parts[1];
  let dd = parts[2];

  let fmt1 = `${m}/${d}/${y}`;
  idx = dates.indexOf(fmt1);
  if (idx !== -1) return idx;

  let fmt2 = `${mm}/${dd}/${y}`;
  idx = dates.indexOf(fmt2);
  if (idx !== -1) return idx;

  let fmt3 = `${y}/${mm}/${dd}`;
  idx = dates.indexOf(fmt3);
  if (idx !== -1) return idx;

  let fmt4 = `${y}/${m}/${d}`;
  idx = dates.indexOf(fmt4);
  if (idx !== -1) return idx;

  idx = dates.findIndex(dt => {
    let dp = new Date(dt);
    return !isNaN(dp.getTime()) && dp.toDateString() === pick.toDateString();
  });

  return idx;
}


// ============= 產生日期區間 Summary table =============

function buildCrossRangeTable() {
  const startInput = document.getElementById("rangeStartDate");
  const endInput = document.getElementById("rangeEndDate");
  const body = document.getElementById("rangeTableBody");

  if (!startInput || !endInput || !body) return;
  body.innerHTML = "";

  const startDate = startInput.value;
  const endDate   = endInput.value;

  let startIdx = startDate ? dateToIndex(startDate) : 0;
  let endIdx   = endDate   ? dateToIndex(endDate)   : (dates.length - 1);

  if (startIdx === -1 && startDate) startIdx = nearestDateIndex(startDate);
  if (endIdx   === -1 && endDate)   endIdx   = nearestDateIndex(endDate);

  if (startIdx === -1 || endIdx === -1) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="3" style="opacity:.75">找不到對應日期（資料的日期格式可能跟你選的不一致）</td>`;
    body.appendChild(tr);
    return;
  }

  const from = Math.min(startIdx, endIdx);
  const to   = Math.max(startIdx, endIdx);

  for (let i = from; i <= to; i++) {
    const isGolden = maTripleGolden.includes(i);
    const isDead   = maTripleDeath.includes(i);

    if (!isGolden && !isDead) continue;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${dates[i]}</td>
      <td style="color:${isGolden?'gold':'inherit'}">${isGolden ? "✔" : ""}</td>
      <td style="color:${isDead?'red':'inherit'}">${isDead   ? "✔" : ""}</td>
    `;
    body.appendChild(tr);
  }
}


// ============= 三張圖一起更新 =============

function updateCharts() {
  if (!TOTAL_DAYS || TOTAL_DAYS <= 0) return;

  const startStr = document.getElementById("rangeStartDate")?.value || "";
  const endStr   = document.getElementById("rangeEndDate")?.value || "";

  // 這兩個你原本就有：dateToIndex / nearestDateIndex
  let s = startStr ? dateToIndex(startStr) : 0;
  let e = endStr   ? dateToIndex(endStr)   : (TOTAL_DAYS - 1);

  if (startStr && s < 0) s = nearestDateIndex(startStr);
  if (endStr && e < 0)   e = nearestDateIndex(endStr);

  if (!Number.isFinite(s) || s < 0) s = 0;
  if (!Number.isFinite(e) || e < 0) e = TOTAL_DAYS - 1;

  if (s > e) [s, e] = [e, s];

  chartStart = s;
  chartEnd = e;

  // 先照你原本流程更新資料/線條/annotation
  if (typeof updateKDChart === "function") updateKDChart();
  if (typeof updateMAChart === "function") updateMAChart();
  if (typeof updateVolumeChart === "function") updateVolumeChart();
  if (typeof updateMACDChart === "function") updateMACDChart();
  if (typeof updateRSIChart === "function") updateRSIChart();

  // 最後：統一把所有圖的 x 軸套用 zoom 範圍 + 強制 update
  const applyRange = (ch) => {
    if (!ch?.options?.scales?.x) return;

    ch.options.scales.x.min = chartStart;
    ch.options.scales.x.max = chartEnd;

    // 修正縮放後日期顯示：不要用 idx，直接用 val(=資料 index)
    if (ch.options.scales.x.ticks) {
      ch.options.scales.x.ticks.callback = (val) => dates[val] || "";
    }

    ch.update("none");
  };

  applyRange(kdChart);
  applyRange(maChart);
  applyRange(volumeChart);
  applyRange(macdChart);
  applyRange(rsiChart);
}



// ============= UI 綁定 =============

const radiusSliderEl = document.getElementById("radius");
const radiusInputEl  = document.getElementById("radiusInput");

if (radiusSliderEl && radiusInputEl) {
  radiusSliderEl.addEventListener("input", () => {
    radiusInputEl.value = radiusSliderEl.value;
    computeAll();
    updateCharts();
  });
  radiusInputEl.addEventListener("change", () => {
    let v = parseInt(radiusInputEl.value, 10);
    if (!Number.isFinite(v) || v < 2) v = 2;
    radiusSliderEl.value = v;
    computeAll();
    updateCharts();
  });
}

const maFastInput = document.getElementById("maFast");
if (maFastInput) {
  maFastInput.addEventListener("change", () => {
    updateMAChart();
    updateCrossStats();
    buildCrossRangeTable();
  });
}

const maSlowInput = document.getElementById("maSlow");
if (maSlowInput) {
  maSlowInput.addEventListener("change", () => {
    updateMAChart();
    updateCrossStats();
    buildCrossRangeTable();
  });
}

["kdOversold", "kdOverbought"].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("change", () => updateKDChart());
});

const rsiPeriodEl = document.getElementById("rsiPeriod");
const macdFastEl   = document.getElementById("macdFast");
const macdSlowEl   = document.getElementById("macdSlow");
const macdSignalEl = document.getElementById("macdSignal");

[macdFastEl, macdSlowEl, macdSignalEl].forEach(el => {
  if (!el) return;
  el.addEventListener("change", () => {
    computeAll();
    updateCharts();
  });
});
if (rsiPeriodEl) {
  rsiPeriodEl.addEventListener("change", () => {
    computeAll();
    updateCharts();
  });
}

["rsiOversold", "rsiOverbought"].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("change", () => updateRSIChart());
});

function bindToggleGroup(groupId, maxChecked = null) {
  const group = document.getElementById(groupId);
  if (!group) return;
  const labels = group.querySelectorAll(".toggle");

  labels.forEach(label => {
    const input = label.querySelector("input");
    if (!input) return;

    input.addEventListener("change", () => {
      if (maxChecked !== null) {
        const checkedInputs = group.querySelectorAll("input:checked");
        if (checkedInputs.length > maxChecked) {
          input.checked = false;
          label.classList.remove("active");
          return;
        }
      }

      if (input.checked) label.classList.add("active");
      else label.classList.remove("active");

      if (groupId === "kdSelect") {
        updateKDChart();
        updateCrossStats();
      } else {
        updateMAChart();
        updateCrossStats();
        buildCrossRangeTable();
      }
    });
  });
}

bindToggleGroup("kdSelect", 3);        // sidebar 的
bindToggleGroup("kdSelectChart", 3);   // KD chart header 的
bindToggleGroup("maSelect", null);

document.getElementById("rangeApply")?.addEventListener("click", () => {
  buildCrossRangeTable();
  updateCharts();
});

document.getElementById("rangeReset")?.addEventListener("click", () => {
  const sEl = document.getElementById("rangeStartDate");
  const eEl = document.getElementById("rangeEndDate");
  if (sEl) sEl.value = "";
  if (eEl) eEl.value = "";

  chartStart = 0;
  chartEnd = TOTAL_DAYS - 1;

  updateCharts();
});


// ===== Sidebar Toggle Script =====
const toggleBtn = document.getElementById("sidebarToggle");
const app = document.querySelector(".app");
const sidebar = document.getElementById("sidebar");
const closeBtn = document.getElementById("sidebarClose");

if (toggleBtn && app && sidebar) {
  toggleBtn.addEventListener("click", () => {
    sidebar.classList.toggle("collapsed");
    app.classList.toggle("shifted");
    toggleBtn.classList.toggle("shifted");
  });
}

if (closeBtn && app && sidebar && toggleBtn) {
  closeBtn.addEventListener("click", () => {
    sidebar.classList.add("collapsed");
    app.classList.remove("shifted");
    toggleBtn.classList.remove("shifted");
  });
}


// ============= 綠色區塊 Helper =============

// 產生 Golden → Dead 區段
function buildShadedRanges(goldenList, deadList) {
  const ranges = [];
  let g = 0, d = 0;

  while (g < goldenList.length && d < deadList.length) {
    const gIdx = goldenList[g].index;
    const dIdx = deadList[d].index;

    if (dIdx > gIdx) {
      ranges.push({ start: gIdx, end: dIdx });
      g++;
      d++;
    } else {
      d++;
    }
  }

  return ranges;
}

// 產生 Golden → Dead 區段 (indexes)
function buildShadedRangesFromIndexes(goldenIdxList, deadIdxList) {
  const ranges = [];
  let g = 0, d = 0;

  while (g < goldenIdxList.length && d < deadIdxList.length) {
    const gIdx = goldenIdxList[g];
    const dIdx = deadIdxList[d];

    if (dIdx > gIdx) {
      ranges.push({ start: gIdx, end: dIdx });
      g++;
      d++;
    } else d++;
  }
  return ranges;
}

// 將區段轉成 Chart.js annotation box
function buildAnnotationBoxes(ranges, color) {
  const obj = {};
  ranges.forEach((r, i) => {
    obj["box_" + i] = {
      type: "box",
      xMin: r.start,
      xMax: r.end,
      backgroundColor: color,
      borderWidth: 0,
      z: -10
    };
  });
  return obj;
}


// ===================== Simulator (add-on, does NOT change existing logic) =====================

// safe nearestDateIndex (your buildCrossRangeTable uses it)
function nearestDateIndex(anyDateStr) {
  if (!anyDateStr || !dates?.length) return -1;
  const t = new Date(anyDateStr);
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

function idxSetFromCrossList(list) {
  const s = new Set();
  (list || []).forEach(p => s.add(p.index));
  return s;
}

function intersectSets(sets) {
  if (!sets.length) return new Set();
  sets.sort((a,b)=>a.size-b.size);
  const [first, ...rest] = sets;
  const out = new Set();
  for (const v of first) {
    if (rest.every(s => s.has(v))) out.add(v);
  }
  return out;
}

// MA consensus cross (simulator-only)
function computeMAConsensusCross(requiredTypes, fastPeriod, slowPeriod) {
  const signalByIndex = {}; // idx -> { MA:'golden'/'death', ... }

  requiredTypes.forEach(type => {
    const fastArr = getMAArray(type, fastPeriod);
    const slowArr = getMAArray(type, slowPeriod);
    const crosses = detectCrosses(fastArr, slowArr, TOTAL_DAYS);

    crosses.golden.forEach(p => ((signalByIndex[p.index] ||= {})[type] = "golden"));
    crosses.death.forEach(p => ((signalByIndex[p.index] ||= {})[type] = "death"));
  });

  const golden = new Set();
  const death  = new Set();

  for (const k in signalByIndex) {
    const idx = parseInt(k, 10);
    const s = signalByIndex[k];

    const allGolden = requiredTypes.every(t => s[t] === "golden");
    const allDeath  = requiredTypes.every(t => s[t] === "death");

    if (allGolden) golden.add(idx);
    if (allDeath)  death.add(idx);
  }

  return { golden, death };
}


// ===================== Simulator: Fee / Tax helpers =====================
// Default values (used when corresponding navbar inputs are missing/invalid)
// Note: values are rates (e.g. 0.001425 = 0.1425%)
const DEFAULT_SIM_FEE_RATE = 0.001425;   // brokerage fee rate (buy & sell)
const DEFAULT_SIM_FEE_MIN  = 0.0;        // minimum fee per trade
const DEFAULT_SIM_FEE_MAX  = 1e100;      // cap (usually not needed)

const DEFAULT_SIM_TAX_RATE = 0.0;        // transaction tax rate (usually sell-only)
const DEFAULT_SIM_TAX_MIN  = 0.0;
const DEFAULT_SIM_TAX_MAX  = 1e100;

// Read simulator fee/tax parameters from navbar inputs (if they exist).
// Suggested IDs in HTML:
//   simFeeRate, simFeeMin, simFeeMax, simFeeDiscount
//   simTaxRate, simTaxMin, simTaxMax
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

// Calculate fee for a trade amount.
function calcFee(tradeAmount, feeRate, minFee, maxFee) {
  if (!Number.isFinite(tradeAmount) || tradeAmount <= 0) return 0;
  let fee = tradeAmount * feeRate;
  if (Number.isFinite(minFee)) fee = Math.max(minFee, fee);
  if (Number.isFinite(maxFee)) fee = Math.min(maxFee, fee);
  return fee;
}

// Calculate tax for a trade amount (typically sell-only).
function calcTax(tradeAmount, taxRate, minTax, maxTax) {
  if (!Number.isFinite(tradeAmount) || tradeAmount <= 0) return 0;
  let tax = tradeAmount * taxRate;
  if (Number.isFinite(minTax)) tax = Math.max(minTax, tax);
  if (Number.isFinite(maxTax)) tax = Math.min(maxTax, tax);
  return tax;
}

// Given current cash & price, find max shares you can buy after including fee.
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

// ✅ Your current function整理成可直接跑版本（保持你 UI ID）
function runSimulator() {
  const kNav = document.getElementById("simKpiNav");
  const kRoi = document.getElementById("simKpiRoi");
  const kTrd = document.getElementById("simKpiTrades");
  const kBH  = document.getElementById("simKpiBH");
  const meta = document.getElementById("simMeta");
  const logEl = document.getElementById("simLog");

  if (!kNav && !kRoi && !kTrd && !kBH && !meta && !logEl) {
    console.warn("[SIM] simulator UI not found (missing simKpiNav/simKpiRoi/simKpiTrades/simKpiBH/simMeta/simLog)");
    return;
  }

  if (!priceSeries?.length || !dates?.length) {
    if (meta) meta.textContent = "No data loaded.";
    if (logEl) logEl.textContent = "";
    if (kNav) kNav.textContent = "—";
    if (kRoi) kRoi.textContent = "—";
    if (kTrd) kTrd.textContent = "0";
    if (kBH)  kBH.textContent  = "—";
    return;
  }

  computeAll();

  const startIdx = toIndexOrDefault(document.getElementById("simStartDate")?.value, 0);
  const endIdx   = toIndexOrDefault(document.getElementById("simEndDate")?.value, dates.length - 1);

  const from = Math.max(0, Math.min(startIdx, endIdx));
  const to   = Math.min(dates.length - 1, Math.max(startIdx, endIdx));

  let fund = parseFloat(document.getElementById("simFund")?.value);
  if (!Number.isFinite(fund) || fund < 0) fund = 100000;

  const fillMode = document.getElementById("simFill")?.value || "signalClose";

  // Fee / Tax (editable via navbar inputs if present)
  const { feeRate, feeMin, feeMax, taxRate, taxMin, taxMax } = getSimFeeTaxParams();

  const needKD  = !!document.getElementById("simNeedKD")?.checked;
  const needSMA = !!document.getElementById("simNeedSMA")?.checked;
  const needWMA = !!document.getElementById("simNeedWMA")?.checked;
  const needEMA = !!document.getElementById("simNeedEMA")?.checked;

  const requiredMA = [];
  if (needSMA) requiredMA.push("MA");
  if (needWMA) requiredMA.push("WMA");
  if (needEMA) requiredMA.push("EMA");

  let X = parseInt(document.getElementById("maFast")?.value, 10);
  let Y = parseInt(document.getElementById("maSlow")?.value, 10);
  //暫時無視規則
  //if (!Number.isFinite(X) || X < 2) X = 5;
  //if (!Number.isFinite(Y) || Y <= X) Y = X + 1;

  const buySets = [];
  const sellSets = [];

  if (requiredMA.length) {
    const ma = computeMAConsensusCross(requiredMA, X, Y);
    buySets.push(ma.golden);
    sellSets.push(ma.death);
  }
  if (needKD) {
    buySets.push(idxSetFromCrossList(kdGolden));
    sellSets.push(idxSetFromCrossList(kdDeath));
  }

  if (!buySets.length || !sellSets.length) {
    if (meta) meta.textContent = "No conditions selected → no trades.";
    if (logEl) logEl.textContent = "";
    if (kNav) kNav.textContent = fund.toFixed(2);
    if (kRoi) kRoi.textContent = "0.00%";
    if (kTrd) kTrd.textContent = "0";
    if (kBH)  kBH.textContent  = "—";
    return;
  }

  const buyIdxSet  = intersectSets(buySets);
  const sellIdxSet = intersectSets(sellSets);
  if (buyIdxSet && buyIdxSet.delete) buyIdxSet.delete(from);
  if (sellIdxSet && sellIdxSet.delete) sellIdxSet.delete(from);
  let cash = fund;
  let shares = 0;
  let trades = 0;
  let totalFee = 0;
  let totalTax = 0;

  // logs as structured rows for table rendering
  const rows = []; // {side,date,price,shares,cash}

  const getFillIndex = (i) => {
    if (fillMode === "nextClose") return (i + 1 <= to ? i + 1 : -1);
    return i;
  };

  for (let i = from; i <= to; i++) {
    const px = priceSeries[i];
    if (!Number.isFinite(px)) continue;

    // SELL first
    if (shares > 0 && sellIdxSet.has(i)) {
      const fi = getFillIndex(i);
      if (fi !== -1 && Number.isFinite(priceSeries[fi])) {
        const sellPx = priceSeries[fi];
        const amount = shares * sellPx;
        const fee = calcFee(amount, feeRate, feeMin, feeMax);
        const tax = calcTax(amount, taxRate, taxMin, taxMax); // typically sell-only
        cash += (amount - fee - tax);
        totalFee += fee;
        totalTax += tax;
        rows.push({ side: "SELL", date: dates[fi], price: sellPx, shares, cash, fee, tax });
        shares = 0;
        trades++;
      }
      continue;
    }

    // BUY
    if (shares === 0 && buyIdxSet.has(i)) {
      const fi = getFillIndex(i);
      if (fi !== -1 && Number.isFinite(priceSeries[fi])) {
        const buyPx = priceSeries[fi];

        const canBuy = maxBuySharesWithFee(cash, buyPx, feeRate, feeMin, feeMax);
        if (canBuy > 0) {
          const amount = canBuy * buyPx;
          const fee = calcFee(amount, feeRate, feeMin, feeMax);
          const cost = amount + fee;

          shares = canBuy;
          cash -= cost;

          totalFee += fee;
          rows.push({ side: "BUY", date: dates[fi], price: buyPx, shares, cash, fee, tax: 0 });
          trades++;
        }
      }
    }
  }
  // FORCE CLOSE at end of range: if still holding shares, sell at the last bar close (index `to`)
// This keeps NAV consistent with "must be flat at the end" backtests and makes results comparable.
  if (shares > 0) {
    const fi = to; // force close uses the last available close; no nextClose beyond `to`
    const sellPx = priceSeries[fi];
    if (Number.isFinite(sellPx)) {
      const amount = shares * sellPx;

      // Optional: if fee/tax helpers exist in your page, apply them; otherwise fee/tax = 0
      let fee = 0;
      let tax = 0;
      if (typeof getSimFeeTaxParams === "function" &&
          typeof calcFee === "function" &&
          typeof calcTax === "function") {
        const p = getSimFeeTaxParams();
        const feeRate = Number.isFinite(p?.feeRate) ? p.feeRate : 0;
        const feeMin  = Number.isFinite(p?.feeMin)  ? p.feeMin  : 0;
        const feeMax  = Number.isFinite(p?.feeMax)  ? p.feeMax  : 1e100;

        const taxRate = Number.isFinite(p?.taxRate) ? p.taxRate : 0;
        const taxMin  = Number.isFinite(p?.taxMin)  ? p.taxMin  : 0;
        const taxMax  = Number.isFinite(p?.taxMax)  ? p.taxMax  : 1e100;

        fee = calcFee(amount, feeRate, feeMin, feeMax);
        tax = calcTax(amount, taxRate, taxMin, taxMax);
      }

      cash += (amount - fee - tax);
      rows.push({ side: "LAST_SELL", date: dates[fi], price: sellPx, shares, cash, fee, tax });
      shares = 0;
      trades++;
    }
  }

  const lastPx = priceSeries[to];
  const nav = cash + (shares > 0 && Number.isFinite(lastPx) ? shares * lastPx : 0);

  // Buy & Hold benchmark
  let bh = NaN;
  const p0 = priceSeries[from];
  const p1 = priceSeries[to];
  if (Number.isFinite(p0) && Number.isFinite(p1) && p0 > 0) {
    const bhShares = Math.floor(fund / p0);
    const bhCash = fund - bhShares * p0;
    bh = bhCash + bhShares * p1;
  }

  const roi = (nav - fund) / fund * 100;

  if (kNav) kNav.textContent = nav.toFixed(2);
  if (kRoi) {
    kRoi.textContent = `${roi.toFixed(2)}%`;
    kRoi.style.color = roi >= 0 ? "rgba(0,255,160,.95)" : "rgba(255,90,120,.95)";
  }
  if (kTrd) kTrd.textContent = String(trades);
  if (kBH)  kBH.textContent  = Number.isFinite(bh) ? bh.toFixed(2) : "—";

  if (meta) {
    meta.textContent =
      `Stock: ${selectedStock} | Range: ${dates[from]} → ${dates[to]} | ` +
      `Fill: ${fillMode} | Fund: ${fund.toFixed(2)} | FeeRate: ${feeRate} | TaxRate: ${taxRate} | Fees: ${totalFee.toFixed(2)} | Taxes: ${totalTax.toFixed(2)} | ` +
      `Conditions: ${[
        requiredMA.length ? `MA(${requiredMA.join("+")}) fast=${X} slow=${Y}` : null,
        needKD ? "KD" : null
      ].filter(Boolean).join(" + ")}`;
  }

  // Render trade log as a table inside the same container (simLog)
  if (logEl) {
    if (!rows.length) {
      logEl.innerHTML = `<div style="opacity:.75">(no trades)</div>`;
    } else {
      const maxRows = 400;
      const show = rows.slice(0, maxRows);

      const table = document.createElement("table");
      table.className = "sim-log-table";
      table.innerHTML = `
        <thead>
          <tr>
            <th>Side</th>
            <th>Date</th>
            <th>Price</th>
            <th>Shares</th>
            <th>Fee</th>
            <th>Tax</th>
            <th>Cash</th>
          </tr>
        </thead>
        <tbody></tbody>
      `;

      const tb = table.querySelector("tbody");
      show.forEach(r => {
        const tr = document.createElement("tr");
        tr.className = r.side === "BUY" ? "buy" : "sell";
        tr.innerHTML = `
          <td>${r.side}</td>
          <td>${r.date}</td>
          <td>${Number.isFinite(r.price) ? r.price.toFixed(2) : "—"}</td>
          <td>${r.shares}</td>
          <td>${Number.isFinite(r.fee) ? r.fee.toFixed(2) : "0.00"}</td>
          <td>${Number.isFinite(r.tax) ? r.tax.toFixed(2) : "0.00"}</td>
          <td>${Number.isFinite(r.cash) ? r.cash.toFixed(2) : "—"}</td>
        `;
        tb.appendChild(tr);
      });

      // clear & append
      logEl.innerHTML = "";
      logEl.appendChild(table);
    }
  }
}

// 綁定按鈕
const simRunBtn = document.getElementById("simRun");
if (simRunBtn) {
  simRunBtn.addEventListener("click", () => {
    runSimulator();
  });
}

// (Optional) expose to console if you want: window.runSimulator = runSimulator;
// window.runSimulator = runSimulator;


// ===================== Export Full Signal CSV (Range-anchored, starts calculating from startDate) =====================
// Usage in console:
//   exportFullSignalCSV("2024-01-01", "2024-12-31");
//   exportFullSignalCSV("2024/1/1", "2024/12/31", { smaShort:5, smaLong:20, emaShort:5, emaLong:20, wmaShort:5, wmaLong:20, kdLookback:9, kdSmooth:3, rsiPeriod:14 });

function exportFullSignalCSV(startDate, endDate, opts = {}) {
  if (!priceSeries?.length || !dates?.length) {
    console.warn("[CSV] No data loaded.");
    return;
  }

  // --- options ---
  const smaShort = Number.isFinite(+opts.smaShort) ? +opts.smaShort : 5;
  const smaLong  = Number.isFinite(+opts.smaLong)  ? +opts.smaLong  : 20;
  const emaShort = Number.isFinite(+opts.emaShort) ? +opts.emaShort : 5;
  const emaLong  = Number.isFinite(+opts.emaLong)  ? +opts.emaLong  : 20;
  const wmaShort = Number.isFinite(+opts.wmaShort) ? +opts.wmaShort : 5;
  const wmaLong  = Number.isFinite(+opts.wmaLong)  ? +opts.wmaLong  : 20;

  const kdLookback = Number.isFinite(+opts.kdLookback) ? +opts.kdLookback : 9;  // RSV lookback
  const kdSmooth   = Number.isFinite(+opts.kdSmooth)   ? +opts.kdSmooth   : 3;  // K/D smoothing period (alpha=1/kdSmooth)

  const rsiPeriod  = Number.isFinite(+opts.rsiPeriod)  ? +opts.rsiPeriod  : 14;

  const rsiOversold = Number.isFinite(+opts.rsiOversold)
    ? +opts.rsiOversold
    : (parseFloat(document.getElementById("rsiOversold")?.value) || 30);

  const rsiOverbought = Number.isFinite(+opts.rsiOverbought)
    ? +opts.rsiOverbought
    : (parseFloat(document.getElementById("rsiOverbought")?.value) || 70);

  // --- helpers (local, so this function is copy-paste friendly) ---
  const fmtDate = (dtStr) => {
    const d = new Date(dtStr);
    if (isNaN(d.getTime())) return String(dtStr || "");
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  };

  const safe = (x) => Number.isFinite(x) ? x : NaN;
  const outNumOrDash = (x) => (Number.isFinite(x) ? x.toFixed(2) : "-");

  const escapeCSV = (s) => {
    const str = String(s ?? "");
    if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  };

  // --- resolve range indices ---
  const fromIdx = toIndexOrDefault(startDate, 0);
  const toIdx   = toIndexOrDefault(endDate, dates.length - 1);

  let from = Math.max(0, Math.min(fromIdx, toIdx));
  let to   = Math.min(dates.length - 1, Math.max(fromIdx, toIdx));

  const close = priceSeries.slice(from, to + 1);
  const ds    = dates.slice(from, to + 1);
  const n     = close.length;

  // --- rolling SMA/WMA (range-anchored) ---
  function smaArr(period) {
    const arr = Array(n).fill(NaN);
    if (period < 2) return arr;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const v = safe(close[i]);
      if (!Number.isFinite(v)) { sum = NaN; continue; }
      if (!Number.isFinite(sum)) sum = 0;

      sum += v;
      if (i >= period) {
        const old = safe(close[i - period]);
        if (Number.isFinite(old)) sum -= old;
        else { // window breaks
          sum = 0;
          for (let j = i - period + 1; j <= i; j++) {
            const vv = safe(close[j]);
            if (!Number.isFinite(vv)) { sum = NaN; break; }
            sum += vv;
          }
        }
      }
      if (i >= period - 1 && Number.isFinite(sum)) arr[i] = sum / period;
    }
    return arr;
  }

  function wmaArr(period) {
    const arr = Array(n).fill(NaN);
    if (period < 2) return arr;
    const wsum = (period * (period + 1)) / 2;
    for (let i = period - 1; i < n; i++) {
      let sum = 0;
      let ok = true;
      let w = 1;
      for (let j = i - period + 1; j <= i; j++, w++) {
        const v = safe(close[j]);
        if (!Number.isFinite(v)) { ok = false; break; }
        sum += v * w;
      }
      if (ok) arr[i] = sum / wsum;
    }
    return arr;
  }

  // --- EMA (seed = first close in range) ---
  function emaArr(period) {
    const arr = Array(n).fill(NaN);
    if (period < 2) return arr;
    const alpha = 2 / (period + 1);

    let run = safe(close[0]);
    if (!Number.isFinite(run)) return arr;

    arr[0] = run;
    for (let i = 1; i < n; i++) {
      const v = safe(close[i]);
      if (!Number.isFinite(v) || !Number.isFinite(run)) { run = NaN; arr[i] = NaN; continue; }
      run = run * (1 - alpha) + v * alpha;
      arr[i] = run;
    }
    return arr;
  }

  // --- KD (range-anchored, lookback includes current day so day#lookback is valid) ---
  function kdArrays(lookback, smooth) {
    const RSV = Array(n).fill(NaN);
    const K = Array(n).fill(NaN);
    const D = Array(n).fill(NaN);

    if (lookback < 2 || smooth < 1) return { RSV, K, D };

    for (let i = lookback - 1; i < n; i++) {
      let mn = Infinity;
      let mx = -Infinity;
      let ok = true;

      for (let j = i - lookback + 1; j <= i; j++) {
        const v = safe(close[j]);
        if (!Number.isFinite(v)) { ok = false; break; }
        mn = Math.min(mn, v);
        mx = Math.max(mx, v);
      }

      const c = safe(close[i]);
      if (!ok || !Number.isFinite(c) || mx === mn) { RSV[i] = NaN; continue; }
      RSV[i] = clampKD(((c - mn) / (mx - mn)) * 100);
    }

    const alpha = 1 / smooth;
    let prevK = 50;
    let prevD = 50;

    for (let i = 0; i < n; i++) {
      const r = RSV[i];
      if (!Number.isFinite(r)) continue;
      const k = prevK * (1 - alpha) + r * alpha;
      const d = prevD * (1 - alpha) + k * alpha;
      K[i] = clampKD(k);
      D[i] = clampKD(d);
      prevK = k;
      prevD = d;
    }

    return { RSV, K, D };
  }

  // --- RSI (Wilder, range-anchored) ---
  function rsiArr(period) {
    const arr = Array(n).fill(NaN);
    if (period < 2 || n <= period) return arr;

    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
      const a = safe(close[i - 1]);
      const b = safe(close[i]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return arr;
      const diff = b - a;
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;
    let rs = (avgLoss === 0) ? Infinity : (avgGain / avgLoss);
    arr[period] = clampKD(100 - 100 / (1 + rs));

    for (let i = period + 1; i < n; i++) {
      const a = safe(close[i - 1]);
      const b = safe(close[i]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) { arr[i] = NaN; continue; }
      const diff = b - a;
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;

      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;

      rs = (avgLoss === 0) ? Infinity : (avgGain / avgLoss);
      arr[i] = clampKD(100 - 100 / (1 + rs));
    }

    return arr;
  }

  // --- compute series ---
  const smaS = smaArr(smaShort);
  const smaL = smaArr(smaLong);
  const emaS = emaArr(emaShort);
  const emaL = emaArr(emaLong);
  const wmaS = wmaArr(wmaShort);
  const wmaL = wmaArr(wmaLong);
  const kd   = kdArrays(kdLookback, kdSmooth);
  const rsi  = rsiArr(rsiPeriod);

  // --- cross markers (SMA short vs long, K vs D) ---
  const maCross = Array(n).fill("");
  const kdCross = Array(n).fill("");

  // MA cross
  {
    let prevDiff = null;
    for (let i = 0; i < n; i++) {
      const a = smaS[i], b = smaL[i];
      if (!Number.isFinite(a) || !Number.isFinite(b)) { prevDiff = null; continue; }
      const diff = a - b;
      if (prevDiff !== null) {
        if (prevDiff <= 0 && diff > 0) maCross[i] = "黃金交叉";
        else if (prevDiff >= 0 && diff < 0) maCross[i] = "死亡交叉";
      }
      prevDiff = diff;
    }
  }

  // KD cross
  {
    let prevDiff = null;
    for (let i = 0; i < n; i++) {
      const a = kd.K[i], b = kd.D[i];
      if (!Number.isFinite(a) || !Number.isFinite(b)) { prevDiff = null; continue; }
      const diff = a - b;
      if (prevDiff !== null) {
        if (prevDiff <= 0 && diff > 0) kdCross[i] = "黃金交叉";
        else if (prevDiff >= 0 && diff < 0) kdCross[i] = "死亡交叉";
      }
      prevDiff = diff;
    }
  }

  // RSI signal
  const rsiSig = Array(n).fill("");
  {
    let prev = NaN;
    for (let i = 0; i < n; i++) {
      const cur = rsi[i];
      if (!Number.isFinite(cur)) continue;

      if (Number.isFinite(prev)) {
        if (prev < 50 && cur >= 50) rsiSig[i] = "RSI 50上穿";
        else if (prev > 50 && cur <= 50) rsiSig[i] = "RSI 50下破";
      }

      if (!rsiSig[i]) {
        if (cur <= rsiOversold) rsiSig[i] = "Oversold";
        else if (cur >= rsiOverbought) rsiSig[i] = "Overbought";
      }

      prev = cur;
    }
  }

  // --- build CSV ---
  const header = [
    "日期",
    "收盤價",
    `MA短期(${smaShort})`,
    `MA長期(${smaLong})`,
    `EMA短期(${emaShort})`,
    `EMA長期(${emaLong})`,
    `WMA短期(${wmaShort})`,
    `WMA長期(${wmaLong})`,
    `K值`,
    `D值`,
    "RSI",
    "MA交叉",
    "KD交叉",
    "RSI信號"
  ];

  const lines = [];
  lines.push(header.map(escapeCSV).join(","));

  for (let i = 0; i < n; i++) {
    const row = [
      fmtDate(ds[i]),
      outNumOrDash(safe(close[i])),
      outNumOrDash(smaS[i]),
      outNumOrDash(smaL[i]),
      outNumOrDash(emaS[i]),
      outNumOrDash(emaL[i]),
      outNumOrDash(wmaS[i]),
      outNumOrDash(wmaL[i]),
      outNumOrDash(kd.K[i]),
      outNumOrDash(kd.D[i]),
      outNumOrDash(rsi[i]),
      maCross[i],
      kdCross[i],
      rsiSig[i]
    ];
    lines.push(row.map(escapeCSV).join(","));
  }

  const csv = lines.join("\n");

  // --- download ---
  const name = `${selectedStock || "STOCK"}_signals_${fmtDate(ds[0]).replaceAll("/", "-")}_to_${fmtDate(ds[n - 1]).replaceAll("/", "-")}.csv`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);

  console.log(`[CSV] Downloaded: ${name} (${n} rows)`);
}

// expose to console
window.exportFullSignalCSV = exportFullSignalCSV;

