// app.js (TAM)
// ✅ Register kaldırıldı
// ✅ Firestore/cloud save/load tamamen kaldırıldı
// ✅ layers.json her girişte yükleniyor
// ✅ Katman görünmeme sorunu: proj4 ile TM30 -> WGS84 dönüşümü eklendi
// ✅ ⋯ menü (Stil/Öznitelik/Katmana Git) FIX: capture click yüzünden çalışmama sorunu giderildi

import { auth } from "./firebase.js";

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

/* =========================================================
   AUTH UI
========================================================= */
const authScreen = document.getElementById("authScreen");
const appRoot = document.getElementById("appRoot");

const loginForm = document.getElementById("loginForm");
const authMsg = document.getElementById("authMsg");
const forgotBtn = document.getElementById("forgotBtn");

function setAuthMsg(msg){ authMsg.textContent = msg; }

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const pass = document.getElementById("loginPass").value;
  try{
    setAuthMsg("Giriş yapılıyor...");
    await signInWithEmailAndPassword(auth, email, pass);
    setAuthMsg("Giriş başarılı ✅");
  }catch(err){
    console.error(err);
    setAuthMsg("Giriş hatası ❌");
    alert(err?.message || "Giriş yapılamadı.");
  }
});

forgotBtn.addEventListener("click", async () => {
  const email = (document.getElementById("loginEmail").value || "").trim();
  if (!email) { alert("Önce e-posta gir."); return; }
  try{
    setAuthMsg("Sıfırlama maili gönderiliyor...");
    await sendPasswordResetEmail(auth, email);
    setAuthMsg("Sıfırlama maili gönderildi ✅");
    alert("Şifre sıfırlama maili gönderildi.");
  }catch(err){
    console.error(err);
    setAuthMsg("Sıfırlama hatası ❌");
    alert(err?.message || "Mail gönderilemedi.");
  }
});

/* =========================================================
   APP (Leaflet + UI)
========================================================= */

// ======= Status =======
const statusbar = document.getElementById("statusbar");
function setStatus(msg){ statusbar.textContent = msg; }

// ================= MAP =================
const map = L.map("map", { zoomControl:false }).setView([41.02, 28.78], 12);
L.control.zoom({ position:"topleft" }).addTo(map);
map.doubleClickZoom.disable();

// =============== BASEMAPS ==============
const basemaps = {
  osm: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 20 }),
  cartoLight: L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", { maxZoom: 20 }),
  esriSat: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 20 })
};
let currentBasemap = basemaps.osm;
currentBasemap.addTo(map);

document.querySelectorAll("input[name='basemap']").forEach(radio => {
  radio.addEventListener("change", e => {
    if (currentBasemap) map.removeLayer(currentBasemap);
    currentBasemap = basemaps[e.target.value];
    currentBasemap.addTo(map);
  });
});

function refreshLeafletAfterShow(){
  requestAnimationFrame(() => {
    map.invalidateSize(true);
    requestAnimationFrame(() => map.invalidateSize(true));
  });
}

// ================== TABS ==================
const tabs = document.querySelectorAll(".tab");
const panels = {
  layers: document.getElementById("tab-layers"),
  basemaps: document.getElementById("tab-basemaps"),
  import: document.getElementById("tab-import")
};
function openTab(key){
  tabs.forEach(b => b.classList.remove("active"));
  document.querySelector(`.tab[data-tab="${key}"]`)?.classList.add("active");
  Object.values(panels).forEach(p => p.classList.remove("active"));
  panels[key]?.classList.add("active");
}
tabs.forEach(btn => btn.addEventListener("click", () => openTab(btn.dataset.tab)));

// ================== STATE ==================
const groupListEl = document.getElementById("groupList");
const newGroupNameEl = document.getElementById("newGroupName");
const addGroupBtn = document.getElementById("addGroupBtn");

const layerStore = {};
const groupOrder = [];
const groups = {};
const importedIds = new Set();

function resetAppLayersOnly(){
  for (const id of Object.keys(layerStore)) {
    try { map.removeLayer(layerStore[id].leaflet); } catch(e){}
    delete layerStore[id];
  }
  groupOrder.length = 0;
  for (const k of Object.keys(groups)) delete groups[k];
  importedIds.clear();
  window.__didFit = false;
  refreshAttrLayerSelect();
}

// ================== HELPERS ==================
function safeStr(v){
  if (v === null || v === undefined) return "";
  return String(v);
}

function detectGeomFromGeojson(geojson){
  try{
    const f = geojson?.features?.[0];
    const t = f?.geometry?.type;
    if (!t) return "unknown";
    if (t.includes("Point")) return "point";
    if (t.includes("LineString")) return "line";
    if (t.includes("Polygon")) return "polygon";
  }catch(e){}
  return "unknown";
}

function dashArrayFromType(type){
  if (type === "dash") return "8 6";
  if (type === "dot") return "2 6";
  if (type === "dashdot") return "10 5 2 5";
  return null;
}

function normalizeGeoJSON(raw){
  if (!raw) return { type:"FeatureCollection", features:[] };

  if (Array.isArray(raw)) {
    if (raw.length && raw[0]?.type === "Feature") {
      return { type:"FeatureCollection", features: raw };
    }
    if (raw.length && raw[0]?.type === "FeatureCollection") {
      return raw[0];
    }
    return { type:"FeatureCollection", features:[] };
  }

  if (!raw.features && raw.Features && Array.isArray(raw.Features)) {
    return { type:"FeatureCollection", features: raw.Features };
  }

  if (raw.type === "Feature") {
    return { type:"FeatureCollection", features:[raw] };
  }

  if (raw.type === "FeatureCollection") {
    raw.features = raw.features || [];
    return raw;
  }

  if (raw.type && raw.coordinates) {
    return {
      type: "FeatureCollection",
      features: [{ type:"Feature", properties:{}, geometry: raw }]
    };
  }

  return { type:"FeatureCollection", features: raw.features || [] };
}

