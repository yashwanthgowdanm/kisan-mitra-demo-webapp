"use strict";
/* ---------- utils ---------- */
const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const inr=n=>isFinite(n)?"₹"+Math.round(n).toLocaleString("en-IN"):"—";
const fmt=(n,d=1)=>isFinite(n)?Number(n).toLocaleString("en-IN",{maximumFractionDigits:d}):"—";
const val=id=>{const e=document.getElementById(id);return e?e.value.trim():""};
const numv=id=>parseFloat(val(id));
const today=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")};
const dshow=s=>{if(!s)return"";const d=typeof s==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(s)?new Date(s+"T00:00"):new Date(s);return isNaN(d)?esc(s):d.toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})};
const ago=ms=>{if(!ms)return"";const m=Math.round((Date.now()-ms)/60000);if(m<1)return"just now";if(m<60)return m+" min ago";const h=Math.round(m/60);if(h<24)return h+" h ago";return Math.round(h/24)+" d ago"};
function toast(msg){const e=document.createElement("div");e.className="toast";e.setAttribute("role","status");e.textContent=msg;document.body.appendChild(e);setTimeout(()=>e.remove(),2600)}
function lsGet(k,d){try{const v=localStorage.getItem("km_"+k);return v==null?d:JSON.parse(v)}catch(e){return d}}
function lsSet(k,v){try{localStorage.setItem("km_"+k,JSON.stringify(v))}catch(e){}}
function cropOptions(sel){return CROPS.map(c=>`<option${c===sel?" selected":""}>${esc(c)}</option>`).join("")}
function stateOptions(sel){return STATES.map(c=>`<option${c===sel?" selected":""}>${esc(c)}</option>`).join("")}
/* tiny safe markdown */
function md(src){
  const lines=esc(src).split(/\n/);let html="",list=null;
  const inline=s=>s.replace(/\*\*(.+?)\*\*/g,"<b>$1</b>").replace(/(^|\s)\*(\S.+?)\*(?=\s|$)/g,"$1<i>$2</i>");
  const close=()=>{if(list){html+=`</${list}>`;list=null}};
  for(const raw of lines){const l=raw.trim();
    if(!l){close();continue}
    let m;
    if((m=l.match(/^#{1,4}\s+(.*)/))){close();html+=`<h4>${inline(m[1])}</h4>`;continue}
    if((m=l.match(/^[-*•]\s+(.*)/))){if(list!=="ul"){close();html+="<ul>";list="ul"}html+=`<li>${inline(m[1])}</li>`;continue}
    if((m=l.match(/^\d+[.)]\s+(.*)/))){if(list!=="ol"){close();html+="<ol>";list="ol"}html+=`<li>${inline(m[1])}</li>`;continue}
    close();html+=`<p>${inline(l)}</p>`}
  close();return html}

/* ---------- storage, AI and live data glue ---------- */
const CAP={db:null,ready:false};
async function boot(){
  const fb=window.KM_CONFIG.firebase;
  try{CAP.db=fb&&fb.apiKey?await FirebaseStore(fb):LocalStore}catch(e){console.warn("Firebase unavailable, using this device only",e);CAP.db=LocalStore}
  try{S.uid=await CAP.db.init()}catch(e){CAP.db=LocalStore;S.uid=await LocalStore.init()}
  CAP.ready=true;
  try{const snap=await profRef().get();if(snap.exists){S.profile={...S.profile,...snap.data()};if(S.profile.lang&&LANGS[S.profile.lang])S.lang=S.profile.lang;if(S.profile.role)S.role=S.profile.role}}catch(e){}
  applyChrome();render();
}
const shared=()=>CAP.db&&CAP.db.kind==="firebase";
const profRef=()=>CAP.db.doc("data/users/"+S.uid+"/profile");
const mine=name=>profRef().collection(name);
let profSaving=Promise.resolve();
function saveProfile(patch){Object.assign(S.profile,patch);lsSet("profile",S.profile);if(!CAP.db||!S.uid)return;profSaving=profSaving.then(()=>profRef().set({...S.profile},{merge:true})).catch(()=>{})}
const canWrite=()=>!!(CAP.db&&S.uid);

function langLine(){return `Write every human-readable value in ${LANGS[S.lang]}${S.lang!=="en"?" (native script), keeping crop, product and chemical names also in English in brackets where helpful":""}. Use simple words a farmer understands.`}
function weatherLine(){const w=S.weather;if(!w||!w.days||!w.days.length)return"";const d=w.days.slice(0,3).map(x=>`${x.date}: ${x.desc}, ${Math.round(x.tmin)}-${Math.round(x.tmax)}°C, rain ${x.rain_mm}mm (${x.rain_pct??"?"}%), wind ${Math.round(x.wind)} km/h`).join("; ");return ` Live forecast for the farm: ${d}.`}
function ctxLine(){const p=S.profile;return `User role: ${S.role}. Location: ${[p.place,p.district,p.state].filter(Boolean).join(", ")||"India (not specified)"}. Today: ${today()}.${weatherLine()}`}
function aiErr(e){
  if(!e)return"Something went wrong.";
  if(e.code==="not_configured")return"Connect an AI model in Settings to use this.";
  if(e.code==="invalid_json")return"The answer came back in the wrong shape. Tap the button again.";
  if(e.name==="AbortError")return"";
  if(e.status===401||e.status===403)return"The AI service rejected the API key. Check it in Settings.";
  if(e.status===429)return"Too many requests right now. Try again in a minute.";
  if(e.status===413)return"The photo is too large. Try a smaller one.";
  if(e.status)return"AI service error ("+e.status+"): "+e.message;
  return"Could not reach the AI service. Check your internet connection or the proxy URL in Settings.";
}
function aiOffHTML(){return `<p class="note">${esc(t("ai_off"))} <button class="btn btn-sm" data-go="settings">Settings</button></p>`}
function wireInlineGo(el){el.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>go(b.dataset.go))}
/* small response cache so repeated lessons/plans don't spend tokens again */
function cacheKey(s){let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))|0;return"ai_"+S.lang+"_"+h}
function aiCacheGet(k,ms){const v=lsGet(k,null);return v&&Date.now()-v.t<ms?v.d:null}
function aiCacheSet(k,d){lsSet(k,{t:Date.now(),d})}
async function aiText(prompt,out,opts={}){
  if(!LLM.ready()){out.innerHTML=aiOffHTML();wireInlineGo(out);return null}
  const ttl=opts.cache&&opts.cache.gcTime,ck=ttl&&cacheKey(prompt);
  const hit=ttl&&aiCacheGet(ck,ttl);
  if(hit){out.innerHTML=md(hit);if(opts.speak!==false)addListen(out,hit);return hit}
  out.innerHTML=`<p class="muted"><span class="spin"></span> ${esc(t("thinking"))}</p>`;
  try{const text=await LLM.stream({messages:[{role:"user",content:prompt}],images:opts.images,quick:opts.quick,onText:({text})=>{out.innerHTML=md(text)}});
    out.innerHTML=md(text);if(ttl)aiCacheSet(ck,text);if(opts.speak!==false)addListen(out,text);return text}
  catch(e){const m=aiErr(e);out.innerHTML=m?`<p class="note">${esc(m)}</p>`:"";return null}
}
async function aiJSON(prompt,status,opts={}){
  if(!LLM.ready()){status.innerHTML=aiOffHTML();wireInlineGo(status);return null}
  const ttl=opts.cache&&opts.cache.gcTime,ck=ttl&&cacheKey("j"+prompt);
  const hit=ttl&&!opts.images&&aiCacheGet(ck,ttl);if(hit){status.innerHTML="";return hit}
  status.innerHTML=`<p class="muted"><span class="spin"></span> ${esc(t("thinking"))}</p>`;
  try{const r=await LLM.json({messages:[{role:"user",content:prompt}],images:opts.images,quick:opts.quick});status.innerHTML="";if(ttl&&!opts.images)aiCacheSet(ck,r);return r}
  catch(e){status.innerHTML=`<p class="note">${esc(aiErr(e))}</p>`;return null}
}
/* text-to-speech */
let speaking=null;
function speak(text,btn){
  if(!("speechSynthesis" in window)){toast("Listening is not supported in this browser.");return}
  window.speechSynthesis.cancel();
  if(speaking===btn){speaking=null;btn.innerHTML=icon("speaker",16)+" "+esc(t("listen"));return}
  if(speaking)speaking.innerHTML=icon("speaker",16)+" "+esc(t("listen"));
  const u=new SpeechSynthesisUtterance(text.replace(/[*#•]/g,"").slice(0,4000));u.lang=SPEECH[S.lang];
  const v=speechSynthesis.getVoices().find(v=>v.lang&&v.lang.toLowerCase().startsWith(S.lang));if(v)u.voice=v;
  u.onend=()=>{if(speaking===btn){speaking=null;btn.innerHTML=icon("speaker",16)+" "+esc(t("listen"))}};
  speaking=btn;btn.innerHTML=icon("speaker",16)+" "+esc(t("stop"));speechSynthesis.speak(u);
}
function addListen(container,text){const b=document.createElement("button");b.className="btn btn-sm";b.type="button";b.innerHTML=icon("speaker",16)+" "+esc(t("listen"));b.onclick=()=>speak(text,b);const w=document.createElement("div");w.className="row";w.style.marginTop="6px";w.appendChild(b);container.appendChild(w)}

/* subscriptions per view */
let subs=[];
function unsubAll(){subs.forEach(u=>{try{u()}catch(e){}});subs=[];try{speechSynthesis.cancel()}catch(e){};speaking=null}
function listen(q,cb,el){
  if(!q){if(el)el.innerHTML=`<div class="empty">${esc(CAP.ready?t("nothing"):"…")}</div>`;return}
  try{subs.push(q.onSnapshot(s=>cb(s),err=>{console.warn(err);if(el)el.innerHTML=`<div class="empty">Could not load. Check your connection and reopen this page.</div>`}))}catch(e){console.warn(e)}
}
async function addShared(coll,data){
  if(!canWrite()){toast("Still loading, try again in a moment.");return false}
  try{await CAP.db.collection(coll).add({...data,owner:S.uid,authorName:(S.profile.name||"").slice(0,40),createdAt:Date.now()});return true}
  catch(e){console.warn(e);toast("Could not save. Try again.");return false}
}
async function addMine(coll,data){
  if(!canWrite()){toast("Still loading, try again in a moment.");return false}
  try{await mine(coll).add({...data,createdAt:Date.now()});return true}catch(e){toast("Could not save. Try again.");return false}
}
const sharedNote=()=>shared()?"":`<p class="small muted">Demo mode: posts are saved on this device only. Connect Firebase in js/config.js to share them between users.</p>`;
/* ---------- chrome ---------- */
const NAV=[["home","home","nav_home"],["farm","leaf","nav_farm"],["market","bag","nav_market"],["comm","chat","nav_comm"],["bot","bot","nav_bot"]];
function applyChrome(){
  document.documentElement.lang=S.lang;
  $("#langSel").value=S.lang;$("#tagline").textContent=t("tagline");
  $("#roleSel").innerHTML=ROLES.map(r=>`<option value="${r}"${r===S.role?" selected":""}>${esc(t("r_"+r))}</option>`).join("");
  const nav=NAV.map(([id,ic,k])=>`<button class="navbtn" data-nav="${id}">${icon(ic,20)}<span>${esc(t(k))}</span></button>`).join("");
  $("#tabsBottom").innerHTML=nav;$("#tabsWide").innerHTML=nav;
  $("#setBtn").innerHTML=icon("gear",18);$("#setBtn").onclick=()=>go("settings");
  document.querySelectorAll("[data-nav]").forEach(b=>b.onclick=()=>go(b.dataset.nav));
  markNav();
}
function markNav(){const tool=TOOLS.find(x=>x.id===S.route);const cur=tool?tool.g:S.route;document.querySelectorAll("[data-nav]").forEach(b=>b.dataset.nav===cur?b.setAttribute("aria-current","page"):b.removeAttribute("aria-current"))}
$("#langSel").onchange=e=>{S.lang=e.target.value;lsSet("lang",S.lang);saveProfile({lang:S.lang});applyChrome();render()};
$("#roleSel").onchange=e=>{S.role=e.target.value;lsSet("role",S.role);saveProfile({role:S.role});render()};
$("#brand").onclick=e=>{e.preventDefault();go("home")};
function go(r){S.route=r;try{history.replaceState(null,"","#"+r)}catch(e){}render();window.scrollTo(0,0)}
window.addEventListener("hashchange",()=>{const h=location.hash.slice(1);if(h&&h!==S.route){S.route=h;render()}});

/* ---------- views ---------- */
function toolTile(id){const tool=TOOLS.find(x=>x.id===id)||{id,g:"farm",i:"bot"};return `<button class="tool g-${tool.g}" data-go="${id}"><span class="ico">${icon(tool.i,20)}</span><b>${esc(tn(id))}</b><small>${esc(td(id))}</small></button>`}
function wireGo(root){root.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>go(b.dataset.go))}
function groupSection(g,key){return `<section class="g-${g}" style="display:flex;flex-direction:column;gap:10px"><div class="section-head"><h2>${esc(t(key))}</h2></div><div class="grid-tools">${TOOLS.filter(x=>x.g===g).map(x=>toolTile(x.id)).join("")}</div></section>`}

function render(){
  unsubAll();markNav();const m=$("#main");
  const r=S.route;
  if(r==="home")return viewHome(m);
  if(r==="farm")return viewGroup(m,"farm","nav_farm");
  if(r==="market")return viewGroup(m,"market","nav_market");
  if(r==="comm")return viewGroup(m,"comm","nav_comm");
  if(r==="bot")return viewBot(m);
  if(r==="settings")return viewSettings(m);
  const tool=TOOLS.find(x=>x.id===r);
  if(!tool){S.route="home";return viewHome(m)}
  m.innerHTML=`<div class="view-head g-${tool.g}"><button class="backbtn" id="backBtn" aria-label="${esc(t("back"))}">${icon("back",18)}</button><span class="ico">${icon(tool.i,22)}</span><div style="min-width:0"><h1 style="font-size:1.5rem">${esc(tn(r))}</h1><p class="muted small">${esc(td(r))}</p></div></div><div id="tv" style="display:flex;flex-direction:column;gap:14px"></div>`;
  $("#backBtn").onclick=()=>go(tool.g==="farm"?"farm":tool.g==="market"?"market":"comm");
  VIEWS[r]($("#tv"));
}

function viewGroup(m,g,key){m.innerHTML=`<h1>${esc(t(key))}</h1>`+groupSection(g,key).replace(/<div class="section-head">.*?<\/div>/,"");wireGo(m)}

function profileStrip(){
  const p=S.profile;const where=[p.district,p.state].filter(Boolean).join(", ");
  const w=S.weather&&S.weather.current;
  return `<div class="profile-strip" id="pstrip"><span class="muted">${esc(t("your_farm"))}:</span> <b>${where?esc([p.place,where].filter(Boolean).join(" · ")):"—"}</b>${w?` <span class="chip c-n num">${fmt(w.temp,0)}°C · ${esc(w.desc)}</span>`:""} <button class="btn btn-sm" id="editLoc">${where?"Change":"Set location"}</button></div>
  <div class="panel-sunk" id="locForm" hidden>${placePicker()}</div>`}
function placePicker(){return `<form class="row" id="plcF"><div class="field" style="flex:1;min-width:180px"><label for="plcQ">Search your village or town</label><input type="text" id="plcQ" placeholder="e.g. Maddur" autocomplete="off"></div><button class="btn btn-primary" type="submit">Search</button></form><div class="list" id="plcRes"></div><p class="small muted">Used for live weather and to tailor advice to your area.</p>`}
function wirePlacePicker(root,after){
  const f=$("#plcF",root);if(!f)return;
  f.onsubmit=async e=>{e.preventDefault();const q=val("plcQ");if(!q)return;const box=$("#plcRes",root);box.innerHTML=`<p class="muted"><span class="spin"></span></p>`;
    try{const res=await Live.geocode(q);if(!res.length){box.innerHTML=`<div class="empty">No place found. Try the nearest town.</div>`;return}
      box.innerHTML=res.map((r,i)=>`<button type="button" class="item" style="text-align:left;cursor:pointer" data-i="${i}"><b>${esc(r.name)}</b><span class="meta"><span>${esc(r.district)}</span><span>${esc(r.state)}</span></span></button>`).join("");
      box.querySelectorAll("[data-i]").forEach(b=>b.onclick=()=>{const r=res[+b.dataset.i];const st=STATES.find(s=>s.toLowerCase()===String(r.state).toLowerCase())||r.state;saveProfile({place:r.name,district:r.district,state:st,lat:r.lat,lon:r.lon});S.weather=null;loadWeather();toast("Location saved");after&&after()})}
    catch(err){box.innerHTML=`<div class="empty">Place search is unavailable. Check your connection.</div>`}};
}
function wireProfile(root){
  const f=$("#locForm",root);if(!f)return;$("#editLoc",root).onclick=()=>{f.hidden=!f.hidden;if(!f.hidden)$("#plcQ").focus()};
  wirePlacePicker(root,()=>render());
}
async function loadWeather(force){const p=S.profile;if(p.lat==null)return null;try{S.weather=await Live.weather(p.lat,p.lon,force);return S.weather}catch(e){return null}}

function viewHome(m){
  const fy=FORYOU[S.role]||FORYOU.farmer;
  m.innerHTML=`
  <section class="hero">
    <div style="display:flex;flex-direction:column;gap:10px"><span class="eyebrow" style="color:inherit;opacity:.8">${esc(tn("diagnose"))}</span><h1>${esc(t("hero_title"))}</h1><p>${esc(t("hero_sub"))}</p></div>
    <div class="diag-form" id="heroDiag"></div>
  </section>
  ${LLM.ready()?"":`<p class="note">Connect an AI model to turn on Crop Doctor, KisanBot and AI advice. <button class="btn btn-sm" data-go="settings">Open Settings</button></p>`}
  ${profileStrip()}
  <section style="display:flex;flex-direction:column;gap:10px"><div class="section-head"><h2>${esc(t("for_you"))}</h2><span class="muted small">${esc(t("r_"+S.role))}</span></div><div class="foryou">${fy.map(toolTile).join("")}${toolTile("bot")}</div></section>
  ${groupSection("farm","nav_farm")}${groupSection("market","nav_market")}${groupSection("comm","nav_comm")}
  <footer>Kisan Mitra · AI advice is a guide, not a substitute for your local KVK or agriculture officer. Kisan Call Centre: 1800-180-1551</footer>`;
  wireGo(m);wireProfile(m);diagForm($("#heroDiag"),true);
  if(S.profile.lat!=null&&!S.weather)loadWeather().then(w=>{if(w&&S.route==="home"){const ps=$("#pstrip");if(ps){const tmp=document.createElement("div");tmp.innerHTML=profileStrip();ps.replaceWith(tmp.firstElementChild);$("#editLoc").onclick=()=>{const f=$("#locForm");f.hidden=!f.hidden}}}});
}

/* ---------- Crop Doctor ---------- */
let lastPhoto=null;
function diagForm(el,hero){
  el.innerHTML=`<form id="dForm" style="display:flex;flex-direction:column;gap:10px">
    <label class="drop" id="dDrop" for="dFile"><span class="ph" id="dThumb">${icon("cam",26)}</span><span><b>${esc(t("choose_photo"))}</b><br><span class="small" style="opacity:.85">${esc(t("photo_hint"))}</span></span></label>
    <input type="file" id="dFile" accept="image/jpeg,image/png,image/webp" hidden>
    <div class="form-grid"><div class="field"><label for="dCrop">${esc(t("crop"))}</label><select id="dCrop">${cropOptions(S.profile.lastCrop||"Tomato")}</select></div></div>
    <div class="field"><label for="dSym">${esc(t("symptoms_opt"))}</label><textarea id="dSym" rows="2" placeholder="Yellow spots with brown rings on lower leaves…"></textarea></div>
    <div class="row"><button class="btn btn-primary" type="submit" id="dGo">${icon("leaf",18)} ${esc(t("diagnose_btn"))}</button></div>
  </form>`;
  const file=$("#dFile",el);
  file.onchange=()=>{const f=file.files[0];if(!f)return;lastPhoto=f;const url=URL.createObjectURL(f);$("#dThumb",el).outerHTML=`<img id="dThumb" src="${url}" alt="Selected crop photo">`};
  if(lastPhoto){const url=URL.createObjectURL(lastPhoto);$("#dThumb",el).outerHTML=`<img id="dThumb" src="${url}" alt="Selected crop photo">`}
  $("#dForm",el).onsubmit=e=>{e.preventDefault();S.profile.lastCrop=val("dCrop");S.pendingDiag={crop:val("dCrop"),sym:val("dSym"),photo:lastPhoto};if(hero)go("diagnose");else runDiag()};
}
const VIEWS={};
VIEWS.diagnose=el=>{
  el.innerHTML=`<div class="card" id="dCard"></div><div id="dResult"></div><section class="card"><h3>${esc(t("history"))}</h3><div class="list" id="dHist"></div></section>`;
  diagForm($("#dCard"),false);
  if(S.pendingDiag){$("#dCrop").value=S.pendingDiag.crop;$("#dSym").value=S.pendingDiag.sym||"";runDiag()}
  if(!(CAP.db&&S.uid)){$("#dHist").innerHTML=`<div class="empty">${esc(CAP.ready?t("nothing"):"Loading…")}</div>`;return}
  listen(mine("diagnoses").orderBy("createdAt","desc").limit(15),s=>{
    const h=$("#dHist");if(!h)return;
    h.innerHTML=s.empty?`<div class="empty">${esc(t("nothing"))}</div>`:s.docs.map(d=>{const x=d.data();return `<div class="item"><div class="item-top"><div><b>${esc(x.problem)}</b><div class="meta"><span>${esc(x.crop)}</span><span>${dshow(x.createdAt)}</span></div></div>${confChip(x.confidence)}</div></div>`}).join("")
  },$("#dHist"));
};
function confChip(c){return c==="high"?`<span class="chip c-ok">high confidence</span>`:c==="medium"?`<span class="chip c-warn">medium confidence</span>`:`<span class="chip c-n">${esc(c||"low")} confidence</span>`}
async function runDiag(){
  const out=$("#dResult");if(!out)return;
  const crop=val("dCrop"),sym=val("dSym");const photo=S.pendingDiag?.photo||lastPhoto;S.pendingDiag=null;
  if(!photo&&!sym){out.innerHTML=`<p class="note">Add a photo or describe what you see on the plant.</p>`;return}
  const useImg=!!photo;
  out.innerHTML=`<div class="card" id="dStat"></div>`;
  const prompt=`You are an experienced Indian plant-protection specialist (KVK level). Diagnose the problem in this ${crop} crop.
${useImg?"A photo of the affected plant part is attached.":"No photo is available; rely on the description."}
Farmer's description: ${sym||"(none)"}
${ctxLine()}
${langLine()}
Recommend only products registered for use in India (CIBRC), with dose per litre of water or per acre, and pre-harvest interval if relevant. Prefer IPM and organic options first. Never recommend banned pesticides (e.g. monocrotophos on vegetables, endosulfan).
Reply with only JSON:
{"problem":"name of disease/pest/deficiency (local + English)","type":"disease|pest|nutrient|abiotic|healthy|unclear","confidence":"high|medium|low","seen":["symptoms you can see"],"cause":"one or two sentences","do_now":["immediate steps"],"organic":["organic / bio options with dose"],"chemical":[{"product":"active ingredient (trade name examples)","dose":"dose","note":"timing, PHI, safety"}],"prevention":["for next time"],"see_expert":true|false,"expert_reason":"when to visit KVK"}`;
  const r=await aiJSON(prompt,$("#dStat"),{...(useImg?{images:[photo]}:{}),modelTier:"default"});
  if(!r){return}
  const L=a=>Array.isArray(a)&&a.length?`<ul>${a.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:`<p class="muted">—</p>`;
  const speakText=[r.problem,r.cause,...(r.do_now||[]),...(r.organic||[]),...(r.prevention||[])].join(". ");
  out.innerHTML=`<article class="card">
   <div class="item-top"><div><span class="eyebrow">${esc(crop)} · ${esc(r.type||"")}</span><h2>${esc(r.problem)}</h2></div>${confChip(r.confidence)}</div>
   <p>${esc(r.cause)}</p>
   ${r.seen&&r.seen.length?`<div><h3>What it looks like</h3>${L(r.seen)}</div>`:""}
   <div class="panel-sunk"><h3>Do this now</h3>${L(r.do_now)}</div>
   <div class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr))"><div><h3>Organic & bio options</h3>${L(r.organic)}</div>
   <div><h3>If chemical control is needed</h3>${(r.chemical||[]).length?`<ul>${r.chemical.map(c=>`<li><b>${esc(c.product)}</b> — ${esc(c.dose)}${c.note?`<br><span class="small muted">${esc(c.note)}</span>`:""}</li>`).join("")}</ul>`:`<p class="muted">—</p>`}</div></div>
   <div><h3>Prevention</h3>${L(r.prevention)}</div>
   ${r.see_expert?`<p class="verdict c-warn">${esc(r.expert_reason||"Show a sample to your nearest Krishi Vigyan Kendra.")}</p>`:""}
   <p class="note">Read the product label before spraying, wear gloves and a mask, and keep the pre-harvest interval.</p>
   <div class="row" id="dAct"></div></article>`;
  addListen($("#dAct"),speakText);
  if(canWrite())mine("diagnoses").add({crop,problem:String(r.problem||"").slice(0,200),confidence:r.confidence||"",type:r.type||"",createdAt:Date.now()}).catch(()=>{});
}

/* ---------- Weather (live: Open-Meteo) ---------- */
VIEWS.weather=el=>{
  el.innerHTML=`<section class="card"><div class="section-head"><h3>7-day forecast${S.profile.place?" · "+esc(S.profile.place):""}</h3><span class="small muted" id="wUpd"></span></div><div id="wList"></div></section>
  <section class="card"><h3>Can I spray now?</h3><p class="small muted" id="sSrc">Enter what the forecast says for the next few hours.</p>
  <form id="sprayForm" class="form-grid"><div class="field"><label for="sWind">Wind (km/h)</label><input type="number" id="sWind" value="9" min="0" step="1"></div><div class="field"><label for="sRain">Rain chance next 6 h (%)</label><input type="number" id="sRain" value="20" min="0" max="100"></div><div class="field"><label for="sTemp">Temperature (°C)</label><input type="number" id="sTemp" value="29"></div><div class="field"><label for="sHum">Humidity (%)</label><input type="number" id="sHum" value="65" min="0" max="100"></div><div class="field span2"><button class="btn btn-primary" type="submit">${esc(t("calc"))}</button></div></form><div id="sOut"></div></section>
  <section class="card"><div class="row"><button class="btn btn-sm" id="wAI">${esc(t("ai_advice"))}: farm work this week</button></div><div class="ai-out" id="wAIOut"></div></section>
  <p class="small muted">Forecast data: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>. Official advisories: <a href="https://mausam.imd.gov.in/" target="_blank" rel="noopener">IMD Mausam</a> · Meghdoot app.</p>`;
  $("#sprayForm").onsubmit=e=>{e.preventDefault();sprayVerdict()};sprayVerdict();
  $("#wAI").onclick=()=>aiText(`Based on this week's forecast, give a day-by-day plan of farm work (spraying, irrigation, fertiliser, harvesting, protecting stored produce) for a ${S.profile.lastCrop||"mixed crop"} farmer. ${ctxLine()} ${langLine()} Under 180 words, bullet points.`,$("#wAIOut"));
  const box=$("#wList");
  if(S.profile.lat==null){box.innerHTML=placePicker();wirePlacePicker(box,()=>render());return}
  box.innerHTML=`<p class="muted"><span class="spin"></span> Loading forecast…</p>`;
  const draw=w=>{
    if(!w){box.innerHTML=`<div class="empty">Couldn't load the forecast. Check your connection. <button class="btn btn-sm" id="wRetry">Retry</button></div>`;$("#wRetry").onclick=()=>render();return}
    $("#wUpd").textContent="Updated "+new Date(w.fetchedAt).toLocaleTimeString("en-IN",{hour:"numeric",minute:"2-digit"});
    const c=w.current;
    box.innerHTML=`<div class="kpis"><div class="kpi"><span>Now</span><b>${fmt(c.temp,0)}°C</b><span>${esc(c.desc)}</span></div><div class="kpi"><span>Humidity</span><b>${fmt(c.humidity,0)}%</b></div><div class="kpi"><span>Wind</span><b>${fmt(c.wind,0)} km/h</b></div><div class="kpi"><span>Rain chance, next 6 h</span><b>${c.rain6!=null&&isFinite(c.rain6)?fmt(c.rain6,0)+"%":"—"}</b></div></div>
    <div class="tablewrap"><table class="num"><thead><tr><th>${esc(t("date"))}</th><th>Sky</th><th class="r">Max °C</th><th class="r">Min °C</th><th class="r">Rain mm</th><th class="r">Rain %</th><th class="r">Wind km/h</th><th class="r">ET₀ mm</th></tr></thead><tbody>${w.days.map(x=>`<tr><td>${new Date(x.date+"T00:00").toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"short"})}</td><td>${esc(x.desc)}</td><td class="r">${fmt(x.tmax,0)}</td><td class="r">${fmt(x.tmin,0)}</td><td class="r">${fmt(x.rain_mm,1)}</td><td class="r">${x.rain_pct==null?"—":fmt(x.rain_pct,0)}</td><td class="r">${fmt(x.wind,0)}</td><td class="r">${fmt(x.et0,1)}</td></tr>`).join("")}</tbody></table></div>
    <div class="row"><button class="btn btn-sm" id="wRef">Refresh</button><button class="btn btn-sm" id="wLoc">Change place</button></div>`;
    $("#wRef").onclick=async()=>{await loadWeather(true);render()};
    $("#wLoc").onclick=()=>{box.insertAdjacentHTML("beforeend",`<div class="panel-sunk" id="wPick">${placePicker()}</div>`);wirePlacePicker($("#wPick"),()=>render())};
    if(isFinite(c.wind)){$("#sWind").value=Math.round(c.wind);$("#sTemp").value=Math.round(c.temp);$("#sHum").value=Math.round(c.humidity);if(c.rain6!=null&&isFinite(c.rain6))$("#sRain").value=Math.round(c.rain6);$("#sSrc").textContent="Filled in from the live forecast for your farm. Change any value to re-check.";sprayVerdict()}
  };
  loadWeather().then(w=>{if(S.route==="weather")draw(w)});
};
function sprayVerdict(){
  const w=numv("sWind"),r=numv("sRain"),tp=numv("sTemp"),h=numv("sHum");const issues=[];let lvl=0;
  if(w>15){issues.push("Wind is too strong: spray will drift to neighbouring fields.");lvl=2}else if(w<3){issues.push("Very still air: fine droplets can hang and drift. Prefer 3–15 km/h.");lvl=Math.max(lvl,1)}
  if(r>=60){issues.push("Rain is likely: it will wash the spray off. Wait for a dry window of at least 6 hours.");lvl=2}else if(r>=30){issues.push("Some chance of rain. Use a sticker/spreader or wait.");lvl=Math.max(lvl,1)}
  if(tp>32){issues.push("Hot: spray evaporates fast and can scorch leaves. Spray early morning or after 4 pm.");lvl=Math.max(lvl,1)}
  if(h<40){issues.push("Dry air: droplets evaporate quickly.");lvl=Math.max(lvl,1)}
  const cls=["c-ok","c-warn","c-bad"][lvl],head=["Good time to spray","Spray with care","Don't spray now"][lvl];
  $("#sOut").innerHTML=`<div class="verdict ${cls}">${head}</div>${issues.length?`<ul>${issues.map(i=>`<li>${esc(i)}</li>`).join("")}</ul>`:`<p class="small muted">Wind, rain chance, temperature and humidity are all in a safe range.</p>`}`;
}

