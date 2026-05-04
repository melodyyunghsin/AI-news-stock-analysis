import { initSettingsUI } from "./llm-settings.js";
import { initBookmarks } from "./bookmarks.js";
import { callLLM, extractJSON, validateLlmCredentials } from "./llm.js";
import { fetchPriceAtDate } from "./polygon.js";
import { buildDiscoveryPrompt, normalizeTicker } from "./prompts.js";
import { predictForTicker } from "./prediction.js";
import { getReliabilityInfo } from "./reliability.js";

document.addEventListener("DOMContentLoaded", () => {
  initBookmarks(analyzeStock);
  initSettingsUI();
});

document.getElementById("analyze").addEventListener("click", () => {
  const stock = document.getElementById("stockInput").value.trim().toUpperCase();
  analyzeStock(stock);
});

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