// ================== CRS FIX (TM30 -> WGS84) ==================
function looksProjected(geojson){
  try{
    const f = geojson?.features?.find(x => x?.geometry?.coordinates);
    if (!f) return false;
    let c = f.geometry.coordinates;
    while (Array.isArray(c)) c = c[0];
    const x = Number(c?.[0]);
    const y = Number(c?.[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    return (Math.abs(x) > 180 || Math.abs(y) > 90);
  }catch(e){
    return false;
  }
}

function deepMapCoords(coords, fn){
  if (!Array.isArray(coords)) return coords;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") {
    return fn(coords);
  }
  return coords.map(c => deepMapCoords(c, fn));
}

function reprojectGeoJSONToWGS84(geojson){
  if (typeof proj4 === "undefined") return geojson;

  const TM30_5254 = "+proj=tmerc +lat_0=0 +lon_0=30 +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";
  const TM30_2320 = "+proj=tmerc +lat_0=0 +lon_0=30 +k=1 +x_0=500000 +y_0=0 +ellps=intl +towgs84=-87,-98,-121,0,0,0,0 +units=m +no_defs";

  function tryTransform(fromDef){
    const out = JSON.parse(JSON.stringify(geojson));
    out.features = (out.features || []).map(feat => {
      if (!feat?.geometry?.coordinates) return feat;
      feat.geometry.coordinates = deepMapCoords(feat.geometry.coordinates, ([x,y]) => {
        const p = proj4(fromDef, "WGS84", [x, y]); // [lon,lat]
        return [p[0], p[1]];
      });
      return feat;
    });

    try{
      const f = out.features.find(x => x?.geometry?.coordinates);
      let c = f.geometry.coordinates;
      while (Array.isArray(c)) c = c[0];
      const lon = Number(c?.[0]);
      const lat = Number(c?.[1]);
      if (Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90) {
        return out;
      }
    }catch(e){}
    return null;
  }

  return tryTransform(TM30_5254) || tryTransform(TM30_2320) || geojson;
}

// ================== AUTO SAVE (KALDIRILDI) ==================
function scheduleAutoSave(reason=""){
  return;
}

// ================== ATTRIBUTE TABLE UI =======
const attrDrawer = document.getElementById("attrDrawer");
const attrLayerSelect = document.getElementById("attrLayerSelect");
const attrFilter = document.getElementById("attrFilter");
const attrTable = document.getElementById("attrTable");
const attrSub = document.getElementById("attrSub");
const attrCount = document.getElementById("attrCount");
const attrClose = document.getElementById("attrClose");
const attrGoLayers = document.getElementById("attrGoLayers");
const attrClearFilter = document.getElementById("attrClearFilter");
const attrAddField = document.getElementById("attrAddField");
const attrExportCsv = document.getElementById("attrExportCsv");
const attrZoomSel = document.getElementById("attrZoomSel");
const attrClearSel = document.getElementById("attrClearSel");

let activeAttrLayerId = null;
let selectedFeatureKey = null;

// ======= Style Modal UI =======
const styleModal = document.getElementById("styleModal");
const styleTitle = document.getElementById("styleTitle");
const styleClose = document.getElementById("styleClose");
const styleReset = document.getElementById("styleReset");
const styleApply = document.getElementById("styleApply");
const lineColorEl = document.getElementById("lineColor");
const fillColorEl = document.getElementById("fillColor");
const fillOpacityEl = document.getElementById("fillOpacity");
const fillOpacityVal = document.getElementById("fillOpacityVal");
const lineWeightEl = document.getElementById("lineWeight");
const lineWeightVal = document.getElementById("lineWeightVal");
const lineDashEl = document.getElementById("lineDash");
let activeStyleLayerId = null;

// ================== GROUP UI ==================
function ensureGroup(name){
  if (!groups[name]) groups[name] = [];
  if (!groupOrder.includes(name)) groupOrder.push(name);
}

/* -------- Global menu (FIXED) -------- */
const globalMenu = document.createElement("div");
globalMenu.className = "global-menu hidden";
globalMenu.innerHTML = `
  <button data-act="style" type="button"><span>🎨 Stil</span><small>çizgi/dolgu</small></button>
  <button data-act="attr" type="button"><span>▦ Öznitelik</span><small>tablo</small></button>
  <button data-act="zoom" type="button"><span>↗ Katmana Git</span><small>zoom</small></button>
`;
document.body.appendChild(globalMenu);

let globalMenuCtx = { layerId:null };

function closeGlobalMenu(){
  globalMenu.classList.add("hidden");
  globalMenuCtx.layerId = null;
}

// ✅ menü dışına tıklayınca kapat (menü içi tıklamada kapatma!)
document.addEventListener("pointerdown", (e) => {
  if (globalMenu.classList.contains("hidden")) return;
  const insideMenu = globalMenu.contains(e.target);
  const clickedMore = e.target.closest?.(".morebtn");
  if (!insideMenu && !clickedMore) closeGlobalMenu();
});

window.addEventListener("resize", closeGlobalMenu);
window.addEventListener("scroll", closeGlobalMenu, true);

globalMenu.addEventListener("click", (e) => {
  e.stopPropagation();
  const btn = e.target.closest("button");
  if (!btn) return;

  const act = btn.dataset.act;
  const layerId = globalMenuCtx.layerId;
  if (!layerId || !layerStore[layerId]) return;

  if (act === "style") openStyleModal(layerId);
  if (act === "attr") openAttributeTable(layerId);
  if (act === "zoom") {
    const item = layerStore[layerId];

    // Katman kapalıysa aç
    if (item?.leaflet && !map.hasLayer(item.leaflet)) {
      map.addLayer(item.leaflet);
      const cb = document.querySelector(`input[data-layercheck="${layerId}"]`);
      if (cb) cb.checked = true;
    }

    const b = item?.leaflet?.getBounds?.();
    if (b && b.isValid()) map.fitBounds(b, { padding:[20,20] });
  }

  closeGlobalMenu();
});

function openGlobalMenuAt(btnEl, layerId){
  globalMenuCtx.layerId = layerId;

  const r = btnEl.getBoundingClientRect();
  const menuW = 240;
  const menuH = 160;

  let left = r.right - menuW;
  left = Math.min(window.innerWidth - menuW - 10, left);
  left = Math.max(10, left);

  let top = r.bottom + 8;
  if (top + menuH > window.innerHeight - 10){
    top = r.top - menuH - 8;
  }
  top = Math.max(10, top);

  globalMenu.style.left = `${left}px`;
  globalMenu.style.top = `${top}px`;
  globalMenu.classList.remove("hidden");
}

function rebuildGroupsUI(){
  groupListEl.innerHTML = "";

  groupOrder.forEach(groupName => {
    const card = document.createElement("div");
    card.className = "group-card";

    const head = document.createElement("div");
    head.className = "group-head";
    head.innerHTML = `
      <div class="group-title">${groupName}</div>
      <div class="group-actions">
        <button class="pill" data-act="toggleAll">Hepsini Kapat</button>
        <button class="pill" data-act="hide">Gizle</button>
        <button class="pill danger" data-act="delete">Sil</button>
      </div>
    `;

    const drop = document.createElement("div");
    drop.className = "group-drop";
    drop.dataset.group = groupName;

    drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("dragover");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("dragover"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("dragover");
      const layerId = e.dataTransfer.getData("text/layerId");
      if (!layerId) return;
      moveLayerToGroup(layerId, groupName);
    });

    head.querySelector('[data-act="hide"]').addEventListener("click", () => {
      drop.classList.toggle("hidden");
    });

    head.querySelector('[data-act="delete"]').addEventListener("click", () => {
      if ((groups[groupName] || []).length > 0) {
        alert("Önce gruptaki katmanları başka bir gruba taşı.");
        return;
      }
      delete groups[groupName];
      const idx = groupOrder.indexOf(groupName);
      if (idx >= 0) groupOrder.splice(idx, 1);
      rebuildGroupsUI();
      refreshAttrLayerSelect();
    });

    const toggleAllBtn = head.querySelector('[data-act="toggleAll"]');
    toggleAllBtn.addEventListener("click", () => {
      const ids = groups[groupName] || [];
      if (!ids.length) return;

      const anyVisible = ids.some(id => map.hasLayer(layerStore[id]?.leaflet));
      ids.forEach(id => {
        const item = layerStore[id];
        if (!item?.leaflet) return;
        if (anyVisible) map.removeLayer(item.leaflet);
        else map.addLayer(item.leaflet);

        const cb = document.querySelector(`input[data-layercheck="${id}"]`);
        if (cb) cb.checked = !anyVisible;
      });

      toggleAllBtn.textContent = anyVisible ? "Hepsini Aç" : "Hepsini Kapat";
    });

    card.appendChild(head);
    card.appendChild(drop);
    groupListEl.appendChild(card);

    (groups[groupName] || []).forEach(layerId => {
      const row = buildLayerRow(layerId);
      drop.appendChild(row);
    });
  });
}

