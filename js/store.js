"use strict";
/*
 * Storage layer with one Firestore-style interface:
 *   store.doc(path).get/set/update/delete/onSnapshot/collection
 *   store.collection(path).orderBy(f,dir).limit(n).onSnapshot/get, .add(data), .doc(id)
 * LocalStore keeps everything in this browser. FirebaseStore shares data between users.
 */
const LocalStore = (() => {
  const KEY = "km_db_v1";
  let data = {};
  try { data = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { data = {}; }
  const listeners = new Set();
  const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const notify = () => listeners.forEach(f => { try { f(); } catch (e) { console.error(e); } });
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { console.warn("Storage full", e); } notify(); };
  window.addEventListener("storage", e => { if (e.key === KEY) { try { data = JSON.parse(e.newValue || "{}"); } catch (_) {} notify(); } });
  const merge = (a, b) => {
    for (const k in b) {
      const bv = b[k], av = a[k];
      if (bv && typeof bv === "object" && !Array.isArray(bv) && av && typeof av === "object" && !Array.isArray(av)) merge(av, bv);
      else a[k] = bv;
    }
    return a;
  };
  const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const snapDoc = path => { const v = data[path]; return { id: path.split("/").pop(), exists: v !== undefined, data: () => clone(v) }; };

  function doc(path) {
    return {
      id: path.split("/").pop(), path,
      get: async () => snapDoc(path),
      set: async (d, opts) => { data[path] = opts && opts.merge && data[path] ? merge(data[path], clone(d)) : clone(d); persist(); },
      update: async d => { if (!data[path]) throw { code: "not_found", message: "Document does not exist" }; merge(data[path], clone(d)); persist(); },
      delete: async () => { delete data[path]; persist(); },
      onSnapshot: cb => { const f = () => cb(snapDoc(path)); listeners.add(f); setTimeout(f); return () => listeners.delete(f); },
      collection: c => collection(path + "/" + c)
    };
  }
  function query(cpath, ord, lim) {
    const run = () => {
      const pre = cpath + "/", depth = cpath.split("/").length + 1;
      let docs = Object.keys(data).filter(k => k.startsWith(pre) && k.split("/").length === depth).map(k => ({ k, v: data[k] }));
      if (ord) {
        const [f, dir] = ord, s = dir === "desc" ? -1 : 1;
        docs.sort((a, b) => { const x = a.v[f], y = b.v[f]; return (x > y ? 1 : x < y ? -1 : 0) * s; });
      }
      if (lim) docs = docs.slice(0, lim);
      const out = docs.map(d => snapDoc(d.k));
      return { docs: out, size: out.length, empty: !out.length };
    };
    return {
      orderBy: (f, dir) => query(cpath, [f, dir || "asc"], lim),
      limit: n => query(cpath, ord, n),
      get: async () => run(),
      onSnapshot: cb => { const f = () => cb(run()); listeners.add(f); setTimeout(f); return () => listeners.delete(f); }
    };
  }
  function collection(cpath) {
    return Object.assign(query(cpath), {
      path: cpath,
      doc: id => doc(cpath + "/" + (id || rid())),
      add: async d => { const r = doc(cpath + "/" + rid()); await r.set(d); return r; }
    });
  }
  async function init() {
    let u = null;
    try { u = localStorage.getItem("km_uid"); } catch (e) {}
    if (!u) { u = "u_" + rid(); try { localStorage.setItem("km_uid", u); } catch (e) {} }
    return u;
  }
  return { kind: "local", init, doc, collection };
})();

function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Failed to load " + src)); document.head.appendChild(s); });
}

async function FirebaseStore(cfg) {
  const V = "10.12.2";
  await loadScript(`https://www.gstatic.com/firebasejs/${V}/firebase-app-compat.js`);
  await loadScript(`https://www.gstatic.com/firebasejs/${V}/firebase-auth-compat.js`);
  await loadScript(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore-compat.js`);
  /* global firebase */
  firebase.initializeApp(cfg);
  const auth = firebase.auth(), fs = firebase.firestore();
  try { await fs.enablePersistence({ synchronizeTabs: true }); } catch (e) { /* offline cache optional */ }
  let user = await new Promise(r => { const un = auth.onAuthStateChanged(u => { un(); r(u); }); });
  if (!user) user = (await auth.signInAnonymously()).user;
  return { kind: "firebase", init: async () => user.uid, doc: p => fs.doc(p), collection: p => fs.collection(p) };
}
