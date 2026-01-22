const GEMINI_API_KEY = "your-gemini-api-key";
const ALPHA_KEY = "your-alpha-vantage-api-key";


/***** Load ticker reliability data *****/
let tickerReliabilityByHorizon = {};

fetch(chrome.runtime.getURL("extension_data/ticker_reliability_by_horizon.json"))
  .then(res => res.json())
  .then(data => tickerReliabilityByHorizon = data)
  .catch(err => console.error("Failed to load reliability data", err));

/***** Bookmarks *****/
document.addEventListener("DOMContentLoaded", loadBookmarks);
document.getElementById("bookmarkStock").addEventListener("click", saveBookmark);
document.getElementById("analyze").addEventListener("click", () => {
  const stock = document.getElementById("stockInput").value.trim().toUpperCase();
  analyzeStock(stock);
});

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
      wrapper.style.display = "flex";
      wrapper.style.gap = "6px";

      const btn = document.createElement("button");
      btn.textContent = stock;
      btn.className = "bookmark-button";
      btn.onclick = () => {
        document.getElementById("stockInput").value = stock;
        analyzeStock(stock);
      };

      const removeBtn = document.createElement("button");
      removeBtn.textContent = "Remove";
      removeBtn.className = "remove-bookmark-button";
      removeBtn.onclick = () => removeBookmark(stock);

      wrapper.appendChild(btn);
      wrapper.appendChild(removeBtn);
      container.appendChild(wrapper);
    });
  });
}
const priceCache = {};  // key: `${ticker}_${date}` → priceInfo

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/***** Lookup Price *****/
/*****
 * Alpha Vantage Data Format Example:
 * {
    "Meta Data": {
        "1. Information": "Daily Prices (open, high, low, close) and Volumes",
        "2. Symbol": "GOOGL",
        "3. Last Refreshed": "2025-12-26",
        "4. Output Size": "Compact",
        "5. Time Zone": "US/Eastern"
    },
    "Time Series (Daily)": {
        "2025-12-26": {
            "1. open": "314.4800",
            "2. high": "315.0850",
            "3. low": "312.2750",
            "4. close": "313.5100",
            "5. volume": "10899017"
        },
        "2025-12-24": {
            "1. open": "314.7700",
            "2. high": "315.0800",
            "3. low": "311.9200",
            "4. close": "314.0900",
            "5. volume": "10097361"
        },
        "2025-12-23": {
            "1. open": "309.6250",
            "2. high": "314.9400",
            "3. low": "309.3200",
            "4. close": "314.3500",
            "5. volume": "25478670"
        },
        ...
*****/
let lastAlphaCall = 0;

async function fetchPriceAtDate(ticker, articleDate) {
  const cacheKey = `${ticker}_${articleDate}`;
  if (priceCache[cacheKey]) {
    return priceCache[cacheKey];
  }

  // Wait 2s between Alpha Vantage calls
  const now = Date.now();
  const wait = Math.max(0, 2000 - (now - lastAlphaCall));
  if (wait > 0) {
    await sleep(wait);
  }
  lastAlphaCall = Date.now();

  const url =
    `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${ticker}&apikey=${ALPHA_KEY}`;

  const resp = await fetch(url);
  const data = await resp.json();

  // Rate limit or API error
  if (data["Note"] || data["Error Message"]) {
    const result = { error: "API_LIMIT_OR_ERROR" };
    priceCache[cacheKey] = result;
    return result;
  }

  const series = data["Time Series (Daily)"];
  if (!series) {
    const result = { error: "NO_SERIES" };
    priceCache[cacheKey] = result;
    return result;
  }

  // Get most recent trading day on or before articleDate
  // Avoid weekends/holidays
  const targetDate = articleDate.slice(0, 10);
  const tradingDays = Object.keys(series).sort((a, b) => b.localeCompare(a));

  const newest = tradingDays[0];
  const oldest = tradingDays[tradingDays.length - 1];

  if (targetDate > newest || targetDate < oldest) {
    const result = { error: "OUT_OF_RANGE" };
    priceCache[cacheKey] = result;
    return result;
  }

  for (const d of tradingDays) {
    if (d <= targetDate) {
      const close = parseFloat(series[d]["4. close"]);
      if (isNaN(close)) {
        const result = { error: "INVALID_PRICE" };
        priceCache[cacheKey] = result;
        return result;
      }

      const result = { date: d, close };
      priceCache[cacheKey] = result;
      return result;
    }
  }

  const result = { error: "NO_MATCH" };
  priceCache[cacheKey] = result;
  return result;
}

/***** Reliability Badge *****/
function getReliabilityInfo(ticker, horizon) {
  const tickerData = tickerReliabilityByHorizon[ticker];
  if (!tickerData) {
    return { label: "Low", cls: "low", text: "Insufficient history" };
  }
  const info = tickerData[horizon];
  if (!info || info.samples < 10) {
    return { label: "Low", cls: "low", text: "Insufficient history" };
  }
  if (info.avg_hierarchical_score >= 0.3) {
    return { label: "High", cls: "high", text: `${Math.round(info.direction_accuracy * 100)}% direction accuracy` };
  }
  if (info.avg_hierarchical_score >= 0.15) {
    return { label: "Medium", cls: "medium", text: `${Math.round(info.direction_accuracy * 100)}% direction accuracy` };
  }
  return { label: "Low", cls: "low", text: `${Math.round(info.direction_accuracy * 100)}% direction accuracy` };
}