function moveLayerToGroup(layerId, newGroup){
  Object.keys(groups).forEach(g => {
    const idx = groups[g].indexOf(layerId);
    if (idx >= 0) groups[g].splice(idx, 1);
  });
  ensureGroup(newGroup);
  groups[newGroup].push(layerId);

  layerStore[layerId].def.group = newGroup;
  rebuildGroupsUI();
  refreshAttrLayerSelect();
}

function geomIconClass(geom){
  if (geom === "point") return "geom-icon point";
  if (geom === "line") return "geom-icon line";
  if (geom === "polygon") return "geom-icon poly";
  return "geom-icon";
}

/* =========================================================
   EDIT TOOL
========================================================= */
let activeEdit = null;

function cancelMeasureToolIfAny(){
  if (!activeTool) return;
  clearToolDraw();
}

function cancelEdit(){
  if (activeEdit?.tempLine) drawLayer.removeLayer(activeEdit.tempLine);
  if (activeEdit?.tempPoly) drawLayer.removeLayer(activeEdit.tempPoly);
  (activeEdit?.markers || []).forEach(m => drawLayer.removeLayer(m));
  activeEdit = null;
  setStatus("Hazır");
  toolStatus.textContent = "Hazır";
}

function startEditLayer(layerId){
  const item = layerStore[layerId];
  if (!item) return;

  cancelMeasureToolIfAny();

  activeEdit = {
    layerId,
    geom: item.def.geom,
    points: [],
    tempLine: null,
    tempPoly: null,
    previewPoint: null,
    markers: []
  };

  setStatus(`Düzenleme: ${item.def.name} • Tıkla çiz • Çift tıkla bitir • ESC iptal`);
  toolStatus.textContent = `Edit: ${item.def.geom}`;
}

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (activeEdit) cancelEdit();
    if (activeTool) clearToolDraw();
  }
});

function nextFidForLayer(layerId){
  const item = layerStore[layerId];
  let max = -1;
  (item.geojson.features || []).forEach(f => {
    const fid = Number(f?.properties?._fid);
    if (!Number.isNaN(fid)) max = Math.max(max, fid);
  });
  return max + 1;
}

