import { llmSettings, LLM_DEFAULTS, FALLBACK_GEMINI_API_KEY } from "./llm-settings.js";

export function cleanRawOutput(text) {
  if (!text) return null;
  return text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

export function extractJSON(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch (e) {}

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try { return JSON.parse(text.substring(firstBrace, lastBrace + 1)); } catch (e) {}
  }
  const firstBracket = text.indexOf("[");
  const lastBracket = text.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    try { return JSON.parse(text.substring(firstBracket, lastBracket + 1)); } catch (e) {}
  }
  return null;
}

export async function callLLM(prompt, temperature = null) {
  if (llmSettings.llm_provider === "qwen") {
    return callOllama(prompt, temperature);
  }
  return callGemini(prompt, temperature);
}

export function validateLlmCredentials() {
  if (llmSettings.llm_provider === "qwen") return;
  const apiKey = (llmSettings.gemini_api_key || "").trim() || FALLBACK_GEMINI_API_KEY;
  if (!apiKey) throw new Error("No Gemini API key. Open Model Settings to add one.");
}

async function callGemini(prompt, temperature = null) {
  const apiKey = (llmSettings.gemini_api_key || "").trim() || FALLBACK_GEMINI_API_KEY;
  if (!apiKey) throw new Error("No Gemini API key. Open Model Settings to add one.");
  const model = (llmSettings.gemini_model || "").trim() || LLM_DEFAULTS.gemini_model;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }]
  };
  if (temperature !== null && temperature !== undefined) {
    body.generationConfig = { temperature };
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }
  );
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Gemini API error: ${response.status} ${response.statusText} ${errText}`);
  }
  const text = (await response.json())?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return cleanRawOutput(text);
}

async function callOllama(prompt, temperature = null) {
  const baseUrl = (llmSettings.ollama_url || LLM_DEFAULTS.ollama_url).replace(/\/+$/, "");
  const model = (llmSettings.qwen_model || "").trim() || LLM_DEFAULTS.qwen_model;

  const body = {
    model,
    messages: [{ role: "user", content: prompt }]
  };
  if (temperature !== null && temperature !== undefined) {
    body.temperature = temperature;
  }

  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (err) {
    throw new Error(`Cannot reach Ollama at ${baseUrl}. Is it running? (start with OLLAMA_ORIGINS=* to allow extension requests)`);
  }
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Ollama error: ${response.status} ${response.statusText} ${errText}`);
  }
  const text = (await response.json())?.choices?.[0]?.message?.content || "";
  return cleanRawOutput(text);
}