/***** Prompt Builders *****/
// When user specifies a ticker
function buildSingleTickerPrompt(ticker, date, articleText, horizon) {
  return `
You MUST output ONLY valid JSON.

{
  "ticker": "${ticker}",
  "direction": "UP" | "DOWN" | "NO IMPACT",
  "strength": "weak" | "moderate" | "strong" | "none",
  "expected_move_percent": number,
  "explanation": "short explanation"
}

Rules:
- Predict ONLY ${ticker} over a ${horizon} horizon
- Strength based on expected_move_percent
  - if direction = NO IMPACT or expected_move_percent <= 0.3%, strength = none
  - if 0.3% < expected_move_percent <= 1%, strength = weak
  - if 1% < expected_move_percent <= 3%, strength = moderate
  - if expected_move_percent > 3%, strength = strong
- No hindsight

Article:
"${articleText}"
`;
}

// When user does not specify a ticker
function buildDiscoveryPrompt(date, articleText) {
  return `
You MUST output ONLY valid JSON ARRAY.

Each element:
{
  "ticker": "TICKER",
  "direction": "UP" | "DOWN" | "NO IMPACT",
  "strength": "weak" | "moderate" | "strong" | "none",
  "expected_move_percent": number,
  "explanation": "short explanation"
}

Rules:
- Include ONLY affected tickers
- DO NOT include more than 5 tickers, choose the most affected ones
- DO NOT repeat tickers
- Strength based on expected_move_percent
  - if direction = NO IMPACT or expected_move_percent <= 0.3%, strength = none
  - if 0.3% < expected_move_percent <= 1%, strength = weak
  - if 1% < expected_move_percent <= 3%, strength = moderate
  - if expected_move_percent > 3%, strength = strong
- Sort by expected_move_percent descending
- No hindsight

Article:
"${articleText}"
`;
}

function normalizeTicker(ticker) {
  if (!ticker) return null;

  let t = ticker.toUpperCase().trim();

  // TSLA.O, GOOGL.O, ORCL.N → TSLA, GOOGL, ORCL
  if (t.includes(".")) {
    const base = t.split(".")[0];

    // If base is all letters (US ticker), keep it
    if (/^[A-Z]+$/.test(base)) {
      return base;
    }

    // Otherwise unsupported (e.g. 005930.KS)
    return null;
  }

  // Only allow plain A–Z tickers
  if (/^[A-Z]+$/.test(t)) {
    return t;
  }

  return null;
}


/***** MAIN ANALYSIS *****/
async function analyzeStock(stock) {
  const resultDiv = document.getElementById("result");
  const priceDiv = document.getElementById("price");
  const relDiv = document.getElementById("reliability");
  const horizon = document.getElementById("horizon").value;

  resultDiv.innerText = "Analyzing...";
  priceDiv.innerText = "";
  relDiv.innerHTML = "";
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      // Article text extraction
      const articleText = document.body.innerText
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 8000);

      // Article date extraction
      function extractDate() {
        const meta = document.querySelector('meta[property="article:published_time"]');
        if (meta?.content) return meta.content;

        const timeEl = document.querySelector("time[datetime]");
        if (timeEl) return timeEl.getAttribute("datetime");

        const text = document.body.innerText;
        const regex =
          /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/;
        const match = text.match(regex);
        if (match) return match[0];

        return null;
      }

      const rawDate = extractDate();
      const articleDate = rawDate
        ? new Date(rawDate).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);

      return { articleText, articleDate };
    }
  });


    const { articleText, articleDate } = result;

    const prompt = stock
      ? buildSingleTickerPrompt(stock, articleDate, articleText, horizon)
      : buildDiscoveryPrompt(articleDate, articleText);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] })
      }
    );

    let text = (await response.json())
      ?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    console.log("Raw Gemini API response text:", text);

    text = text.replace(/```json|```/g, "").trim();
    const preds = stock ? [JSON.parse(text)] : JSON.parse(text);

    resultDiv.innerHTML = ""
    priceDiv.innerHTML = "";

    for (const p of preds) {
      const ticker = p.ticker;
      const cleanTicker = normalizeTicker(ticker);
      const rel = cleanTicker ? getReliabilityInfo(cleanTicker, horizon) : null;
      if (!cleanTicker) {
        priceDiv.innerHTML += `
          ${ticker}: Price unavailable (non-US ticker)<br>
        `;
      } else {
        
        const priceInfo = await fetchPriceAtDate(cleanTicker, articleDate);
        if (priceInfo?.close !== undefined) {
          priceDiv.innerHTML += `
            ${ticker}: $${priceInfo.close.toFixed(2)}<br>
          `;
        } else {
          let reason = "Unavailable";
          if (priceInfo?.error === "OUT_OF_RANGE") reason = "Outside date range";
          if (priceInfo?.error === "API_LIMIT_OR_ERROR") reason = "API limit";
          if (priceInfo?.error === "NO_SERIES") reason = "Unsupported ticker";
          if (priceInfo?.error === "INVALID_PRICE") reason = "Invalid price data";

          priceDiv.innerHTML += `
            ${ticker}: Price unavailable (${reason})<br>
          `;
        }
      }


      resultDiv.innerHTML += `
<hr>
<strong>${ticker}</strong><br>
Direction: ${p.direction}<br>
Strength: ${p.strength}<br>
Expected move: ${p.expected_move_percent}%<br>
${p.explanation}<br>
${rel ? `<span class="badge ${rel.cls}">${rel.label} reliability</span> ${rel.text}` : ""}
`;
    }
    if (priceDiv.innerHTML === "") {
      priceDiv.innerText = `Price data not available.`;
    }

  } catch (err) {
    resultDiv.innerText = "Error: " + err.message;
  }
}

