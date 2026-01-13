import pandas as pd
import json

df = pd.read_csv("evaluation_summary/accuracy_by_ticker_direction_strength.csv")

out = {}
for _, r in df.iterrows():
    out[r["Ticker"]] = {
        "samples": int(r["samples"]),
        "direction_accuracy": float(r["direction_accuracy"]),
        "avg_hierarchical_score": float(r["avg_hierarchical_score"])
    }

with open("extension_data/ticker_reliability.json", "w") as f:
    json.dump(out, f, indent=2)
