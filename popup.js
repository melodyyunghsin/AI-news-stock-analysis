// Built-in defaults — users can override per-installation in the Settings panel.
const FALLBACK_GEMINI_API_KEY = ""; //
const POLYGON_KEY = ""; // Replace with your key from polygon.io

// ============================================================
// LLM PROVIDER SETTINGS
// ============================================================
const LLM_DEFAULTS = {
  llm_provider:    "gemini",                       // "gemini" | "qwen"
  gemini_api_key:  "",                              // user-supplied; falls back to built-in
  gemini_model:    "gemini-2.5-flash",              // 2.0-flash is being deprecated
  ollama_url:      "http://localhost:11434/v1",
  qwen_model:      "qwen2.5:7b"
};

let llmSettings = { ...LLM_DEFAULTS };

function loadLlmSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(Object.keys(LLM_DEFAULTS), data => {
      llmSettings = { ...LLM_DEFAULTS, ...data };
      resolve(llmSettings);
    });
  });
}

function saveLlmSettings(updates) {
  Object.assign(llmSettings, updates);
  return new Promise(resolve => {
    chrome.storage.local.set(updates, resolve);
  });
}

// ============================================================
// CONFIG (adapted from Evaluation_v2/qwen_predict.py)
// Note: relevance gating is intentionally omitted — discovery mode
// already pre-filters to relevant tickers, and single-ticker mode
// is the user's explicit choice. Every ticker gets a prediction.
// ============================================================
const K_SAMPLES = 1;               // Self-consistency samples (1 = legacy, >1 = majority vote)
const SAMPLE_TEMPERATURE = 0.8;
const MAX_RETRIES = 3;
const ARTICLE_TEXT_LIMIT = 3000;   // Match Python pipeline (was 8000)

const HORIZON_INSTRUCTIONS = {
  "1d":  "Focus on immediate market reaction. Consider whether this news is likely already priced in. Short-term sentiment and momentum dominate.",
  "3d":  "Consider both immediate reaction and follow-on effects. Weigh whether the identified factors have short-term or medium-term implications.",
  "5d":  "Consider both immediate reaction and follow-on effects. Weigh whether the identified factors have short-term or medium-term implications.",
  "10d": "Focus on structural and fundamental impacts. Consider industry dynamics, competitive positioning, and whether this news changes the medium-term outlook. Short-term noise is less relevant.",
  "21d": "Focus on structural and fundamental impacts. Consider industry dynamics, competitive positioning, and whether this news changes the medium-term outlook. Short-term noise is less relevant."
};

/***** Load ticker reliability data *****/
let tickerReliabilityByHorizon = {};

fetch(chrome.runtime.getURL("extension_data/ticker_reliability_by_horizon.json"))
  .then(res => res.json())
  .then(data => tickerReliabilityByHorizon = data)
  .catch(err => console.error("Failed to load reliability data", err));

/***** Bookmarks *****/
document.addEventListener("DOMContentLoaded", () => {
  loadBookmarks();
  initSettingsUI();
});
document.getElementById("bookmarkStock").addEventListener("click", saveBookmark);
document.getElementById("analyze").addEventListener("click", () => {
  const stock = document.getElementById("stockInput").value.trim().toUpperCase();
  analyzeStock(stock);
});

