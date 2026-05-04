const POLYGON_KEY = ""; // Replace with your key from polygon.io

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const memCache = {};
const _companyContextCache = {};
let lastPolyCall = 0;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function subtractDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function readFromStorage(key) {
  return new Promise(resolve => {
    chrome.storage.local.get([key], result => {
      const entry = result[key];
      if (!entry) return resolve(null);
      if (Date.now() - entry.ts > CACHE_TTL) {
        chrome.storage.local.remove([key]);
        return resolve(null);
      }
      resolve(entry.data);
    });
  });
}

function writeToStorage(key, data) {
  chrome.storage.local.set({ [key]: { data, ts: Date.now() } });
}

async function fetchRawSeries(ticker, articleDate) {
  const articleDateOnly = articleDate.slice(0, 10);

  function coversDate(cached) {
    if (!cached || cached.error || !cached.series || cached.series.length === 0) return false;
    const diffDays = (new Date(articleDateOnly) - new Date(cached.series[0].date)) / 86400000;
    return diffDays <= 5;
  }

  if (memCache[ticker]) {
    if (coversDate(memCache[ticker])) {
      console.log(`[mem-cache] ${ticker}`);
      return memCache[ticker];
    }
    delete memCache[ticker];
  }

  const stored = await readFromStorage(`poly_${ticker}`);
  if (stored) {
    if (coversDate(stored)) {
      memCache[ticker] = stored;
      return stored;
    }
    chrome.storage.local.remove([`poly_${ticker}`]);
  }

  const wait = Math.max(0, 2000 - (Date.now() - lastPolyCall));
  if (wait > 0) await sleep(wait);
  lastPolyCall = Date.now();

  const fromDate = subtractDays(articleDate, 90);
  const toDate = articleDate;
  const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${fromDate}/${toDate}?adjusted=true&sort=desc&limit=60&apiKey=${POLYGON_KEY}`;

  try {
    const resp = await fetch(url);
    const data = await resp.json();
    console.log(`[api-fetch] ${ticker} — status: ${data.status}, count: ${data.resultsCount}`);

    if (data.status === "ERROR" || data.status === "NOT_FOUND") {
      const result = { error: "UNSUPPORTED_TICKER" };
      memCache[ticker] = result;
      writeToStorage(`poly_${ticker}`, result);
      return result;
    }

    if (!data.results || data.results.length === 0) {
      if (data.message && data.message.toLowerCase().includes("rate")) {
        return { error: "API_LIMIT" };
      }
      const result = { error: "NO_SERIES" };
      memCache[ticker] = result;
      return result;
    }

    const series = data.results.map(bar => ({
      date: new Date(bar.t).toISOString().slice(0, 10),
      close: bar.c
    }));

    const result = { series };
    memCache[ticker] = result;
    writeToStorage(`poly_${ticker}`, result);
    return result;

  } catch (err) {
    console.error(`[network-error] ${ticker}:`, err);
    return { error: "NETWORK_ERROR" };
  }
}

export async function fetchPriceAtDate(ticker, articleDate) {
  const raw = await fetchRawSeries(ticker, articleDate);
  if (raw.error) return raw;

  const targetDate = articleDate.slice(0, 10);
  for (const bar of raw.series) {
    if (bar.date <= targetDate) {
      return { date: bar.date, close: bar.close };
    }
  }
  return { error: "NO_MATCH" };
}

export async function fetchHistoricalPrices(ticker, articleDate, days = 60) {
  const raw = await fetchRawSeries(ticker, articleDate);
  if (raw.error) return raw;

  const targetDate = articleDate.slice(0, 10);
  const historical = [];
  for (const bar of raw.series) {
    if (bar.date < targetDate) {
      historical.push({ date: bar.date, close: bar.close });
      if (historical.length >= days) break;
    }
  }
  return historical.length > 0 ? historical : { error: "NO_HISTORICAL_DATA" };
}

export async function getCompanyContext(ticker) {
  if (_companyContextCache[ticker]) return _companyContextCache[ticker];

  const stored = await readFromStorage(`ctx_${ticker}`);
  if (stored) {
    _companyContextCache[ticker] = stored;
    return stored;
  }

  let context = `${ticker} — company details unavailable.`;
  try {
    const wait = Math.max(0, 2000 - (Date.now() - lastPolyCall));
    if (wait > 0) await sleep(wait);
    lastPolyCall = Date.now();

    const resp = await fetch(`https://api.polygon.io/v3/reference/tickers/${ticker}?apiKey=${POLYGON_KEY}`);
    const data = await resp.json();
    if (data.status === "OK" && data.results) {
      const r = data.results;
      const name = r.name || ticker;
      const sic = r.sic_description || "N/A";
      let description = r.description || "";
      if (description.length > 300) description = description.substring(0, 297) + "...";
      context =
        `Company: ${name} (${ticker})\n` +
        `Sector/Industry: ${sic}\n` +
        `Description: ${description}`;
      writeToStorage(`ctx_${ticker}`, context);
    }
  } catch (err) {
    console.warn(`yfinance-equivalent lookup failed for ${ticker}:`, err);
  }

  _companyContextCache[ticker] = context;
  return context;
}