function addFeatureToLayer(layerId, feature){
  const item = layerStore[layerId];
  if (!item) return;

  feature.properties = feature.properties || {};
  feature.properties._fid = nextFidForLayer(layerId);

  item.geojson.features = item.geojson.features || [];
  item.geojson.features.push(feature);

  item.leaflet.addData(feature);

  item.leaflet.eachLayer(l => {
    const f = l.feature;
    const fid = f?.properties?._fid;
    if (fid !== undefined) item.byFid[fid] = l;
  });

  rebuildGroupsUI();
  refreshAttrLayerSelect();
}

/* =========================================================
   Layer row
========================================================= */
function buildLayerRow(layerId){
  const item = layerStore[layerId];
  const def = item.def;

  const row = document.createElement("div");
  row.className = "layer-row";
  row.draggable = true;

  row.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/layerId", layerId);
  });

  row.innerHTML = `
    <div class="layer-left">
      <input class="layer-check" data-layercheck="${layerId}" type="checkbox" ${map.hasLayer(item.leaflet) ? "checked": ""}/>
      <span class="${geomIconClass(def.geom)}"></span>
      <span class="swatch" style="background:${item.style.lineColor}"></span>
      <span class="layer-name" title="${def.name}">${def.name}</span>
    </div>

    <div class="layer-right">
      <button class="editbtn" title="Bu katmana çizim ekle" type="button">✏️</button>
      <button class="morebtn" title="İşlemler" type="button">⋯</button>
    </div>
  `;

  const cb = row.querySelector(".layer-check");
  cb.addEventListener("change", (e) => {
    if (e.target.checked) map.addLayer(item.leaflet);
    else map.removeLayer(item.leaflet);
  });

  row.querySelector(".editbtn").addEventListener("click", (e) => {
    e.stopPropagation();
    startEditLayer(layerId);
  });

  const moreBtn = row.querySelector(".morebtn");
  moreBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openGlobalMenuAt(moreBtn, layerId);
  });

  return row;
}

// ================== Leaflet GeoJSON creation ==================
function makeLeafletGeoJsonLayer(layerId){
  const item = layerStore[layerId];
  const { geojson } = item;

  const geom = item.def.geom || detectGeomFromGeojson(geojson);
  item.def.geom = geom;

  const style = item.style;

  const leaflet = L.geoJSON(geojson, {
    style: () => ({
      color: style.lineColor,
      weight: style.weight,
      dashArray: dashArrayFromType(style.dash),
      fillColor: style.fillColor,
      fillOpacity: style.fillOpacity
    }),
    pointToLayer: (f, latlng) => {
      return L.circleMarker(latlng, {
        radius: 6,
        color: style.lineColor,
        weight: Math.max(1, style.weight),
        fillColor: style.fillColor || style.lineColor,
        fillOpacity: 0.9
      });
    },
    onEachFeature: (f, l) => {
      const fid = f?.properties?._fid ?? null;
      if (fid !== null) item.byFid[fid] = l;

      l.on("click", () => {
        if (activeAttrLayerId === layerId) {
          selectedFeatureKey = `${layerId}::${fid}`;
          renderAttributeTable(layerId);
        }
      });

      if (f.properties) {
        l.bindPopup(
          Object.entries(f.properties)
            .filter(([k]) => k !== "_fid")
            .map(([k, v]) => `<b>${k}</b>: ${safeStr(v)}`)
            .join("<br>")
        );
      }
    }
  });

  return leaflet;
}

function applyStyleToLeaflet(layerId){
  const item = layerStore[layerId];
  if (!item?.leaflet) return;
  const s = item.style;

  item.leaflet.setStyle && item.leaflet.setStyle({
    color: s.lineColor,
    weight: s.weight,
    dashArray: dashArrayFromType(s.dash),
    fillColor: s.fillColor,
    fillOpacity: s.fillOpacity
  });

  item.leaflet.eachLayer(l => {
    if (l instanceof L.CircleMarker) {
      l.setStyle({
        color: s.lineColor,
        weight: Math.max(1, s.weight),
        fillColor: s.fillColor || s.lineColor,
        fillOpacity: 0.9
      });
    }
  });
}

// ================== LOAD / INIT LAYERS ==================
function initLayer(def, geojson, isImported=false){
  geojson = normalizeGeoJSON(geojson);

  let fid = 0;
  geojson.features = geojson.features || [];
  geojson.features.forEach(f => {
    f.properties = f.properties || {};
    if (f.properties._fid === undefined) f.properties._fid = fid++;
  });

  layerStore[def.id] = {
    def: {
      id: def.id,
      name: def.name,
      group: def.group || (isImported ? "İçe Aktarılanlar" : "Genel"),
      geom: def.geom || detectGeomFromGeojson(geojson)
    },
    geojson,
    byFid: {},
    style: {
      lineColor: def.color || "#2563eb",
      fillColor: def.fillColor || (def.color || "#2563eb"),
      fillOpacity: (def.fillOpacity ?? 0.2),
      weight: (def.weight ?? 2),
      dash: (def.dash ?? "solid")
    },
    leaflet: null,
    isImported
  };

  const item = layerStore[def.id];
  item.leaflet = makeLeafletGeoJsonLayer(def.id);

  ensureGroup(item.def.group);
  groups[item.def.group].push(def.id);

  map.addLayer(item.leaflet);

  if (!window.__didFit) {
    const b = item.leaflet.getBounds?.();
    if (b && b.isValid()) {
      window.__didFit = true;
      map.fitBounds(b, { padding:[20,20] });
    }
  }

  rebuildGroupsUI();
  refreshAttrLayerSelect();
}

