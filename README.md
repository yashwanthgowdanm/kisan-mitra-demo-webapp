# Kisan Mitra — upgraded demo

A farmer super-app that runs entirely on GitHub Pages, with live data and a real AI assistant.

- **AI Crop Doctor**: photo → disease/pest, organic and chemical treatment, prevention (Claude vision)
- **KisanBot**: streaming chat in English, ಕನ್ನಡ, हिन्दी, తెలుగు, தமிழ், with photo attach and read-aloud
- **Live weather** (Open-Meteo, no key): 7-day forecast, spray-window check filled from live wind/rain, live ET₀ for irrigation
- **Live mandi prices** (AGMARKNET on data.gov.in) with MSP comparison, plus farmer-reported rates
- Crop calendar, soil health card reader, season planner, agroforestry, irrigation, cost & profit, solar ROI, GPS field mapper (acres/guntas/cents), crop diary, livestock records, spray safety log
- Marketplace, equipment rental, drone service requests, farm jobs, agri box, bulk-buying clubs, forum with AI-suggested answers, micro-courses, Kisan Radio (text-to-speech), loans & schemes checker, FPO builder
- 5 user roles (Farmer, Buyer, Service provider, FPO/Entrepreneur, Govt/NGO), installable PWA, offline app shell, light/dark themes

No build step. Plain HTML, CSS and JavaScript.

```
kisan-mitra-app/
├── index.html              app shell
├── css/app.css             design tokens + components (light/dark)
├── js/config.js            PUBLIC settings: proxy URL, models, optional Firebase
├── js/i18n.js              UI text in 5 languages
├── js/data.js              crops, states, MSP table, icons, tool registry
├── js/store.js             storage: this-device (localStorage) or shared (Firebase Firestore)
├── js/llm.js               AI client: Worker proxy / Claude direct / any OpenAI-compatible API
├── js/live.js              Open-Meteo weather + geocoding, AGMARKNET mandi prices
├── js/app.js               all screens and tools
├── sw.js, manifest.webmanifest, icons/   PWA
└── worker/                 Cloudflare Worker that holds your API keys
```

---

## 1. Put it on GitHub Pages (5 minutes)

1. Copy everything in this folder into your repo root (for example `kisan-mitra-demo-webapp`).
2. Commit and push.
3. GitHub → repo **Settings → Pages** → Source: *Deploy from a branch* → `main` / root → Save.
4. Open `https://<your-username>.github.io/<repo>/`.

Weather, place search, calculators, MSP and all forms work immediately. AI features need step 2.

To test locally: `python3 -m http.server 8080` in this folder, then open http://localhost:8080.

## 2. Turn on AI (pick one)

### A. Cloudflare Worker proxy — recommended for a public demo

Your Claude key stays on Cloudflare and never appears in the browser or on GitHub. Cloudflare's free plan is enough for a demo.

```bash
cd worker
npm install -g wrangler          # or use: npx wrangler ...
wrangler login
wrangler secret put ANTHROPIC_API_KEY     # paste your key from console.anthropic.com
wrangler secret put DATA_GOV_KEY          # optional: your data.gov.in key, for full mandi data
# edit wrangler.toml → ALLOWED_ORIGINS = your GitHub Pages origin
wrangler deploy
```

Copy the URL it prints (e.g. `https://kisan-mitra-proxy.<you>.workers.dev`) into `js/config.js`:

```js
ai: { provider: "proxy", proxyUrl: "https://kisan-mitra-proxy.<you>.workers.dev", ... }
```

Push again. Everyone who opens your site now gets AI with no setup.

Cost control: `ALLOWED_MODELS` pins the models, `MAX_TOKENS` caps each answer, and the optional `RATE` KV namespace limits requests per visitor per day (`DAILY_LIMIT_PER_IP`). Set a monthly spend limit in the Anthropic Console as well.

### B. Bring your own key (for you, while developing)

Open the app → ⚙ **Settings** → *Claude API directly with my own key* → paste key → **Test connection**. The key is stored in that browser only. Never put a key in `config.js`: anything pushed to GitHub Pages is public.

### C. Any other LLM

Settings → *Any OpenAI-compatible API*, then set the base URL and model:

| Provider | Base URL | Example model |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Groq | `https://api.groq.com/openai/v1` | a Llama model with vision |
| OpenRouter | `https://openrouter.ai/api/v1` | any listed model |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | a Gemini Flash model |
| Ollama (local) | `http://localhost:11434/v1` | `llava` |

Crop Doctor needs a model that accepts images.

## 3. Live data sources

| Data | Source | Key |
|---|---|---|
| Weather, ET₀, rain probability | [Open-Meteo](https://open-meteo.com/) | none |
| Place search | Open-Meteo geocoding | none |
| Mandi prices | [AGMARKNET daily prices on data.gov.in](https://data.gov.in/) (resource `9ef84268-d588-465a-a308-a864a43d0070`) | free key from data.gov.in |
| MSP | Hard-coded in `js/data.js` (Kharif 2026-27, Rabi RMS 2026-27) | update each season |

Without your own data.gov.in key the public sample key returns only 10 rows. Put your key on the Worker (`DATA_GOV_KEY`) or in Settings. If data.gov.in blocks direct browser requests, the Worker's `/mandi` route solves that. Open-Meteo's free tier is for non-commercial use; check their terms before launching commercially.

## 4. Optional: share posts between users (Firebase)

By default the marketplace, forum, jobs, clubs and personal records live in each visitor's browser. To make them shared:

1. Create a Firebase project → add a Web app → enable **Authentication → Anonymous** and **Firestore**.
2. Paste the web config (`apiKey`, `authDomain`, `projectId`, `appId`) into `js/config.js` → `firebase`. These values are designed to be public; security comes from the rules below.
3. Firestore → Rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    // private per-user data
    match /data/users/{uid}/{rest=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
    // shared boards
    match /{coll}/{id} {
      allow read: if coll in ['listings','equipment','droneRequests','jobs','clubs','forum','prices'];
      allow create: if request.auth != null && request.resource.data.owner == request.auth.uid;
      allow delete: if request.auth != null && resource.data.owner == request.auth.uid;
      allow update: if request.auth != null && (
        resource.data.owner == request.auth.uid ||
        (coll == 'clubs' && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['members'])) ||
        (coll == 'droneRequests' && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['acceptedBy']))
      );
    }
    match /forum/{id}/replies/{rid} {
      allow read: if true;
      allow create: if request.auth != null && request.resource.data.owner == request.auth.uid;
      allow delete: if request.auth != null && resource.data.owner == request.auth.uid;
    }
  }
}
```

The app switches to Firestore automatically when `firebase.apiKey` is set.

## Notes

- AI advice is a guide. The app tells farmers to read pesticide labels, keep pre-harvest intervals and contact their KVK; keep those prompts if you edit `js/app.js`.
- After each deploy, bump `VERSION` in `sw.js` so installed copies update.
- Kisan Call Centre: 1800-180-1551.
