/*
 * Kisan Mitra configuration.
 * Everything here is PUBLIC once pushed to GitHub Pages. Never put API keys in this file.
 * Secret keys live either in your Cloudflare Worker (recommended) or in each user's own
 * browser via the in-app Settings screen.
 */
window.KM_CONFIG = {
  ai: {
    // "proxy"     -> your Cloudflare Worker (worker/worker.js) holds the Claude key. Best for a public demo.
    // "anthropic" -> call the Claude API straight from the browser with a key typed into Settings.
    // "openai"    -> any OpenAI-compatible endpoint (OpenAI, Groq, OpenRouter, Gemini's OpenAI endpoint, local Ollama).
    provider: "proxy",
    proxyUrl: "",                       // e.g. "https://kisan-mitra-proxy.<your-subdomain>.workers.dev"
    model: "claude-sonnet-5-5",         // main model: diagnosis, plans, KisanBot
    quickModel: "claude-haiku-5-5",     // fast model for short answers
    baseUrl: "https://api.openai.com/v1", // only for provider "openai"
    maxTokens: 1800
  },

  mandi: {
    // AGMARKNET "Current Daily Price of Various Commodities from Various Markets (Mandi)" on data.gov.in
    resourceId: "9ef84268-d588-465a-a308-a864a43d0070",
    // Public sample key published by data.gov.in. It returns only 10 rows per call.
    // Get your own free key at https://data.gov.in (My Account -> API key) and add it in Settings,
    // or better, set DATA_GOV_KEY on the Worker so the key never reaches the browser.
    sampleKey: "579b464db66ec23bdd000001cdd3946e44ce4aad7209ff7b23ac571b"
  },

  // Optional: shared marketplace, forum, jobs etc. across all users via Firebase Firestore.
  // Leave apiKey empty to keep all data in each visitor's browser (localStorage).
  firebase: {
    apiKey: "",
    authDomain: "",
    projectId: "",
    appId: ""
  }
};