async function loadDefaultLayersFromDataFolder(){
  const defs = await fetch("data/layers.json").then(r => r.json());

  const failed = [];
  const loaded = [];

  for (const def of defs) {
    try {
      const res = await fetch(`data/${def.file}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} - data/${def.file}`);

      const raw = await res.json();
      let geojson = normalizeGeoJSON(raw);

      if (looksProjected(geojson)) {
        geojson = reprojectGeoJSONToWGS84(geojson);
      }

      initLayer(def, geojson, false);
      loaded.push(def.id);
    } catch (err) {
      console.error("Layer load failed:", def?.id, def?.file, err);
      failed.push(def?.file || def?.id || "unknown");
    }
  }

  if (loaded.length) setStatus(`${loaded.length} katman yüklendi ✅`);
  if (failed.length) {
    setStatus(`Bazı katman dosyaları yüklenemedi: ${failed.slice(0,3).join(", ")}${failed.length>3 ? "..." : ""}`);
  }
}

// ================== TOOLBAR ==================
document.getElementById("zoomToAll").onclick = () => {
  const group = L.featureGroup(Object.values(layerStore).map(x => x.leaflet));
  if (group.getLayers().length) map.fitBounds(group.getBounds(), { padding:[20,20] });
};

// ================== IMPORT ==================
document.getElementById("geojsonFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try{
    const raw = JSON.parse(await file.text());
    let geojson = normalizeGeoJSON(raw);

    if (looksProjected(geojson)) {
      geojson = reprojectGeoJSONToWGS84(geojson);
    }

    const id = `import_${Date.now()}`;
    importedIds.add(id);
    initLayer({ id, name: file.name, group: "İçe Aktarılanlar", color:"#2563eb" }, geojson, true);
    e.target.value = "";
  }catch(err){
    console.error(err);
    alert("GeoJSON okunamadı.");
  }
});

document.getElementById("shpZipFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try{
    const arrayBuffer = await file.arrayBuffer();
    const raw = await shp(arrayBuffer);
    let geojson = normalizeGeoJSON(raw);

    if (looksProjected(geojson)) {
      geojson = reprojectGeoJSONToWGS84(geojson);
    }

    const id = `import_${Date.now()}`;
    importedIds.add(id);
    initLayer({ id, name: file.name, group: "İçe Aktarılanlar", color:"#16a34a" }, geojson, true);
    e.target.value = "";
  }catch(err){
    console.error(err);
    alert("Shapefile ZIP okunamadı.");
  }
});

document.getElementById("clearImports").onclick = () => {
  for (const id of importedIds) {
    const item = layerStore[id];
    if (!item) continue;
    map.removeLayer(item.leaflet);
    Object.keys(groups).forEach(g => {
      const idx = groups[g].indexOf(id);
      if (idx >= 0) groups[g].splice(idx, 1);
    });
    delete layerStore[id];
  }
  importedIds.clear();
  rebuildGroupsUI();
  refreshAttrLayerSelect();
};

// ================== GROUP CREATE ==================
addGroupBtn.addEventListener("click", () => {
  const name = (newGroupNameEl.value || "").trim();
  if (!name) return;
  ensureGroup(name);
  rebuildGroupsUI();
  refreshAttrLayerSelect();
  newGroupNameEl.value = "";
});

// ================== STYLE MODAL ==================
function openStyleModal(layerId){
  activeStyleLayerId = layerId;
  const item = layerStore[layerId];
  if (!item) return;

  styleTitle.textContent = item.def.name;

  lineColorEl.value = item.style.lineColor;
  fillColorEl.value = item.style.fillColor;

  fillOpacityEl.value = item.style.fillOpacity;
  fillOpacityVal.textContent = Number(item.style.fillOpacity).toFixed(2);

  lineWeightEl.value = item.style.weight;
  lineWeightVal.textContent = String(item.style.weight);

  lineDashEl.value = item.style.dash;

  styleModal.classList.remove("hidden");
}

styleClose.addEventListener("click", () => styleModal.classList.add("hidden"));
fillOpacityEl.addEventListener("input", () => fillOpacityVal.textContent = Number(fillOpacityEl.value).toFixed(2));
lineWeightEl.addEventListener("input", () => lineWeightVal.textContent = String(lineWeightEl.value));

styleReset.addEventListener("click", () => {
  const item = layerStore[activeStyleLayerId];
  if (!item) return;
  item.style.lineColor = "#2563eb";
  item.style.fillColor = "#2563eb";
  item.style.fillOpacity = 0.2;
  item.style.weight = 2;
  item.style.dash = "solid";
  openStyleModal(activeStyleLayerId);
});

styleApply.addEventListener("click", () => {
  const item = layerStore[activeStyleLayerId];
  if (!item) return;

  item.style.lineColor = lineColorEl.value;
  item.style.fillColor = fillColorEl.value;
  item.style.fillOpacity = Number(fillOpacityEl.value);
  item.style.weight = Number(lineWeightEl.value);
  item.style.dash = lineDashEl.value;

  applyStyleToLeaflet(activeStyleLayerId);

  document.querySelectorAll(`input[data-layercheck="${activeStyleLayerId}"]`).forEach(cb => {
    const row = cb.closest(".layer-row");
    const sw = row?.querySelector(".swatch");
    if (sw) sw.style.background = item.style.lineColor;
  });

  styleModal.classList.add("hidden");
});

// ================== ATTRIBUTE TABLE ==================
function refreshAttrLayerSelect(){
  const ids = Object.keys(layerStore);
  const current = attrLayerSelect.value || activeAttrLayerId;

  attrLayerSelect.innerHTML = "";
  ids.forEach(id => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = layerStore[id].def.name;
    attrLayerSelect.appendChild(opt);
  });

  if (current && layerStore[current]) attrLayerSelect.value = current;
}

function openAttributeTable(layerId){
  activeAttrLayerId = layerId;
  refreshAttrLayerSelect();
  attrLayerSelect.value = layerId;

  attrFilter.value = "";
  selectedFeatureKey = null;

  renderAttributeTable(layerId);
  attrDrawer.classList.remove("hidden");
}

function closeAttributeTable(){
  activeAttrLayerId = null;
  selectedFeatureKey = null;
  attrDrawer.classList.add("hidden");
}

