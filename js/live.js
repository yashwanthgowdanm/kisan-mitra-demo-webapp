"use strict";
/*
 * Live data sources (all free):
 *   Weather + ET0  : Open-Meteo (no key, CORS enabled)  https://open-meteo.com
 *   Place search   : Open-Meteo geocoding
 *   Mandi prices   : AGMARKNET daily prices on data.gov.in (via Worker /mandi, or direct with a key)
 */
const Live = (() => {
  const enc = encodeURIComponent;
  function cacheGet(k, maxAgeMs) {
    try { const v = JSON.parse(localStorage.getItem("km_cache_" + k)); if (v && Date.now() - v.t < maxAgeMs) return v.d; } catch (e) {}
    return null;
  }
  function cacheSet(k, d) { try { localStorage.setItem("km_cache_" + k, JSON.stringify({ t: Date.now(), d })); } catch (e) {} }

  async function geocode(q) {
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${enc(q)}&count=8&language=en&format=json&countryCode=IN`);
    if (!r.ok) throw new Error("Place search failed");
    const j = await r.json();
    return (j.results || []).map(x => ({ name: x.name, district: x.admin2 || x.name, state: x.admin1 || "", lat: x.latitude, lon: x.longitude }));
  }

  const WMO = { 0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Cloudy", 45: "Fog", 48: "Fog", 51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle", 61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain", 71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains", 80: "Light showers", 81: "Showers", 82: "Heavy showers", 85: "Snow showers", 86: "Snow showers", 95: "Thunderstorm", 96: "Thunderstorm, hail", 99: "Thunderstorm, hail" };

  async function weather(lat, lon, force) {
    const key = `w_${(+lat).toFixed(2)}_${(+lon).toFixed(2)}`;
    if (!force) { const c = cacheGet(key, 30 * 60 * 1000); if (c) return c; }
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m` +
      `&hourly=precipitation_probability` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,et0_fao_evapotranspiration` +
      `&timezone=Asia%2FKolkata&forecast_days=7`;
    const r = await fetch(url);
    if (!r.ok) throw new Error("Weather service unavailable");
    const j = await r.json();
    const d = j.daily || {};
    const days = (d.time || []).map((date, i) => ({
      date, desc: WMO[d.weather_code[i]] || "", tmax: d.temperature_2m_max[i], tmin: d.temperature_2m_min[i],
      rain_mm: d.precipitation_sum[i], rain_pct: d.precipitation_probability_max ? d.precipitation_probability_max[i] : null,
      wind: d.wind_speed_10m_max[i], et0: d.et0_fao_evapotranspiration ? d.et0_fao_evapotranspiration[i] : null
    }));
    // max rain probability over the next 6 hours
    let rain6 = null;
    if (j.hourly && j.hourly.time) {
      const now = Date.now();
      const idx = j.hourly.time.findIndex(tm => new Date(tm + ":00+05:30").getTime() >= now - 3600e3);
      if (idx >= 0) rain6 = Math.max(...j.hourly.precipitation_probability.slice(idx, idx + 6).filter(v => v != null));
    }
    const c = j.current || {};
    const out = {
      fetchedAt: Date.now(),
      current: { temp: c.temperature_2m, humidity: c.relative_humidity_2m, wind: c.wind_speed_10m, rain: c.precipitation, desc: WMO[c.weather_code] || "", rain6 },
      days
    };
    cacheSet(key, out);
    return out;
  }

  /* Crop name in the app -> words that appear in AGMARKNET commodity names */
  const MANDI_WORDS = {
    "Paddy": ["paddy"], "Wheat": ["wheat"], "Maize": ["maize"], "Ragi": ["ragi"], "Jowar": ["jowar"], "Bajra": ["bajra"],
    "Tur (Arhar)": ["arhar", "tur"], "Moong": ["green gram", "moong"], "Urad": ["black gram", "urd"], "Chickpea": ["bengal gram", "gram"],
    "Groundnut": ["groundnut"], "Soybean": ["soyabean", "soybean"], "Mustard": ["mustard"], "Sunflower": ["sunflower"],
    "Cotton": ["cotton", "kapas"], "Sugarcane": ["sugarcane", "jaggery"], "Tomato": ["tomato"], "Onion": ["onion"], "Potato": ["potato"],
    "Chilli": ["chilli"], "Brinjal": ["brinjal"], "Okra (Bhindi)": ["bhindi", "ladies finger"], "Cabbage": ["cabbage"], "Banana": ["banana"],
    "Mango": ["mango"], "Coconut": ["coconut", "copra"], "Arecanut": ["arecanut"], "Coffee": ["coffee"], "Turmeric": ["turmeric"],
    "Grapes": ["grapes"], "Pomegranate": ["pomegranate"]
  };
  function matchesCrop(commodity, crop) {
    if (!crop) return true;
    const c = String(commodity || "").toLowerCase();
    return (MANDI_WORDS[crop] || [crop.toLowerCase()]).some(w => c.includes(w));
  }

  /**
   * mandi({state, district, crop}) -> {records:[{state,district,market,commodity,variety,grade,arrival_date,min_price,max_price,modal_price}], source, limited}
   */
  async function mandi({ state, district, crop }, aiCfg, userKey) {
    const ck = `m_${state}_${district}_${crop}`;
    const cached = cacheGet(ck, 30 * 60 * 1000);
    if (cached) return cached;
    let records = [], source = "", limited = false;
    if (aiCfg && aiCfg.proxyUrl) {
      const u = new URL(aiCfg.proxyUrl.replace(/\/$/, "") + "/mandi");
      if (state) u.searchParams.set("state", state);
      if (district) u.searchParams.set("district", district);
      const r = await fetch(u);
      if (!r.ok) throw new Error("Mandi proxy error " + r.status);
      const j = await r.json();
      records = j.records || []; source = "proxy";
    } else {
      const key = userKey || window.KM_CONFIG.mandi.sampleKey;
      limited = !userKey;
      const base = `https://api.data.gov.in/resource/${window.KM_CONFIG.mandi.resourceId}?api-key=${enc(key)}&format=json&limit=${limited ? 10 : 1000}`;
      const tryFetch = async style => {
        let u = base;
        if (state) u += `&${enc(`filters[${style ? "state.keyword" : "state"}]`)}=${enc(state)}`;
        if (district) u += `&${enc(`filters[${style ? "district" : "district"}]`)}=${enc(district)}`;
        const r = await fetch(u);
        if (!r.ok) throw new Error("data.gov.in error " + r.status);
        return (await r.json()).records || [];
      };
      records = await tryFetch(true);
      if (!records.length) records = await tryFetch(false);
      source = "data.gov.in";
    }
    records = records.map(x => ({
      state: x.state, district: x.district, market: x.market, commodity: x.commodity, variety: x.variety, grade: x.grade,
      arrival_date: x.arrival_date, min_price: +x.min_price, max_price: +x.max_price, modal_price: +x.modal_price
    })).filter(x => matchesCrop(x.commodity, crop));
    const out = { records, source, limited, fetchedAt: Date.now() };
    cacheSet(ck, out);
    return out;
  }

  /* data.gov.in dates are dd/mm/yyyy */
  function parseArrival(s) { const m = String(s || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : s; }

  return { geocode, weather, mandi, parseArrival, WMO };
})();
