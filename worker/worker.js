/**
 * Kisan Mitra proxy — Cloudflare Worker
 *
 * Keeps your secret keys off GitHub Pages.
 *   POST /chat   -> Claude Messages API (streams back). Body: Anthropic Messages JSON.
 *   GET  /mandi  -> AGMARKNET daily prices from data.gov.in (?state=&district=), cached 30 min.
 *   GET  /health -> "ok"
 *
 * Secrets (wrangler secret put ...):  ANTHROPIC_API_KEY, DATA_GOV_KEY (optional)
 * Vars (wrangler.toml):               ALLOWED_ORIGINS, ALLOWED_MODELS, MAX_TOKENS, DAILY_LIMIT_PER_IP
 * Optional KV binding RATE (for per-IP daily limits).
 */
const MANDI_RESOURCE = "9ef84268-d588-465a-a308-a864a43d0070";
const SAMPLE_KEY = "579b464db66ec23bdd000001cdd3946e44ce4aad7209ff7b23ac571b";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
    const okOrigin = allowed.length === 0 || allowed.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": okOrigin ? (origin || "*") : "null",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (!okOrigin) return json({ error: { message: "Origin not allowed" } }, 403, cors);

    try {
      if (url.pathname === "/health") return new Response("ok", { headers: cors });
      if (url.pathname === "/chat" && request.method === "POST") return await chat(request, env, cors);
      if (url.pathname === "/mandi" && request.method === "GET") return await mandi(url, env, ctx, cors);
      return json({ error: { message: "Not found" } }, 404, cors);
    } catch (e) {
      return json({ error: { message: String(e && e.message || e) } }, 500, cors);
    }
  }
};

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, "content-type": "application/json" } });
}

async function rateLimit(request, env) {
  if (!env.RATE) return true;
  const limit = parseInt(env.DAILY_LIMIT_PER_IP || "60", 10);
  const ip = request.headers.get("CF-Connecting-IP") || "anon";
  const key = `${new Date().toISOString().slice(0, 10)}:${ip}`;
  const n = parseInt((await env.RATE.get(key)) || "0", 10);
  if (n >= limit) return false;
  await env.RATE.put(key, String(n + 1), { expirationTtl: 86400 });
  return true;
}

async function chat(request, env, cors) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: { message: "Proxy has no ANTHROPIC_API_KEY set" } }, 500, cors);
  if (!(await rateLimit(request, env))) return json({ error: { message: "Daily limit reached. Try again tomorrow." } }, 429, cors);

  const body = await request.json();
  const models = (env.ALLOWED_MODELS || "claude-sonnet-5-5,claude-haiku-5-5").split(",").map(s => s.trim());
  if (!models.includes(body.model)) body.model = models[0];
  const cap = parseInt(env.MAX_TOKENS || "2000", 10);
  body.max_tokens = Math.min(parseInt(body.max_tokens || cap, 10), cap);
  if (!Array.isArray(body.messages) || body.messages.length === 0) return json({ error: { message: "messages required" } }, 400, cors);
  body.messages = body.messages.slice(-16); // keep requests small

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: body.model, max_tokens: body.max_tokens, system: body.system, messages: body.messages, stream: body.stream !== false })
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { ...cors, "content-type": upstream.headers.get("content-type") || "text/event-stream", "cache-control": "no-store" }
  });
}

async function mandi(url, env, ctx, cors) {
  const state = url.searchParams.get("state") || "";
  const district = url.searchParams.get("district") || "";
  const cacheKey = new Request(`https://cache.kisan-mitra/mandi?state=${encodeURIComponent(state)}&district=${encodeURIComponent(district)}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) { const r = new Response(hit.body, hit); Object.entries(cors).forEach(([k, v]) => r.headers.set(k, v)); return r; }

  const key = env.DATA_GOV_KEY || SAMPLE_KEY;
  const base = `https://api.data.gov.in/resource/${MANDI_RESOURCE}?api-key=${encodeURIComponent(key)}&format=json&limit=${env.DATA_GOV_KEY ? 2000 : 10}`;
  const build = style => {
    let u = base;
    if (state) u += `&${encodeURIComponent(`filters[${style ? "state.keyword" : "state"}]`)}=${encodeURIComponent(state)}`;
    if (district) u += `&${encodeURIComponent("filters[district]")}=${encodeURIComponent(district)}`;
    return u;
  };
  let records = [];
  for (const style of [true, false]) {
    const r = await fetch(build(style), { headers: { accept: "application/json" } });
    if (r.ok) { const j = await r.json(); records = j.records || []; if (records.length) break; }
  }
  const res = json({ records, limited: !env.DATA_GOV_KEY, fetchedAt: Date.now() }, 200, { ...cors, "cache-control": "public, max-age=1800" });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