attrClose.addEventListener("click", closeAttributeTable);
attrGoLayers.addEventListener("click", () => openTab("layers"));

attrLayerSelect.addEventListener("change", () => {
  activeAttrLayerId = attrLayerSelect.value;
  selectedFeatureKey = null;
  renderAttributeTable(activeAttrLayerId);
});

attrClearFilter.addEventListener("click", () => {
  attrFilter.value = "";
  renderAttributeTable(activeAttrLayerId);
});

attrFilter.addEventListener("input", () => renderAttributeTable(activeAttrLayerId));

attrClearSel.addEventListener("click", () => {
  selectedFeatureKey = null;
  renderAttributeTable(activeAttrLayerId);
});

attrZoomSel.addEventListener("click", () => {
  if (!selectedFeatureKey) return;
  const [lid, fidStr] = selectedFeatureKey.split("::");
  const fid = Number(fidStr);
  const item = layerStore[lid];
  const lyr = item?.byFid?.[fid];
  if (!lyr) return;
  const b = lyr.getBounds?.();
  if (b && b.isValid()) map.fitBounds(b, { padding:[20,20] });
  else if (lyr.getLatLng) map.setView(lyr.getLatLng(), Math.max(map.getZoom(), 16));
});

function parseFilterExpr(expr){
  const s = (expr || "").trim();
  if (!s) return { type:"none" };
  const eq = s.indexOf("=");
  if (eq > 0) {
    const col = s.slice(0, eq).trim();
    const val = s.slice(eq+1).trim();
    return { type:"eq", col, val };
  }
  return { type:"search", q:s.toLowerCase() };
}

function getAllColumns(features){
  const set = new Set();
  features.forEach(f => {
    Object.keys(f.properties || {}).forEach(k => {
      if (k !== "_fid") set.add(k);
    });
  });
  return Array.from(set);
}

function featurePassesFilter(f, filter){
  const props = f.properties || {};
  if (filter.type === "none") return true;
  if (filter.type === "eq") {
    const v = safeStr(props[filter.col]);
    return v.toLowerCase().includes(filter.val.toLowerCase());
  }
  if (filter.type === "search") {
    const q = filter.q;
    return Object.entries(props).some(([k,v]) => {
      if (k === "_fid") return false;
      return safeStr(v).toLowerCase().includes(q);
    });
  }
  return true;
}

function renderAttributeTable(layerId){
  const item = layerStore[layerId];
  if (!item) return;

  const all = item.geojson.features || [];
  const filter = parseFilterExpr(attrFilter.value);
  const rows = all.filter(f => featurePassesFilter(f, filter));

  const cols = getAllColumns(rows.length ? rows : all);

  attrSub.textContent = `${item.def.name} • ${rows.length}/${all.length} kayıt`;
  attrCount.textContent = `${rows.length} kayıt`;

  const thead = `
    <thead>
      <tr>
        <th style="width:42px;">#</th>
        ${cols.map(c => `<th>${c}</th>`).join("")}
      </tr>
    </thead>
  `;

  const tbodyRows = rows.map((f, idx) => {
    const fid = f.properties?._fid;
    const key = `${layerId}::${fid}`;
    const selClass = (selectedFeatureKey === key) ? "selected" : "";
    return `
      <tr class="${selClass}" data-fid="${fid}">
        <td>${idx+1}</td>
        ${cols.map(c => `<td title="${safeStr(f.properties?.[c])}">${safeStr(f.properties?.[c])}</td>`).join("")}
      </tr>
    `;
  }).join("");

  attrTable.innerHTML = thead + `<tbody>${tbodyRows}</tbody>`;

  attrTable.querySelectorAll("tbody tr").forEach(tr => {
    tr.addEventListener("click", () => {
      const fid = Number(tr.dataset.fid);
      selectedFeatureKey = `${layerId}::${fid}`;
      const lyr = item.byFid?.[fid];
      if (lyr) {
        try{ lyr.openPopup?.(); }catch(e){}
      }
      renderAttributeTable(layerId);
    });
  });
}

attrAddField.addEventListener("click", () => {
  const layerId = activeAttrLayerId || attrLayerSelect.value;
  const item = layerStore[layerId];
  if (!item) return;

  const name = prompt("Yeni kolon adı (örn: status):");
  if (!name) return;

  const defVal = prompt("Varsayılan değer (boş bırakılabilir):", "") ?? "";

  item.geojson.features.forEach(f => {
    f.properties = f.properties || {};
    if (f.properties[name] === undefined) f.properties[name] = defVal;
  });

  renderAttributeTable(layerId);
});

