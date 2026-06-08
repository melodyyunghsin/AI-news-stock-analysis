"""Regenerate the reliability badge data the extension loads at runtime.

Input:  evaluation_summary/accuracy_by_ticker_all_horizons.csv
Output: extension_data/ticker_reliability_by_horizon.json

The extension reads the *_by_horizon.json file (see reliability.js). Run this
after dropping in a fresh evaluation CSV to refresh the badges:

    python results_to_json.py
"""

import pandas as pd
import json

# Only these tickers were evaluated under the current (two-step, gemini-2.5-flash-lite)
# pipeline. Any ticker not listed shows "No History" in the UI, which is the honest
# outcome. Empty list = include every ticker present in the CSV.
TICKER_ALLOWLIST = ["AAPL", "NVDA", "GOOG", "AMZN", "TSLA", "TSM", "MSFT"]

df = pd.read_csv("evaluation_summary/accuracy_by_ticker_all_horizons.csv")

if TICKER_ALLOWLIST:
    df = df[df["Ticker"].isin(TICKER_ALLOWLIST)]


def num(v):
    return None if pd.isna(v) else float(v)


out = {}
for _, r in df.iterrows():
    out.setdefault(r["Ticker"], {})[r["horizon"]] = {
        "samples": int(r["samples"]),
        "direction_accuracy": num(r["direction_accuracy"]),
        "direction_wf1": num(r["direction_wf1"]),
        "direction_mcc": num(r["direction_mcc"]),
        "direction_mcc_ci_low": num(r["direction_mcc_ci_low"]),
        "direction_mcc_ci_high": num(r["direction_mcc_ci_high"]),
    }

with open("extension_data/ticker_reliability_by_horizon.json", "w") as f:
    json.dump(out, f, indent=2)

print(f"Wrote {len(out)} tickers: {', '.join(sorted(out))}")
