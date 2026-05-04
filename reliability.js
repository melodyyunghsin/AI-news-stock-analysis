let tickerReliabilityByHorizon = {};

fetch(chrome.runtime.getURL("extension_data/ticker_reliability_by_horizon.json"))
  .then(res => res.json())
  .then(data => tickerReliabilityByHorizon = data)
  .catch(err => console.error("Failed to load reliability data", err));

export function getReliabilityInfo(ticker, horizon) {
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