function toCsv(rows, cols){
  const esc = (v) => {
    const s = safeStr(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
    return s;
  };
  const header = cols.map(esc).join(",");
  const body = rows.map(f => cols.map(c => esc(f.properties?.[c])).join(",")).join("\n");
  return header + "\n" + body;
}

attrExportCsv.addEventListener("click", () => {
  const layerId = activeAttrLayerId || attrLayerSelect.value;
  const item = layerStore[layerId];
  if (!item) return;

  const all = item.geojson.features || [];
  const filter = parseFilterExpr(attrFilter.value);
  const rows = all.filter(f => featurePassesFilter(f, filter));
  const cols = getAllColumns(rows.length ? rows : all);

  const csv = toCsv(rows, cols);
  const blob = new Blob([csv], { type:"text/csv;charset=utf-8;" });

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${item.def.name}_attribute_table.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
});

// ================== TOOLBOX (MEASURE) ==================
const toolbox = document.getElementById("toolbox");
const toolsBtn = document.getElementById("toolsBtn");
const toolboxClose = document.getElementById("toolboxClose");
const toolboxBody = document.getElementById("toolboxBody");
const toolStatus = document.getElementById("toolStatus");

toolsBtn.addEventListener("click", () => toolbox.classList.toggle("hidden"));
toolboxClose.addEventListener("click", () => toolbox.classList.add("hidden"));

function renderToolbox(){
  toolboxBody.innerHTML = `
    <div class="tb-group">
      <button class="tb-group-head" type="button"><span class="caret">▾</span> Ölçüm</button>
      <div class="tb-items">
        <button class="tb-item" data-tool="measureDistance" type="button"><span class="tb-ico">📏</span><span class="tb-text">Mesafe Ölç</span></button>
        <button class="tb-item" data-tool="measureArea" type="button"><span class="tb-ico">📐</span><span class="tb-text">Alan Ölç</span></button>
        <button class="tb-item danger" data-tool="clearToolDraw" type="button"><span class="tb-ico">🧹</span><span class="tb-text">Çizimleri Temizle</span></button>
      </div>
    </div>

    <div class="tb-group">
      <button class="tb-group-head" type="button"><span class="caret">▾</span> Yeni Katman</button>
      <div class="tb-items">
        <div class="tb-form">
          <label class="tb-label">Katman adı</label>
          <input id="newEditLayerName" class="tb-input" placeholder="örn: test"/>

          <label class="tb-label">Geometri tipi</label>
          <select id="newEditGeom" class="tb-select">
            <option value="point">Nokta</option>
            <option value="line">Çizgi</option>
            <option value="polygon">Poligon</option>
          </select>

          <button id="createEditLayerBtn" class="btn primary tb-create" type="button">Oluştur</button>
          <div class="tb-mini">Oluşturduktan sonra Katmanlar sekmesinde görünecek.</div>
        </div>
      </div>
    </div>
  `;

  const caretButtons = toolboxBody.querySelectorAll(".tb-group-head");
  caretButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const items = btn.parentElement.querySelector(".tb-items");
      items.classList.toggle("hidden");
      btn.querySelector(".caret").textContent = items.classList.contains("hidden") ? "▸" : "▾";
    });
  });

  toolboxBody.querySelectorAll(".tb-item").forEach(btn => {
    btn.addEventListener("click", () => {
      const t = btn.dataset.tool;

      if (t === "clearToolDraw") {
        clearToolDraw();
        toolStatus.textContent = "Temizlendi";
        setStatus("Ölçüm çizimleri temizlendi");
        return;
      }

      if (t === "measureDistance" || t === "measureArea") {
        cancelEdit();
        setActiveTool(t);
        toolStatus.textContent = `Seçildi: ${t}`;
        setStatus(`Araç: ${t} • Haritada tıkla, çift tıkla bitir`);
        return;
      }
    });
  });

  const createBtn = toolboxBody.querySelector("#createEditLayerBtn");
  createBtn.addEventListener("click", () => {
    const name = (toolboxBody.querySelector("#newEditLayerName").value || "").trim();
    const geom = toolboxBody.querySelector("#newEditGeom").value;
    if (!name) { alert("Katman adı gir."); return; }

    const id = `edit_${Date.now()}`;
    const geojson = { type:"FeatureCollection", features:[] };
    initLayer({
      id,
      name,
      group: "İçe Aktarılanlar",
      geom,
      color: "#2563eb",
      fillColor: "#2563eb",
      fillOpacity: 0.2,
      weight: 2,
      dash: "solid"
    }, geojson, true);

    openTab("layers");
    toolbox.classList.add("hidden");
  });
}
renderToolbox();

/* ======= MEASURE TOOL ======= */
let activeTool = null;
let drawLayer = L.featureGroup().addTo(map);
let drawPoints = [];
let tempLine = null;
let tempPoly = null;
let tempMarkers = [];
let previewPoint = null;

function clearToolDraw() {
  activeTool = null;
  drawPoints = [];
  drawLayer.clearLayers();
  tempLine = null;
  tempPoly = null;
  tempMarkers = [];
  previewPoint = null;
}

function setActiveTool(tool) {
  activeTool = tool;
  drawPoints = [];
  previewPoint = null;

  if (tempLine) { drawLayer.removeLayer(tempLine); tempLine = null; }
  if (tempPoly) { drawLayer.removeLayer(tempPoly); tempPoly = null; }
  tempMarkers.forEach(m => drawLayer.removeLayer(m));
  tempMarkers = [];
}

function distMeters(a, b) { return map.distance(a, b); }

function polygonAreaM2(latlngs) {
  const pts = latlngs.map(ll => map.options.crs.project(ll));
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    area += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  }
  return Math.abs(area / 2);
}

function fmtDistance(m) {
  if (m >= 1000) return (m/1000).toFixed(2) + " km";
  return Math.round(m) + " m";
}
function fmtArea(m2) {
  if (m2 >= 1e6) return (m2/1e6).toFixed(2) + " km²";
  if (m2 >= 1e4) return (m2/1e4).toFixed(2) + " ha";
  return Math.round(m2) + " m²";
}

function updateMeasurePreview(mouseLatLng){
  if (!activeTool) return;
  if (!drawPoints.length) return;

  previewPoint = mouseLatLng;

  if (activeTool === "measureDistance") {
    const pts = [...drawPoints, previewPoint];
    if (!tempLine) {
      tempLine = L.polyline(pts, { weight: 3 });
      drawLayer.addLayer(tempLine);
    } else {
      tempLine.setLatLngs(pts);
    }

    let total = 0;
    for (let i = 1; i < pts.length; i++) total += distMeters(pts[i-1], pts[i]);

    setStatus(`Mesafe: ${fmtDistance(total)} • Çift tıkla bitir`);
    toolStatus.textContent = `Mesafe: ${fmtDistance(total)}`;
  }

  if (activeTool === "measureArea") {
    const pts = [...drawPoints, previewPoint];

    if (!tempPoly) {
      tempPoly = L.polygon(pts, { weight: 3, fillOpacity: 0.15 });
      drawLayer.addLayer(tempPoly);
    } else {
      tempPoly.setLatLngs(pts);
    }

    if (pts.length >= 3) {
      const a = polygonAreaM2(pts);
      setStatus(`Alan: ${fmtArea(a)} • Çift tıkla bitir`);
      toolStatus.textContent = `Alan: ${fmtArea(a)}`;
    } else {
      setStatus(`Alan ölçümü: en az 3 nokta • Çift tıkla bitir`);
      toolStatus.textContent = `Alan: —`;
    }
  }
}

