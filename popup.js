const GEMINI_API_KEY = "AIzaSyDZJvFFNU6GpAVPxqw5oCJqs1MxlTfnxPo";

document.getElementById('analyze').addEventListener('click', async () => {
  const stockName = document.getElementById('stockSelect').value.trim();
  const resultDiv = document.getElementById('result');
  resultDiv.innerText = 'Analyzing...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const [{ result: articleText }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const body = document.body.innerText || '';
        return body.replace(/\s+/g, ' ').trim().substring(0, 8000);
      }
    });

    if (!articleText) {
      resultDiv.innerText = 'Error: No article text found on the page.';
      return;
    }

    let prompt = `
    Analyze the following news article and identify which companies' stocks might be affected.
    For each company, list:
    - Company name
    - Stock ticker
    - Whether the impact is positive or negative
    - A short explanation
    If no companies are affected, say so.
    Article:
    "${articleText}"
    `;

    if (stockName) {
      prompt += `
      Additionally, focus your analysis specifically on how the stock "${stockName}"
      might be affected by this article. Predict the likely direction (up/down),
      the strength of the effect (weak/moderate/strong), and the reasoning.
      `;
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }]
        })
      }
    );

    if (!response.ok) throw new Error(`API error: ${response.statusText}`);

    const data = await response.json();
    const analysis = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (analysis) {
      resultDiv.innerText = analysis;
    } else {
      resultDiv.innerText = 'No analysis returned. Check your API key or quota.';
    }

  } catch (error) {
    resultDiv.innerText = `Error: ${error.message}`;
  }
});