export function buildPriceSummary(ticker, historical) {
  if (!Array.isArray(historical) || historical.length === 0) {
    return "Historical price data unavailable.";
  }

  // historical comes back newest-first; reverse to chronological order
  const sorted = [...historical].reverse();
  const closes = sorted.map(h => h.close);
  const dates = sorted.map(h => h.date);
  const n = closes.length;
  const currentPrice = closes[n - 1];

  const lines = [
    `Price summary for ${ticker} (as of ${dates[n - 1]}, ${n} trading days of history):`,
    `Current price: $${currentPrice.toFixed(2)}`
  ];

  const recentN = Math.min(10, n);
  if (recentN >= 2) {
    lines.push(`\nRecent daily moves (last ${recentN} trading days):`);
    const startIdx = n - recentN;
    for (let i = Math.max(startIdx, 1); i < n; i++) {
      const pct = (closes[i] - closes[i - 1]) / closes[i - 1] * 100;
      const arrow = pct >= 0 ? "↑" : "↓";
      lines.push(`  ${dates[i]}: ${arrow} ${Math.abs(pct).toFixed(2)}%`);
    }
  }

  function pctChangeOver(period) {
    if (n > period) {
      const old = closes[n - 1 - period];
      return (currentPrice - old) / old * 100;
    }
    return null;
  }
  for (const [label, period] of [["5-day", 5], ["20-day", 20], ["60-day", 60]]) {
    const pct = pctChangeOver(period);
    if (pct !== null) {
      const direction = pct >= 0 ? "up" : "down";
      lines.push(`${label} trend: ${direction} ${Math.abs(pct).toFixed(2)}%`);
    }
  }

  const smaSection = [];
  for (const window of [10, 20, 50]) {
    if (n >= window) {
      const slice = closes.slice(n - window);
      const sma = slice.reduce((a, b) => a + b, 0) / window;
      const position = currentPrice >= sma ? "ABOVE" : "BELOW";
      smaSection.push(`  ${window}-day SMA: $${sma.toFixed(2)} (price is ${position})`);
    }
  }
  if (smaSection.length) {
    lines.push("\nMoving averages:");
    lines.push(...smaSection);
  }

  if (n >= 21) {
    const dailyAbsPct = [];
    for (let i = n - 20; i < n; i++) {
      dailyAbsPct.push(Math.abs(closes[i] - closes[i - 1]) / closes[i - 1] * 100);
    }
    const avgVol = dailyAbsPct.reduce((a, b) => a + b, 0) / dailyAbsPct.length;
    lines.push(`\n20-day average absolute daily move (volatility): ${avgVol.toFixed(2)}%`);
  }

  if (n >= 20) {
    const last20 = closes.slice(n - 20);
    const high20 = Math.max(...last20);
    const low20 = Math.min(...last20);
    lines.push(`20-day closing range: $${low20.toFixed(2)} – $${high20.toFixed(2)}`);
  }

  return lines.join("\n");
}
