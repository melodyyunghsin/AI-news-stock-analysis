let analyzeHandler = null;

export function initBookmarks(onAnalyze) {
  analyzeHandler = onAnalyze;
  document.getElementById("bookmarkStock").addEventListener("click", saveBookmark);
  loadBookmarks();
}

function saveBookmark() {
  const stock = document.getElementById("stockInput").value.trim().toUpperCase();
  if (!stock) return alert("Enter a stock ticker");
  chrome.storage.sync.get(["bookmarks"], data => {
    const list = data.bookmarks || [];
    if (!list.includes(stock)) list.push(stock);
    chrome.storage.sync.set({ bookmarks: list }, loadBookmarks);
  });
}

function removeBookmark(stock) {
  chrome.storage.sync.get(["bookmarks"], data => {
    const list = (data.bookmarks || []).filter(s => s !== stock);
    chrome.storage.sync.set({ bookmarks: list }, loadBookmarks);
  });
}

function loadBookmarks() {
  chrome.storage.sync.get(["bookmarks"], data => {
    const list = data.bookmarks || [];
    const container = document.getElementById("bookmarks");
    container.innerHTML = "";
    list.forEach(stock => {
      const wrapper = document.createElement("div");
      wrapper.className = "bookmark-item";

      const btn = document.createElement("button");
      btn.textContent = stock;
      btn.className = "bookmark-button";
      btn.onclick = () => {
        document.getElementById("stockInput").value = stock;
        if (analyzeHandler) analyzeHandler(stock);
      };

      const removeBtn = document.createElement("button");
      removeBtn.textContent = "×";
      removeBtn.className = "remove-bookmark-button";
      removeBtn.onclick = () => removeBookmark(stock);

      wrapper.appendChild(btn);
      wrapper.appendChild(removeBtn);
      container.appendChild(wrapper);
    });
  });
}