/* ---------- Mandi & MSP (live: AGMARKNET via data.gov.in) ---------- */
VIEWS.mandi=el=>{
  const p=S.profile;
  el.innerHTML=`<section class="card"><div class="section-head"><h3>Today's mandi prices</h3><span class="small muted">₹ per quintal · AGMARKNET</span></div>
  <form id="lmF" class="form-grid"><div class="field"><label for="lmState">${esc(t("state"))}</label><select id="lmState">${stateOptions(p.state||"Karnataka")}</select></div><div class="field"><label for="lmDist">${esc(t("district"))} (optional)</label><input type="text" id="lmDist" value="${esc(p.district||"")}"></div><div class="field"><label for="lmCrop">${esc(t("crop"))}</label><select id="lmCrop"><option value="">All crops</option>${cropOptions(p.lastCrop||"")}</select></div><div class="field"><label>&nbsp;</label><button class="btn btn-primary" type="submit">Get prices</button></div></form>
  <div id="lmOut"></div><div class="row"><button class="btn btn-sm" id="pAI">${esc(t("ai_advice"))}: sell or hold?</button></div><div id="pAIOut" class="ai-out"></div></section>
  <section class="card"><div class="section-head"><h3>Farmer-reported rates</h3><span class="small muted">for mandis not on AGMARKNET</span></div>
  <form id="pForm" class="form-grid"><div class="field"><label for="pCrop">${esc(t("crop"))}</label><select id="pCrop">${cropOptions("Tomato")}</select></div><div class="field"><label for="pMkt">Mandi / APMC</label><input type="text" id="pMkt" placeholder="e.g. Kolar APMC"></div><div class="field"><label for="pRate">Modal price (₹/qtl)</label><input type="number" id="pRate" min="0" placeholder="1800"></div><div class="field"><label for="pDate">${esc(t("date"))}</label><input type="date" id="pDate" value="${today()}"></div><div class="field span2"><button class="btn btn-primary" type="submit">Report a rate</button></div></form>
  <div id="pList"></div>${sharedNote()}</section>
  <section class="card"><div class="section-head"><h3>Minimum Support Price</h3><span class="small muted">₹ per quintal, Government of India</span></div><div class="tablewrap"><table><thead><tr><th>Crop</th><th class="r">MSP</th><th>Season</th></tr></thead><tbody class="num">${MSP.map(m=>`<tr><td>${esc(m[0])}</td><td class="r">${inr(m[1])}</td><td class="muted">${esc(m[2])}</td></tr>`).join("")}</tbody></table></div><p class="small muted">Kharif MSPs approved by the Cabinet on 13 May 2026; rabi MSPs for RMS 2026-27. Update js/data.js when new MSPs are announced. Official sites: <a href="https://agmarknet.gov.in/" target="_blank" rel="noopener">AGMARKNET</a> · <a href="https://enam.gov.in/" target="_blank" rel="noopener">eNAM</a></p></section>`;
  let live=[],rows=[];
  const vsMsp=(crop,rate)=>{const ms=mspFor(crop);if(!ms||!isFinite(rate))return"—";const d=(rate-ms[1])/ms[1]*100;return `<span class="chip ${d>=0?"c-ok":"c-bad"}">${d>=0?"+":""}${fmt(d,0)}%</span>`};
  $("#lmF").onsubmit=async e=>{e.preventDefault();const out=$("#lmOut");out.innerHTML=`<p class="muted"><span class="spin"></span> Fetching today's arrivals…</p>`;
    const c=LLM.cfg();
    try{const r=await Live.mandi({state:val("lmState"),district:val("lmDist"),crop:val("lmCrop")},c.proxyUrl?c:null,lsGet("datagovKey",""));live=r.records;
      if(!live.length){out.innerHTML=`<div class="empty">No arrivals found for this filter today. Try without the district, or another crop.${r.limited?" The public sample key returns only 10 rows; add your free data.gov.in key in Settings for full results.":""}</div>`;return}
      live.sort((a,b)=>String(Live.parseArrival(b.arrival_date)).localeCompare(Live.parseArrival(a.arrival_date))||b.modal_price-a.modal_price);
      out.innerHTML=`<div class="tablewrap"><table><thead><tr><th>Commodity</th><th>Market</th><th class="r">Min</th><th class="r">Modal</th><th class="r">Max</th><th>vs MSP</th><th>${esc(t("date"))}</th></tr></thead><tbody class="num">${live.slice(0,80).map(x=>`<tr><td>${esc(x.commodity)}${x.variety&&x.variety!=="Other"?` <span class="muted small">${esc(x.variety)}</span>`:""}</td><td>${esc(x.market)}<br><span class="muted small">${esc(x.district)}</span></td><td class="r">${inr(x.min_price)}</td><td class="r"><b>${inr(x.modal_price)}</b></td><td class="r">${inr(x.max_price)}</td><td>${vsMsp(x.commodity,x.modal_price)}</td><td>${dshow(Live.parseArrival(x.arrival_date))}</td></tr>`).join("")}</tbody></table></div><p class="small muted">${live.length} rows from ${esc(r.source)}${r.limited?" (sample key: limited to 10 rows — add your own key in Settings)":""}.</p>`}
    catch(err){out.innerHTML=`<div class="empty">Couldn't reach the mandi price service. ${c.proxyUrl?"Check that your Worker is deployed.":"data.gov.in may block browser requests; deploy the Worker in /worker and add its URL in Settings."}</div>`}};
  const drawReports=()=>{const box=$("#pList");if(!box)return;
    if(!rows.length){box.innerHTML=`<div class="empty">No rates reported yet. Report the price you saw at your mandi today.</div>`;return}
    box.innerHTML=`<div class="tablewrap"><table><thead><tr><th>Crop</th><th>Mandi</th><th class="r">₹/qtl</th><th>vs MSP</th><th>${esc(t("date"))}</th><th></th></tr></thead><tbody class="num">${rows.slice(0,40).map(x=>`<tr><td>${esc(x.crop)}</td><td>${esc(x.market)}</td><td class="r"><b>${inr(x.rate)}</b></td><td>${vsMsp(x.crop,x.rate)}</td><td>${dshow(x.date)}</td><td>${x.owner===S.uid?`<button class="btn btn-sm" data-delp="${esc(x.id)}">${esc(t("del"))}</button>`:""}</td></tr>`).join("")}</tbody></table></div>`;
    box.querySelectorAll("[data-delp]").forEach(b=>b.onclick=()=>CAP.db.doc("prices/"+b.dataset.delp).delete().catch(()=>toast("Could not delete.")));
  };
  listen(CAP.db?CAP.db.collection("prices").orderBy("createdAt","desc").limit(200):null,s=>{rows=s.docs.map(d=>({id:d.id,...d.data()}));drawReports()},$("#pList"));
  $("#pForm").onsubmit=async e=>{e.preventDefault();const rate=numv("pRate");if(!val("pMkt")||!(rate>0)){toast("Add the mandi name and price.");return}
    if(await addShared("prices",{crop:val("pCrop"),market:val("pMkt").slice(0,80),rate,date:val("pDate")||today()})){$("#pRate").value="";toast("Thanks — rate shared")}};
  $("#pAI").onclick=()=>{const crop=val("lmCrop")||p.lastCrop||"Tomato";const ms=mspFor(crop);
    const a=live.slice(0,25).map(x=>`${x.arrival_date} ${x.market} (${x.district}) ${x.commodity}: modal ₹${x.modal_price}/qtl`);
    const b=rows.filter(x=>x.crop===crop).slice(0,10).map(x=>`${x.date} ${x.market}: ₹${x.rate}/qtl (farmer report)`);
    aiText(`You are a farm marketing advisor in India. Crop: ${crop}. ${ms?`MSP: ₹${ms[1]}/qtl (${ms[2]}).`:"No MSP for this crop."}\nToday's mandi data:\n${[...a,...b].join("\n")||"(no price data loaded — click Get prices first)"}\n${ctxLine()}\nGive short practical advice: which nearby mandi pays best after transport, sell now / hold / sell in parts, grading and storage tips, and whether MSP procurement or eNAM is worth trying. Say clearly that prices are uncertain. ${langLine()} Under 180 words, bullet points.`,$("#pAIOut"))};
  $("#lmF").requestSubmit();
};

