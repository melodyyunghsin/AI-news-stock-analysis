# Stock Impact Analyzer

A browser extension that analyzes financial news articles and predicts how the news will move specified stocks. It runs a two-step LLM pipeline — causal factor extraction followed by horizon-specific direction prediction — and lets you choose between a cloud model (Gemini) and a local model (Ollama: Qwen, Llama, Mistral, etc.) from inside the popup.

## Features

- **Two-step prediction pipeline.** The model first extracts a relevance score and 3–5 causal factors from the article, then makes a horizon-conditioned UP/DOWN prediction using those factors, a pre-computed price summary (current price, recent daily moves, 5/20/60-day trends, 10/20/50-day SMAs, 20-day volatility and range), and horizon-specific reasoning guidance.
- **Multi-LLM support.** Switch between **Gemini** (cloud, free API key) and **Ollama** (local — Qwen, Llama, Mistral, Gemma, etc.) from the in-popup *Model Settings* panel. Per-installation API keys and model names persist in `chrome.storage.local` (kept off sync so keys don't replicate to the cloud).
- **Auto-detection of affected tickers.** Leave the ticker field blank and the model identifies up to 5 NYSE/NASDAQ tickers most affected by the article.
- **Single-ticker mode.** Type a ticker (e.g. AAPL) for a focused analysis on that company.
- **Horizon selection.** 1d / 3d / 5d / 10d / 21d, each with its own reasoning instructions baked into the prompt.
- **Prediction cards.** Direction (UP/DOWN), confidence (0–100%), relevance score + one-line reasoning, expandable causal-factor list, current price.
- **Stock bookmarking.** Save tickers for one-click re-analysis.
- **Reliability badge.** Per ticker × horizon direction-accuracy from historical evaluation across ~50 companies. *Caveat: these scores were computed against the older single-prompt pipeline running on Gemini 2.0 Flash, so treat them as indicative only — they do not directly reflect the current two-step pipeline.*
- **Cached price/reference data.** 24h cache for Polygon.io daily bars and ticker-reference lookups, throttled to stay under the 5 req/min free-tier limit.

## How to Use

1. **Load the extension.**
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" and select this directory

2. **Configure the LLM.** Open the popup, expand **Model Settings**, choose a provider, fill in the fields, and click **Save Settings**. The active model is shown as a pill next to the section header.

   **Gemini (cloud, default):**
   - Get a free API key at https://aistudio.google.com/apikey
   - Paste it into the "Gemini API Key" field
   - Default model: `gemini-2.5-flash` (Gemini 2.0 Flash is being deprecated)

   **Ollama (local):** see the dedicated [Ollama Setup](#ollama-setup) section below — there's a CORS step that catches most users.

3. **Analyze an article.**
   - Open a news article in a browser tab
   - Click the extension icon
   - (Optional) type a ticker — leave blank to auto-detect
   - Pick a prediction horizon and click **Analyze Article**

## Ollama Setup

Use this if you want to run analyses locally instead of through Gemini's cloud API.

### 1. Install Ollama
- **macOS / Windows:** download the installer from https://ollama.com/download
- **macOS via Homebrew:** `brew install ollama`
- **Linux:** `curl -fsSL https://ollama.com/install.sh | sh`

### 2. Pull a model
```bash
ollama pull qwen2.5:7b
```
Other options: `llama3.2`, `mistral`, `gemma2:9b`. 7B models need roughly 5 GB of RAM/VRAM — pick a smaller variant (`qwen2.5:3b`, `llama3.2:3b`) on a low-spec machine.

### 3. Allow the extension origin (the critical step)
By default Ollama blocks `chrome-extension://...` origins and returns **403 Forbidden**. Set `OLLAMA_ORIGINS=*` so it accepts requests from the extension.

**macOS (menu-bar app — most common):**
```bash
launchctl setenv OLLAMA_ORIGINS "*"
```
Then **fully quit** Ollama from the menu bar (icon → Quit Ollama) and reopen it from Applications. Closing the popup window isn't enough — the env var is only read at process start.

**macOS (terminal):** quit any running menu-bar Ollama first, then:
```bash
OLLAMA_ORIGINS="*" ollama serve
```

**Windows:** System Properties → Environment Variables → New → `OLLAMA_ORIGINS=*` → restart Ollama.

**Linux (systemd):**
```bash
sudo systemctl edit ollama.service
```
Add:
```
[Service]
Environment="OLLAMA_ORIGINS=*"
```
Then `sudo systemctl daemon-reload && sudo systemctl restart ollama`.

### 4. Verify Ollama is reachable
```bash
curl -i -H "Origin: chrome-extension://test" http://localhost:11434/api/tags
```
- `200 OK` → you're set.
- `403 Forbidden` → step 3 didn't take effect. On macOS check `launchctl getenv OLLAMA_ORIGINS` returns `*` and that you fully quit + reopened the app.
- `connection refused` → Ollama isn't running.

### 5. Configure the extension
1. Open the extension popup
2. Expand **Model Settings**
3. **LLM Provider** → `Ollama (local — Qwen, Llama, Mistral, etc.)`
4. **Ollama URL** → `http://localhost:11434/v1` (leave default)
5. **Ollama Model** → exact name you pulled, e.g. `qwen2.5:7b`
6. Click **Save Settings** — the pill should now read `Ollama · qwen2.5:7b`

### 6. Run an analysis
First call is slow (~10–30s) because Ollama loads the model into memory; later calls are much faster.

### Troubleshooting
| Symptom | Cause | Fix |
|---|---|---|
| `403 Forbidden` | `OLLAMA_ORIGINS` not set or not picked up | Redo step 3, verify with step 4 |
| `Cannot reach Ollama at ...` | Ollama not running, or wrong URL | Start Ollama; check the URL field |
| Very slow / timeouts | Model too big for your RAM | Pull a smaller variant (`:3b` instead of `:7b`) |
| Empty / malformed output | Model name typo, or model not pulled | Run `ollama list` to see exact names |

## Version History

### v0.5.0 — current
- **Pipeline:** Two-step factor-extraction + horizon-specific prediction pipeline from [melodyyunghsin/AI-news-stock-analysis-evaluation](https://github.com/melodyyunghsin/AI-news-stock-analysis-evaluation).
- **Output schema:** `direction` + `confidence` (0–1) replace `strength` + `expected_move_percent`. Relevance score and causal factors are now shown on each prediction card.
- **LLM selector:** added in-popup Settings with a Gemini ⇄ Ollama toggle, per-installation API key, and configurable model name. Gemini default updated to `gemini-3.1-flash-lite-preview`.
- **Price summary:** raw price dump replaced with SMAs / trend / volatility / range indicators (LLMs reason better over pre-computed features than long number lists).

### v0.4.0
- Prediction horizon selector (1d, 3d, 5d, 10d, 21d). Prompt and reliability badge update with the chosen horizon.

### v0.3.0
- Reliability badge — direction-accuracy score per ticker × horizon, evaluated on historical data for ~50 companies.

### v0.2.0
- Stock bookmarking system; user-specified ticker analysis.

### v0.1.0
- Initial release: parse current article, send to LLM, display prediction.