function updateEditPreview(mouseLatLng){
  if (!activeEdit) return;
  if (activeEdit.geom === "point") return;
  if (!activeEdit.points.length) return;

  activeEdit.previewPoint = mouseLatLng;

  if (activeEdit.geom === "line"){
    const pts = [...activeEdit.points, activeEdit.previewPoint];
    if (!activeEdit.tempLine) {
      activeEdit.tempLine = L.polyline(pts, { weight: 3 });
      drawLayer.addLayer(activeEdit.tempLine);
    } else {
      activeEdit.tempLine.setLatLngs(pts);
    }
  }

  if (activeEdit.geom === "polygon"){
    const pts = [...activeEdit.points, activeEdit.previewPoint];
    if (!activeEdit.tempPoly) {
      activeEdit.tempPoly = L.polygon(pts, { weight: 3, fillOpacity: 0.15 });
      drawLayer.addLayer(activeEdit.tempPoly);
    } else {
      activeEdit.tempPoly.setLatLngs(pts);
    }
  }
}

map.on("mousemove", (e) => {
  if (activeTool) updateMeasurePreview(e.latlng);
  if (activeEdit) updateEditPreview(e.latlng);
});

map.on("click", (e) => {
  if (activeEdit){
    const ll = e.latlng;

    if (activeEdit.geom === "point"){
      const feature = {
        type:"Feature",
        properties: { name:"" },
        geometry: { type:"Point", coordinates:[ll.lng, ll.lat] }
      };
      addFeatureToLayer(activeEdit.layerId, feature);
      cancelEdit();
      return;
    }

    activeEdit.points.push(ll);
    const mk = L.circleMarker(ll, { radius: 5, weight: 2, fillOpacity: 0.9 });
    activeEdit.markers.push(mk);
    drawLayer.addLayer(mk);

    updateEditPreview(ll);
    return;
  }

  if (!activeTool) return;

  const ll = e.latlng;
  drawPoints.push(ll);

  const mk = L.circleMarker(ll, { radius: 5, weight: 2, fillOpacity: 0.9 });
  tempMarkers.push(mk);
  drawLayer.addLayer(mk);

  updateMeasurePreview(ll);
});

map.on("dblclick", (e) => {
  if (activeEdit){
    L.DomEvent.stop(e);

    const lid = activeEdit.layerId;
    const geom = activeEdit.geom;

    if (geom === "line" && activeEdit.points.length >= 2){
      const coords = activeEdit.points.map(p => [p.lng, p.lat]);
      const feature = {
        type:"Feature",
        properties: { name:"" },
        geometry: { type:"LineString", coordinates: coords }
      };
      addFeatureToLayer(lid, feature);
    }

    if (geom === "polygon" && activeEdit.points.length >= 3){
      const ring = activeEdit.points.map(p => [p.lng, p.lat]);
      ring.push([activeEdit.points[0].lng, activeEdit.points[0].lat]);
      const feature = {
        type:"Feature",
        properties: { name:"" },
        geometry: { type:"Polygon", coordinates:[ring] }
      };
      addFeatureToLayer(lid, feature);
    }

    cancelEdit();
    return;
  }

  if (!activeTool) return;
  L.DomEvent.stop(e);

  if (activeTool === "measureDistance" && tempLine) {
    const pts = [...drawPoints];
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += distMeters(pts[i-1], pts[i]);
    tempLine.setLatLngs(pts);
    tempLine.bindPopup(`Mesafe: <b>${fmtDistance(total)}</b>`).openPopup();
  }

  if (activeTool === "measureArea" && tempPoly && drawPoints.length >= 3) {
    const pts = [...drawPoints];
    const a = polygonAreaM2(pts);
    tempPoly.setLatLngs(pts);
    tempPoly.bindPopup(`Alan: <b>${fmtArea(a)}</b>`).openPopup();
  }

  activeTool = null;
  drawPoints = [];
  previewPoint = null;
  tempLine = null;
  tempPoly = null;
  tempMarkers = [];
  toolStatus.textContent = "Hazır";
  setStatus("Hazır");
});

// ================== AUTH STATE ==================
let currentUser = null;
const userLine = document.getElementById("userLine");
const logoutBtn = document.getElementById("logoutBtn");

// Çıkış
logoutBtn.addEventListener("click", async () => {
  try{
    await signOut(auth);
    alert("Çıkış yapıldı.");
  }catch(e){
    console.error(e);
    alert("Çıkış yapılamadı.");
  }
});

onAuthStateChanged(auth, async (u) => {
  currentUser = u || null;

  if (!u) {
    resetAppLayersOnly();
    authScreen.style.display = "grid";
    appRoot.style.display = "none";
    userLine.textContent = "—";
    setStatus("Hazır");
    return;
  }

  authScreen.style.display = "none";
  appRoot.style.display = "grid";
  userLine.textContent = u.email || u.uid;

  resetAppLayersOnly();
  refreshLeafletAfterShow();

  try{
    setStatus("Katmanlar yükleniyor...");
    await loadDefaultLayersFromDataFolder();
    setStatus("Varsayılan katmanlar yüklendi ✅");
  }catch(err){
    console.error(err);
    setStatus("Yükleme hatası ❌");
  }

  refreshLeafletAfterShow();
});
