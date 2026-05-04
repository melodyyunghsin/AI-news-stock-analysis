const ARTICLE_TEXT_LIMIT = 3000; // Match Python pipeline (was 8000)

const HORIZON_INSTRUCTIONS = {
  "1d":  "Focus on immediate market reaction. Consider whether this news is likely already priced in. Short-term sentiment and momentum dominate.",
  "3d":  "Consider both immediate reaction and follow-on effects. Weigh whether the identified factors have short-term or medium-term implications.",
  "5d":  "Consider both immediate reaction and follow-on effects. Weigh whether the identified factors have short-term or medium-term implications.",
  "10d": "Focus on structural and fundamental impacts. Consider industry dynamics, competitive positioning, and whether this news changes the medium-term outlook. Short-term noise is less relevant.",
  "21d": "Focus on structural and fundamental impacts. Consider industry dynamics, competitive positioning, and whether this news changes the medium-term outlook. Short-term noise is less relevant."
};

export function buildFactorExtractionPrompt(ticker, text, companyContext, date) {
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

export function formatFactorsForPrediction(factorsData) {
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

export function buildPredictionPrompt(articleId, date, ticker, text, horizon,
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

export function buildDiscoveryPrompt(date, articleText) {
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

export function normalizeTicker(ticker) {
  if (!ticker) return null;
  const t = ticker.toUpperCase().trim();
  if (t.includes(".")) {
    const base = t.split(".")[0];
    return /^[A-Z]{1,5}$/.test(base) ? base : null;
  }
  return /^[A-Z]{1,5}$/.test(t) ? t : null;
}
