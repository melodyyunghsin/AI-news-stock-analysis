import { callLLM, extractJSON } from "./llm.js";
import {
  buildFactorExtractionPrompt,
  formatFactorsForPrediction,
  buildPredictionPrompt
} from "./prompts.js";
import { getCompanyContext, fetchHistoricalPrices, buildPriceSummary } from "./polygon.js";

// Note: relevance gating is intentionally omitted — discovery mode
// already pre-filters to relevant tickers, and single-ticker mode
// is the user's explicit choice. Every ticker gets a prediction.
const K_SAMPLES = 1;               // Self-consistency samples (1 = legacy, >1 = majority vote)
const SAMPLE_TEMPERATURE = 0.8;
const MAX_RETRIES = 3;

export async function predictForTicker(ticker, articleDate, articleText, horizon, statusUpdater) {
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