/***** Settings UI *****/
async function initSettingsUI() {
  await loadLlmSettings();

  const toggle      = document.getElementById("settingsToggle");
  const body        = document.getElementById("settingsBody");
  const providerSel = document.getElementById("llmProvider");
  const apiKeyInput = document.getElementById("geminiApiKey");
  const geminiModel = document.getElementById("geminiModel");
  const ollamaUrl   = document.getElementById("ollamaUrl");
  const qwenModel   = document.getElementById("qwenModel");
  const geminiBox   = document.getElementById("geminiFields");
  const qwenBox     = document.getElementById("qwenFields");
  const saveBtn     = document.getElementById("saveSettings");
  const statusDiv   = document.getElementById("settingsStatus");
  const modelLabel  = document.getElementById("currentModelLabel");

  // Populate inputs from saved settings
  providerSel.value = llmSettings.llm_provider;
  apiKeyInput.value = llmSettings.gemini_api_key;
  geminiModel.value = llmSettings.gemini_model;
  ollamaUrl.value   = llmSettings.ollama_url;
  qwenModel.value   = llmSettings.qwen_model;
  refreshProviderVisibility();
  refreshModelLabel();

  toggle.addEventListener("click", () => {
    toggle.classList.toggle("expanded");
    body.classList.toggle("expanded");
  });

  providerSel.addEventListener("change", refreshProviderVisibility);

  saveBtn.addEventListener("click", async () => {
    await saveLlmSettings({
      llm_provider:   providerSel.value,
      gemini_api_key: apiKeyInput.value.trim(),
      gemini_model:   geminiModel.value.trim() || LLM_DEFAULTS.gemini_model,
      ollama_url:     ollamaUrl.value.trim()   || LLM_DEFAULTS.ollama_url,
      qwen_model:     qwenModel.value.trim()   || LLM_DEFAULTS.qwen_model
    });
    refreshModelLabel();
    statusDiv.textContent = "Saved.";
    statusDiv.className = "settings-status ok";
    setTimeout(() => { statusDiv.textContent = ""; statusDiv.className = "settings-status"; }, 1800);
  });

  function refreshProviderVisibility() {
    const isQwen = providerSel.value === "qwen";
    geminiBox.style.display = isQwen ? "none" : "";
    qwenBox.style.display   = isQwen ? "" : "none";
  }

  function refreshModelLabel() {
    if (llmSettings.llm_provider === "qwen") {
      modelLabel.textContent = `Ollama · ${llmSettings.qwen_model}`;
    } else {
      modelLabel.textContent = `Gemini · ${llmSettings.gemini_model}`;
    }
  }
}

function saveBookmark() {
  const stock = document.getElementById("stockInput").value.trim().toUpperCase();
  if (!stock) return alert("Enter a stock ticker");
  chrome.storage.sync.get(["bookmarks"], data => {
    const list = data.bookmarks || [];
    if (!list.includes(stock)) list.push(stock);
    chrome.storage.sync.set({ bookmarks: list }, loadBookmarks);
  });
}

function removeBookmark(stock) {
  chrome.storage.sync.get(["bookmarks"], data => {
    const list = (data.bookmarks || []).filter(s => s !== stock);
    chrome.storage.sync.set({ bookmarks: list }, loadBookmarks);
  });
}

function loadBookmarks() {
  chrome.storage.sync.get(["bookmarks"], data => {
    const list = data.bookmarks || [];
    const container = document.getElementById("bookmarks");
    container.innerHTML = "";
    list.forEach(stock => {
      const wrapper = document.createElement("div");
      wrapper.className = "bookmark-item";

      const btn = document.createElement("button");
      btn.textContent = stock;
      btn.className = "bookmark-button";
      btn.onclick = () => {
        document.getElementById("stockInput").value = stock;
        analyzeStock(stock);
      };

      const removeBtn = document.createElement("button");
      removeBtn.textContent = "×";
      removeBtn.className = "remove-bookmark-button";
      removeBtn.onclick = () => removeBookmark(stock);

      wrapper.appendChild(btn);
      wrapper.appendChild(removeBtn);
      container.appendChild(wrapper);
    });
  });
}

/***** Polygon.io series cache *****/
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const memCache = {};
let lastPolyCall = 0;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function subtractDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

