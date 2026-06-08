let tickerReliabilityByHorizon = {};

fetch(chrome.runtime.getURL("extension_data/ticker_reliability_by_horizon.json"))
  .then(res => res.json())
  .then(data => tickerReliabilityByHorizon = data)
  .catch(err => console.error("Failed to load reliability data", err));

const MIN_SAMPLES = 10;

// The badge reports whether the model's direction calls for this ticker × horizon
// are statistically distinguishable from random, using the 95% CI of the Matthews
// correlation coefficient (MCC). CI excludes 0 → a real signal; CI spans 0 → at chance.
// We deliberately do NOT tier on raw accuracy: 55% on 100 samples can still be a coin
// flip, and a green "High" badge would overclaim. The accuracy % is shown for context.
export function getReliabilityInfo(ticker, horizon) {
  const tickerData = tickerReliabilityByHorizon[ticker];
  if (!tickerData) return { label: "No History", cls: "none", text: "Not in evaluation set" };

  const info = tickerData[horizon];
  if (!info || info.samples < MIN_SAMPLES) {
    return { label: "Insufficient History", cls: "none", text: `Only ${info?.samples ?? 0} samples — need ≥${MIN_SAMPLES}` };
  }

  const acc = Math.round(info.direction_accuracy * 100);
  const n = info.samples;
  const ciLow = info.direction_mcc_ci_low;
  const ciHigh = info.direction_mcc_ci_high;

  if (typeof ciLow === "number" && ciLow > 0) {
    return { label: `${acc}% · Signal`, cls: "high", text: `beats random (95% CI, n=${n})` };
  }
  if (typeof ciHigh === "number" && ciHigh < 0) {
    return { label: `${acc}% · Underperforms`, cls: "low", text: `worse than random (95% CI, n=${n})` };
  }
  return { label: `${acc}% · At chance`, cls: "none", text: `not distinguishable from random (n=${n})` };
}
