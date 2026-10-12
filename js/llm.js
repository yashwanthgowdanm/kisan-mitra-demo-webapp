"use strict";
/*
 * LLM client: one function, three backends.
 *   proxy     -> POST {proxyUrl}/chat   (Anthropic Messages format; the Worker adds the key)
 *   anthropic -> POST https://api.anthropic.com/v1/messages directly from the browser
 *   openai    -> POST {baseUrl}/chat/completions (any OpenAI-compatible API)
 * All stream tokens back through onText({text, delta}).
 */
const LLM = (() => {
  const SETTINGS_KEY = "km_ai";
  function cfg() {
    let mine = {};
    try { mine = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); } catch (e) {}
    const merged = { ...window.KM_CONFIG.ai };
    for (const k in mine) if (mine[k] !== "" && mine[k] != null) merged[k] = mine[k];
    return merged;
  }
  function save(patch) {
    let mine = {};
    try { mine = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); } catch (e) {}
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...mine, ...patch })); } catch (e) {}
  }
  function ready() {
    const c = cfg();
    if (c.provider === "proxy") return !!c.proxyUrl;
    if (c.provider === "anthropic") return !!c.apiKey;
    if (c.provider === "openai") return !!(c.baseUrl && c.model);
    return false;
  }

  /* Downscale photos to ~1280px JPEG before sending: faster on rural networks and cheaper. */
  async function prepImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const s = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const dataUrl = c.toDataURL("image/jpeg", 0.85);
      return { mediaType: "image/jpeg", base64: dataUrl.split(",")[1], dataUrl };
    } finally { URL.revokeObjectURL(url); }
  }

  async function* sseLines(res) {
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (line.startsWith("data:")) yield line.slice(5).trim();
      }
    }
    if (buf.trim().startsWith("data:")) yield buf.trim().slice(5).trim();
  }

  async function httpError(res) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = (j.error && (j.error.message || j.error)) || j.message || msg; } catch (e) {}
    const err = new Error(String(msg)); err.code = "http"; err.status = res.status; throw err;
  }

  /**
   * stream({system, messages:[{role,content}], images:[File], quick, maxTokens, onText, signal}) -> full text
   */
  async function stream({ system = "", messages, images = [], quick = false, maxTokens, onText, signal }) {
    const c = cfg();
    if (!ready()) { const e = new Error("No AI provider configured"); e.code = "not_configured"; throw e; }
    const model = quick && c.quickModel ? c.quickModel : c.model;
    const prepped = [];
    for (const f of images || []) if (f) prepped.push(await prepImage(f));
    let text = "";
    const emit = d => { if (!d) return; text += d; if (onText) onText({ text, delta: d }); };

    if (c.provider === "openai") {
      const msgs = [];
      if (system) msgs.push({ role: "system", content: system });
      messages.forEach((m, idx) => {
        if (idx === messages.length - 1 && m.role === "user" && prepped.length) {
          msgs.push({ role: "user", content: [{ type: "text", text: m.content }, ...prepped.map(p => ({ type: "image_url", image_url: { url: p.dataUrl } }))] });
        } else msgs.push(m);
      });
      const res = await fetch(c.baseUrl.replace(/\/$/, "") + "/chat/completions", {
        method: "POST", signal,
        headers: { "content-type": "application/json", ...(c.apiKey ? { authorization: "Bearer " + c.apiKey } : {}) },
        body: JSON.stringify({ model, messages: msgs, stream: true, max_tokens: maxTokens || c.maxTokens })
      });
      if (!res.ok) await httpError(res);
      for await (const d of sseLines(res)) {
        if (d === "[DONE]") break;
        try { const j = JSON.parse(d); emit(j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content); } catch (e) {}
      }
      return text;
    }

    // Anthropic Messages format (direct or via proxy)
    const msgs = messages.map((m, idx) => {
      if (idx === messages.length - 1 && m.role === "user" && prepped.length) {
        return { role: "user", content: [...prepped.map(p => ({ type: "image", source: { type: "base64", media_type: p.mediaType, data: p.base64 } })), { type: "text", text: m.content }] };
      }
      return m;
    });
    const body = { model, max_tokens: maxTokens || c.maxTokens, messages: msgs, stream: true };
    if (system) body.system = system;
    const direct = c.provider === "anthropic";
    const url = direct ? "https://api.anthropic.com/v1/messages" : c.proxyUrl.replace(/\/$/, "") + "/chat";
    const headers = { "content-type": "application/json" };
    if (direct) Object.assign(headers, { "x-api-key": c.apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" });
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });
    if (!res.ok) await httpError(res);
    for await (const d of sseLines(res)) {
      let j; try { j = JSON.parse(d); } catch (e) { continue; }
      if (j.type === "content_block_delta" && j.delta && j.delta.type === "text_delta") emit(j.delta.text);
      else if (j.type === "error") { const e = new Error((j.error && j.error.message) || "AI error"); e.code = "http"; e.status = 500; throw e; }
    }
    return text;
  }

  function parseJSON(raw) {
    let s = String(raw).trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) s = fence[1].trim();
    try { return JSON.parse(s); } catch (e) {}
    const a = Math.min(...["{", "["].map(ch => { const i = s.indexOf(ch); return i < 0 ? Infinity : i; }));
    const b = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
    if (a !== Infinity && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e) {} }
    const err = new Error("Could not read the AI answer"); err.code = "invalid_json"; err.raw = raw; throw err;
  }
  async function json(opts) {
    const sys = (opts.system ? opts.system + "\n" : "") + "Reply with only valid JSON. No prose, no markdown fences.";
    return parseJSON(await stream({ ...opts, system: sys, onText: null }));
  }

  return { cfg, save, ready, stream, json, parseJSON };
})();