async function readFromStorage(key) {
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

async function fetchPriceAtDate(ticker, articleDate) {
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

async function fetchHistoricalPrices(ticker, articleDate, days = 60) {
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

/***** Reliability Badge *****/
function getReliabilityInfo(ticker, horizon) {
  const tickerData = tickerReliabilityByHorizon[ticker];
  if (!tickerData) return { label: "Insufficient History", cls: "none", text: "No data available for this ticker" };
  const info = tickerData[horizon];
  if (!info || info.samples < 10) return { label: "Insufficient History", cls: "none", text: `Only ${info?.samples ?? 0} samples — need ≥10` };
  if (info.avg_hierarchical_score >= 0.3)
    return { label: "High", cls: "high", text: `${Math.round(info.direction_accuracy * 100)}% direction accuracy` };
  if (info.avg_hierarchical_score >= 0.15)
    return { label: "Medium", cls: "medium", text: `${Math.round(info.direction_accuracy * 100)}% direction accuracy` };
  return { label: "Low", cls: "low", text: `${Math.round(info.direction_accuracy * 100)}% direction accuracy` };
}

// ============================================================
// LLM HELPERS
// ============================================================

function cleanRawOutput(text) {
  if (!text) return null;
  return text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

function extractJSON(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch (e) {}

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try { return JSON.parse(text.substring(firstBrace, lastBrace + 1)); } catch (e) {}
  }
  const firstBracket = text.indexOf("[");
  const lastBracket = text.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    try { return JSON.parse(text.substring(firstBracket, lastBracket + 1)); } catch (e) {}
  }
  return null;
}

async function callLLM(prompt, temperature = null) {
  if (llmSettings.llm_provider === "qwen") {
    return callOllama(prompt, temperature);
  }
  return callGemini(prompt, temperature);
}

function validateLlmCredentials() {
  if (llmSettings.llm_provider === "qwen") return;
  const apiKey = (llmSettings.gemini_api_key || "").trim() || FALLBACK_GEMINI_API_KEY;
  if (!apiKey) throw new Error("No Gemini API key. Open Model Settings to add one.");
}

async function callGemini(prompt, temperature = null) {
  const apiKey = (llmSettings.gemini_api_key || "").trim() || FALLBACK_GEMINI_API_KEY;
  if (!apiKey) throw new Error("No Gemini API key. Open Model Settings to add one.");
  const model = (llmSettings.gemini_model || "").trim() || LLM_DEFAULTS.gemini_model;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }]
  };
  if (temperature !== null && temperature !== undefined) {
    body.generationConfig = { temperature };
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }
  );
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Gemini API error: ${response.status} ${response.statusText} ${errText}`);
  }
  const text = (await response.json())?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return cleanRawOutput(text);
}

async function callOllama(prompt, temperature = null) {
  const baseUrl = (llmSettings.ollama_url || LLM_DEFAULTS.ollama_url).replace(/\/+$/, "");
  const model = (llmSettings.qwen_model || "").trim() || LLM_DEFAULTS.qwen_model;

  const body = {
    model,
    messages: [{ role: "user", content: prompt }]
  };
  if (temperature !== null && temperature !== undefined) {
    body.temperature = temperature;
  }

  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (err) {
    throw new Error(`Cannot reach Ollama at ${baseUrl}. Is it running? (start with OLLAMA_ORIGINS=* to allow extension requests)`);
  }
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Ollama error: ${response.status} ${response.statusText} ${errText}`);
  }
  const text = (await response.json())?.choices?.[0]?.message?.content || "";
  return cleanRawOutput(text);
}

// ============================================================
// COMPANY CONTEXT (Polygon reference, with cache + graceful fallback)
// ============================================================

const _companyContextCache = {};

