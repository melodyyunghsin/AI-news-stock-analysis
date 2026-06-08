// Built-in defaults — users can override per-installation in the Settings panel.
export const FALLBACK_GEMINI_API_KEY = "";

export const LLM_DEFAULTS = {
  llm_provider:    "gemini",                       // "gemini" | "qwen"
  gemini_api_key:  "",                              // user-supplied; falls back to built-in
  gemini_model:    "gemini-2.5-flash-lite",         // model used for the evaluation
  ollama_url:      "http://localhost:11434/v1",
  qwen_model:      "qwen2.5:7b",
  polygon_api_key: ""                               // user-supplied; for price/company data
};

export let llmSettings = { ...LLM_DEFAULTS };

export function loadLlmSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(Object.keys(LLM_DEFAULTS), data => {
      llmSettings = { ...LLM_DEFAULTS, ...data };
      resolve(llmSettings);
    });
  });
}

export function saveLlmSettings(updates) {
  Object.assign(llmSettings, updates);
  return new Promise(resolve => {
    chrome.storage.local.set(updates, resolve);
  });
}

export async function initSettingsUI() {
  await loadLlmSettings();

  const toggle      = document.getElementById("settingsToggle");
  const body        = document.getElementById("settingsBody");
  const providerSel = document.getElementById("llmProvider");
  const apiKeyInput = document.getElementById("geminiApiKey");
  const geminiModel = document.getElementById("geminiModel");
  const ollamaUrl   = document.getElementById("ollamaUrl");
  const qwenModel   = document.getElementById("qwenModel");
  const polygonKey  = document.getElementById("polygonApiKey");
  const geminiBox   = document.getElementById("geminiFields");
  const qwenBox     = document.getElementById("qwenFields");
  const saveBtn     = document.getElementById("saveSettings");
  const statusDiv   = document.getElementById("settingsStatus");
  const modelLabel  = document.getElementById("currentModelLabel");

  providerSel.value = llmSettings.llm_provider;
  apiKeyInput.value = llmSettings.gemini_api_key;
  geminiModel.value = llmSettings.gemini_model;
  ollamaUrl.value   = llmSettings.ollama_url;
  qwenModel.value   = llmSettings.qwen_model;
  polygonKey.value  = llmSettings.polygon_api_key;
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
      qwen_model:     qwenModel.value.trim()   || LLM_DEFAULTS.qwen_model,
      polygon_api_key: polygonKey.value.trim()
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