/* ---------- Crop Calendar ---------- */
VIEWS.advisory=el=>{
  el.innerHTML=`<form class="card" id="aForm"><div class="form-grid"><div class="field"><label for="aCrop">${esc(t("crop"))}</label><select id="aCrop">${cropOptions(S.profile.lastCrop||"Paddy")}</select></div><div class="field"><label for="aSow">Sowing / transplant date</label><input type="date" id="aSow" value="${S.profile.sowDate||today()}"></div><div class="field"><label for="aState">${esc(t("state"))}</label><select id="aState">${stateOptions(S.profile.state||"Karnataka")}</select></div><div class="field"><label for="aIrr">Water</label><select id="aIrr"><option>Irrigated</option><option>Rainfed</option></select></div></div><div class="row"><button class="btn btn-primary" type="submit">Build my calendar</button></div></form><div id="aStat"></div><div id="aOut"></div>`;
  $("#aForm").onsubmit=async e=>{e.preventDefault();const crop=val("aCrop"),sow=val("aSow");saveProfile({lastCrop:crop,sowDate:sow});
    const r=await aiJSON(`Create a practical crop calendar for ${crop} (${val("aIrr")}) in ${val("aState")}, India, sown on ${sow}. ${langLine()}
Reply with only JSON: {"duration_days":number,"variety_tip":"short","stages":[{"from_day":0,"to_day":14,"stage":"stage name","tasks":["specific task with dose/timing"]}],"watch_out":["key pest/disease risks this season"]}. 6-10 stages covering land prep to harvest and post-harvest. Use days after sowing (negative for land preparation).`,$("#aStat"),{cache:{gcTime:86400000}});
    if(!r||!Array.isArray(r.stages))return;const s0=new Date(sow),now=Date.now();const dd=n=>{const d=new Date(s0);d.setDate(d.getDate()+n);return d};
    const das=Math.floor((now-s0)/86400000);
    $("#aOut").innerHTML=`<section class="card"><div class="kpis"><div class="kpi"><span>Crop duration</span><b>${fmt(r.duration_days,0)} days</b></div><div class="kpi"><span>Today</span><b>Day ${das}</b></div><div class="kpi"><span>Expected harvest</span><b>${dd(r.duration_days||0).toLocaleDateString("en-IN",{day:"numeric",month:"short"})}</b></div></div>${r.variety_tip?`<p class="note">${esc(r.variety_tip)}</p>`:""}
    <div class="timeline">${r.stages.map(s=>{const cur=das>=s.from_day&&das<=s.to_day;return `<div class="tl${cur?" now":""}"><div class="meta"><b style="color:var(--ink)">${esc(s.stage)}</b><span>${dd(s.from_day).toLocaleDateString("en-IN",{day:"numeric",month:"short"})} – ${dd(s.to_day).toLocaleDateString("en-IN",{day:"numeric",month:"short"})}</span>${cur?`<span class="chip c-warn">this week</span>`:""}</div><ul>${(s.tasks||[]).map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>`}).join("")}</div>
    ${(r.watch_out||[]).length?`<div class="panel-sunk"><h3>Watch out for</h3><ul>${r.watch_out.map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>`:""}</section>`};
};

/* ---------- Soil Health ---------- */
const SOILR={N:[280,560],P:[10,25],K:[108,280],OC:[0.5,0.75]};
VIEWS.soil=el=>{
  el.innerHTML=`<form class="card" id="soForm"><p class="small muted">Copy the values from your Soil Health Card (available nitrogen, phosphorus and potassium in kg/ha).</p><div class="form-grid">
  <div class="field"><label for="soN">N (kg/ha)</label><input type="number" id="soN" value="240"></div><div class="field"><label for="soP">P (kg/ha)</label><input type="number" id="soP" value="18"></div><div class="field"><label for="soK">K (kg/ha)</label><input type="number" id="soK" value="150"></div><div class="field"><label for="sopH">pH</label><input type="number" id="sopH" step="0.1" value="6.8"></div><div class="field"><label for="soOC">Organic carbon (%)</label><input type="number" id="soOC" step="0.01" value="0.42"></div><div class="field"><label for="soTex">Texture</label><select id="soTex"><option>Loam</option><option>Clay</option><option>Sandy</option><option>Red soil</option><option>Black cotton soil</option></select></div><div class="field"><label for="soCrop">Next crop</label><select id="soCrop">${cropOptions(S.profile.lastCrop||"Paddy")}</select></div><div class="field"><label for="soArea">${esc(t("area"))}</label><input type="number" id="soArea" value="1" step="0.1"></div></div><div class="row"><button class="btn btn-primary" type="submit">Read my soil</button></div></form><div id="soOut"></div>`;
  $("#soForm").onsubmit=e=>{e.preventDefault();
    const rate=(v,[lo,hi])=>v<lo?["Low","c-bad"]:v>hi?["High","c-ok"]:["Medium","c-warn"];
    const n=numv("soN"),p=numv("soP"),k=numv("soK"),ph=numv("sopH"),oc=numv("soOC");
    const phr=ph<5.5?["Strongly acidic","c-bad"]:ph<6.5?["Slightly acidic","c-warn"]:ph<=7.5?["Neutral","c-ok"]:ph<=8.5?["Slightly alkaline","c-warn"]:["Strongly alkaline","c-bad"];
    const rows=[["Nitrogen (N)",fmt(n,0)+" kg/ha",rate(n,SOILR.N)],["Phosphorus (P)",fmt(p,0)+" kg/ha",rate(p,SOILR.P)],["Potassium (K)",fmt(k,0)+" kg/ha",rate(k,SOILR.K)],["Organic carbon",fmt(oc,2)+" %",rate(oc,SOILR.OC)],["pH",fmt(ph,1),phr]];
    $("#soOut").innerHTML=`<section class="card"><div class="tablewrap"><table><thead><tr><th>Parameter</th><th class="r">Value</th><th>Status</th></tr></thead><tbody class="num">${rows.map(r=>`<tr><td>${r[0]}</td><td class="r">${r[1]}</td><td><span class="chip ${r[2][1]}">${r[2][0]}</span></td></tr>`).join("")}</tbody></table></div>
    <p class="small muted">Ranges used: N low &lt;280, high &gt;560; P low &lt;10, high &gt;25; K low &lt;108, high &gt;280 kg/ha; OC low &lt;0.5%, high &gt;0.75%.</p>
    <div class="row"><button class="btn btn-primary btn-sm" id="soAI">Fertiliser plan for ${esc(val("soCrop"))}</button></div><div id="soAIOut" class="ai-out"></div></section>`;
    $("#soAI").onclick=()=>aiText(`Soil test: N ${n} kg/ha, P ${p} kg/ha, K ${k} kg/ha, pH ${ph}, OC ${oc}%, texture ${val("soTex")}. Next crop: ${val("soCrop")} on ${val("soArea")} acre. ${ctxLine()}
Give a fertiliser plan using soil-test-based adjustment of the recommended dose: total N-P-K needed, converted into bags of common fertilisers (urea 45 kg bag, DAP 50 kg, MOP 50 kg, SSP) for the given area, split doses with timing, organic manure/biofertiliser advice, and pH/OC correction if needed. ${langLine()} Use bullet points, under 220 words.`,$("#soAIOut"));
  };
  $("#soForm").requestSubmit();
};

/* ---------- Season Planner ---------- */
VIEWS.planner=el=>{
  el.innerHTML=`<form class="card" id="plForm"><div class="form-grid"><div class="field"><label for="plCrop">${esc(t("crop"))}</label><select id="plCrop">${cropOptions("Tomato")}</select></div><div class="field"><label for="plArea">${esc(t("area"))}</label><input type="number" id="plArea" value="2" step="0.1"></div><div class="field"><label for="plSeason">Season</label><select id="plSeason"><option>Kharif</option><option selected>Rabi</option><option>Summer / Zaid</option></select></div><div class="field"><label for="plWater">Water</label><select id="plWater"><option>Borewell / drip</option><option>Canal</option><option>Rainfed</option></select></div></div><div class="row"><button class="btn btn-primary" type="submit">Plan my season</button></div></form><div id="plStat"></div><div id="plOut"></div>`;
  $("#plForm").onsubmit=async e=>{e.preventDefault();const crop=val("plCrop"),area=numv("plArea")||1;
    const r=await aiJSON(`Estimate per-acre economics for growing ${crop} in the ${val("plSeason")} season with ${val("plWater")} water. ${ctxLine()} Use typical 2025-26 Indian input prices. ${langLine()}
Reply with only JSON: {"cost_per_acre":[{"item":"seed/nursery","amount":0}],"yield_qtl_per_acre":{"low":0,"high":0},"price_per_qtl":{"low":0,"high":0},"duration_days":0,"tips":["3-5 tips to raise profit"]}. 6-9 cost items, amounts in rupees per acre.`,$("#plStat"),{cache:{gcTime:86400000}});
    if(!r||!Array.isArray(r.cost_per_acre))return;
    const cpa=r.cost_per_acre.reduce((a,c)=>a+(+c.amount||0),0),cost=cpa*area;const ylo=(+r.yield_qtl_per_acre?.low||0)*area,yhi=(+r.yield_qtl_per_acre?.high||0)*area;const plo=+r.price_per_qtl?.low||0,phi=+r.price_per_qtl?.high||0;
    const rlo=ylo*plo,rhi=yhi*phi;const ms=mspFor(crop);
    $("#plOut").innerHTML=`<section class="card"><div class="kpis"><div class="kpi"><span>Total cost (${fmt(area)} acre)</span><b>${inr(cost)}</b></div><div class="kpi"><span>Yield</span><b>${fmt(ylo,0)}–${fmt(yhi,0)} qtl</b></div><div class="kpi"><span>Revenue</span><b>${inr(rlo)}–${inr(rhi)}</b></div><div class="kpi"><span>Profit</span><b style="color:${rlo-cost<0?"var(--bad)":"var(--ok)"}">${inr(rlo-cost)}–${inr(rhi-cost)}</b></div><div class="kpi"><span>Break-even price</span><b>${inr(cost/Math.max(ylo,1))}/qtl</b></div></div>
    ${ms?`<p class="small muted">MSP for ${esc(ms[0])}: ${inr(ms[1])}/qtl (${esc(ms[2])}).</p>`:""}
    <div class="tablewrap"><table><thead><tr><th>Cost item (per acre)</th><th class="r">₹</th></tr></thead><tbody class="num">${r.cost_per_acre.map(c=>`<tr><td>${esc(c.item)}</td><td class="r">${inr(+c.amount)}</td></tr>`).join("")}<tr><td><b>Total per acre</b></td><td class="r"><b>${inr(cpa)}</b></td></tr></tbody></table></div>
    <div class="panel-sunk"><h3>How to earn more</h3><ul>${(r.tips||[]).map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div><p class="note">AI estimates based on typical costs. Replace them with your own numbers in Cost & Profit.</p></section>`};
};

/* ---------- Agroforestry ---------- */
VIEWS.agroforestry=el=>{
  el.innerHTML=`<form class="card" id="afForm"><div class="form-grid"><div class="field"><label for="afCrop">Main crop</label><select id="afCrop">${cropOptions(S.profile.lastCrop||"Ragi")}</select></div><div class="field"><label for="afGoal">Goal</label><select id="afGoal"><option>Extra income from timber/fruit</option><option>Fodder for animals</option><option>Windbreak and shade</option><option>Improve soil fertility</option></select></div><div class="field"><label for="afPlace">Where on the farm</label><select id="afPlace"><option>Field boundary (bund)</option><option>Rows inside the field (alley cropping)</option><option>Separate block</option></select></div><div class="field"><label for="afRain">Rainfall</label><select id="afRain"><option>Low (&lt;700 mm)</option><option selected>Medium (700–1200 mm)</option><option>High (&gt;1200 mm)</option></select></div></div><div class="row"><button class="btn btn-primary" type="submit">Suggest trees</button></div></form><div class="card ai-out" id="afOut" hidden></div>`;
  $("#afForm").onsubmit=e=>{e.preventDefault();const o=$("#afOut");o.hidden=false;aiText(`Suggest 4-5 agroforestry tree species for an Indian farm. Main crop: ${val("afCrop")}. Goal: ${val("afGoal")}. Placement: ${val("afPlace")}. Rainfall: ${val("afRain")}. ${ctxLine()}
For each: name (local + English), spacing, years to first income, expected benefit, and any crop-competition caution. Mention relevant schemes (e.g. Sub-Mission on Agroforestry / Har Medh Par Ped) only generally. ${langLine()} Bullet points, under 250 words.`,o,{cache:{gcTime:86400000}})};
};

/* ---------- Irrigation ---------- */
VIEWS.irrigation=el=>{
  el.innerHTML=`<form class="card" id="irForm"><div class="form-grid"><div class="field"><label for="irEt">Reference ET₀ (mm/day)</label><input type="number" id="irEt" value="5" step="0.1"></div><div class="field"><label for="irKc">Crop coefficient Kc</label><input type="number" id="irKc" value="1.05" step="0.05"></div><div class="field"><label for="irArea">${esc(t("area"))}</label><input type="number" id="irArea" value="1" step="0.1"></div><div class="field"><label for="irEff">System</label><select id="irEff"><option value="90">Drip (90%)</option><option value="75">Sprinkler (75%)</option><option value="55" selected>Flood / furrow (55%)</option></select></div><div class="field"><label for="irRain">Effective rain today (mm)</label><input type="number" id="irRain" value="0" step="0.5"></div><div class="field"><label for="irPump">Pump output (litres/min)</label><input type="number" id="irPump" value="300"></div></div>
  <div class="row" id="irLive"></div>
  <div class="row"><span class="small muted">Kc quick picks:</span>${[["Initial",0.5],["Growing",0.8],["Flowering/peak",1.1],["Maturity",0.7]].map(([n,v])=>`<button type="button" class="btn btn-sm" data-kc="${v}">${n} ${v}</button>`).join("")}</div>
  <div class="row"><button class="btn btn-primary" type="submit">${esc(t("calc"))}</button></div></form><div id="irOut"></div>`;
  if(S.profile.lat!=null){loadWeather().then(w=>{const b=$("#irLive");if(!w||!b||w.days[0].et0==null)return;const e0=w.days[0].et0,rain=w.days[0].rain_mm||0;b.innerHTML=`<span class="small muted">Live for ${esc(S.profile.place||"your farm")}: ET₀ ${fmt(e0,1)} mm, rain ${fmt(rain,1)} mm today.</span><button type="button" class="btn btn-sm" id="irUse">Use live values</button>`;$("#irUse").onclick=()=>{$("#irEt").value=fmt(e0,1);$("#irRain").value=fmt(rain*0.8,1);$("#irForm").requestSubmit()}})}
  el.querySelectorAll("[data-kc]").forEach(b=>b.onclick=()=>{$("#irKc").value=b.dataset.kc;$("#irForm").requestSubmit()});
  $("#irForm").onsubmit=e=>{e.preventDefault();const etc=numv("irEt")*numv("irKc"),net=Math.max(0,etc-(numv("irRain")||0)),m2=numv("irArea")*4046.86,eff=numv("irEff")/100;
    const litres=net*m2/eff,hrs=litres/(numv("irPump")*60);
    $("#irOut").innerHTML=`<section class="card"><div class="kpis"><div class="kpi"><span>Crop water use (ETc)</span><b>${fmt(etc,1)} mm/day</b></div><div class="kpi"><span>Water to apply</span><b>${fmt(litres/1000,1)} m³/day</b></div><div class="kpi"><span>In litres</span><b>${fmt(litres,0)}</b></div><div class="kpi"><span>Pump running time</span><b>${isFinite(hrs)?Math.floor(hrs)+" h "+Math.round((hrs%1)*60)+" min":"—"}</b></div><div class="kpi"><span>Per week</span><b>${fmt(litres*7/1000,0)} m³</b></div></div><p class="small muted">1 mm of water on 1 acre = 4,047 litres. ETc = ET₀ × Kc, minus effective rain, divided by system efficiency. Get ET₀ for your district from the IMD Agromet bulletin.</p></section>`};
  $("#irForm").requestSubmit();
};

/* ---------- Cost & Profit ---------- */
VIEWS.profit=el=>{
  el.innerHTML=`<form class="card" id="prForm"><div class="form-grid"><div class="field"><label for="prCrop">${esc(t("crop"))}</label><select id="prCrop">${cropOptions("Tur (Arhar)")}</select></div><div class="field"><label for="prArea">${esc(t("area"))}</label><input type="number" id="prArea" value="2" step="0.1"></div><div class="field"><label for="prIn">Seeds, fertiliser, sprays (₹)</label><input type="number" id="prIn" value="24000"></div><div class="field"><label for="prLab">Labour (₹)</label><input type="number" id="prLab" value="18000"></div><div class="field"><label for="prMach">Machinery, water, transport (₹)</label><input type="number" id="prMach" value="9000"></div><div class="field"><label for="prRent">Land lease / interest (₹)</label><input type="number" id="prRent" value="0"></div><div class="field"><label for="prY">Expected yield (qtl total)</label><input type="number" id="prY" value="14"></div><div class="field"><label for="prP">Expected price (₹/qtl)</label><input type="number" id="prP" value="8450"></div></div><div class="row"><button class="btn btn-primary" type="submit">${esc(t("calc"))}</button><button class="btn" type="button" id="prMsp">Use MSP as price</button></div></form><div id="prOut"></div>`;
  $("#prMsp").onclick=()=>{const m=mspFor(val("prCrop"));if(m){$("#prP").value=m[1];$("#prForm").requestSubmit()}else toast("No MSP for this crop.")};
  $("#prForm").onsubmit=e=>{e.preventDefault();const cost=["prIn","prLab","prMach","prRent"].reduce((a,k)=>a+(numv(k)||0),0),y=numv("prY")||0,pr=numv("prP")||0,rev=y*pr,pf=rev-cost,area=numv("prArea")||1;const mx=Math.max(cost,rev,1);
    $("#prOut").innerHTML=`<section class="card"><div class="kpis"><div class="kpi"><span>Total cost</span><b>${inr(cost)}</b></div><div class="kpi"><span>Revenue</span><b>${inr(rev)}</b></div><div class="kpi"><span>Profit</span><b style="color:${pf<0?"var(--bad)":"var(--ok)"}">${inr(pf)}</b></div><div class="kpi"><span>Profit per acre</span><b>${inr(pf/area)}</b></div><div class="kpi"><span>Return on cost</span><b>${fmt(cost?pf/cost*100:0,0)}%</b></div><div class="kpi"><span>Break-even price</span><b>${inr(y?cost/y:NaN)}/qtl</b></div></div>
    <div><div class="meta"><span>Cost</span></div><div class="bar"><i style="width:${cost/mx*100}%;background:var(--soil)"></i></div><div class="meta" style="margin-top:6px"><span>Revenue</span></div><div class="bar"><i style="width:${rev/mx*100}%;background:var(--leaf)"></i></div></div></section>`};
  $("#prForm").requestSubmit();
};

/* ---------- Solar ---------- */
VIEWS.solar=el=>{
  el.innerHTML=`<form class="card" id="soF"><div class="form-grid"><div class="field"><label for="slCost">System cost (₹)</label><input type="number" id="slCost" value="285000"></div><div class="field"><label for="slSub">Subsidy (%)</label><input type="number" id="slSub" value="60"></div><div class="field"><label for="slSave">Monthly diesel/power saved (₹)</label><input type="number" id="slSave" value="4500"></div><div class="field"><label for="slOM">Maintenance (₹/year)</label><input type="number" id="slOM" value="3000"></div><div class="field"><label for="slLife">Life (years)</label><input type="number" id="slLife" value="20"></div></div><div class="row"><button class="btn btn-primary" type="submit">${esc(t("calc"))}</button></div></form><div id="slOut"></div>`;
  $("#soF").onsubmit=e=>{e.preventDefault();const own=numv("slCost")*(1-numv("slSub")/100),net=numv("slSave")*12-numv("slOM"),pb=own/net,life=numv("slLife");
    $("#slOut").innerHTML=`<section class="card"><div class="kpis"><div class="kpi"><span>Your share</span><b>${inr(own)}</b></div><div class="kpi"><span>Net saving per year</span><b>${inr(net)}</b></div><div class="kpi"><span>Payback</span><b>${net>0?fmt(pb,1)+" years":"never"}</b></div><div class="kpi"><span>Gain over ${fmt(life,0)} years</span><b>${inr(net*life-own)}</b></div></div><p class="small muted">Standalone solar pumps are subsidised under PM-KUSUM; the subsidy share and your contribution vary by state. Check with your state nodal agency before paying any vendor.</p></section>`};
  $("#soF").requestSubmit();
};

/* ---------- Field Mapper ---------- */
const SAMPLE_PTS="12.52101, 76.89512\n12.52168, 76.89620\n12.52090, 76.89695\n12.52021, 76.89590";
function polyArea(pts){const R=6371008.8,lat0=pts.reduce((a,p)=>a+p[0],0)/pts.length*Math.PI/180;const xy=pts.map(([la,lo])=>[R*lo*Math.PI/180*Math.cos(lat0),R*la*Math.PI/180]);let a=0;for(let i=0;i<xy.length;i++){const[j,k]=[xy[i],xy[(i+1)%xy.length]];a+=j[0]*k[1]-k[0]*j[1]}let per=0;for(let i=0;i<xy.length;i++){const[j,k]=[xy[i],xy[(i+1)%xy.length]];per+=Math.hypot(k[0]-j[0],k[1]-j[1])}return{m2:Math.abs(a)/2,per,xy}}
VIEWS.boundary=el=>{
  el.innerHTML=`<form class="card" id="bF"><p class="small muted">Walk the corners of your field with a phone GPS app and note each point as "latitude, longitude", one per line, in order.</p><div class="form-grid"><div class="field"><label for="bName">Field name</label><input type="text" id="bName" value="Main field"></div></div><div class="field"><label for="bPts">Corner points</label><textarea id="bPts" rows="6" class="num">${SAMPLE_PTS}</textarea></div><div class="row"><button class="btn btn-primary" type="submit">${esc(t("calc"))}</button><button class="btn" type="button" id="bSave">${esc(t("save"))}</button></div></form><div id="bOut"></div><section class="card"><h3>Saved fields</h3><div class="list" id="bList"></div></section>`;
  let last=null;
  $("#bF").onsubmit=e=>{e.preventDefault();const pts=val("bPts").split(/\n/).map(l=>l.split(/[,\s]+/).filter(Boolean).map(Number)).filter(p=>p.length>=2&&isFinite(p[0])&&isFinite(p[1]));
    if(pts.length<3){$("#bOut").innerHTML=`<p class="note">Enter at least 3 corner points.</p>`;return}
    const{m2,per,xy}=polyArea(pts);const ac=m2/4046.86;last={name:val("bName")||"Field",pts,acres:ac};
    const xs=xy.map(p=>p[0]),ys=xy.map(p=>p[1]),mnx=Math.min(...xs),mny=Math.min(...ys),w=Math.max(...xs)-mnx||1,h=Math.max(...ys)-mny||1,sc=260/Math.max(w,h);
    const path=xy.map(([x,y])=>`${(20+(x-mnx)*sc).toFixed(1)},${(20+(h-(y-mny))*sc).toFixed(1)}`);
    $("#bOut").innerHTML=`<section class="card"><div class="kpis"><div class="kpi"><span>Acres</span><b>${fmt(ac,2)}</b></div><div class="kpi"><span>Guntas (40/acre)</span><b>${fmt(ac*40,1)}</b></div><div class="kpi"><span>Cents (100/acre)</span><b>${fmt(ac*100,0)}</b></div><div class="kpi"><span>Hectares</span><b>${fmt(m2/10000,3)}</b></div><div class="kpi"><span>Boundary length</span><b>${fmt(per,0)} m</b></div></div>
    <svg viewBox="0 0 ${40+w*sc} ${40+h*sc}" style="max-width:320px;width:100%;background:var(--sunk);border-radius:12px" role="img" aria-label="Field outline"><polygon points="${path.join(" ")}" fill="var(--leaf-soft)" stroke="var(--leaf)" stroke-width="2.5"/>${path.map((p,i)=>`<circle cx="${p.split(",")[0]}" cy="${p.split(",")[1]}" r="5" fill="var(--turmeric)"/><text x="${+p.split(",")[0]+7}" y="${+p.split(",")[1]-7}" font-size="12" fill="var(--ink)">${i+1}</text>`).join("")}</svg>
    <p class="small muted">Phone GPS is accurate to about 3–5 m, so treat small fields as approximate. Your RTC/7-12 land record is the legal area.</p></section>`};
  $("#bSave").onclick=async()=>{if(!last)$("#bF").requestSubmit();if(last&&await addMine("fields",{name:last.name,acres:last.acres,pts:last.pts.map(p=>p.join(","))}))toast("Field saved")};
  $("#bF").requestSubmit();
  listen(CAP.db&&S.uid?mine("fields").orderBy("createdAt","desc"):null,s=>{const b=$("#bList");if(!b)return;b.innerHTML=s.empty?`<div class="empty">${esc(t("nothing"))}</div>`:s.docs.map(d=>{const x=d.data();return `<div class="item"><div class="item-top"><div><b>${esc(x.name)}</b><div class="meta num"><span>${fmt(x.acres,2)} acres</span><span>${fmt(x.acres*40,1)} guntas</span></div></div><div class="row"><button class="btn btn-sm" data-load="${d.id}">Open</button><button class="btn btn-sm" data-del="${d.id}">${esc(t("del"))}</button></div></div></div>`}).join("");
    b.querySelectorAll("[data-load]").forEach(x=>x.onclick=()=>{const d=s.docs.find(q=>q.id===x.dataset.load).data();$("#bName").value=d.name;$("#bPts").value=(d.pts||[]).join("\n");$("#bF").requestSubmit();window.scrollTo(0,0)});
    b.querySelectorAll("[data-del]").forEach(x=>x.onclick=()=>mine("fields").doc(x.dataset.del).delete().catch(()=>{}));
  },$("#bList"));
  if(!(CAP.db&&S.uid))$("#bList").innerHTML=`<div class="empty">${"Loading…"}</div>`;
};

/* ---------- Crop Diary ---------- */
const STAGES=["Land preparation","Sowing / transplanting","Germination","Vegetative growth","Flowering","Fruiting / grain filling","Harvest","Post-harvest / storage"];
VIEWS.timeline=el=>{
  el.innerHTML=`<form class="card" id="tlF"><div class="form-grid"><div class="field"><label for="tlCrop">${esc(t("crop"))}</label><select id="tlCrop">${cropOptions(S.profile.lastCrop||"Tomato")}</select></div><div class="field"><label for="tlStage">Stage</label><select id="tlStage">${STAGES.map(s=>`<option>${s}</option>`).join("")}</select></div><div class="field"><label for="tlDate">${esc(t("date"))}</label><input type="date" id="tlDate" value="${today()}"></div></div><div class="field"><label for="tlNote">What did you do or see?</label><textarea id="tlNote" rows="2" placeholder="Applied 25 kg urea, first flowers seen…"></textarea></div><div class="row"><button class="btn btn-primary" type="submit">${esc(t("add"))}</button></div></form><section class="card"><h3>Diary</h3><div id="tlList"></div></section>`;
  $("#tlF").onsubmit=async e=>{e.preventDefault();if(await addMine("diary",{crop:val("tlCrop"),stage:val("tlStage"),date:val("tlDate"),note:val("tlNote").slice(0,1000)})){$("#tlNote").value="";toast("Added to diary")}};
  listen(CAP.db&&S.uid?mine("diary").orderBy("date","desc").limit(100):null,s=>{const b=$("#tlList");if(!b)return;if(s.empty){b.innerHTML=`<div class="empty">${esc(t("nothing"))}</div>`;return}
    b.innerHTML=`<div class="timeline">${s.docs.map(d=>{const x=d.data();return `<div class="tl"><div class="meta"><b style="color:var(--ink)">${esc(x.stage)}</b><span>${esc(x.crop)}</span><span>${dshow(x.date)}</span><button class="btn btn-sm" data-del="${d.id}" aria-label="${esc(t("del"))}">×</button></div>${x.note?`<p>${esc(x.note)}</p>`:""}</div>`}).join("")}</div>`;
    b.querySelectorAll("[data-del]").forEach(x=>x.onclick=()=>mine("diary").doc(x.dataset.del).delete().catch(()=>{}));
  },$("#tlList"));
  if(!(CAP.db&&S.uid))$("#tlList").innerHTML=`<div class="empty">${"Loading…"}</div>`;
};

/* ---------- Livestock ---------- */
VIEWS.livestock=el=>{
  el.innerHTML=`<form class="card" id="lvF"><div class="form-grid"><div class="field"><label for="lvTag">Animal tag / name</label><input type="text" id="lvTag" placeholder="Lakshmi / 1023"></div><div class="field"><label for="lvSp">Animal</label><select id="lvSp"><option>Cow</option><option>Buffalo</option><option>Goat</option><option>Sheep</option><option>Poultry</option></select></div><div class="field"><label for="lvType">Record</label><select id="lvType"><option>Vaccination</option><option>Deworming</option><option>Treatment</option><option>Artificial insemination</option><option>Calving</option></select></div><div class="field"><label for="lvWhat">Vaccine / medicine</label><input type="text" id="lvWhat" placeholder="FMD vaccine"></div><div class="field"><label for="lvDate">${esc(t("date"))}</label><input type="date" id="lvDate" value="${today()}"></div><div class="field"><label for="lvNext">Next due</label><input type="date" id="lvNext"></div></div><div class="row"><button class="btn btn-primary" type="submit">${esc(t("add"))}</button><button class="btn" type="button" id="lvAI">Vaccination schedule</button></div></form><div class="card ai-out" id="lvAIOut" hidden></div><section class="card"><h3>Records</h3><div class="list" id="lvList"></div></section>`;
  $("#lvF").onsubmit=async e=>{e.preventDefault();if(!val("lvTag")){toast("Add the animal tag or name.");return}if(await addMine("animals",{tag:val("lvTag"),species:val("lvSp"),type:val("lvType"),what:val("lvWhat"),date:val("lvDate"),next:val("lvNext")})){$("#lvWhat").value="";toast("Record added")}};
  $("#lvAI").onclick=()=>{const o=$("#lvAIOut");o.hidden=false;aiText(`Give the standard preventive vaccination and deworming schedule for ${val("lvSp")} in India (e.g. FMD, HS, BQ, brucellosis for cattle/buffalo; PPR, ET for goats/sheep; Ranikhet for poultry): age at first dose, booster interval, best season. Mention that FMD and brucellosis vaccination is free under the National Animal Disease Control Programme through the government vet. ${langLine()} Short bullet list.`,o,{cache:{gcTime:86400000}})};
  listen(CAP.db&&S.uid?mine("animals").orderBy("createdAt","desc").limit(200):null,s=>{const b=$("#lvList");if(!b)return;if(s.empty){b.innerHTML=`<div class="empty">${esc(t("nothing"))}</div>`;return}
    const now=new Date(today());
    b.innerHTML=s.docs.map(d=>{const x=d.data();let chip="";if(x.next){const dd=(new Date(x.next)-now)/86400000;chip=dd<0?`<span class="chip c-bad">overdue</span>`:dd<=14?`<span class="chip c-warn">due in ${Math.round(dd)} d</span>`:`<span class="chip c-ok">next ${dshow(x.next)}</span>`}
      return `<div class="item"><div class="item-top"><div><b>${esc(x.tag)}</b> <span class="muted small">${esc(x.species)}</span><div class="meta"><span>${esc(x.type)}${x.what?": "+esc(x.what):""}</span><span>${dshow(x.date)}</span></div></div><div class="row">${chip}<button class="btn btn-sm" data-del="${d.id}" aria-label="${esc(t("del"))}">×</button></div></div></div>`}).join("");
    b.querySelectorAll("[data-del]").forEach(x=>x.onclick=()=>mine("animals").doc(x.dataset.del).delete().catch(()=>{}));
  },$("#lvList"));
  if(!(CAP.db&&S.uid))$("#lvList").innerHTML=`<div class="empty">${"Loading…"}</div>`;
};

/* ---------- Spray safety ---------- */
VIEWS.safety=el=>{
  el.innerHTML=`<div class="verdict c-bad">Dizziness, vomiting, breathing trouble, heavy sweating, fits or pinpoint pupils after spraying: call 108 now and take the pesticide label to the hospital.</div>
  <form class="card" id="sfF"><div class="form-grid"><div class="field"><label for="sfChem">Chemical / product</label><input type="text" id="sfChem" placeholder="Chlorpyrifos 20 EC"></div><div class="field"><label for="sfHrs">Hours spraying</label><input type="number" id="sfHrs" value="3" step="0.5"></div><div class="field"><label for="sfDate">${esc(t("date"))}</label><input type="date" id="sfDate" value="${today()}"></div></div>
  <fieldset class="field" style="border:0;padding:0;margin:0"><legend class="small muted" style="font-weight:600">Protection used</legend><div class="row">${["Gloves","Mask","Goggles","Full sleeves","Boots"].map(x=>`<label class="chip c-n" style="cursor:pointer"><input type="checkbox" name="ppe" value="${x}"> ${x}</label>`).join("")}</div></fieldset>
  <div class="field"><label for="sfSym">Any symptoms?</label><input type="text" id="sfSym" placeholder="Headache, eye irritation…"></div>
  <div class="row"><button class="btn btn-primary" type="submit">${esc(t("ai_advice"))}</button></div></form><div class="card ai-out" id="sfOut" hidden></div><section class="card"><h3>Exposure log</h3><div class="list" id="sfList"></div></section>`;
  $("#sfF").onsubmit=async e=>{e.preventDefault();const ppe=[...document.querySelectorAll('input[name=ppe]:checked')].map(x=>x.value);const rec={chem:val("sfChem"),hours:numv("sfHrs")||0,date:val("sfDate"),ppe,sym:val("sfSym")};
    if(canWrite())addMine("exposure",rec);const o=$("#sfOut");o.hidden=false;
    aiText(`A farmer sprayed "${rec.chem||"unknown pesticide"}" for ${rec.hours} hours. Protection used: ${ppe.join(", ")||"none"}. Symptoms: ${rec.sym||"none"}. Give: 1) immediate steps (wash, change clothes, etc.), 2) warning signs that need hospital (call 108), 3) the protective gear they were missing, 4) safe re-entry and storage advice. Do not suggest home remedies like milk or inducing vomiting. ${langLine()} Under 200 words.`,o)};
  listen(CAP.db&&S.uid?mine("exposure").orderBy("createdAt","desc").limit(50):null,s=>{const b=$("#sfList");if(!b)return;
    if(s.empty){b.innerHTML=`<div class="empty">${esc(t("nothing"))}</div>`;return}const tot=s.docs.reduce((a,d)=>a+(+d.data().hours||0),0);
    b.innerHTML=`<p class="small muted num">${fmt(tot,1)} hours logged in total.</p>`+s.docs.map(d=>{const x=d.data();const miss=5-(x.ppe||[]).length;return `<div class="item"><div class="item-top"><div><b>${esc(x.chem||"Pesticide")}</b><div class="meta"><span>${dshow(x.date)}</span><span>${fmt(x.hours,1)} h</span>${x.sym?`<span>${esc(x.sym)}</span>`:""}</div></div><span class="chip ${miss>=3?"c-bad":miss?"c-warn":"c-ok"}">${(x.ppe||[]).length}/5 protection</span></div></div>`}).join("")},$("#sfList"));
  if(!(CAP.db&&S.uid))$("#sfList").innerHTML=`<div class="empty">${"Loading…"}</div>`;
};

/* ---------- shared post lists ---------- */
async function drawPosts(box,docs,itemFn,coll){
  if(!box)return;
  if(!docs.length){box.innerHTML=`<div class="empty">${esc(t("nothing"))}</div>`+sharedNote();return}
  box.innerHTML=docs.map(d=>itemFn(d,d.authorName||"")).join("")+sharedNote();
  box.querySelectorAll("[data-delpost]").forEach(b=>b.onclick=()=>CAP.db.doc(coll+"/"+b.dataset.delpost).delete().catch(()=>toast("Could not delete.")));
  box.querySelectorAll("[data-copy]").forEach(b=>b.onclick=async()=>{try{await navigator.clipboard.writeText(b.dataset.copy);toast("Number copied")}catch(e){toast(b.dataset.copy)}});
}
const phoneLine=p=>p?`<span class="num" style="user-select:all">${esc(p)}</span> <button class="btn btn-sm" data-copy="${esc(p)}">Copy</button>`:"";
const ownBtns=(d,extra="")=>d.owner&&d.owner===S.uid?`<div class="row">${extra}<button class="btn btn-sm" data-delpost="${esc(d.id)}">${esc(t("del"))}</button></div>`:"";

VIEWS.sell=el=>{
  el.innerHTML=`<form class="card" id="mkF"><h3>Post your produce</h3><div class="form-grid"><div class="field"><label for="mkCrop">${esc(t("crop"))}</label><select id="mkCrop">${cropOptions(S.profile.lastCrop||"Tomato")}</select></div><div class="field"><label for="mkQty">${esc(t("qty"))} (qtl)</label><input type="number" id="mkQty" step="0.5" placeholder="20"></div><div class="field"><label for="mkPrice">Asking price (₹/qtl)</label><input type="number" id="mkPrice" placeholder="1600"></div><div class="field"><label for="mkLoc">${esc(t("loc"))}</label><input type="text" id="mkLoc" value="${esc(S.profile.district||"")}"></div><div class="field"><label for="mkPhone">${esc(t("phone"))}</label><input type="tel" id="mkPhone" placeholder="98xxxxxxxx"></div><div class="field"><label for="mkNote">Grade / ${esc(t("notes"))}</label><input type="text" id="mkNote" placeholder="A grade, ready by Friday"></div></div><div class="row"><button class="btn btn-primary" type="submit">${esc(t("post"))}</button></div></form>
  <section class="card"><div class="section-head"><h3>Produce for sale</h3><input type="text" id="mkSearch" placeholder="Search crop or place" style="max-width:220px"></div><div class="list" id="mkList"></div></section>`;
  let rows=[];const draw=()=>{const q=val("mkSearch").toLowerCase();drawPosts($("#mkList"),rows.filter(r=>!q||(r.crop+" "+r.loc).toLowerCase().includes(q)),(d,who)=>{const ms=mspFor(d.crop);return `<div class="item"><div class="item-top"><div><b>${esc(d.crop)}</b> · <span class="num">${fmt(d.qty)} qtl</span> ${d.sold?`<span class="chip c-n">sold</span>`:""}<div class="meta"><span>${esc(d.loc)}</span>${who?`<span>${esc(who)}</span>`:""}<span>${ago(d.createdAt)}</span></div>${d.note?`<p class="small">${esc(d.note)}</p>`:""}</div><div style="text-align:right"><b class="num">${inr(d.price)}</b><div class="small muted">per qtl${ms?` · MSP ${inr(ms[1])}`:""}</div></div></div><div class="meta">${phoneLine(d.phone)}</div>${ownBtns(d,d.sold?"":`<button class="btn btn-sm" data-sold="${esc(d.id)}">Mark sold</button>`)}</div>`},"listings").then(()=>{document.querySelectorAll("[data-sold]").forEach(b=>b.onclick=()=>CAP.db.doc("listings/"+b.dataset.sold).update({sold:true}).catch(()=>{}))})};
  $("#mkSearch").oninput=draw;
  listen(CAP.db?CAP.db.collection("listings").orderBy("createdAt","desc").limit(200):null,s=>{rows=s.docs.map(d=>({id:d.id,...d.data()}));draw()},$("#mkList"));
  $("#mkF").onsubmit=async e=>{e.preventDefault();if(!(numv("mkQty")>0)||!(numv("mkPrice")>0)||!val("mkLoc")){toast("Add quantity, price and place.");return}
    if(await addShared("listings",{crop:val("mkCrop"),qty:numv("mkQty"),price:numv("mkPrice"),loc:val("mkLoc").slice(0,80),phone:val("mkPhone").slice(0,20),note:val("mkNote").slice(0,200),sold:false})){toast("Posted");$("#mkQty").value="";$("#mkPrice").value=""}};
};

VIEWS.equipment=el=>{
  el.innerHTML=`<form class="card" id="eqF"><h3>List equipment for rent</h3><div class="form-grid"><div class="field"><label for="eqItem">Equipment</label><select id="eqItem"><option>Tractor with driver</option><option>Rotavator</option><option>Power tiller</option><option>Combine harvester</option><option>Seed drill</option><option>Power sprayer</option><option>Thresher</option><option>Baler</option></select></div><div class="field"><label for="eqRate">Rate (₹)</label><input type="number" id="eqRate" placeholder="900"></div><div class="field"><label for="eqPer">Per</label><select id="eqPer"><option>hour</option><option>acre</option><option>day</option></select></div><div class="field"><label for="eqLoc">${esc(t("loc"))}</label><input type="text" id="eqLoc" value="${esc(S.profile.district||"")}"></div><div class="field"><label for="eqPhone">${esc(t("phone"))}</label><input type="tel" id="eqPhone"></div></div><div class="row"><button class="btn btn-primary" type="submit">${esc(t("post"))}</button></div></form><section class="card"><h3>Available near you</h3><div class="list" id="eqList"></div></section>`;
  listen(CAP.db?CAP.db.collection("equipment").orderBy("createdAt","desc").limit(200):null,s=>drawPosts($("#eqList"),s.docs.map(d=>({id:d.id,...d.data()})),(d,who)=>`<div class="item"><div class="item-top"><div><b>${esc(d.item)}</b><div class="meta"><span>${esc(d.loc)}</span>${who?`<span>${esc(who)}</span>`:""}<span>${ago(d.createdAt)}</span></div></div><b class="num">${inr(d.rate)}<span class="small muted">/${esc(d.per)}</span></b></div><div class="meta">${phoneLine(d.phone)}</div>${ownBtns(d)}</div>`,"equipment"),$("#eqList"));
  $("#eqF").onsubmit=async e=>{e.preventDefault();if(!(numv("eqRate")>0)||!val("eqLoc")){toast("Add rate and place.");return}if(await addShared("equipment",{item:val("eqItem"),rate:numv("eqRate"),per:val("eqPer"),loc:val("eqLoc").slice(0,80),phone:val("eqPhone").slice(0,20)}))toast("Posted")};
};

const DRONE_RATES={Spraying:500,Seeding:600,Mapping:300};
VIEWS.drone=el=>{
  el.innerHTML=`<form class="card" id="drF"><div class="form-grid"><div class="field"><label for="drSvc">Service</label><select id="drSvc">${Object.keys(DRONE_RATES).map(k=>`<option>${k}</option>`).join("")}</select></div><div class="field"><label for="drArea">${esc(t("area"))}</label><input type="number" id="drArea" value="5" step="0.5"></div><div class="field"><label for="drRate">Rate (₹/acre)</label><input type="number" id="drRate" value="500"></div><div class="field"><label for="drDate">Preferred date</label><input type="date" id="drDate" value="${today()}"></div><div class="field"><label for="drLoc">${esc(t("loc"))}</label><input type="text" id="drLoc" value="${esc(S.profile.district||"")}"></div><div class="field"><label for="drPhone">${esc(t("phone"))}</label><input type="tel" id="drPhone"></div></div><div id="drQuote"></div><div class="row"><button class="btn btn-primary" type="submit">Request this service</button></div><p class="small muted">Rates are typical starting points; providers confirm the final price. Drone spraying needs a DGCA-certified pilot and only pesticides approved for drone application.</p></form><section class="card"><div class="section-head"><h3>Open requests</h3><span class="small muted">Providers: accept a job to show you're coming</span></div><div class="list" id="drList"></div></section>`;
  const q=()=>{const a=numv("drArea")||0,r=numv("drRate")||0,mins=a*7;$("#drQuote").innerHTML=`<div class="kpis"><div class="kpi"><span>Estimated cost</span><b>${inr(a*r)}</b></div><div class="kpi"><span>Flight time (approx.)</span><b>${fmt(mins/60,1)} h</b></div><div class="kpi"><span>Water saved vs knapsack</span><b>~${fmt(a*(200-10),0)} L</b></div></div>`};
  $("#drSvc").onchange=()=>{$("#drRate").value=DRONE_RATES[val("drSvc")];q()};$("#drArea").oninput=q;$("#drRate").oninput=q;q();
  listen(CAP.db?CAP.db.collection("droneRequests").orderBy("createdAt","desc").limit(100):null,s=>drawPosts($("#drList"),s.docs.map(d=>({id:d.id,...d.data()})),(d,who)=>`<div class="item"><div class="item-top"><div><b>${esc(d.service)}</b> · <span class="num">${fmt(d.area)} acre</span><div class="meta"><span>${esc(d.loc)}</span><span>${dshow(d.date)}</span>${who?`<span>${esc(who)}</span>`:""}</div></div>${d.acceptedBy?`<span class="chip c-ok">accepted</span>`:`<span class="chip c-warn">open</span>`}</div><div class="meta">${phoneLine(d.phone)}</div>${d.owner===S.uid?ownBtns(d):(!d.acceptedBy&&canWrite()?`<div class="row"><button class="btn btn-sm btn-primary" data-accept="${esc(d.id)}">Accept job</button></div>`:"")}</div>`,"droneRequests").then(()=>document.querySelectorAll("[data-accept]").forEach(b=>b.onclick=()=>CAP.db.doc("droneRequests/"+b.dataset.accept).update({acceptedBy:S.uid}).then(()=>toast("Accepted — call the farmer to confirm")).catch(()=>toast("Could not accept.")))),$("#drList"));
  $("#drF").onsubmit=async e=>{e.preventDefault();if(!val("drLoc")||!val("drPhone")){toast("Add place and phone so providers can reach you.");return}if(await addShared("droneRequests",{service:val("drSvc"),area:numv("drArea"),date:val("drDate"),loc:val("drLoc").slice(0,80),phone:val("drPhone").slice(0,20)}))toast("Request posted")};
};

VIEWS.jobs=el=>{
  el.innerHTML=`<form class="card" id="jbF"><div class="seg" role="group" aria-label="Post type"><button type="button" data-k="hire" aria-pressed="true">I need workers</button><button type="button" data-k="seek" aria-pressed="false">I need work</button></div><div class="form-grid"><div class="field"><label for="jbRole">Work</label><select id="jbRole"><option>Harvesting</option><option>Transplanting</option><option>Weeding</option><option>Spraying</option><option>Tractor driver</option><option>Dairy / cattle care</option><option>Pruning / orchard work</option><option>General farm work</option></select></div><div class="field"><label for="jbWage">Wage (₹/day)</label><input type="number" id="jbWage" placeholder="600"></div><div class="field"><label for="jbN">People / days</label><input type="text" id="jbN" placeholder="5 people, 3 days"></div><div class="field"><label for="jbLoc">${esc(t("loc"))}</label><input type="text" id="jbLoc" value="${esc(S.profile.district||"")}"></div><div class="field"><label for="jbPhone">${esc(t("phone"))}</label><input type="tel" id="jbPhone"></div></div><div class="row"><button class="btn btn-primary" type="submit">${esc(t("post"))}</button></div></form><section class="card"><h3>Job board</h3><div class="list" id="jbList"></div></section>`;
  let kind="hire";el.querySelectorAll("[data-k]").forEach(b=>b.onclick=()=>{kind=b.dataset.k;el.querySelectorAll("[data-k]").forEach(x=>x.setAttribute("aria-pressed",x===b))});
  listen(CAP.db?CAP.db.collection("jobs").orderBy("createdAt","desc").limit(200):null,s=>drawPosts($("#jbList"),s.docs.map(d=>({id:d.id,...d.data()})),(d,who)=>`<div class="item"><div class="item-top"><div><span class="chip ${d.kind==="hire"?"c-ok":"c-warn"}">${d.kind==="hire"?"Hiring":"Looking for work"}</span> <b>${esc(d.role)}</b><div class="meta"><span>${esc(d.loc)}</span>${d.n?`<span>${esc(d.n)}</span>`:""}${who?`<span>${esc(who)}</span>`:""}<span>${ago(d.createdAt)}</span></div></div><b class="num">${d.wage?inr(d.wage)+"<span class='small muted'>/day</span>":""}</b></div><div class="meta">${phoneLine(d.phone)}</div>${ownBtns(d)}</div>`,"jobs"),$("#jbList"));
  $("#jbF").onsubmit=async e=>{e.preventDefault();if(!val("jbLoc")||!val("jbPhone")){toast("Add place and phone.");return}if(await addShared("jobs",{kind,role:val("jbRole"),wage:numv("jbWage")||0,n:val("jbN").slice(0,60),loc:val("jbLoc").slice(0,80),phone:val("jbPhone").slice(0,20)}))toast("Posted")};
};

const KITS={
"Tomato":["Trichoderma viride 1 kg (seed/soil treatment)","Pseudomonas fluorescens 1 kg","Water-soluble 19:19:19, 5 kg","Calcium nitrate 5 kg (blossom-end rot)","Yellow & blue sticky traps × 20","Tuta absoluta pheromone traps × 5","Micronutrient mix 1 kg"],
"Chilli":["Trichoderma 1 kg","Neem oil 10000 ppm, 1 L","Water-soluble 13:0:45, 5 kg","Yellow sticky traps × 20","Boron 20% 500 g","Mulch film 1 roll (30 micron)"],
"Paddy":["Azospirillum + PSB 1 kg each","Zinc sulphate 10 kg","Trichoderma 1 kg","Stem borer pheromone traps × 8","Leaf colour chart","Neem-coated urea guide card"],
"Cotton":["Pink bollworm pheromone traps × 5 + lures","Yellow sticky traps × 20","Magnesium sulphate 10 kg","Neem oil 1 L","Boron 500 g"],
"Onion":["Trichoderma 1 kg","Sulphur 90% WDG 3 kg","Water-soluble 0:52:34, 2 kg","Blue sticky traps × 20 (thrips)","Micronutrient mix 1 kg"],
};
VIEWS.agribox=el=>{
  el.innerHTML=`<section class="card"><div class="field" style="max-width:260px"><label for="abCrop">${esc(t("crop"))}</label><select id="abCrop">${Object.keys(KITS).map(k=>`<option>${k}</option>`).join("")}</select></div><div id="abOut"></div><div class="row"><button class="btn btn-sm" id="abAI">Customise for my farm</button></div><div class="ai-out" id="abAIOut"></div><p class="note">Kit lists are a planning aid. Buy from licensed input dealers and check the batch and expiry date.</p></section>`;
  const draw=()=>{$("#abOut").innerHTML=`<h3>Monthly kit for ${esc(val("abCrop"))} (per acre)</h3><div class="list">${KITS[val("abCrop")].map(x=>`<label class="check"><input type="checkbox"> <span>${esc(x)}</span></label>`).join("")}</div>`};
  $("#abCrop").onchange=draw;draw();
  $("#abAI").onclick=()=>aiText(`A farmer growing ${val("abCrop")} wants a month-by-month input kit. Base kit: ${KITS[val("abCrop")].join("; ")}. ${ctxLine()} Suggest which items they need this month (based on today's date and the typical season in their area), what to add or remove, and an approximate total cost range per acre. ${langLine()} Under 180 words.`,$("#abAIOut"));
};

VIEWS.clubs=el=>{
  el.innerHTML=`<form class="card" id="clF"><h3>Start a buying club</h3><div class="form-grid"><div class="field"><label for="clItem">Item</label><input type="text" id="clItem" placeholder="DAP 50 kg bag"></div><div class="field"><label for="clRetail">Retail price per unit (₹)</label><input type="number" id="clRetail" placeholder="1350"></div><div class="field"><label for="clDisc">Bulk discount (%)</label><input type="number" id="clDisc" value="8"></div><div class="field"><label for="clTarget">Target units</label><input type="number" id="clTarget" value="100"></div><div class="field"><label for="clLoc">${esc(t("loc"))}</label><input type="text" id="clLoc" value="${esc(S.profile.district||"")}"></div></div><div class="row"><button class="btn btn-primary" type="submit">Start club</button></div></form><section class="card"><h3>Open clubs</h3><div class="list" id="clList"></div></section>`;
  listen(CAP.db?CAP.db.collection("clubs").orderBy("createdAt","desc").limit(50):null,s=>drawPosts($("#clList"),s.docs.map(d=>({id:d.id,...d.data()})),(d,who)=>{const mem=Object.entries(d.members||{}).filter(([,v])=>v&&v.qty>0);const units=mem.reduce((a,[,v])=>a+v.qty,0);const mineQ=(d.members||{})[S.uid]?.qty||0;const pct=Math.min(100,units/(d.target||1)*100);const save=d.retail*d.disc/100;
    return `<div class="item"><div class="item-top"><div><b>${esc(d.item)}</b><div class="meta"><span>${esc(d.loc)}</span>${who?`<span>by ${esc(who)}</span>`:""}<span>${mem.length} member${mem.length===1?"":"s"}</span></div></div><div style="text-align:right"><b class="num">${inr(d.retail-save)}</b><div class="small muted"><s>${inr(d.retail)}</s> · save ${fmt(d.disc,0)}%</div></div></div>
    <div class="bar" aria-label="${fmt(units,0)} of ${fmt(d.target,0)} units"><i style="width:${pct}%;background:var(--turmeric)"></i></div><div class="meta num"><span>${fmt(units,0)} / ${fmt(d.target,0)} units pledged</span>${mineQ?`<span>You: ${fmt(mineQ,0)} units, saving ${inr(mineQ*save)}</span>`:""}</div>
    ${canWrite()?`<div class="row"><input type="number" min="0" id="cq_${esc(d.id)}" value="${mineQ||""}" placeholder="Units" style="max-width:110px"><button class="btn btn-sm btn-primary" data-join="${esc(d.id)}">${mineQ?"Update":"Join"}</button>${mineQ?`<button class="btn btn-sm" data-leave="${esc(d.id)}">Leave</button>`:""}${d.owner===S.uid?`<button class="btn btn-sm" data-delpost="${esc(d.id)}">${esc(t("del"))}</button>`:""}</div>`:""}</div>`},"clubs").then(()=>{
      document.querySelectorAll("[data-join]").forEach(b=>b.onclick=()=>{const q=parseFloat(document.getElementById("cq_"+b.dataset.join).value);if(!(q>0)){toast("Enter how many units you need.");return}CAP.db.doc("clubs/"+b.dataset.join).set({members:{[S.uid]:{qty:q,at:Date.now()}}},{merge:true}).then(()=>toast("You're in")).catch(()=>toast("Could not join."))});
      document.querySelectorAll("[data-leave]").forEach(b=>b.onclick=()=>CAP.db.doc("clubs/"+b.dataset.leave).set({members:{[S.uid]:{qty:0,at:Date.now()}}},{merge:true}).catch(()=>{}));
    }),$("#clList"));
  $("#clF").onsubmit=async e=>{e.preventDefault();if(!val("clItem")||!(numv("clRetail")>0)){toast("Add item and retail price.");return}if(await addShared("clubs",{item:val("clItem").slice(0,80),retail:numv("clRetail"),disc:numv("clDisc")||0,target:numv("clTarget")||1,loc:val("clLoc").slice(0,80),members:{}}))toast("Club started")};
};

/* ---------- Forum ---------- */
VIEWS.forum=el=>{
  el.innerHTML=`<form class="card" id="fmF"><h3>Ask the community</h3><div class="form-grid"><div class="field span2"><label for="fmTitle">Question</label><input type="text" id="fmTitle" placeholder="Why are my coconut leaves turning yellow?"></div><div class="field span2"><label for="fmBody">Details</label><textarea id="fmBody" rows="3"></textarea></div><div class="field"><label for="fmTag">Topic</label><select id="fmTag"><option>Crops</option><option>Pests & diseases</option><option>Livestock</option><option>Markets & prices</option><option>Schemes & loans</option><option>Machinery</option></select></div></div><div class="row"><button class="btn btn-primary" type="submit">${esc(t("post"))}</button></div></form><section class="card"><h3>Discussions</h3><div class="list" id="fmList"></div></section><section class="card" id="fmThread" hidden></section>`;
  listen(CAP.db?CAP.db.collection("forum").orderBy("createdAt","desc").limit(100):null,s=>drawPosts($("#fmList"),s.docs.map(d=>({id:d.id,...d.data()})),(d,who)=>`<div class="item"><div class="item-top"><div><span class="chip c-n">${esc(d.tag)}</span> <b>${esc(d.title)}</b><div class="meta">${who?`<span>${esc(who)}</span>`:""}<span>${ago(d.createdAt)}</span></div></div></div><div class="row"><button class="btn btn-sm" data-open="${esc(d.id)}">Open</button>${d.owner===S.uid?`<button class="btn btn-sm" data-delpost="${esc(d.id)}">${esc(t("del"))}</button>`:""}</div></div>`,"forum").then(()=>document.querySelectorAll("[data-open]").forEach(b=>b.onclick=()=>openThread(s.docs.find(x=>x.id===b.dataset.open)))),$("#fmList"));
  $("#fmF").onsubmit=async e=>{e.preventDefault();if(!val("fmTitle")){toast("Write your question.");return}if(await addShared("forum",{title:val("fmTitle").slice(0,160),body:val("fmBody").slice(0,2000),tag:val("fmTag")})){$("#fmTitle").value="";$("#fmBody").value="";toast("Posted")}};
};
let threadUnsub=null;
function openThread(doc){
  if(!doc)return;const d=doc.data();const box=$("#fmThread");box.hidden=false;
  box.innerHTML=`<span class="chip c-n" style="align-self:flex-start">${esc(d.tag)}</span><h2>${esc(d.title)}</h2>${d.body?`<p>${esc(d.body)}</p>`:""}<div class="row"><button class="btn btn-sm" id="fmAI">Suggest an answer with AI</button></div><div class="ai-out" id="fmAIOut"></div><h3>Replies</h3><div class="list" id="fmReplies"></div><form id="fmRF" class="row"><input type="text" id="fmReply" placeholder="Write a reply" style="flex:1;min-width:0"><button class="btn btn-primary" type="submit">${esc(t("post"))}</button></form>`;
  box.scrollIntoView({behavior:"smooth",block:"start"});
  if(threadUnsub){try{threadUnsub()}catch(e){}}
  const rc=CAP.db.collection("forum/"+doc.id+"/replies");
  threadUnsub=rc.orderBy("createdAt","asc").limit(200).onSnapshot(s=>drawPosts($("#fmReplies"),s.docs.map(x=>({id:x.id,...x.data()})),(r,who)=>`<div class="item"><p>${esc(r.text)}</p><div class="meta">${r.ai?`<span class="chip c-warn">AI suggestion</span>`:""}${who?`<span>${esc(who)}</span>`:""}<span>${ago(r.createdAt)}</span></div></div>`,"forum/"+doc.id+"/replies"),()=>{});subs.push(threadUnsub);
  $("#fmRF").onsubmit=async e=>{e.preventDefault();const tx=val("fmReply");if(!tx)return;if(await addShared("forum/"+doc.id+"/replies",{text:tx.slice(0,2000)}))$("#fmReply").value=""};
  $("#fmAI").onclick=async()=>{const txt=await aiText(`A farmer asked in a community forum: "${d.title}". Details: ${d.body||"none"}. ${ctxLine()} Write a helpful, practical answer (under 150 words). If a field visit or lab test is needed, say so. ${langLine()}`,$("#fmAIOut"),{speak:false});
    if(txt&&canWrite()){const b=document.createElement("button");b.className="btn btn-sm";b.textContent="Post this as a reply";b.onclick=async()=>{if(await addShared("forum/"+doc.id+"/replies",{text:txt.slice(0,2000),ai:true})){b.remove();toast("Posted")}};$("#fmAIOut").appendChild(b)}};
}

/* ---------- Courses & Radio ---------- */
const COURSES=["Seed treatment in 10 minutes","Making jeevamrutha and vermicompost","Drip irrigation basics and fertigation","Integrated pest management with traps","Reading a Soil Health Card","Grading and packing produce for better prices","Preventing mastitis in dairy cows","Applying for crop insurance (PMFBY)"];
VIEWS.courses=el=>{
  const done=S.profile.coursesDone||{};
  el.innerHTML=`<section class="card"><div class="list">${COURSES.map((c,i)=>`<div class="item"><div class="item-top"><div><b>${esc(c)}</b><div class="meta"><span>5 min</span></div></div>${done[i]?`<span class="chip c-ok">done</span>`:""}</div><div class="row"><button class="btn btn-sm btn-primary" data-c="${i}">Start lesson</button></div></div>`).join("")}</div></section><section class="card" id="coOut" hidden></section>`;
  el.querySelectorAll("[data-c]").forEach(b=>b.onclick=async()=>{const i=+b.dataset.c;const o=$("#coOut");o.hidden=false;o.innerHTML=`<h2>${esc(COURSES[i])}</h2><div class="ai-out" id="coText"></div><div class="row" id="coAct"></div>`;o.scrollIntoView({behavior:"smooth"});
    const txt=await aiText(`Teach a short lesson for Indian farmers: "${COURSES[i]}". Structure: why it matters (2 lines), 5 numbered steps with exact quantities, 2 common mistakes, and a 2-question quiz with answers at the end. ${langLine()} Under 300 words.`,$("#coText"),{cache:{gcTime:86400000}});
    if(txt){const m=document.createElement("button");m.className="btn btn-sm btn-primary";m.textContent="Mark as done";m.onclick=()=>{saveProfile({coursesDone:{...(S.profile.coursesDone||{}),[i]:true}});toast("Lesson complete");render()};$("#coAct").appendChild(m)}});
};
const SHOWS=[["Weekly farm news roundup","A 2-minute radio news bulletin with this week's farming tips for the season"],["Interview with a successful farmer","A short interview with a smallholder who doubled income through crop diversification"],["Ask the vet","A radio Q&A about common cattle and goat health problems this season"],["Market talk","A radio segment on how to time sales, use eNAM and avoid distress selling"],["Women in farming","A short radio feature on a women's self-help group running a farm business"]];
VIEWS.radio=el=>{
  el.innerHTML=`<section class="card"><p class="small muted">Each show is written for you and read aloud by your phone, in your language. Voice quality depends on the languages installed on your device.</p><div class="list">${SHOWS.map((s,i)=>`<div class="item"><div class="item-top"><div><b>${esc(s[0])}</b><div class="meta"><span>~2 min</span></div></div><button class="btn btn-sm btn-primary" data-s="${i}">${icon("radio",16)} Play</button></div></div>`).join("")}</div></section><section class="card" id="raOut" hidden></section>`;
  el.querySelectorAll("[data-s]").forEach(b=>b.onclick=async()=>{const i=+b.dataset.s;const o=$("#raOut");o.hidden=false;o.innerHTML=`<h2>${esc(SHOWS[i][0])}</h2><div class="ai-out" id="raText"></div>`;o.scrollIntoView({behavior:"smooth"});
    const txt=await aiText(`Write a script for ${SHOWS[i][1]}, for Indian farmers. ${ctxLine()} About 250 words, spoken style, short sentences, no stage directions or speaker labels in brackets. Characters are fictional and the content is practical. ${langLine()}`,$("#raText"),{cache:{gcTime:86400000}});
    if(txt){const btn=$("#raText").parentElement.querySelector(".row .btn");if(btn)speak(txt,btn)}});
};

/* ---------- Loans & schemes ---------- */
VIEWS.loans=el=>{
  el.innerHTML=`<form class="card" id="lnF"><div class="form-grid"><div class="field"><label for="lnLand">Land in your name (acres)</label><input type="number" id="lnLand" value="2" step="0.1"></div><div class="field"><label for="lnTen">Do you farm leased land?</label><select id="lnTen"><option>No</option><option>Yes</option></select></div><div class="field"><label for="lnTax">Anyone in family pays income tax?</label><select id="lnTax"><option>No</option><option>Yes</option></select></div><div class="field"><label for="lnGov">Govt employee / pension ≥ ₹10,000 / doctor, lawyer, CA, engineer?</label><select id="lnGov"><option>No</option><option>Yes</option></select></div><div class="field"><label for="lnSeason">Insure crop for</label><select id="lnSeason"><option value="2">Kharif food/oilseed (2%)</option><option value="1.5">Rabi food/oilseed (1.5%)</option><option value="5">Commercial / horticulture (5%)</option></select></div><div class="field"><label for="lnSI">Sum insured per acre (₹)</label><input type="number" id="lnSI" value="30000"></div></div><div class="row"><button class="btn btn-primary" type="submit">Check</button></div></form><div id="lnOut"></div>`;
  $("#lnF").onsubmit=e=>{e.preventDefault();const land=numv("lnLand")||0,ten=val("lnTen")==="Yes",tax=val("lnTax")==="Yes",gov=val("lnGov")==="Yes";
    const pmk=land>0&&!tax&&!gov;const prem=(numv("lnSI")||0)*numv("lnSeason")/100;const area=Math.max(land,ten?1:0);
    $("#lnOut").innerHTML=`<section class="card">
    <div class="item"><div class="item-top"><div><b>PM-KISAN</b><div class="meta"><span>₹6,000 a year in 3 instalments of ₹2,000</span></div></div><span class="chip ${pmk?"c-ok":"c-bad"}">${pmk?"Likely eligible":"Not eligible"}</span></div><p class="small">${pmk?"Needs land records in your name, Aadhaar-linked bank account and e-KYC.":land<=0?"Only farmers who own cultivable land can apply. Tenant farmers are not covered.":"Families with an income-tax payer, government employees, pensioners above ₹10,000/month and registered professionals are excluded."}</p><a class="small" href="https://pmkisan.gov.in/" target="_blank" rel="noopener">pmkisan.gov.in</a></div>
    <div class="item"><div class="item-top"><div><b>Kisan Credit Card (KCC)</b><div class="meta"><span>Short-term crop loan at 7%, effectively 4% if repaid on time</span></div></div><span class="chip ${land>0||ten?"c-ok":"c-warn"}">${land>0||ten?"Likely eligible":"Check with bank"}</span></div><p class="small">Owner farmers, tenants, sharecroppers and SHG/JLG members can apply at any bank. Interest subvention covers loans up to ₹5 lakh; collateral-free limit is ₹2 lakh. Confirm current limits with your bank.</p></div>
    <div class="item"><div class="item-top"><div><b>PM Fasal Bima Yojana</b><div class="meta"><span>Crop insurance against yield loss</span></div></div><span class="chip c-ok">Open to all farmers</span></div><div class="kpis"><div class="kpi"><span>Your premium per acre</span><b>${inr(prem)}</b></div><div class="kpi"><span>For ${fmt(area,1)} acre</span><b>${inr(prem*area)}</b></div></div><p class="small">The government pays the rest of the premium. Enrol before your state's cut-off date through a bank, CSC or the portal.</p><a class="small" href="https://pmfby.gov.in/" target="_blank" rel="noopener">pmfby.gov.in</a></div>
    <div class="row"><button class="btn btn-sm" id="lnAI">${esc(t("ai_advice"))}: other schemes for me</button></div><div class="ai-out" id="lnAIOut"></div><p class="note">Rules change. Confirm eligibility at your bank, CSC or agriculture office. Kisan Call Centre: 1800-180-1551.</p></section>`;
    $("#lnAI").onclick=()=>aiText(`List 4-5 central or state government schemes a farmer may apply for. Profile: owns ${land} acres, leased land: ${ten?"yes":"no"}, role ${S.role}. ${ctxLine()} For each: what it gives, who is eligible, where to apply. Include state-specific schemes for their state if known, and say to verify on the official portal. ${langLine()} Under 220 words.`,$("#lnAIOut"))};
  $("#lnF").requestSubmit();
};

/* ---------- FPO ---------- */
const FPO_STEPS=[["Gather interested farmers","Hold village meetings; list members with land and crop details. Group into interest groups of 15–20."],["Choose a legal form","Producer Company (Companies Act) or Cooperative Society (state act). A producer company needs at least 10 producer members and 5 directors."],["Find a support agency","Under the 10,000 FPO scheme, Cluster-Based Business Organisations (CBBOs) help with formation and handholding."],["Collect documents","ID and address proof of promoters, DSC and DIN for directors, registered office proof."],["Draft MoA and AoA / bylaws","Define objectives, membership, share capital, voting (one member one vote) and profit sharing."],["Register","File online with the Ministry of Corporate Affairs (SPICe+) or the state Registrar of Cooperatives."],["Open bank account, PAN, GST","Get a PAN, open a current account and register for GST if turnover requires it."],["Collect share capital","Collect equity from members and issue share certificates. Matching equity grants may be available."],["Write a business plan","Start with input supply or aggregation of one main crop; add processing later."],["Apply for licences and support","Seed/fertiliser/pesticide dealer licences, mandi licence, eNAM registration, credit guarantee and equity grant."]];
VIEWS.fpo=el=>{
  const done=S.profile.fpoDone||{};
  el.innerHTML=`<section class="card"><div class="section-head"><h3>Formation checklist</h3><span class="small muted num" id="fpoCount"></span></div><div class="bar"><i id="fpoBar" style="background:var(--leaf)"></i></div><div>${FPO_STEPS.map((s,i)=>`<label class="check"><input type="checkbox" data-f="${i}"${done[i]?" checked":""}><span><b>${i+1}. ${esc(s[0])}</b><br><span class="small muted">${esc(s[1])}</span></span></label>`).join("")}</div><p class="small muted">${canWrite()?"Your progress is saved to your account.":"Sign in to save progress."}</p></section>
  <form class="card" id="fpF"><h3>Draft bylaws with AI</h3><div class="form-grid"><div class="field"><label for="fpName">FPO name</label><input type="text" id="fpName" placeholder="Cauvery Raitha Producer Company"></div><div class="field"><label for="fpMem">Members</label><input type="number" id="fpMem" value="300"></div><div class="field"><label for="fpBiz">Main business</label><input type="text" id="fpBiz" placeholder="Paddy aggregation and input supply"></div></div><div class="row"><button class="btn btn-primary" type="submit">Draft key clauses</button></div><div class="ai-out" id="fpOut"></div></form>`;
  const upd=()=>{const n=el.querySelectorAll("[data-f]:checked").length;$("#fpoCount").textContent=`${n} of ${FPO_STEPS.length} done`;$("#fpoBar").style.width=n/FPO_STEPS.length*100+"%"};upd();
  el.querySelectorAll("[data-f]").forEach(c=>c.onchange=()=>{const d={};el.querySelectorAll("[data-f]").forEach(x=>{if(x.checked)d[x.dataset.f]=true});saveProfile({fpoDone:d});upd()});
  $("#fpF").onsubmit=e=>{e.preventDefault();aiText(`Draft the key clauses of bylaws / Articles of Association for an Indian Farmer Producer Organisation named "${val("fpName")||"(name)"}" with ${val("fpMem")} members, main business: ${val("fpBiz")||"aggregation"}. Cover: objectives, membership eligibility, share capital, board composition and term, general body voting, patronage bonus, and exit. Note that a lawyer or CBBO should review it. ${langLine()} Numbered clauses, under 350 words.`,$("#fpOut"),{speak:false})};
};

/* ---------- KisanBot ---------- */
let chat=[],botCtl=null;
function viewBot(m){
  m.innerHTML=`<div class="view-head"><span class="ico" style="background:var(--leaf-soft);color:var(--leaf)">${icon("bot",22)}</span><div style="min-width:0"><h1 style="font-size:1.5rem">${esc(tn("bot"))}</h1><p class="muted small">${esc(td("bot"))}</p></div><button class="btn btn-sm" id="chatClear" style="margin-left:auto">New chat</button></div>
  ${LLM.ready()?"":aiOffHTML()}
  <div class="chat" id="chatBox"><div class="bubble bot">${esc(t("bot_hello"))}</div></div>
  <div class="suggest" id="sugg">${["When should I apply urea to paddy?","Tomato leaves curling — what to do?","Will it rain this week? Should I spray?","How do I get a Kisan Credit Card?"].map(q=>`<button class="btn btn-sm" data-q="${esc(q)}">${esc(q)}</button>`).join("")}</div>
  <form class="chatbar" id="chatF"><label class="btn" for="chatImg" title="Attach photo" style="padding-inline:12px">${icon("cam",18)}</label><input type="file" id="chatImg" accept="image/*" hidden><input type="text" id="chatIn" placeholder="${esc(t("bot_ph"))}" style="flex:1;min-width:0" autocomplete="off"><button class="btn btn-primary" type="submit" id="chatSend">${esc(t("ask"))}</button></form>`;
  wireInlineGo(m);
  const box=$("#chatBox");
  if(S.profile.lat!=null&&!S.weather)loadWeather();
  chat.forEach(x=>{const b=document.createElement("div");b.className="bubble "+(x.role==="user"?"me":"bot");if(x.role==="user")b.textContent=x.content;else{b.innerHTML=md(x.content);addListen(b,x.content)}box.appendChild(b)});
  if(chat.length)$("#sugg").hidden=true;
  $("#chatClear").onclick=()=>{chat=[];render()};
  let photo=null;$("#chatImg").onchange=e=>{photo=e.target.files[0]||null;if(photo)toast("Photo attached — now type your question")};
  m.querySelectorAll("[data-q]").forEach(b=>b.onclick=()=>{$("#chatIn").value=b.dataset.q;$("#chatF").requestSubmit()});
  $("#chatF").onsubmit=async e=>{e.preventDefault();
    if(botCtl){botCtl.abort();return}
    const q=val("chatIn");if(!q)return;$("#chatIn").value="";$("#sugg").hidden=true;
    const me=document.createElement("div");me.className="bubble me";me.textContent=q+(photo?" 📷":"");box.appendChild(me);
    const bot=document.createElement("div");bot.className="bubble bot";box.appendChild(bot);bot.scrollIntoView({block:"end"});
    if(!LLM.ready()){bot.innerHTML=aiOffHTML();wireInlineGo(bot);return}
    chat.push({role:"user",content:q+(photo?" [The farmer attached a photo of the crop.]":"")});
    const system=`You are KisanBot inside the Kisan Mitra app: a friendly, expert Indian agricultural extension advisor. ${ctxLine()} ${langLine()} Keep answers short (under 150 words), practical, with doses and timings where relevant. Recommend only pesticides registered in India (CIBRC) and advise reading labels. For emergencies point to the right helpline (Kisan Call Centre 1800-180-1551, ambulance 108, local veterinary hospital). Current MSPs (₹/qtl): ${MSP.map(x=>x[0]+" "+x[1]).join(", ")}. For today's mandi prices, tell the user to open the Mandi Prices tool in this app.`;
    bot.innerHTML=`<span class="muted"><span class="spin"></span> ${esc(t("thinking"))}</span>`;
    botCtl=new AbortController();$("#chatSend").textContent=t("stop");
    const img=photo;photo=null;$("#chatImg").value="";
    try{const text=await LLM.stream({system,messages:chat.slice(-12),images:img?[img]:[],signal:botCtl.signal,onText:({text})=>{bot.innerHTML=md(text);bot.scrollIntoView({block:"end"})}});
      bot.innerHTML=md(text);addListen(bot,text);chat.push({role:"assistant",content:text})}
    catch(err){const msg=aiErr(err);bot.innerHTML=msg?`<p class="note">${esc(msg)}</p>`:"<p class='muted'>Stopped.</p>";chat.pop();if(err&&err.code==="not_configured"){bot.innerHTML=aiOffHTML();wireInlineGo(bot)}}
    botCtl=null;const sb=$("#chatSend");if(sb)sb.textContent=t("ask");bot.scrollIntoView({block:"end"})};
}

/* ---------- Settings ---------- */
function viewSettings(m){
  const c=LLM.cfg();
  m.innerHTML=`<div class="view-head"><button class="backbtn" id="backBtn" aria-label="${esc(t("back"))}">${icon("back",18)}</button><div><h1 style="font-size:1.5rem">Settings</h1><p class="muted small">AI model, live data and your profile. Saved in this browser only.</p></div></div>
  <form class="card" id="setAI"><h3>AI model (KisanBot, Crop Doctor, advice)</h3>
   <div class="field"><label for="aiProv">Connect through</label><select id="aiProv"><option value="proxy">Kisan Mitra proxy (Cloudflare Worker) — recommended</option><option value="anthropic">Claude API directly with my own key</option><option value="openai">Any OpenAI-compatible API (OpenAI, Groq, OpenRouter, Gemini, Ollama)</option></select></div>
   <div class="form-grid">
    <div class="field span2" data-p="proxy"><label for="aiProxy">Proxy URL</label><input type="text" id="aiProxy" value="${esc(c.proxyUrl||"")}" placeholder="https://kisan-mitra-proxy.yourname.workers.dev"></div>
    <div class="field span2" data-p="openai"><label for="aiBase">Base URL</label><input type="text" id="aiBase" value="${esc(c.baseUrl||"")}" placeholder="https://api.openai.com/v1"></div>
    <div class="field span2" data-p="anthropic openai"><label for="aiKey">API key</label><input type="password" id="aiKey" value="${esc(lsGetRaw("ai").apiKey||"")}" autocomplete="off" placeholder="Stored only in this browser"></div>
    <div class="field"><label for="aiModel">Main model</label><input type="text" id="aiModel" value="${esc(c.model||"")}"></div>
    <div class="field"><label for="aiQuick">Fast model</label><input type="text" id="aiQuick" value="${esc(c.quickModel||"")}"></div>
   </div>
   <p class="note" data-p="anthropic openai">A key typed here is kept in this browser's storage and sent only to the AI provider. Don't use this on a shared phone, and never commit a key to GitHub. For a public demo, use the proxy.</p>
   <div class="row"><button class="btn btn-primary" type="submit">${esc(t("save"))}</button><button class="btn" type="button" id="aiTest">Test connection</button></div><div id="aiTestOut"></div></form>
  <form class="card" id="setData"><h3>Live mandi prices</h3><div class="field"><label for="dgKey">data.gov.in API key (optional)</label><input type="password" id="dgKey" value="${esc(lsGet("datagovKey",""))}" autocomplete="off" placeholder="Leave blank to use the proxy or the public sample key"></div><p class="small muted">Get a free key at data.gov.in → sign in → My Account. Weather needs no key.</p><div class="row"><button class="btn btn-primary" type="submit">${esc(t("save"))}</button></div></form>
  <form class="card" id="setMe"><h3>Your profile</h3><div class="form-grid"><div class="field"><label for="meName">Name shown on your posts</label><input type="text" id="meName" value="${esc(S.profile.name||"")}" maxlength="40"></div></div><div class="row"><button class="btn btn-primary" type="submit">${esc(t("save"))}</button></div></form>
  <section class="card"><h3>Farm location</h3><div id="setPlace" style="display:flex;flex-direction:column;gap:10px">${placePicker()}</div><p class="small muted">Current: ${esc([S.profile.place,S.profile.district,S.profile.state].filter(Boolean).join(", ")||"not set")}. Storage: ${shared()?"shared online (Firebase)":"this device only"}.</p></section>`;
  $("#backBtn").onclick=()=>go("home");
  const prov=$("#aiProv");prov.value=c.provider||"proxy";
  const showP=()=>m.querySelectorAll("[data-p]").forEach(x=>x.hidden=!x.dataset.p.split(" ").includes(prov.value));
  prov.onchange=()=>{const v=prov.value;if(v==="openai"&&/^claude/.test(val("aiModel"))){$("#aiModel").value="gpt-4o-mini";$("#aiQuick").value="gpt-4o-mini"}if(v!=="openai"&&!/^claude/.test(val("aiModel"))){$("#aiModel").value=KM_CONFIG.ai.model;$("#aiQuick").value=KM_CONFIG.ai.quickModel}showP()};showP();
  const saveAI=()=>LLM.save({provider:prov.value,proxyUrl:val("aiProxy"),baseUrl:val("aiBase"),apiKey:val("aiKey"),model:val("aiModel"),quickModel:val("aiQuick")});
  $("#setAI").onsubmit=e=>{e.preventDefault();saveAI();toast("AI settings saved")};
  $("#aiTest").onclick=async()=>{saveAI();const o=$("#aiTestOut");o.innerHTML=`<p class="muted"><span class="spin"></span> Testing…</p>`;
    try{const r=await LLM.stream({messages:[{role:"user",content:"Reply with exactly: Namaskara, Kisan Mitra is connected."}],quick:true,maxTokens:40});o.innerHTML=`<p class="verdict c-ok">${esc(r)}</p>`}
    catch(err){o.innerHTML=`<p class="verdict c-bad">${esc(aiErr(err))}</p>`}};
  $("#setData").onsubmit=e=>{e.preventDefault();lsSet("datagovKey",val("dgKey"));toast("Saved")};
  $("#setMe").onsubmit=e=>{e.preventDefault();saveProfile({name:val("meName")});toast("Saved")};
  wirePlacePicker($("#setPlace"),()=>toast("Location saved"));
}
function lsGetRaw(k){try{return JSON.parse(localStorage.getItem("km_"+k)||"{}")}catch(e){return{}}}

/* ---------- start ---------- */
(function init(){
  S.lang=lsGet("lang","en");if(!LANGS[S.lang])S.lang="en";S.role=lsGet("role","farmer");if(!ROLES.includes(S.role))S.role="farmer";
  Object.assign(S.profile,lsGet("profile",{}));
  const h=location.hash.slice(1);if(h&&(TOOLS.some(x=>x.id===h)||NAV.some(n=>n[0]===h)||h==="settings"))S.route=h;
  applyChrome();render();boot();
  if("serviceWorker" in navigator&&location.protocol==="https:")navigator.serviceWorker.register("sw.js").catch(()=>{});
})();