async function getCompanyContext(ticker) {
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

// ============================================================
// PRICE SUMMARY (replaces raw price dump)
// ============================================================

function buildPriceSummary(ticker, historical) {
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

  // Recent daily moves (last 10 days)
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

  // Trend summaries
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

  // Simple Moving Averages
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

  // Volatility
  if (n >= 21) {
    const dailyAbsPct = [];
    for (let i = n - 20; i < n; i++) {
      dailyAbsPct.push(Math.abs(closes[i] - closes[i - 1]) / closes[i - 1] * 100);
    }
    const avgVol = dailyAbsPct.reduce((a, b) => a + b, 0) / dailyAbsPct.length;
    lines.push(`\n20-day average absolute daily move (volatility): ${avgVol.toFixed(2)}%`);
  }

  // Recent range
  if (n >= 20) {
    const last20 = closes.slice(n - 20);
    const high20 = Math.max(...last20);
    const low20 = Math.min(...last20);
    lines.push(`20-day closing range: $${low20.toFixed(2)} – $${high20.toFixed(2)}`);
  }

  return lines.join("\n");
}

// ============================================================
// PROMPTS — two-step pipeline (matches qwen_predict.py)
// ============================================================

function buildFactorExtractionPrompt(ticker, text, companyContext, date) {
  const t = text.trim().substring(0, ARTICLE_TEXT_LIMIT);
  return `You are an expert financial analyst. Your task is to extract specific causal factors from the article below that could affect the stock price of ${ticker}.

${companyContext}

Temporal restriction: Pretend today is ${date}. Use ONLY information that would be known on or before that date. NO hindsight.

Article:
"""${t}"""

Instructions:
- "relevance": a float from 0.0 to 1.0 indicating how directly this article relates to ${ticker}
  - 0.8–1.0: article is primarily about ${ticker}, discusses its earnings/products/strategy directly
  - 0.5–0.7: article discusses ${ticker} substantially alongside other companies
  - 0.2–0.4: article mentions ${ticker} but focuses on its sector, competitors, or a related topic
  - 0.0–0.1: ${ticker} is mentioned in passing (in a list, disclaimer, or brief comparison)
- "relevance_reasoning": one sentence explaining why you gave this relevance score
- Identify 3 to 5 specific factors from this article that could influence ${ticker}'s stock price.
- For each factor, provide:
  - "factor": a short description of the causal factor (1-2 sentences)
  - "direction": "positive" or "negative" (the expected impact on ${ticker}'s stock price)
  - "time_horizon": "short-term" (1-5 days), "medium-term" (1-4 weeks), or "long-term" (months+)
  - "confidence": "high", "medium", or "low"
- If the article is NOT directly about ${ticker}, still identify indirect effects (industry trends, competitor news, macro factors) but mark confidence as "low" or "medium".
- Consider supply chain effects, competitive dynamics, regulatory implications, and market sentiment.

You MUST output ONLY a valid JSON object. NO markdown. NO code fences. NO commentary.

Return this structure:
{
  "relevance": 0.0 to 1.0,
  "relevance_reasoning": "one sentence",
  "factors": [
    {"factor": "...", "direction": "positive", "time_horizon": "short-term", "confidence": "high"},
    {"factor": "...", "direction": "negative", "time_horizon": "medium-term", "confidence": "medium"}
  ]
}`;
}

function formatFactorsForPrediction(factorsData) {
  let factorsList = [];
  if (factorsData && Array.isArray(factorsData.factors)) factorsList = factorsData.factors;
  else if (Array.isArray(factorsData)) factorsList = factorsData;
  else return "Factor extraction failed. Analyze the article directly.";

  if (factorsList.length === 0) return "No specific factors identified. Analyze the article directly.";

  const lines = ["Extracted causal factors:"];
  factorsList.forEach((f, i) => {
    const factor = f.factor ?? "N/A";
    const direction = f.direction ?? "N/A";
    const horizon = f.time_horizon ?? "N/A";
    const confidence = f.confidence ?? "N/A";
    lines.push(`  ${i + 1}. ${factor}`);
    lines.push(`     Impact: ${direction} | Horizon: ${horizon} | Confidence: ${confidence}`);
  });
  return lines.join("\n");
}

function buildPredictionPrompt(articleId, date, ticker, text, horizon,
                               priceSummary, companyContext, factorsText,
                               relevance, relevanceReasoning) {
  const t = text.trim().substring(0, ARTICLE_TEXT_LIMIT);
  const horizonInstruction = HORIZON_INSTRUCTIONS[horizon] ?? "";

  return `You are an expert financial analyst predicting stock price direction for ${ticker}.

${companyContext}

Article relevance to ${ticker}: ${relevance.toFixed(2)} — ${relevanceReasoning}

${factorsText}

${priceSummary}

Horizon-specific guidance (${horizon}):
${horizonInstruction}

Original article (for reference):
"""${t}"""

Based on the causal factors above, the price data, and the article, predict whether ${ticker} will move UP or DOWN over the next ${horizon}.

Temporal restriction: Pretend you are predicting at ${date}. Use ONLY information known before or at that date. NO hindsight.

You MUST output ONLY valid JSON. NO markdown. NO code fences. NO extra text before or after.

Return EXACTLY this structure:

{
  "article_id": "${articleId}",
  "ticker": "${ticker}",
  "direction": "UP" | "DOWN",
  "confidence": number between 0.0 and 1.0,
  "explanation": "short explanation"
}

Rules:
- direction MUST be either "UP" or "DOWN"
- Even if the news seems mixed or loosely related, commit to whichever direction is more likely
- confidence: a number from 0.0 to 1.0 representing how confident you are in the DIRECTION prediction
  - 0.8–1.0: Strong conviction — clear directional signal
  - 0.6–0.8: Moderate conviction — likely direction but some uncertainty
  - 0.4–0.6: Low conviction — mixed signals, could go either way
  - Below 0.4: Very low conviction — essentially guessing
- confidence is about DIRECTION certainty, NOT about price magnitude
- explanation: 1-2 sentences justifying the direction
- ALWAYS include all 4 fields`;
}

function buildDiscoveryPrompt(date, articleText) {
  return `You are an expert in analyzing financial news, stock market and trading.
Given your expertise in the field, determine which US stock tickers (NYSE/NASDAQ) are most affected by the article.
You MUST output ONLY a valid JSON array of ticker strings. No markdown, no explanation.

Example: ["AAPL", "MSFT", "NVDA"]

Rules:
- Include ONLY US stock tickers (NYSE/NASDAQ) directly affected by this article
- Maximum 5 tickers, most impacted only
- No duplicates
- No hindsight bias — treat the article date as "now"

Article (published ${date}):
"${articleText.substring(0, ARTICLE_TEXT_LIMIT)}"`;
}

function normalizeTicker(ticker) {
  if (!ticker) return null;
  const t = ticker.toUpperCase().trim();
  if (t.includes(".")) {
    const base = t.split(".")[0];
    return /^[A-Z]{1,5}$/.test(base) ? base : null;
  }
  return /^[A-Z]{1,5}$/.test(t) ? t : null;
}

// ============================================================
// TWO-STEP PREDICTION (per ticker)
// ============================================================

async function predictForTicker(ticker, articleDate, articleText, horizon, statusUpdater) {
  const articleId = `live-${Date.now()}`;

  if (statusUpdater) statusUpdater(`${ticker}: fetching context...`);
  const companyContext = await getCompanyContext(ticker);

  if (statusUpdater) statusUpdater(`${ticker}: fetching price history...`);
  const historical = await fetchHistoricalPrices(ticker, articleDate);
  let priceSummary;
  let priceError = null;
  if (Array.isArray(historical) && historical.length > 0) {
    priceSummary = buildPriceSummary(ticker, historical);
  } else {
    priceSummary = "Historical price data unavailable.";
    priceError = (historical && historical.error) ? historical.error : null;
  }

  // ---- Step 1: factor extraction (also yields relevance) ----
  if (statusUpdater) statusUpdater(`${ticker}: extracting causal factors...`);
  const factorPrompt = buildFactorExtractionPrompt(ticker, articleText, companyContext, articleDate);

  let factorsData = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const raw = await callLLM(factorPrompt);
      const parsed = extractJSON(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Array.isArray(parsed.factors)) {
        factorsData = parsed;
        break;
      } else if (Array.isArray(parsed)) {
        // Backward compat: list-only output
        factorsData = { relevance: 0.5, relevance_reasoning: "unknown", factors: parsed };
        break;
      }
      console.warn(`Factor extraction parse failed (attempt ${attempt})`);
    } catch (err) {
      console.warn(`Factor extraction attempt ${attempt} failed:`, err);
    }
  }
  if (!factorsData) {
    factorsData = { relevance: 0.0, relevance_reasoning: "extraction failed", factors: [] };
  }

  let relevance = parseFloat(factorsData.relevance);
  if (!isFinite(relevance)) relevance = 0.0;
  relevance = Math.max(0, Math.min(1, relevance));
  const relevanceReasoning = factorsData.relevance_reasoning || "";

  // ---- Step 2: prediction (with optional self-consistency sampling) ----
  if (statusUpdater) statusUpdater(`${ticker}: predicting direction...`);
  const factorsText = formatFactorsForPrediction(factorsData);
  const predPrompt = buildPredictionPrompt(
    articleId, articleDate, ticker, articleText, horizon,
    priceSummary, companyContext, factorsText,
    relevance, relevanceReasoning
  );

  const samples = [];
  const sampleTemp = K_SAMPLES > 1 ? SAMPLE_TEMPERATURE : null;
  for (let k = 0; k < K_SAMPLES; k++) {
    let sample = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const raw = await callLLM(predPrompt, sampleTemp);
        const parsed = extractJSON(raw);
        if (parsed && typeof parsed === "object" && (parsed.direction === "UP" || parsed.direction === "DOWN")) {
          sample = parsed;
          break;
        }
        console.warn(`Prediction parse failed (sample ${k + 1}/${K_SAMPLES}, attempt ${attempt})`);
      } catch (err) {
        console.warn(`Prediction sample ${k + 1}/${K_SAMPLES} attempt ${attempt} failed:`, err);
      }
    }
    if (sample) samples.push(sample);
  }

  if (samples.length === 0) {
    console.error(`Prediction failed for ${ticker} after ${MAX_RETRIES} retries × ${K_SAMPLES} samples`);
    return null;
  }

  let final;
  if (K_SAMPLES === 1) {
    final = samples[0];
  } else {
    const upCount = samples.filter(s => s.direction === "UP").length;
    const downCount = samples.filter(s => s.direction === "DOWN").length;
    const winningDir = upCount >= downCount ? "UP" : "DOWN";
    const agreement = Math.max(upCount, downCount) / samples.length;
    const winning = samples.find(s => s.direction === winningDir);
    final = {
      ...winning,
      direction: winningDir,
      confidence: agreement,
      n_samples: samples.length,
      vote_up: upCount,
      vote_down: downCount
    };
  }

  return {
    ticker,
    direction: final.direction,
    confidence: typeof final.confidence === "number" ? final.confidence : null,
    explanation: final.explanation || "",
    relevance,
    relevance_reasoning: relevanceReasoning,
    factors: factorsData.factors,
    priceError
  };
}

