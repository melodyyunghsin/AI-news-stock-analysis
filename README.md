# Stock Impact Analyzer

Stock Impact Analyzer is a browser extension designed to analyze financial news articles and predict their potential impact on specified stocks. Using the Gemini language model, this tool provides users with insights into market sentiment and potential stock price movements based on the content of the article they are currently reading.

## Features

- **On-the-fly Analysis:** Analyze any financial news article with the click of a button.
- **Ticker-Specific Insights:** Specify a stock ticker to get a detailed analysis of the article's impact on that particular company.
- **Multi-Ticker Discovery:** If no ticker is specified, the extension can identify the most affected tickers mentioned in the article.
- **Prediction Horizon:** Choose a prediction horizon (1d, 3d, 5d, 10d, or 21d) to tailor the analysis to your trading or investment strategy.
- **Accuracy Index:** View a historical accuracy score for the model's predictions on a given ticker and horizon, evaluated against past data (available for ~50 major companies).
- **Stock Bookmarking:** Save your most-watched stocks for quick and easy access.

## How to Use

1.  **Load the Extension:**
    *   Open Chrome and navigate to `chrome://extensions/`.
    *   Enable "Developer mode".
    *   Click "Load unpacked" and select the project directory.

2.  **Configure API Key:**
    *   Open `popup.js` in a text editor.
    *   Replace the placeholder `GEMINI_API_KEY` and  `ALPHA_KEY` with your own Gemini and Alpha Vantage API key.
    *   **Important:** For security, ensure your API key has the necessary restrictions or is used in a secure manner. Using an unrestricted key on the client-side is not recommended for production applications.

3.  **Analyze an Article:**
    *   Navigate to a web page containing a financial news article.
    *   Click the extension icon in your browser toolbar.
    *   Enter a stock ticker (e.g., "GM", "TSLA") in the input field.
    *   Select your desired prediction horizon from the dropdown menu.
    *   Click "Analyze Article" to get a prediction.

## Version History

### v0.4.0
- **Feature:** Added the ability for users to specify a prediction horizon (1d, 3d, 5d, 10d, 21d).
- **Enhancement:** The analysis prompt and the displayed accuracy index now update based on the selected horizon.

### v0.3.0
- **Feature:** Introduced an accuracy index, which is evaluated using historical article and stock price data for approximately 50 companies. This provides users with a measure of model reliability for a given ticker.

### v0.2.0
- **Feature:** Implemented a stock bookmarking system, allowing users to save and quickly access their favorite tickers.
- **Feature:** Added functionality to analyze an article for a user-specified stock ticker.

### v0.1.0
- **Initial Release:** Basic prediction pipeline.
- **Core Functionality:** The extension parses the content of a web article, sends it to the Gemini model, and displays the raw JSON output of the analysis.