// ============================================================
// MAIN ANALYSIS
// ============================================================

async function analyzeStock(stock) {
  const statusDiv = document.getElementById("status");
  const predictionsDiv = document.getElementById("predictions");
  const horizon = document.getElementById("horizon").value;
  const analyzeBtn = document.getElementById("analyze");

  statusDiv.innerText = "Analyzing...";
  predictionsDiv.innerHTML = "";
  analyzeBtn.disabled = true;
  const setStatus = msg => { statusDiv.innerText = msg; };

  try {
    validateLlmCredentials();

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const articleText = document.body.innerText.replace(/\s+/g, " ").trim().substring(0, 8000);

        function extractDate() {
          const meta = document.querySelector('meta[property="article:published_time"]');
          if (meta?.content) return meta.content;
          const timeEl = document.querySelector("time[datetime]");
          if (timeEl) return timeEl.getAttribute("datetime");
          const match = document.body.innerText.match(
            /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/
          );
          return match ? match[0] : null;
        }

        const rawDate = extractDate();
        const articleDate = rawDate
          ? new Date(rawDate).toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10);

        return { articleText, articleDate };
      }
    });

    const { articleText, articleDate } = result;

    if (!articleText || articleText.length < 150) {
      setStatus("Article too short to analyze (need at least 150 chars).");
      return;
    }

    const preds = [];

    if (stock) {
      const pred = await predictForTicker(stock, articleDate, articleText, horizon, setStatus);
      if (pred) preds.push(pred);
    } else {
      setStatus("Identifying affected tickers...");
      let tickers;
      try {
        tickers = extractJSON(await callLLM(buildDiscoveryPrompt(articleDate, articleText)));
      } catch (err) {
        setStatus(`Discovery failed: ${err.message}`);
        return;
      }

      if (!Array.isArray(tickers) || tickers.length === 0) {
        setStatus("No affected tickers found for this article.");
        return;
      }

      for (let i = 0; i < tickers.length; i++) {
        const cleanTicker = normalizeTicker(tickers[i]);
        if (!cleanTicker) continue;
        setStatus(`Analyzing ${cleanTicker} (${i + 1}/${tickers.length})...`);
        const pred = await predictForTicker(cleanTicker, articleDate, articleText, horizon, setStatus);
        if (pred) preds.push(pred);
      }
    }

    predictionsDiv.innerHTML = "";

    if (preds.length === 0) {
      setStatus("No predictions could be generated for this article.");
      return;
    }
    setStatus("");

    for (const p of preds) {
      await renderPredictionCard(p, articleDate, horizon, predictionsDiv);
    }

  } catch (err) {
    console.error("Analysis error:", err);
    setStatus("Error: " + err.message);
  } finally {
    analyzeBtn.disabled = false;
  }
}

async function renderPredictionCard(p, articleDate, horizon, container) {
  const ticker = p.ticker;
  const cleanTicker = normalizeTicker(ticker);
  const rel = cleanTicker ? getReliabilityInfo(cleanTicker, horizon) : null;

  // Current price for display
  let priceHTML = `<span class="pred-price">Price unavailable (non-US ticker)</span>`;
  if (cleanTicker) {
    const priceInfo = await fetchPriceAtDate(cleanTicker, articleDate);
    if (priceInfo?.close !== undefined) {
      priceHTML = `<span class="pred-price">$${priceInfo.close.toFixed(2)} <small>(${priceInfo.date})</small></span>`;
    } else {
      const errorMap = {
        OUT_OF_RANGE:       "Outside date range",
        API_LIMIT:          "API rate limit — wait 1 min and retry",
        UNSUPPORTED_TICKER: "Unsupported ticker",
        NO_SERIES:          "No price data",
        INVALID_PRICE:      "Invalid price data",
        NETWORK_ERROR:      "Network error",
        NO_HISTORICAL_DATA: "No historical data",
        NO_MATCH:           "No matching trading date",
      };
      priceHTML = `<span class="pred-price">Price unavailable (${errorMap[priceInfo?.error] || "Unknown"})</span>`;
    }
  }

  const dir = (p.direction || "").toUpperCase();
  const dirClass = dir === "UP" ? "up" : "down";
  const dirLabel = dir === "UP" ? "▲ UP" : "▼ DOWN";

  const confidencePct = (typeof p.confidence === "number")
    ? `${Math.round(p.confidence * 100)}%`
    : "—";
  const relevancePct = (typeof p.relevance === "number")
    ? `${Math.round(p.relevance * 100)}%`
    : "—";

  const relHTML = rel
    ? `<div class="pred-rel"><span class="badge ${rel.cls}">${rel.label}${rel.cls !== "none" ? " reliability" : ""}</span><span>${rel.text}</span></div>`
    : "";

  const reasoningHTML = p.relevance_reasoning
    ? `<div class="pred-reasoning"><span class="reasoning-label">Why this score:</span> ${escapeHtml(p.relevance_reasoning)}</div>`
    : "";

  // Factors (collapsible)
  let factorsHTML = "";
  if (Array.isArray(p.factors) && p.factors.length > 0) {
    const items = p.factors.map(f => {
      const fdir = (f.direction || "").toLowerCase();
      const fclass = fdir === "positive" ? "factor-pos" : (fdir === "negative" ? "factor-neg" : "");
      return `<li class="factor-item ${fclass}"><span class="factor-text">${escapeHtml(f.factor || "")}</span><span class="factor-meta">${escapeHtml(f.direction || "?")} · ${escapeHtml(f.time_horizon || "?")} · ${escapeHtml(f.confidence || "?")}</span></li>`;
    }).join("");
    factorsHTML = `
      <details class="pred-factors">
        <summary>${p.factors.length} causal factor${p.factors.length === 1 ? "" : "s"}</summary>
        <ul>${items}</ul>
      </details>`;
  }

  container.innerHTML += `
<div class="pred-card ${dirClass}">
  <div class="pred-header">
    <span class="pred-ticker">${escapeHtml(ticker)}</span>
    <span class="direction-badge ${dirClass}">${dirLabel}</span>
  </div>
  ${priceHTML}
  <div class="pred-meta">
    <div class="pred-meta-item">
      <span class="meta-label">Confidence</span>
      <span class="meta-value">${confidencePct}</span>
    </div>
    <div class="pred-meta-item">
      <span class="meta-label">Relevance</span>
      <span class="meta-value">${relevancePct}</span>
    </div>
    <div class="pred-meta-item">
      <span class="meta-label">Horizon</span>
      <span class="meta-value">${horizon}</span>
    </div>
  </div>
  <div class="pred-explanation">${escapeHtml(p.explanation || "")}</div>
  ${reasoningHTML}
  ${factorsHTML}
  ${relHTML}
</div>`;
}

function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
